import { AnalysisEngine } from '../../shared/engine';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { config } from '../../config';
import { isSystemGeneratedComment } from '../../shared/systemComment';
import { classifyDeterministic } from '../../modules/ai/deterministicClassifier';
import fs from 'fs';
import path from 'path';

export const PENDING_AI_MARKER = '__PENDING_AI__';

export class SalesCopilotService implements AnalysisEngine {
  public name = 'Sales Copilot Analyzer';

  /**
   * Cleans HTML tags from text.
   */
  private cleanHtml(rawHtml: string): string {
    if (!rawHtml) return '';
    let text = rawHtml.replace(/<\/p>|<br\s*\/?>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/\n\s*\n/g, '\n');
    return text.trim();
  }

  /**
   * Identifies real sales agent comments.
   */
  private isRealSalesComment(desc: string, commentedBy: string, commentType: string): boolean {
    if (!desc) return false;
    if (commentType !== 'internal') return false;
    if (isSystemGeneratedComment(desc, commentedBy)) return false;
    return true;
  }

  /**
   * Classifies the latest comment's badges. Deterministic rules run FIRST
   * (100% repeatable for common comment patterns); if no rule matches,
   * returns null so the worker can mark the estimate as pending AI
   * (the actual LLM call happens in GitHub Actions via the Cloudflare Tunnel).
   */
  private classifyBadges(latestComment: string, dateVal: string): any {
    const rule = classifyDeterministic(latestComment, dateVal);
    if (rule) {
      logger.info({ rule: true }, 'SalesCopilotService: deterministic badge classification');
      return rule;
    }
    return null; // no LLM on worker - GitHub Actions will handle AI via Cloudflare Tunnel
  }

  /**
   * Parses the raw Zoho curl-export content into a URL + headers + orgId.
   * Shared by the local fs path and the Worker secret path.
   */
  private parseCurlContent(content: string): { url: string; headers: Record<string, string>; orgId: string } | null {
    try {
      // Extract URL
      const urlMatch = content.match(/curl\s+'([^']+)'/) || content.match(/curl\s+"([^"]+)"/) || content.match(/curl\s+([^\s\\]+)/);
      const url = urlMatch ? urlMatch[1] : '';

      // Extract headers
      const headers: Record<string, string> = {};
      const headerMatches = content.matchAll(/-H\s+'([^:]+):\s*(.*?)'(?=\s|\\|$)/g);
      for (const m of headerMatches) {
        headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
      }

      if (Object.keys(headers).length === 0) {
        const headerMatchesDouble = content.matchAll(/-H\s+"([^:]+):\s*(.*?)"(?=\s|\\|$)/g);
        for (const m of headerMatchesDouble) {
          headers[m[1].trim()] = m[2].trim().replace(/\\$/, '').trim();
        }
      }

      // Extract org ID
      let orgId = '';
      const orgMatch = url.match(/organization_id=([0-9]+)/);
      if (orgMatch) {
        orgId = orgMatch[1];
      }

      if (headers['Accept-Encoding']) {
        headers['Accept-Encoding'] = 'gzip, deflate';
      }

      if (!url || Object.keys(headers).length === 0) {
        logger.error('SalesCopilotService: could not extract URL or headers from curl content');
        return null;
      }

      return { url, headers, orgId };
    } catch (err: any) {
      logger.error({ error: err.message }, 'SalesCopilotService: failed to parse curl credentials');
      return null;
    }
  }

  /**
   * Parses Zoho curl credentials. On the Worker (no fs), the full curl-export
   * content is provided via the ZOHO_CURL_CONTENT secret and parsed with the
   * same logic as the local sent_estimates.txt file. Env url+token is kept as a
   * secondary fallback for an OAuth-token style auth.
   */
  private parseCurlFile(): { url: string; headers: Record<string, string>; orgId: string } | null {
    const readSecret = (key: string): string | undefined =>
      (globalThis as any)?.__WORKER_ENV__?.[key] ??
      (globalThis as any)?.process?.env?.[key] ??
      (globalThis as any)?.[key];

    // 1. Full curl-export content from a Worker secret / env (cookie-based auth).
    const envContent = readSecret('ZOHO_CURL_CONTENT');
    if (envContent) {
      const parsed = this.parseCurlContent(envContent);
      if (parsed) return parsed;
    }

    // 2. OAuth-token style env vars (secondary).
    const envUrl = readSecret('ZOHO_BOOKS_SENT_URL');
    const envToken = readSecret('ZOHO_BOOKS_AUTH_TOKEN');
    if (envUrl && envToken) {
      const orgMatch = envUrl.match(/organization_id=([0-9]+)/);
      return {
        url: envUrl,
        headers: {
          Authorization: `Zoho-oauthtoken ${envToken}`,
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        orgId: orgMatch ? orgMatch[1] : '',
      };
    }

    // 3. Local fs file (dev / self-hosted).
    try {
      let curlFile = path.join('/app', 'zoho_sent', 'sent_estimates.txt');
      if (!fs.existsSync(curlFile)) {
        curlFile = path.join(__dirname, '..', '..', '..', 'zoho_sent', 'sent_estimates.txt');
      }
      if (!fs.existsSync(curlFile)) {
        curlFile = path.join(__dirname, '..', '..', '..', '..', 'zoho_sent', 'sent_estimates.txt');
      }
      if (!fs.existsSync(curlFile)) {
        logger.error(`SalesCopilotService: credentials file not found at: ${curlFile}`);
        return null;
      }
      return this.parseCurlContent(fs.readFileSync(curlFile, 'utf-8'));
    } catch (err: any) {
      logger.error({ error: err.message }, 'SalesCopilotService: failed to parse curl credentials file');
      return null;
    }
  }

  /**
   * Shared lock so the manual force sync and the cron incremental sync never run
   * concurrently (both would otherwise fetch comments + spend AI credits).
   */
  public static isSyncRunning = false;

  /**
   * Main sync engine. Crawls estimates, analyzes, and performs Notion matching.
   */
  public async runSync(force: boolean = false): Promise<any> {
    if (SalesCopilotService.isSyncRunning) {
      throw new Error('Sales Copilot sync is already running. Please wait.');
    }
    SalesCopilotService.isSyncRunning = true;
    try {
      return await this.syncNow(force);
    } finally {
      SalesCopilotService.isSyncRunning = false;
    }
  }

  private async syncNow(force: boolean): Promise<any> {
    logger.info(`SalesCopilotService: Starting sync execution (force: ${force})...`);
    const creds = this.parseCurlFile();
    if (!creds) {
      throw new Error('Could not parse Zoho credentials from sent_estimates.txt');
    }

    const { url, headers, orgId } = creds;

    // 1. Fetch active estimates from Zoho Books
    logger.info('SalesCopilotService: Fetching sent estimates from Zoho Books...');
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch estimates: ${response.status} ${await response.text()}`);
    }

    const responseJson = (await response.json()) as any;
    const estimates = responseJson.estimates || [];
    logger.info(`SalesCopilotService: Fetched ${estimates.length} active sent estimates from Zoho.`);

    const activeEstIds = new Set<string>();

    // 2. Load the current DB state once. This single read is reused by both the
    //    metadata sync and the AI change-detection below — previously we did one
    //    findUnique per estimate on top of the metadata writes, so a full tick ran
    //    ~200 sequential DB queries even when nothing had changed.
    const existingRows = await prisma.estimate.findMany({
      where: { estimateId: { in: estimates.map(e => e.estimate_id) } },
      include: { classification: true }
    });
    const existingByEstId = new Map<string, any>();
    for (const row of existingRows) existingByEstId.set(row.estimateId, row);

    // 3. FAST metadata sync — ALWAYS runs first, before any AI analysis. This
    //    brings the DB in sync with Zoho's current state immediately (new
    //    estimates created, totals/statuses/names refreshed). Rows whose fields
    //    already match Zoho are skipped so we never rewrite the same data every tick.
    let metadataUpdated = 0;
    for (const est of estimates) {
      activeEstIds.add(est.estimate_id);

      const metadata = {
        estimateNumber: est.estimate_number,
        customerName: est.customer_name,
        total: parseFloat(est.total),
        date: est.date,
        status: est.status
      };
      const existing = existingByEstId.get(est.estimate_id);
      const unchanged = !!existing &&
        existing.estimateNumber === metadata.estimateNumber &&
        existing.customerName === metadata.customerName &&
        existing.total === metadata.total &&
        existing.date === metadata.date &&
        existing.status === metadata.status;

      if (unchanged) continue;

      await prisma.estimate.upsert({
        where: { estimateId: est.estimate_id },
        update: metadata,
        create: { estimateId: est.estimate_id, ...metadata, lastSyncTime: new Date() }
      });
      metadataUpdated++;
    }
    logger.info(`SalesCopilotService: Metadata sync updated ${metadataUpdated} of ${estimates.length} estimates.`);

    // 4. Closed status sync — estimates that left the "sent" list in Zoho
    // (accepted/declined/etc.). Runs before AI so statuses are in sync too.
    await this.syncClosedStatuses(activeEstIds, orgId, headers);

    // 5. Comment refresh — ALWAYS runs for every sent estimate on every tick.
    //    Zoho Books comments do NOT bump the estimate's last_modified_time, so the
    //    incremental gate below would otherwise never re-fetch new sales comments
    //    and the dashboard's "last comment" age/counts would go stale. Comments are
    //    fetched in parallel (small concurrency), and new comments are detected by
    //    comparing Zoho's max comment_id against the highest one stored in the DB.
    const dbMaxCommentIdByEst = new Map<string, string>();
    {
      const rows = await prisma.comment.groupBy({
        by: ['estimateId'],
        _max: { commentId: true }
      });
      for (const r of rows) dbMaxCommentIdByEst.set(r.estimateId, (r._max.commentId as string) || '');
    }

    const fetchedCommentsByEst = new Map<string, { comments: any[]; hasNew: boolean }>();
    const COMMENT_FETCH_CONCURRENCY = 6;
    for (let i = 0; i < estimates.length; i += COMMENT_FETCH_CONCURRENCY) {
      const batch = estimates.slice(i, i + COMMENT_FETCH_CONCURRENCY);
      await Promise.all(batch.map(async (est) => {
        const estId = est.estimate_id;
        const estNo = est.estimate_number;
        try {
          const commentsUrl = `https://books.zoho.com/api/v3/estimates/${estId}/comments?organization_id=${orgId}`;
          const commentsRes = await fetch(commentsUrl, { headers });
          if (!commentsRes.ok) {
            logger.warn(`SalesCopilotService: Failed to fetch comments for ${estNo}: ${commentsRes.status}`);
            return;
          }
          const commentsJson = (await commentsRes.json()) as any;
          const comments = commentsJson.comments || [];
          let maxZohoId = '';
          for (const c of comments) {
            if (!this.isRealSalesComment(c.description || '', c.commented_by, c.comment_type)) continue;
            if (c.comment_id > maxZohoId) maxZohoId = c.comment_id;
          }
          const hasNew = maxZohoId > (dbMaxCommentIdByEst.get(estId) || '');
          fetchedCommentsByEst.set(estId, { comments, hasNew });
        } catch (err: any) {
          logger.warn({ error: err.message }, `SalesCopilotService: Failed to fetch comments for ${estNo} due to network error`);
        }
      }));
    }

    // 6. AI analysis — comments are already fresh; classification runs only for
    //    estimates that are new, modified since their last sync, forced, or that
    //    gained new comments. Skipped estimates keep their old lastSyncTime, so
    //    anything changed while the machine was off is picked up on the next run.
    //    Processing is PARALLEL (concurrency pool) to cut wall-clock time, and any
    //    estimate that fails (e.g. all 3 LLM models error) is retried once after
    //    5 minutes. If it still fails, its lastSyncTime is NOT advanced, so the
    //    next 15-minute tick re-processes it.
    const AI_CONCURRENCY = 6;
    const AI_RETRY_DELAY_MS = 5 * 60 * 1000;
    let processedCount = 0;
    let skippedCount = 0;
    let neededCount = 0;
    let failedCount = 0;

    // ---- Gather the work list (change detection) ----
    const workItems: Array<{ estId: string; estNo: string; custName: string; total: number; dateVal: string; estStatus: string; existingEstimate: any; fetched: any }> = [];
    for (const est of estimates) {
      const estId = est.estimate_id;
      const estNo = est.estimate_number;
      const custName = est.customer_name;
      const total = parseFloat(est.total);
      const dateVal = est.date;
      const estStatus = est.status;

      const lastModified = est.last_modified_time ? new Date(est.last_modified_time) : null;
      const existingEstimate = existingByEstId.get(estId);

      const statusChanged = !existingEstimate || existingEstimate.status !== estStatus;
      const neverAnalyzed = !existingEstimate?.classification;
      const modifiedSinceLastSync = !!lastModified && !!existingEstimate &&
        lastModified.getTime() > existingEstimate.lastSyncTime.getTime();

      const fetched = fetchedCommentsByEst.get(estId);
      if (!fetched) {
        // Comment fetch failed this tick — skip without advancing lastSyncTime
        // so the estimate is retried on the next run. Also marks this run as
        // incomplete: we couldn't verify every estimate.
        failedCount++;
        continue;
      }
      const hasNewComments = fetched.hasNew;
      const needsProcessing = force || statusChanged || neverAnalyzed || modifiedSinceLastSync || hasNewComments;

      if (!needsProcessing) {
        skippedCount++;
        continue;
      }
      neededCount++;
      workItems.push({ estId, estNo, custName, total, dateVal, estStatus, existingEstimate, fetched });
    }

    // ---- Parallel processing worker pool. Returns the jobs that failed. ----
    const runWorkerPool = async (items: Array<{ estId: string; estNo: string; custName: string; total: number; dateVal: string; estStatus: string; existingEstimate: any; fetched: any }>): Promise<typeof items> => {
      let index = 0;
      const failed: typeof items = [];
      const runner = async () => {
        while (index < items.length) {
          const job = items[index++];
          try {
            await this.processEstimate(job);
            processedCount++;
          } catch (err: any) {
            logger.error({ error: err.message }, `SalesCopilotService: AI processing error for ${job.estNo}`);
            failed.push(job);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, items.length) }, () => runner()));
      return failed;
    };

    let failedItems = await runWorkerPool(workItems);
    if (failedItems.length > 0) {
      logger.warn(`SalesCopilotService: ${failedItems.length} estimates failed AI processing. Retrying in 5 minutes...`);
      await new Promise(r => setTimeout(r, AI_RETRY_DELAY_MS));
      const stillFailed = await runWorkerPool(failedItems);
      failedCount += stillFailed.length;
      if (stillFailed.length > 0) {
        logger.warn(`SalesCopilotService: ${stillFailed.length} estimates still failing after retry — left unprocessed for the next 15-minute tick.`);
      }
    }

    logger.info(`SalesCopilotService: Processed ${processedCount} estimates, skipped ${skippedCount}.`);

    // A run is only "complete" when every estimate that needed processing (new
    // or modified since its last sync) was actually processed with zero
    // failures. Only then is the watermark advanced — the dashboard's "Last
    // synced" time reflects the last fully-completed processing pass, not just
    // any sync/analyze run. A run where nothing needed processing leaves the
    // existing watermark untouched.
    const complete = neededCount > 0 && failedCount === 0;
    if (complete) {
      const completedAt = new Date();
      await prisma.setting.upsert({
        where: { key: 'sales_copilot:last_complete_sync_at' },
        update: { value: completedAt.toISOString() },
        create: { key: 'sales_copilot:last_complete_sync_at', value: completedAt.toISOString() }
      });
      logger.info(`SalesCopilotService: Complete processing pass finished at ${completedAt.toISOString()} (needed ${neededCount}, failed ${failedCount}).`);
    } else {
      logger.warn(`SalesCopilotService: Sync run incomplete — needed ${neededCount}, failed ${failedCount}. Watermark not advanced.`);
    }

    return { success: true, processedCount, skippedCount, neededCount, failedCount, complete };
  }

  /**
   * Saves an estimate's comments, then runs classification (badges from the
   * latest comment only; summary + intent score from the full journey). Advances
   * lastSyncTime only on success so a failure leaves the estimate for retry.
   */
  private async processEstimate(job: {
    estId: string;
    estNo: string;
    custName: string;
    total: number;
    dateVal: string;
    estStatus: string;
    existingEstimate: any;
    fetched: any;
  }): Promise<void> {
    const { estId, estNo, custName, total, dateVal, fetched } = job;

    // Save comments and extract sales agent comments
    const comments = fetched.comments;
    const salesComments: Array<{ id: string; date: string; author: string; text: string }> = [];

    for (const c of comments) {
      const descClean = this.cleanHtml(c.description || '');

      await prisma.comment.upsert({
        where: { commentId: c.comment_id },
        update: {
          estimateId: estId,
          description: descClean,
          commentedBy: c.commented_by,
          date: c.date,
          dateDescription: c.date_description,
          dateFormatted: c.date_formatted || null
        },
        create: {
          commentId: c.comment_id,
          estimateId: estId,
          description: descClean,
          commentedBy: c.commented_by,
          date: c.date,
          dateDescription: c.date_description,
          dateFormatted: c.date_formatted || null
        }
      });

      if (this.isRealSalesComment(descClean, c.commented_by, c.comment_type)) {
        salesComments.push({
          id: c.comment_id,
          date: c.date || '',
          author: c.commented_by || 'Unknown',
          text: descClean
        });
      }
    }

    // Sort timeline latest first using sequential Zoho comment IDs
    salesComments.sort((a, b) => b.id.localeCompare(a.id));
    const historyLines = salesComments.slice(0, 15).map(c => `[${c.date}] ${c.author}: ${c.text}`);
    const commentHistory = historyLines.join('\n');

    if (!commentHistory) {
      // No comments found: default values directly (no LLM call needed)
      const createdDate = new Date(dateVal);
      const diffDays = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000));
      const isOlderThan5Days = diffDays > 5;

      await prisma.classification.upsert({
        where: { estimateId: estId },
        update: {
          meaningfulUpdate: false,
          notAnswering: 'No',
          movingSlow: isOlderThan5Days ? 'Yes' : 'No',
          underDiscussion: 'No',
          confirm: 'No',
          intentScore: 2,
          reasoning: 'No sales agent comment found.',
          summary: 'No sales agent comment found.',
          processedAt: new Date()
        },
        create: {
          estimateId: estId,
          meaningfulUpdate: false,
          notAnswering: 'No',
          movingSlow: isOlderThan5Days ? 'Yes' : 'No',
          underDiscussion: 'No',
          confirm: 'No',
          intentScore: 2,
          reasoning: 'No sales agent comment found.',
          summary: 'No sales agent comment found.'
        }
      });
    } else {
      // Split concerns: badges come from ONLY the single latest comment;
      // summary + intent score come from the entire journey timeline.
      const latestComment = historyLines[0] || '';
      const badgeResult = this.classifyBadges(latestComment, dateVal);
      const createdDate = new Date(dateVal);
      const isOlderThan5Days = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000)) > 5;

      let finalConfirm = 'No';
      let journeyResult = { summary: '', intent_score: 2 };

      if (badgeResult) {
        // Deterministic rule matched - write full classification
        if (badgeResult.confirm) {
          const confirmDateStr = badgeResult.confirm_date;
          if (confirmDateStr && confirmDateStr !== 'None') {
            try {
              const confirmDate = new Date(confirmDateStr);
              const diffDays = Math.floor((Date.now() - confirmDate.getTime()) / (24 * 60 * 60 * 1000));
              if (diffDays <= 2) finalConfirm = 'Yes';
            } catch (e) {
              finalConfirm = 'No';
            }
          }
        }

        // Deterministic journey summary (no LLM on worker)
        journeyResult = { summary: 'Deterministic classification.', intent_score: badgeResult.meaningful_update ? 4 : 2 };

        await prisma.classification.upsert({
          where: { estimateId: estId },
          update: {
            meaningfulUpdate: badgeResult.meaningful_update,
            notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
            movingSlow: isOlderThan5Days ? 'Yes' : 'No',
            underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
            confirm: finalConfirm,
            intentScore: journeyResult.intent_score,
            reasoning: badgeResult.reasoning,
            summary: journeyResult.summary || '',
            processedAt: new Date()
          },
          create: {
            estimateId: estId,
            meaningfulUpdate: badgeResult.meaningful_update,
            notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
            movingSlow: isOlderThan5Days ? 'Yes' : 'No',
            underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
            confirm: finalConfirm,
            intentScore: journeyResult.intent_score,
            reasoning: badgeResult.reasoning,
            summary: journeyResult.summary || ''
          }
        });
      } else {
        // No deterministic rule matched - mark as pending AI for GitHub Actions
        await prisma.classification.upsert({
          where: { estimateId: estId },
          update: {
            meaningfulUpdate: false,
            notAnswering: 'No',
            movingSlow: isOlderThan5Days ? 'Yes' : 'No',
            underDiscussion: 'No',
            confirm: 'No',
            intentScore: null,
            reasoning: PENDING_AI_MARKER,
            summary: '',
            processedAt: new Date()
          },
          create: {
            estimateId: estId,
            meaningfulUpdate: false,
            notAnswering: 'No',
            movingSlow: isOlderThan5Days ? 'Yes' : 'No',
            underDiscussion: 'No',
            confirm: 'No',
            intentScore: null,
            reasoning: PENDING_AI_MARKER,
            summary: '',
            processedAt: new Date()
          }
        });
      }
    }

    // Advance the per-estimate sync watermark only after successful processing.
    // Skipped estimates keep their old lastSyncTime, so anything modified while
    // the machine was off (e.g. 10h downtime) is detected on the next run.
    await prisma.estimate.update({
      where: { estimateId: estId },
      data: { lastSyncTime: new Date() }
    });
  }

  private async syncClosedStatuses(activeEstIds: Set<string>, orgId: string, headers: Record<string, string>): Promise<void> {
    // Fetch estimates currently labeled "sent" in local DB
    const localSentEstimates = await prisma.estimate.findMany({
      where: { status: 'sent' }
    });

    for (const est of localSentEstimates) {
      if (!activeEstIds.has(est.estimateId)) {
        logger.info(`SalesCopilotService: Checking closed status for estimate ${est.estimateNumber}...`);
        try {
          const detailUrl = `https://books.zoho.com/api/v3/estimates/${est.estimateId}?organization_id=${orgId}`;
          const detailRes = await fetch(detailUrl, { headers });
          if (detailRes.ok) {
            const detailJson = (await detailRes.json()) as any;
            const currentStatus = detailJson.estimate?.status;
            if (currentStatus && currentStatus !== 'sent') {
              logger.info(`SalesCopilotService: Estimate ${est.estimateNumber} status updated to: ${currentStatus}`);
              await prisma.estimate.update({
                where: { estimateId: est.estimateId },
                data: { status: currentStatus, lastSyncTime: new Date() }
              });

              // Fetch comments for this now-closed estimate to analyze its final comments (e.g. why it was declined/accepted)
              let commentsJson: any = { comments: [] };
              try {
                const commentsUrl = `https://books.zoho.com/api/v3/estimates/${est.estimateId}/comments?organization_id=${orgId}`;
                const commentsRes = await fetch(commentsUrl, { headers });
                if (commentsRes.ok) {
                  commentsJson = (await commentsRes.json()) as any;
                }
              } catch (err: any) {
                logger.warn(`SalesCopilotService: Failed to fetch comments for closed estimate ${est.estimateNumber}`);
              }

              const comments = commentsJson.comments || [];
              const salesComments: Array<{ id: string; date: string; author: string; text: string }> = [];

              for (const c of comments) {
                const descClean = this.cleanHtml(c.description || '');
                await prisma.comment.upsert({
                  where: { commentId: c.comment_id },
                  update: {
                    estimateId: est.estimateId,
                    description: descClean,
                    commentedBy: c.commented_by,
                    date: c.date,
                    dateDescription: c.date_description,
                    dateFormatted: c.date_formatted || null
                  },
                  create: {
                    commentId: c.comment_id,
                    estimateId: est.estimateId,
                    description: descClean,
                    commentedBy: c.commented_by,
                    date: c.date,
                    dateDescription: c.date_description,
                    dateFormatted: c.date_formatted || null
                  }
                });

                if (this.isRealSalesComment(descClean, c.commented_by, c.comment_type)) {
                  salesComments.push({
                    id: c.comment_id,
                    date: c.date || '',
                    author: c.commented_by || 'Unknown',
                    text: descClean
                  });
                }
              }

              salesComments.sort((a, b) => b.id.localeCompare(a.id));
              const historyLines = salesComments.slice(0, 15).map(c => `[${c.date}] ${c.author}: ${c.text}`);
              const commentHistory = historyLines.join('\n');

              if (commentHistory) {
                const latestComment = historyLines[0] || '';
                const badgeResult = this.classifyBadges(latestComment, est.date);
                if (badgeResult) {
                  let finalConfirm = 'No';
                  if (badgeResult.confirm) {
                    const confirmDateStr = badgeResult.confirm_date;
                    if (confirmDateStr && confirmDateStr !== 'None') {
                      try {
                        const confirmDate = new Date(confirmDateStr);
                        const diffDays = Math.floor((Date.now() - confirmDate.getTime()) / (24 * 60 * 60 * 1000));
                        if (diffDays <= 2) finalConfirm = 'Yes';
                      } catch (e) {
                        finalConfirm = 'No';
                      }
                    }
                  }
                  const journeyResult = { summary: 'Deterministic classification.', intent_score: badgeResult.meaningful_update ? 4 : 2 };
                  await prisma.classification.upsert({
                    where: { estimateId: est.estimateId },
                    update: {
                      meaningfulUpdate: badgeResult.meaningful_update,
                      notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
                      movingSlow: 'No',
                      underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
                      confirm: finalConfirm,
                      intentScore: journeyResult.intent_score,
                      reasoning: badgeResult.reasoning,
                      summary: journeyResult.summary || '',
                      processedAt: new Date()
                    },
                    create: {
                      estimateId: est.estimateId,
                      meaningfulUpdate: badgeResult.meaningful_update,
                      notAnswering: badgeResult.not_answering ? 'Yes' : 'No',
                      movingSlow: 'No',
                      underDiscussion: badgeResult.under_discussion ? 'Yes' : 'No',
                      confirm: finalConfirm,
                      intentScore: journeyResult.intent_score,
                      reasoning: badgeResult.reasoning,
                      summary: journeyResult.summary || ''
                    }
                  });
                } else {
                  // No deterministic rule - mark pending AI for GitHub Actions
                  await prisma.classification.upsert({
                    where: { estimateId: est.estimateId },
                    update: {
                      meaningfulUpdate: false,
                      notAnswering: 'No',
                      movingSlow: 'No',
                      underDiscussion: 'No',
                      confirm: 'No',
                      intentScore: null,
                      reasoning: PENDING_AI_MARKER,
                      summary: '',
                      processedAt: new Date()
                    },
                    create: {
                      estimateId: est.estimateId,
                      meaningfulUpdate: false,
                      notAnswering: 'No',
                      movingSlow: 'No',
                      underDiscussion: 'No',
                      confirm: 'No',
                      intentScore: null,
                      reasoning: PENDING_AI_MARKER,
                      summary: '',
                      processedAt: new Date()
                    }
                  });
                }
              }
            }
          }
        }
        catch (err: any) {
          logger.warn({ error: err.message }, `SalesCopilotService: Failed to check closed status for ${est.estimateNumber}`);
        }
      }
    }
  }

  /**
   * Dynamic briefings context compilation.
   */
  public async getBriefingContext(): Promise<string> {
    try {
      const estimates = await prisma.estimate.findMany({
        where: { status: 'sent' },
        include: { classification: true }
      });

      if (estimates.length === 0) {
        return 'No active Zoho sent estimates found in priority calling queue.';
      }

      const getSortGroup = (x: any) => {
        const c = x.classification || {};
        if (x.total > 80000) return 1;
        if (c.underDiscussion === 'Yes') return 2;
        if (c.movingSlow === 'Yes') return 3;
        return 4;
      };

      estimates.sort((a, b) => {
        const groupA = getSortGroup(a);
        const groupB = getSortGroup(b);
        if (groupA !== groupB) {
          return groupA - groupB;
        }
        const scoreA = a.classification?.intentScore || 0;
        const scoreB = b.classification?.intentScore || 0;
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return b.total - a.total;
      });

      const lines = estimates.map(e => {
        const score = e.classification?.intentScore || 0;
        const reasons = e.classification?.reasoning || 'No analysis logs.';
        return `- **${e.customerName}** (Est. No: ${e.estimateNumber} | Total: ₹${e.total.toLocaleString()}) - Intent Score: **${score}/10** | Reason: ${reasons}`;
      });

      return `### Zoho Sent Estimates Calling Priority List\n${lines.join('\n')}`;
    } catch (err: any) {
      return `Failed to fetch Zoho Sent Estimate briefings context: ${err.message}`;
    }
  }

  /**
   * EOD digest context compiled metrics.
   */
  public async getEodContext(): Promise<string> {
    try {
      const estimates = await prisma.estimate.findMany({
        where: { status: 'sent' }
      });
      return `- Sent Estimates monitored today: ${estimates.length}`;
    } catch (err: any) {
      return `- Zoho Estimates sync monitor: offline (${err.message})`;
    }
  }
}
