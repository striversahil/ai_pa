import { prisma, useInMemoryDb } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { BrainEmbedder } from './embedder';
import crypto from 'crypto';

/**
 * BrainIndexer
 * Pulls records from all data source tables and upserts them into the
 * BrainContext table as normalized, searchable text entries.
 *
 * Also computes and stores vector embeddings via HuggingFace for RAG semantic search.
 */
export class BrainIndexer {
  /**
   * Helper to perform raw SQL upsert that resets embedding to NULL if content changes.
   */
  private static async upsertContext(data: {
    source: string;
    sourceId: string;
    entityName: string | null;
    content: string;
    metadata: string | null;
    eventDate: Date;
  }) {
    if (useInMemoryDb) {
      // In-memory fallback (no pgvector)
      try {
        await prisma.brainContext.upsert({
          where: { source_sourceId: { source: data.source, sourceId: data.sourceId } },
          update: { content: data.content, entityName: data.entityName, eventDate: data.eventDate, indexedAt: new Date() },
          create: {
            source: data.source,
            sourceId: data.sourceId,
            entityName: data.entityName,
            content: data.content,
            metadata: data.metadata,
            eventDate: data.eventDate,
          },
        });
      } catch (err: any) {
        logger.warn({ error: err.message }, 'BrainIndexer: In-memory upsert failed');
      }
      return;
    }

    const id = crypto.randomUUID();
    try {
      await prisma.$executeRaw`
        INSERT INTO "BrainContext" ("id", "source", "sourceId", "entityName", "content", "metadata", "eventDate")
        VALUES (${id}, ${data.source}, ${data.sourceId}, ${data.entityName}, ${data.content}, ${data.metadata}, ${data.eventDate})
        ON CONFLICT ("source", "sourceId") DO UPDATE
        SET "entityName" = EXCLUDED."entityName",
            "metadata" = EXCLUDED."metadata",
            "eventDate" = EXCLUDED."eventDate",
            "indexedAt" = NOW(),
            "embedding" = CASE WHEN "BrainContext"."content" <> EXCLUDED."content" THEN NULL ELSE "BrainContext"."embedding" END,
            "content" = EXCLUDED."content"
      `;
    } catch (err: any) {
      logger.error({ error: err.message, source: data.source, sourceId: data.sourceId }, 'BrainIndexer: SQL upsert failed');
      throw err;
    }
  }

  /**
   * Full re-index of all sources. Called on demand or on a schedule.
   * Uses upsert to avoid duplicates — safe to run repeatedly.
   */
  static async indexAll(): Promise<{ indexed: number; embedded: number; errors: number }> {
    logger.info('BrainIndexer: Starting full re-index of all company context...');
    let indexed = 0;
    let errors = 0;

    const results = await Promise.allSettled([
      this.indexWhatsAppMessages(),
      this.indexEmails(),
      this.indexDigests(),
      this.indexEstimates(),
      this.indexTasks(),
    ]);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        indexed += result.value;
      } else {
        logger.error({ error: result.reason?.message }, 'BrainIndexer: A source indexer failed');
        errors++;
      }
    }

    // Now, run batch embedding for all entries missing vector embeddings
    let embedded = 0;
    if (!useInMemoryDb) {
      try {
        embedded = await this.generateMissingEmbeddings();
      } catch (err: any) {
        logger.error({ error: err.message }, 'BrainIndexer: Embedding pass failed');
        errors++;
      }
    } else {
      logger.info('BrainIndexer: Running in memory, skipping vector embedding pass.');
    }

    logger.info({ indexed, embedded, errors }, 'BrainIndexer: Full re-index complete');
    return { indexed, embedded, errors };
  }

  /**
   * Generates missing embeddings in batches of 100 to respect API rate limits.
   */
  static async generateMissingEmbeddings(): Promise<number> {
    logger.info('BrainIndexer: Starting vector embedding pass for un-indexed records...');

    // Fetch records missing embeddings
    const missing: any[] = await prisma.$queryRaw`
      SELECT "id", "content" 
      FROM "BrainContext" 
      WHERE "embedding" IS NULL
      ORDER BY "eventDate" DESC
    `;

    if (missing.length === 0) {
      logger.info('BrainIndexer: All records already have embeddings. Nothing to do.');
      return 0;
    }

    logger.info(`BrainIndexer: Found ${missing.length} records missing embeddings. Processing in batches of 100...`);

    const batchSize = 100;
    let successCount = 0;

    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      const texts = batch.map((item) => item.content);
      
      try {
        logger.info(`BrainIndexer: Generating embeddings for batch ${Math.floor(i / batchSize) + 1} (${batch.length} items)...`);
        const embeddings = await BrainEmbedder.getEmbeddings(texts);

        // Update database in single queries per record
        // (Postgres pgvector extension supports updating with cast)
        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const embedding = embeddings[j];
          
          if (!embedding || embedding.length === 0) continue;

          const vectorStr = `[${embedding.join(',')}]`;
          await prisma.$executeRawUnsafe(`
            UPDATE "BrainContext"
            SET "embedding" = CAST($1 AS vector)
            WHERE "id" = $2
          `, vectorStr, row.id);
          
          successCount++;
        }
      } catch (err: any) {
        logger.error({ error: err.message }, `BrainIndexer: Batch ${Math.floor(i / batchSize) + 1} failed. Skipping.`);
      }
    }

    logger.info(`BrainIndexer: Vector embedding pass complete. Successfully embedded ${successCount}/${missing.length} records.`);
    return successCount;
  }

  /**
   * Index WhatsApp messages from the last 90 days
   */
  static async indexWhatsAppMessages(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const messages = await prisma.message.findMany({
      where: { timestamp: { gte: cutoff } },
      orderBy: { timestamp: 'desc' },
      take: 500,
    });

    let count = 0;
    for (const msg of messages) {
      try {
        const content = `[WhatsApp] From: ${msg.sender}\nMessage: ${msg.body}`;
        await this.upsertContext({
          source: 'WHATSAPP',
          sourceId: msg.id,
          entityName: msg.sender,
          content,
          metadata: JSON.stringify({ chatId: msg.chatId }),
          eventDate: msg.timestamp,
        });
        count++;
      } catch (err: any) {
        logger.warn({ error: err.message, id: msg.id }, 'BrainIndexer: Failed to index WhatsApp message');
      }
    }
    logger.info({ count }, 'BrainIndexer: WhatsApp messages indexed');
    return count;
  }

  /**
   * Index emails
   */
  static async indexEmails(): Promise<number> {
    const emails = await prisma.email.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    let count = 0;
    for (const email of emails) {
      try {
        const content = `[Email] From: ${email.sender}\nSubject: ${email.subject}\nBody: ${email.body}`;
        await this.upsertContext({
          source: 'EMAIL',
          sourceId: email.id,
          entityName: email.sender,
          content,
          metadata: JSON.stringify({ subject: email.subject }),
          eventDate: email.createdAt,
        });
        count++;
      } catch (err: any) {
        logger.warn({ error: err.message, id: email.id }, 'BrainIndexer: Failed to index email');
      }
    }
    logger.info({ count }, 'BrainIndexer: Emails indexed');
    return count;
  }

  /**
   * Index WhatsApp digests (AI-summarized conversations)
   */
  static async indexDigests(): Promise<number> {
    const digests = await prisma.digest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    let count = 0;
    for (const digest of digests) {
      try {
        const content = `[WhatsApp Digest] Chat: ${digest.chatName}\nPriority: ${digest.priority} | Category: ${digest.category}\nSummary: ${digest.summary}${digest.suggestedReply ? `\nSuggested Reply: ${digest.suggestedReply}` : ''}`;
        await this.upsertContext({
          source: 'DIGEST',
          sourceId: digest.id,
          entityName: digest.chatName,
          content,
          metadata: JSON.stringify({ priority: digest.priority, category: digest.category, requiresFounder: digest.requiresFounder }),
          eventDate: digest.createdAt,
        });
        count++;
      } catch (err: any) {
        logger.warn({ error: err.message, id: digest.id }, 'BrainIndexer: Failed to index digest');
      }
    }
    logger.info({ count }, 'BrainIndexer: Digests indexed');
    return count;
  }

  /**
   * Index Zoho estimates and their sales agent comments
   */
  static async indexEstimates(): Promise<number> {
    const estimates = await prisma.estimate.findMany({
      include: {
        comments: true,
        classification: true,
      },
      orderBy: { lastSyncTime: 'desc' },
      take: 500,
    });

    let count = 0;
    for (const est of estimates) {
      try {
        // Index the estimate itself
        const intentScore = est.classification?.intentScore ?? 'N/A';
        const reasoning = est.classification?.reasoning ?? 'No AI analysis yet';
        const estimateContent = `[Estimate] Customer: ${est.customerName}\nEstimate No: ${est.estimateNumber} | Status: ${est.status} | Total: ₹${est.total.toLocaleString()} | Date: ${est.date}\nAI Intent Score: ${intentScore}/10\nReasoning: ${reasoning}`;

        await this.upsertContext({
          source: 'ESTIMATE',
          sourceId: est.estimateId,
          entityName: est.customerName,
          content: estimateContent,
          metadata: JSON.stringify({
            estimateNumber: est.estimateNumber,
            status: est.status,
            total: est.total,
            intentScore,
          }),
          eventDate: est.lastSyncTime,
        });
        count++;

        // Index each sales comment separately (they carry the core sales intelligence)
        for (const comment of est.comments) {
          if (!comment.description?.trim()) continue;
          const commentContent = `[Sales Comment] Customer: ${est.customerName} (${est.estimateNumber})\nBy: ${comment.commentedBy} on ${comment.date}\nComment: ${comment.description}`;

          await this.upsertContext({
            source: 'COMMENT',
            sourceId: comment.commentId,
            entityName: est.customerName,
            content: commentContent,
            metadata: JSON.stringify({ estimateNumber: est.estimateNumber, commentedBy: comment.commentedBy }),
            eventDate: new Date(comment.date || est.date),
          });
          count++;
        }
      } catch (err: any) {
        logger.warn({ error: err.message, id: est.estimateId }, 'BrainIndexer: Failed to index estimate');
      }
    }
    logger.info({ count }, 'BrainIndexer: Estimates + Comments indexed');
    return count;
  }

  /**
   * Index tasks / action items
   */
  static async indexTasks(): Promise<number> {
    const tasks = await prisma.task.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    let count = 0;
    for (const task of tasks) {
      try {
        const content = `[Task] ${task.title}\nOwner: ${task.owner} | Status: ${task.status} | Source: ${task.source}${task.deadline ? ` | Deadline: ${task.deadline.toISOString().split('T')[0]}` : ''}`;
        await this.upsertContext({
          source: 'TASK',
          sourceId: task.id,
          entityName: task.owner,
          content,
          metadata: JSON.stringify({ status: task.status, source: task.source }),
          eventDate: task.createdAt,
        });
        count++;
      } catch (err: any) {
        logger.warn({ error: err.message, id: task.id }, 'BrainIndexer: Failed to index task');
      }
    }
    logger.info({ count }, 'BrainIndexer: Tasks indexed');
    return count;
  }
}
