import { AnalysisEngine } from '../../shared/engine';
import { prisma } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { config } from '../../config';
import { AIService } from '../ai/service';
import fs from 'fs';
import path from 'path';

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

    const commentedByLower = (commentedBy || '').toLowerCase();
    if (commentedByLower.includes('system')) return false;

    const descLower = desc.toLowerCase();
    const systemPhrases = [
      'estimate has been created',
      'estimate has been sent',
      'email sent to',
      'mail sent to',
      'status changed from',
      'quote created',
      'sent status',
      'created by',
      'updated by',
      'viewed in mail',
      'client viewed',
      'accepted by',
      'declined by',
      'payment received',
      'has been printed',
      'estimate sent',
      'quote marked as',
      'marked as sent',
      'created for',
      'quote sent',
      'email sent',
      'mail sent'
    ];

    for (const phrase of systemPhrases) {
      if (descLower.includes(phrase)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Parses Zoho curl credentials from local file.
   */
  private parseCurlFile(): { url: string; headers: Record<string, string>; orgId: string } | null {
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
      const content = fs.readFileSync(curlFile, 'utf-8');

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

      return { url, headers, orgId };
    } catch (err: any) {
      logger.error({ error: err.message }, 'SalesCopilotService: failed to parse curl credentials file');
      return null;
    }
  }

  /**
   * Main sync engine. Crawls estimates, analyzes, and performs Notion matching.
   */
  public async runSync(force: boolean = false): Promise<any> {
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

    // 2. Process active estimates
    for (const est of estimates) {
      const estId = est.estimate_id;
      const estNo = est.estimate_number;
      const custName = est.customer_name;
      const total = parseFloat(est.total);
      const dateVal = est.date;
      const estStatus = est.status;

      activeEstIds.add(estId);

      // Save estimate metadata to database
      await prisma.estimate.upsert({
        where: { estimateId: estId },
        update: {
          estimateNumber: estNo,
          customerName: custName,
          total,
          date: dateVal,
          status: estStatus,
          lastSyncTime: new Date()
        },
        create: {
          estimateId: estId,
          estimateNumber: estNo,
          customerName: custName,
          total,
          date: dateVal,
          status: estStatus
        }
      });

      // Fetch estimate comments
      let commentsJson: any = { comments: [] };
      try {
        const commentsUrl = `https://books.zoho.com/api/v3/estimates/${estId}/comments?organization_id=${orgId}`;
        const commentsRes = await fetch(commentsUrl, { headers });
        if (!commentsRes.ok) {
          logger.warn(`SalesCopilotService: Failed to fetch comments for ${estNo}: ${commentsRes.status}`);
          continue;
        }
        commentsJson = (await commentsRes.json()) as any;
      } catch (err: any) {
        logger.warn({ error: err.message }, `SalesCopilotService: Failed to fetch comments for ${estNo} due to network error`);
        continue;
      }

      const comments = commentsJson.comments || [];

      // Query database comment count BEFORE we upsert them to detect new comments
      const commentCountBefore = await prisma.comment.count({ where: { estimateId: estId } });

      // Save comments and extract sales agent comments
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

      // 3. Classify comments using AI
      const existingEstimate = await prisma.estimate.findUnique({
        where: { estimateId: estId },
        include: { classification: true }
      });
      const commentCountDb = await prisma.comment.count({ where: { estimateId: estId } });
      // Force reclassify if: (a) force flag set, (b) no existing classification,
      // (c) comment count changed, or (d) summary is missing (classified before summary field existed)
      const summaryMissing = existingEstimate?.classification && existingEstimate.classification.summary === '';
      const skipAIClassification = !force && existingEstimate?.classification && commentCountBefore === comments.length && !summaryMissing;

      if (!commentHistory) {
        // No comments found: default values directly
        const createdDate = new Date(dateVal);
        const diffDays = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000));
        const isOlderThan3Days = diffDays > 3;
        const isOlderThan5Days = diffDays > 5;

        await prisma.classification.upsert({
          where: { estimateId: estId },
          update: {
            meaningfulUpdate: false,
            followUpMissing: 'Yes',
            notAnswering: 'No',
            improperFollowUp: 'No',
            lastCommentNotSatisfactory: 'No',
            dayExceeded: isOlderThan3Days ? 'Yes' : 'No',
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
            followUpMissing: 'Yes',
            notAnswering: 'No',
            improperFollowUp: 'No',
            lastCommentNotSatisfactory: 'No',
            dayExceeded: isOlderThan3Days ? 'Yes' : 'No',
            movingSlow: isOlderThan5Days ? 'Yes' : 'No',
            underDiscussion: 'No',
            confirm: 'No',
            intentScore: 2,
            reasoning: 'No sales agent comment found.',
            summary: 'No sales agent comment found.'
          }
        });
      } else if (skipAIClassification) {
        logger.info(`SalesCopilotService: Classification for ${estNo} is cached. Skipping AI call.`);
      } else {
        try {
          const result = await AIService.classifyEstimateComments(custName, total, commentHistory, dateVal);
          const createdDate = new Date(dateVal);
          const isOlderThan5Days = Math.floor((Date.now() - createdDate.getTime()) / (24 * 60 * 60 * 1000)) > 5;

          let finalConfirm = result.confirm ? 'Yes' : 'No';
          if (result.confirm) {
            const confirmDateStr = result.confirm_date;
            if (confirmDateStr && confirmDateStr !== 'None') {
              try {
                const confirmDate = new Date(confirmDateStr);
                const diffDays = Math.floor((Date.now() - confirmDate.getTime()) / (24 * 60 * 60 * 1000));
                if (diffDays > 2) {
                  finalConfirm = 'No';
                }
              } catch (e) {
                finalConfirm = 'No';
              }
            } else {
              finalConfirm = 'No';
            }
          }

          await prisma.classification.upsert({
            where: { estimateId: estId },
            update: {
              meaningfulUpdate: result.meaningful_update,
              followUpMissing: result.follow_up_missing ? 'Yes' : 'No',
              notAnswering: result.not_answering ? 'Yes' : 'No',
              improperFollowUp: result.improper_follow_up ? 'Yes' : 'No',
              lastCommentNotSatisfactory: result.last_comment_not_satisfactory ? 'Yes' : 'No',
              dayExceeded: result.day_exceeded ? 'Yes' : 'No',
              movingSlow: (result.moving_slow === true || result.moving_slow === 'Yes' || isOlderThan5Days) ? 'Yes' : 'No',
              underDiscussion: result.under_discussion ? 'Yes' : 'No',
              confirm: finalConfirm,
              intentScore: result.intent_score,
              reasoning: result.reasoning,
              summary: result.summary || '',
              processedAt: new Date()
            },
            create: {
              estimateId: estId,
              meaningfulUpdate: result.meaningful_update,
              followUpMissing: result.follow_up_missing ? 'Yes' : 'No',
              notAnswering: result.not_answering ? 'Yes' : 'No',
              improperFollowUp: result.improper_follow_up ? 'Yes' : 'No',
              lastCommentNotSatisfactory: result.last_comment_not_satisfactory ? 'Yes' : 'No',
              dayExceeded: result.day_exceeded ? 'Yes' : 'No',
              movingSlow: (result.moving_slow === true || result.moving_slow === 'Yes' || isOlderThan5Days) ? 'Yes' : 'No',
              underDiscussion: result.under_discussion ? 'Yes' : 'No',
              confirm: finalConfirm,
              intentScore: result.intent_score,
              reasoning: result.reasoning,
              summary: result.summary || ''
            }
          });
        } catch (err: any) {
          logger.error({ error: err.message }, `SalesCopilotService: AI classification error for ${estNo}`);
        }
      }
    }

    // 4. Closed Status Synchronization
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
                data: { status: currentStatus }
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
              const commentCountBefore = await prisma.comment.count({ where: { estimateId: est.estimateId } });
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

              const existingEstimate = await prisma.estimate.findUnique({
                where: { estimateId: est.estimateId },
                include: { classification: true }
              });
              const summaryMissing = existingEstimate?.classification && existingEstimate.classification.summary === '';
              const skipAIClassification = !force && existingEstimate?.classification && commentCountBefore === comments.length && !summaryMissing;

              if (commentHistory) {
                if (skipAIClassification) {
                  logger.info(`SalesCopilotService: Classification for closed ${est.estimateNumber} is cached. Skipping AI call.`);
                } else {
                  try {
                    const result = await AIService.classifyEstimateComments(est.customerName, est.total, commentHistory, est.date);
                    await prisma.classification.upsert({
                      where: { estimateId: est.estimateId },
                      update: {
                        meaningfulUpdate: result.meaningful_update,
                        followUpMissing: result.follow_up_missing ? 'Yes' : 'No',
                        notAnswering: result.not_answering ? 'Yes' : 'No',
                        improperFollowUp: result.improper_follow_up ? 'Yes' : 'No',
                        lastCommentNotSatisfactory: result.last_comment_not_satisfactory ? 'Yes' : 'No',
                        dayExceeded: result.day_exceeded ? 'Yes' : 'No',
                        movingSlow: (result.moving_slow === true || result.moving_slow === 'Yes') ? 'Yes' : 'No',
                        underDiscussion: result.under_discussion ? 'Yes' : 'No',
                        confirm: result.confirm ? 'Yes' : 'No',
                        intentScore: result.intent_score,
                        reasoning: result.reasoning,
                        summary: result.summary || '',
                        processedAt: new Date()
                      },
                      create: {
                        estimateId: est.estimateId,
                        meaningfulUpdate: result.meaningful_update,
                        followUpMissing: result.follow_up_missing ? 'Yes' : 'No',
                        notAnswering: result.not_answering ? 'Yes' : 'No',
                      improperFollowUp: result.improper_follow_up ? 'Yes' : 'No',
                      lastCommentNotSatisfactory: result.last_comment_not_satisfactory ? 'Yes' : 'No',
                      dayExceeded: result.day_exceeded ? 'Yes' : 'No',
                      movingSlow: (result.moving_slow === true || result.moving_slow === 'Yes') ? 'Yes' : 'No',
                      underDiscussion: result.under_discussion ? 'Yes' : 'No',
                      confirm: result.confirm ? 'Yes' : 'No',
                      intentScore: result.intent_score,
                      reasoning: result.reasoning,
                      summary: result.summary || ''
                    }
                  });
                } catch (err: any) {
                  logger.error({ error: err.message }, `SalesCopilotService: AI classification error for closed estimate ${est.estimateNumber}`);
                }
              }
            }
          }
        }
        } catch (err: any) {
          logger.warn({ error: err.message }, `SalesCopilotService: Failed to check closed status for ${est.estimateNumber}`);
        }
      }
    }

    return { success: true };
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
