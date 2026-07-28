import { prisma, useInMemoryDb } from '../../shared/prisma';
import { logger } from '../../shared/logger';
import { AIService } from '../ai/service';
import { BrainIndexer } from './indexer';
import { AnalysisEngine } from '../../shared/engine';
import { BrainEmbedder } from './embedder';

/**
 * BrainService — Pillar 1: Company Brain
 *
 * The central knowledge retrieval layer for Founder OS.
 * Indexes all company context from every data source, then enables
 * semantic search and AI-synthesized answers to any founder query.
 *
 * Example queries:
 *   - "What happened with Bühler last month?"
 *   - "Find every discussion about the packaging line project"
 *   - "What did we promise the Sefar team?"
 */
export class BrainService implements AnalysisEngine {
  public name = 'Company Brain';

  /**
   * runSync: Re-index all data sources into BrainContext
   * Called by the cron scheduler (every 30 minutes alongside other engines)
   */
  public async runSync(): Promise<any> {
    logger.info('BrainService: Starting indexing run...');
    const result = await BrainIndexer.indexAll();
    logger.info(result, 'BrainService: Indexing complete');
    return result;
  }

  /**
   * getBriefingContext: Returns count of indexed entries for morning brief
   */
  public async getBriefingContext(): Promise<string> {
    try {
      const count = await prisma.brainContext.count();
      const bySource = await prisma.brainContext.groupBy({
        by: ['source'],
        _count: { id: true },
      });
      const breakdown = bySource.map((s) => `${s.source}: ${s._count.id}`).join(', ');
      return `Company Brain: ${count} context entries indexed (${breakdown})`;
    } catch (err: any) {
      return `Company Brain: offline (${err.message})`;
    }
  }

  /**
   * getEodContext: EOD summary of today's indexing activity
   */
  public async getEodContext(): Promise<string> {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayCount = await prisma.brainContext.count({
        where: { indexedAt: { gte: todayStart } },
      });
      return `- Company Brain: ${todayCount} new context entries indexed today`;
    } catch (err: any) {
      return `- Company Brain: offline (${err.message})`;
    }
  }

  /**
   * query: The main brain search function
   *
   * Performs full-text keyword search across all indexed context,
   * then uses AI to synthesize a coherent answer from the top results.
   *
   * @param question   Natural language question from the founder
   * @param entityFilter  Optional: filter to a specific customer/person name
   * @param limit      Max number of context entries to pass to AI (default 20)
   */
  static async query(question: string, entityFilter?: string, limit = 20): Promise<BrainQueryResult> {
    logger.info({ question, entityFilter }, 'BrainService: Processing brain query...');

    // 1. Extract keywords from the question for search
    const keywords = this.extractKeywords(question);
    logger.info({ keywords }, 'BrainService: Extracted search keywords');

    // 2. Search BrainContext using keyword matching across all sources
    const contextEntries = await this.searchContext(question, keywords, entityFilter, limit);
    logger.info({ count: contextEntries.length }, 'BrainService: Retrieved context entries');

    if (contextEntries.length === 0) {
      return {
        question,
        answer: "I couldn't find any relevant records for that query in my indexed data. Try triggering a brain re-index first.",
        sourcesUsed: [],
        contextCount: 0,
      };
    }

    // 3. Build context with a strict budget to avoid LLM context overflow
    //    Budget: max 600 chars per entry, max 12,000 chars total (~3,000 tokens)
    //    Entries are already sorted by relevance (eventDate DESC from search query)
    const MAX_CHARS_PER_ENTRY = 600;
    const MAX_TOTAL_CHARS = 12_000;

    let totalChars = 0;
    const fittedEntries: typeof contextEntries = [];

    for (const entry of contextEntries) {
      const entryText = entry.content.length > MAX_CHARS_PER_ENTRY
        ? entry.content.substring(0, MAX_CHARS_PER_ENTRY) + '… [truncated]'
        : entry.content;

      const formatted = `[Entry ${fittedEntries.length + 1}] SOURCE: ${entry.source} | DATE: ${entry.eventDate.toISOString().split('T')[0]}${entry.entityName ? ` | ENTITY: ${entry.entityName}` : ''}\n${entryText}`;
      const entryLen = formatted.length;

      if (totalChars + entryLen > MAX_TOTAL_CHARS) {
        logger.info({ fitted: fittedEntries.length, totalChars, budget: MAX_TOTAL_CHARS }, 'BrainService: Context budget reached, stopping');
        break;
      }

      fittedEntries.push(entry);
      totalChars += entryLen;
    }

    // Approximate token count for logging (1 token ≈ 4 chars for English text)
    const estimatedTokens = Math.round(totalChars / 4);
    logger.info({ entries: fittedEntries.length, chars: totalChars, estimatedTokens }, 'BrainService: Context assembled');

    // 4. Format fitted entries for AI
    const contextText = fittedEntries
      .map((entry, i) => {
        const date = entry.eventDate.toISOString().split('T')[0];
        const truncatedContent = entry.content.length > MAX_CHARS_PER_ENTRY
          ? entry.content.substring(0, MAX_CHARS_PER_ENTRY) + '… [truncated]'
          : entry.content;
        return `[Entry ${i + 1}] SOURCE: ${entry.source} | DATE: ${date}${entry.entityName ? ` | ENTITY: ${entry.entityName}` : ''}\n${truncatedContent}`;
      })
      .join('\n\n---\n\n');

    // 5. Call AI to synthesize answer
    const answer = await AIService.queryBrain(question, contextText);

    // 6. Build source summary
    const sourcesUsed = [...new Set(fittedEntries.map((e) => e.source))];

    return {
      question,
      answer,
      sourcesUsed,
      contextCount: fittedEntries.length,
      contextStats: { totalChars, estimatedTokens, entriesDropped: contextEntries.length - fittedEntries.length },
      topResults: fittedEntries.slice(0, 5).map((e) => ({
        source: e.source,
        entityName: e.entityName,
        date: e.eventDate.toISOString().split('T')[0],
        preview: e.content.substring(0, 120) + '...',
      })),
    };
  }

  /**
   * Extracts meaningful search keywords from the question
   * Strips common stop words and returns unique terms
   */
  private static extractKeywords(question: string): string[] {
    const stopWords = new Set([
      'what', 'when', 'where', 'who', 'why', 'how', 'did', 'do', 'does',
      'was', 'were', 'is', 'are', 'the', 'a', 'an', 'and', 'or', 'but',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'about', 'by', 'from',
      'we', 'our', 'us', 'i', 'me', 'my', 'you', 'your', 'them', 'they',
      'have', 'had', 'has', 'any', 'all', 'tell', 'find', 'show', 'give',
      'me', 'last', 'recent', 'latest', 'ever', 'happened', 'discussed',
    ]);

    return question
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .filter((word, idx, arr) => arr.indexOf(word) === idx); // unique
  }

  /**
   * Searches BrainContext using keyword matching or semantic vector search.
   * Falls back automatically to keyword search if vector search is unavailable.
   */
  private static async searchContext(
    question: string,
    keywords: string[],
    entityFilter?: string,
    limit = 20
  ) {
    if (useInMemoryDb) {
      return this.searchKeywordFallback(keywords, entityFilter, limit);
    }

    try {
      logger.info('BrainService: Generating query embedding via HuggingFace...');
      const queryVector = await BrainEmbedder.getEmbedding(question);
      const vectorStr = `[${queryVector.join(',')}]`;
      const entityClause = entityFilter
        ? ` AND ("entityName" ILIKE '%${entityFilter.replace(/'/g, "''")}%')`
        : '';

      logger.info('BrainService: Performing pgvector similarity search...');
      const results = await prisma.$queryRawUnsafe<any[]>(`
        SELECT "id", "source", "sourceId", "entityName", "content", "metadata", "eventDate", "indexedAt"
        FROM "BrainContext"
        WHERE "embedding" IS NOT NULL${entityClause}
        ORDER BY "embedding" <=> CAST($1 AS vector)
        LIMIT $2
      `, vectorStr, limit);

      // Map raw results to match Prisma model shape
      return results.map((r) => ({
        ...r,
        eventDate: new Date(r.eventDate),
        indexedAt: new Date(r.indexedAt),
      }));
    } catch (err: any) {
      logger.warn({ error: err.message }, 'BrainService: pgvector search failed. Falling back to keyword search.');
      return this.searchKeywordFallback(keywords, entityFilter, limit);
    }
  }

  private static async searchKeywordFallback(
    keywords: string[],
    entityFilter?: string,
    limit = 20
  ) {
    if (keywords.length === 0 && !entityFilter) {
      // Fallback: return most recent entries
      return prisma.brainContext.findMany({
        orderBy: { eventDate: 'desc' },
        take: limit,
      });
    }

    // Build WHERE conditions: at least one keyword must match content or entityName
    // Prisma doesn't support ILIKE OR chains directly, so we use $queryRaw for this
    const conditions = keywords.map((kw) => `"content" ILIKE '%${kw.replace(/'/g, "''")}%' OR "entityName" ILIKE '%${kw.replace(/'/g, "''")}%'`);
    const whereClause = conditions.join(' OR ');
    const entityClause = entityFilter
      ? ` AND ("entityName" ILIKE '%${entityFilter.replace(/'/g, "''")}%')`
      : '';

    try {
      const results = await prisma.$queryRawUnsafe<any[]>(`
        SELECT "id", "source", "sourceId", "entityName", "content", "metadata", "eventDate", "indexedAt"
        FROM "BrainContext"
        WHERE (${whereClause})${entityClause}
        ORDER BY "eventDate" DESC
        LIMIT ${limit}
      `);
      // Map raw results to match Prisma model shape
      return results.map((r) => ({
        ...r,
        eventDate: new Date(r.eventDate),
        indexedAt: new Date(r.indexedAt),
      }));
    } catch (err: any) {
      logger.error({ error: err.message }, 'BrainService: Raw search query failed, falling back to recent entries');
      return prisma.brainContext.findMany({
        orderBy: { eventDate: 'desc' },
        take: limit,
      });
    }
  }

  /**
   * getStats: Returns current brain indexing statistics
   */
  static async getStats() {
    const total = await prisma.brainContext.count();
    const bySource = await prisma.brainContext.groupBy({
      by: ['source'],
      _count: { id: true },
    });
    const lastIndexed = await prisma.brainContext.findFirst({
      orderBy: { indexedAt: 'desc' },
      select: { indexedAt: true },
    });

    return {
      totalEntries: total,
      bySource: bySource.reduce((acc, s) => {
        acc[s.source] = s._count.id;
        return acc;
      }, {} as Record<string, number>),
      lastIndexedAt: lastIndexed?.indexedAt ?? null,
    };
  }
}

export interface BrainQueryResult {
  question: string;
  answer: string;
  sourcesUsed: string[];
  contextCount: number;
  contextStats?: {
    totalChars: number;
    estimatedTokens: number;
    entriesDropped: number;
  };
  topResults?: Array<{
    source: string;
    entityName: string | null;
    date: string;
    preview: string;
  }>;
}
