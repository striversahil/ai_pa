function randomUUID(): string {
  const g = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID();
  if (g.crypto && typeof g.crypto.randomUUID !== 'function' && g.crypto.getRandomValues) {
    const buf = new Uint8Array(16);
    g.crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export interface D1DatabaseLike {
  prepare(query: string): {
    bind(...params: any[]): D1StatementLike;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
  };
  batch(statements: any[]): Promise<any[]>;
}

export interface D1StatementLike {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
}

const BOOL_FIELDS: Record<string, string[]> = {
  Contact: ['isGroup', 'hasInbound'],
  Message: ['processed', 'isHistorical'],
  Email: ['processed'],
  Digest: ['requiresFounder'],
  Estimate: ['skipMatching'],
  Classification: ['meaningfulUpdate'],
  Automation: ['enabled'],
  MarketingCampaign: ['enabled'],
};

const DATE_FIELDS: Record<string, string[]> = {
  Contact: ['lastMessageAt', 'createdAt', 'updatedAt'],
  Message: ['timestamp', 'classifiedAt', 'slaDeadline', 'createdAt'],
  OutboundIntent: ['createdAt', 'enqueuedAt'],
  Email: ['createdAt'],
  Digest: ['createdAt'],
  Task: ['deadline', 'createdAt'],
  ChatPendingItem: ['dueDate', 'createdAt', 'resolvedAt'],
  ChatNote: ['createdAt', 'updatedAt'],
  FounderNote: ['createdAt'],
  Estimate: ['lastSyncTime'],
  Classification: ['processedAt'],
  AuditLog: ['createdAt'],
  BrainContext: ['indexedAt', 'eventDate'],
  Automation: ['lastRunAt', 'createdAt', 'updatedAt'],
  AutomationRun: ['createdAt'],
  PriceQuote: ['quotedAt', 'createdAt'],
  Setting: ['updatedAt'],
  MarketingCampaign: ['scheduledAt', 'lastRunAt', 'createdAt', 'updatedAt'],
  MarketingLead: ['sentAt', 'deliveredAt', 'readAt', 'createdAt'],
  MarketingCampaignRun: ['startedAt', 'finishedAt'],
};

const ID_FIELDS: Record<string, string> = {
  Contact: 'id',
  Message: 'id',
  OutboundIntent: 'id',
  Email: 'id',
  Digest: 'id',
  Task: 'id',
  ChatPendingItem: 'id',
  ChatNote: 'chatId',
  FounderNote: 'id',
  Estimate: 'estimateId',
  Comment: 'commentId',
  Classification: 'estimateId',
  AuditLog: 'id',
  BrainContext: 'id',
  Automation: 'id',
  AutomationRun: 'id',
  PriceQuote: 'id',
  Setting: 'key',
  MarketingCampaign: 'id',
  MarketingLead: 'id',
  MarketingCampaignRun: 'id',
};

const UNIQUE_FIELDS: Record<string, string[]> = {
  Contact: ['chatId'],
  Message: ['wahaMessageId'],
  BrainContext: ['source', 'sourceId'],
  Automation: ['slug'],
  AutomationRun: ['automationId', 'dedupKey'],
  MarketingLead: ['campaignId', 'phoneNumber'],
  PriceQuote: ['messageId'],
};

const FLOAT_FIELDS: Record<string, string[]> = {
  Estimate: ['total'],
  PriceQuote: ['unitPrice'],
};

const RELATIONS: Record<string, Record<string, { model: string; fk: string; one?: boolean }>> = {
  Estimate: {
    comments: { model: 'Comment', fk: 'estimateId' },
    classification: { model: 'Classification', fk: 'estimateId', one: true },
  },
  Comment: { estimate: { model: 'Estimate', fk: 'estimateId', one: true } },
  Classification: { estimate: { model: 'Estimate', fk: 'estimateId', one: true } },
  Automation: { runs: { model: 'AutomationRun', fk: 'automationId' } },
  AutomationRun: { automation: { model: 'Automation', fk: 'automationId', one: true } },
  MarketingCampaign: {
    leads: { model: 'MarketingLead', fk: 'campaignId' },
    runs: { model: 'MarketingCampaignRun', fk: 'campaignId' },
  },
  MarketingLead: { campaign: { model: 'MarketingCampaign', fk: 'campaignId', one: true } },
  MarketingCampaignRun: { campaign: { model: 'MarketingCampaign', fk: 'campaignId', one: true } },
};

function serialize(v: any): any {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function deserialize(model: string, row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  const out: Record<string, any> = { ...row };
  for (const f of BOOL_FIELDS[model] || []) {
    if (f in out && out[f] !== null) out[f] = !!out[f];
  }
  for (const f of DATE_FIELDS[model] || []) {
    if (f in out && out[f] !== null && out[f] !== undefined) out[f] = new Date(out[f]);
  }
  for (const f of FLOAT_FIELDS[model] || []) {
    if (f in out && out[f] !== null) out[f] = Number(out[f]);
  }
  return out;
}

interface WhereOperand {
  equals?: any;
  not?: any;
  in?: any[];
  notIn?: any[];
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  mode?: 'default' | 'insensitive';
  lt?: any;
  lte?: any;
  gt?: any;
  gte?: any;
  isNot?: any;
  is?: any;
}

function buildWhere(model: string, where: any): { sql: string; params: any[] } {
  if (!where || Object.keys(where).length === 0) return { sql: '1 = 1', params: [] };
  const clauses: string[] = [];
  const params: any[] = [];
  for (const [key, cond] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const sub = Array.isArray(cond) ? cond : [cond];
      const parts = sub.map((c: any) => buildWhere(model, c));
      const joiner = key === 'OR' ? ' OR ' : ' AND ';
      const neg = key === 'NOT' ? 'NOT ' : '';
      clauses.push(`(${neg}(${parts.map((p) => p.sql).join(joiner)}))`);
      for (const p of parts) params.push(...p.params);
      continue;
    }
    const rel = RELATIONS[model]?.[key];
    if (rel) {
      const op: WhereOperand = cond as WhereOperand;
      if (op.isNot === null || op.is === null) {
        const exists = `EXISTS (SELECT 1 FROM ${rel.model} WHERE ${rel.fk} = ${rel.one ? `${model}.${ID_FIELDS[model]}` : ''})`;
        clauses.push(op.isNot === null ? exists : `NOT ${exists}`);
      }
      continue;
    }
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const op = cond as WhereOperand;
      for (const [opName, val] of Object.entries(op)) {
        if (val === undefined) continue;
        if (opName === 'equals') {
          if (val === null) clauses.push(`${key} IS NULL`);
          else { clauses.push(`${key} = ?`); params.push(serialize(val)); }
        } else if (opName === 'not') {
          if (val === null) clauses.push(`${key} IS NOT NULL`);
          else { clauses.push(`${key} != ?`); params.push(serialize(val)); }
        } else if (opName === 'in') {
          if (!val || val.length === 0) { clauses.push('1 = 0'); }
          else {
            const placeholders = val.map((x: any) => { params.push(serialize(x)); return '?'; }).join(',');
            clauses.push(`${key} IN (${placeholders})`);
          }
        } else if (opName === 'notIn') {
          if (!val || val.length === 0) { clauses.push('1 = 1'); }
          else {
            const placeholders = val.map((x: any) => { params.push(serialize(x)); return '?'; }).join(',');
            clauses.push(`${key} NOT IN (${placeholders})`);
          }
        } else if (opName === 'contains' || opName === 'startsWith' || opName === 'endsWith') {
          let pattern = String(val);
          if (opName === 'contains') pattern = `%${pattern}%`;
          else if (opName === 'startsWith') pattern = `${pattern}%`;
          else pattern = `%${pattern}`;
          if (op.mode === 'insensitive') {
            clauses.push(`LOWER(${key}) LIKE LOWER(?)`);
          } else {
            clauses.push(`${key} LIKE ?`);
          }
          params.push(pattern);
        } else if (['lt', 'lte', 'gt', 'gte'].includes(opName)) {
          const sym = { lt: '<', lte: '<=', gt: '>', gte: '>=' }[opName];
          clauses.push(`${key} ${sym} ?`);
          params.push(serialize(val));
        } else if (opName === 'isNot') {
          if (val === null) clauses.push(`${key} IS NOT NULL`);
          else { clauses.push(`${key} != ?`); params.push(serialize(val)); }
        } else if (opName === 'is') {
          if (val === null) clauses.push(`${key} IS NULL`);
          else { clauses.push(`${key} = ?`); params.push(serialize(val)); }
        }
      }
    } else {
      clauses.push(`${key} = ?`);
      params.push(serialize(cond));
    }
  }
  return { sql: clauses.join(' AND '), params };
}

function buildOrderBy(orderBy: any): string {
  if (!orderBy) return '';
  const arr = Array.isArray(orderBy) ? orderBy : [orderBy];
  return arr
    .map((o: any) => {
      if (typeof o === 'string') return `${o} ASC`;
      const entries = Object.entries(o);
      if (entries.length === 0) return '';
      const [field, dir] = entries[0];
      return `${field} ${String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
    })
    .filter(Boolean)
    .join(', ');
}

function buildSelect(model: string, select?: any): { sql: string; isSelect: boolean } {
  if (!select) return { sql: '*', isSelect: false };
  const cols = Object.entries(select)
    .filter(([, v]) => !!v)
    .map(([k]) => k);
  return { sql: cols.length ? cols.join(', ') : '*', isSelect: true };
}

function buildData(model: string, data: any): { cols: string[]; params: any[] } {
  const cols: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) {
      // atomic increment
      continue;
    }
    cols.push(k);
    params.push(serialize(v));
  }
  return { cols, params };
}

function buildSet(model: string, data: any): { sql: string; params: any[] } {
  const sets: string[] = [];
  const params: any[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) {
      sets.push(`${k} = ${k} + ?`);
      params.push(Number(v.increment));
      continue;
    }
    sets.push(`${k} = ?`);
    params.push(serialize(v));
  }
  return { sql: sets.join(', '), params };
}

function resolveUniqueWhere(model: string, where: any): { sql: string; params: any[] } {
  for (const [key, val] of Object.entries(where)) {
    if (val && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
      // compound unique key like source_sourceId
      const parts = Object.keys(val);
      if (parts.length === 2 && UNIQUE_FIELDS[model]?.length === 2) {
        const params: any[] = [];
        const clauses = parts.map((p) => { params.push(serialize((val as any)[p])); return `${p} = ?`; });
        return { sql: clauses.join(' AND '), params };
      }
    }
  }
  return buildWhere(model, where);
}

type Row = Record<string, any>;

class D1Model {
  constructor(private db: D1DatabaseLike, private model: string) {}

  private table() {
    return this.model;
  }

  async findMany(args: any = {}): Promise<Row[]> {
    const { sql: whereSql, params } = buildWhere(this.model, args.where);
    const select = buildSelect(this.model, args.select);
    let orderBy = buildOrderBy(args.orderBy);
    if (orderBy) orderBy = ` ORDER BY ${orderBy}`;
    const take = args.take !== undefined ? ` LIMIT ${Number(args.take)}` : '';
    const skip = args.skip !== undefined ? ` OFFSET ${Number(args.skip)}` : '';
    const query = `SELECT ${select.sql} FROM ${this.table()} WHERE ${whereSql}${orderBy}${take}${skip}`;
    const stmt = this.db.prepare(query).bind(...params);
    const { results } = await stmt.all<Row>();
    let rows = results.map((r) => deserialize(this.model, r));
    if (args.include) {
      rows = await this.attachIncludes(rows, args.include);
    }
    return rows;
  }

  private async attachIncludes(rows: Row[], include: any): Promise<Row[]> {
    if (!rows.length) return rows;
    for (const [relName, relArgs] of Object.entries(include)) {
      if (!relArgs) continue;
      const rel = RELATIONS[this.model]?.[relName];
      if (!rel) continue;
      const relArgsObj = (relArgs && typeof relArgs === 'object') ? relArgs as Record<string, any> : {};
      const fk = rel.fk;
      const ids = [...new Set(rows.map((r) => r[ID_FIELDS[this.model]]).filter(Boolean))];
      if (!ids.length) continue;
      let orderBy = '';
      if (relArgsObj.orderBy) {
        const ob = buildOrderBy(relArgsObj.orderBy);
        if (ob) orderBy = ` ORDER BY ${ob}`;
      }
      const take = relArgsObj.take !== undefined ? ` LIMIT ${Number(relArgsObj.take)}` : '';
      const relRows: Row[] = [];
      // D1 caps bound SQL variables per statement (100). Batch the IN-clause
      // so large row sets (e.g. all Zoho estimates) don't exceed the limit.
      const BATCH = 90;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT * FROM ${rel.model} WHERE ${fk} IN (${placeholders})${orderBy}${take}`;
        const { results } = await this.db.prepare(query).bind(...chunk).all<Row>();
        relRows.push(...results.map((r) => deserialize(rel.model, r)));
      }
      for (const row of rows) {
        const mine = relRows.filter((r) => r[fk] === row[ID_FIELDS[this.model]]);
        row[relName] = rel.one ? mine[0] ?? null : mine;
      }
    }
    return rows;
  }

  async findUnique(args: any = {}): Promise<Row | null> {
    const { sql, params } = resolveUniqueWhere(this.model, args.where);
    const query = `SELECT * FROM ${this.table()} WHERE ${sql} LIMIT 1`;
    const row = await this.db.prepare(query).bind(...params).first<Row>();
    let out = row ? deserialize(this.model, row) : null;
    if (out && args.include) {
      out = (await this.attachIncludes([out], args.include))[0];
    }
    return out;
  }

  async findFirst(args: any = {}): Promise<Row | null> {
    const rows = await this.findMany({ ...args, take: args.take ?? 1 });
    return rows[0] ?? null;
  }

  async create(args: any = {}): Promise<Row> {
    const data: Record<string, any> = { ...args.data };
    const now = new Date().toISOString();
    if (!data.id && ID_FIELDS[this.model] === 'id') data.id = crypto.randomUUID();
    if (BOOL_FIELDS[this.model]?.includes('processed') && data.processed === undefined) data.processed = false;
    if (data.createdAt === undefined && DATE_FIELDS[this.model]?.includes('createdAt')) data.createdAt = new Date();
    if (data.updatedAt === undefined && DATE_FIELDS[this.model]?.includes('updatedAt')) data.updatedAt = new Date();
    const { cols, params } = buildData(this.model, data);
    const placeholders = cols.map(() => '?').join(', ');
    const query = `INSERT INTO ${this.table()} (${cols.join(', ')}) VALUES (${placeholders})`;
    await this.db.prepare(query).bind(...params).run();
    const sel = await this.db.prepare(`SELECT * FROM ${this.table()} WHERE ${ID_FIELDS[this.model]} = ?`).bind(data[ID_FIELDS[this.model]]).first<Row>();
    return deserialize(this.model, sel as Row);
  }

  async createMany(args: any = {}): Promise<{ count: number }> {
    const rows = args.data || [];
    if (!rows.length) return { count: 0 };
    const placeholders = rows.map((r: any) => `(${Object.keys(r).map(() => '?').join(', ')})`).join(', ');
    const cols = Object.keys(rows[0]);
    const params: any[] = [];
    for (const r of rows) {
      for (const c of cols) params.push(serialize(r[c]));
    }
    const query = `INSERT INTO ${this.table()} (${cols.join(', ')}) VALUES ${placeholders}`;
    const { meta } = await this.db.prepare(query).bind(...params).run();
    return { count: meta.changes };
  }

  async createManyAndReturn(args: any = {}): Promise<Row[]> {
    const rows = args.data || [];
    if (!rows.length) return [];
    const model = this.model;
    const now = new Date().toISOString();
    const enriched = rows.map((r: any) => {
      const d = { ...r };
      if (!d.id && ID_FIELDS[model] === 'id') d.id = crypto.randomUUID();
      if (d.createdAt === undefined && DATE_FIELDS[model]?.includes('createdAt')) d.createdAt = new Date();
      return d;
    });
    const cols: string[] = [...new Set(enriched.flatMap((r: any) => Object.keys(r)))] as string[];
    const placeholders = enriched.map((r: any) => `(${cols.map((c) => '?').join(', ')})`).join(', ');
    const params: any[] = [];
    for (const r of enriched as any[]) {
      for (const c of cols) params.push(serialize((r as any)[c]));
    }
    const conflict = args.skipDuplicates && UNIQUE_FIELDS[model]?.length === 1
      ? ` ON CONFLICT (${UNIQUE_FIELDS[model][0]}) DO NOTHING`
      : '';
    const query = `INSERT INTO ${this.table()} (${cols.join(', ')}) VALUES ${placeholders}${conflict}`;
    await this.db.prepare(query).bind(...params).run();
    const ids = enriched.map((r: any) => r[ID_FIELDS[model]]).filter(Boolean);
    if (!ids.length) return [];
    const placeholders2 = ids.map(() => '?').join(',');
    const { results } = await this.db.prepare(`SELECT * FROM ${this.table()} WHERE ${ID_FIELDS[model]} IN (${placeholders2})`).bind(...ids).all<Row>();
    return results.map((r) => deserialize(model, r));
  }

  async update(args: any = {}): Promise<Row> {
    const where = args.where || {};
    const { sql, params: whereParams } = resolveUniqueWhere(this.model, where);
    const data: Record<string, any> = { ...args.data };
    if (DATE_FIELDS[this.model]?.includes('updatedAt') && data.updatedAt === undefined) data.updatedAt = new Date();
    const { sql: setSql, params: setParams } = buildSet(this.model, data);
    if (!setSql) throw new Error('update requires data');
    const query = `UPDATE ${this.table()} SET ${setSql} WHERE ${sql}`;
    await this.db.prepare(query).bind(...setParams, ...whereParams).run();
    const { results } = await this.db.prepare(`SELECT * FROM ${this.table()} WHERE ${sql}`).bind(...whereParams).all<Row>();
    return deserialize(this.model, results[0] as Row);
  }

  async updateMany(args: any = {}): Promise<{ count: number }> {
    const { sql, params: whereParams } = buildWhere(this.model, args.where);
    const data: Record<string, any> = { ...args.data };
    if (DATE_FIELDS[this.model]?.includes('updatedAt') && data.updatedAt === undefined) data.updatedAt = new Date();
    const { sql: setSql, params: setParams } = buildSet(this.model, data);
    if (!setSql) return { count: 0 };
    const query = `UPDATE ${this.table()} SET ${setSql} WHERE ${sql}`;
    const { meta } = await this.db.prepare(query).bind(...setParams, ...whereParams).run();
    return { count: meta.changes };
  }

  async delete(args: any = {}): Promise<Row | null> {
    const { sql, params } = resolveUniqueWhere(this.model, args.where);
    const sel = await this.db.prepare(`SELECT * FROM ${this.table()} WHERE ${sql} LIMIT 1`).bind(...params).first<Row>();
    await this.db.prepare(`DELETE FROM ${this.table()} WHERE ${sql}`).bind(...params).run();
    return sel ? deserialize(this.model, sel) : null;
  }

  async deleteMany(args: any = {}): Promise<{ count: number }> {
    const { sql, params } = buildWhere(this.model, args.where);
    const query = `DELETE FROM ${this.table()} WHERE ${sql}`;
    const { meta } = await this.db.prepare(query).bind(...params).run();
    return { count: meta.changes };
  }

  async count(args: any = {}): Promise<number> {
    const { sql, params } = buildWhere(this.model, args.where);
    const query = `SELECT COUNT(*) as c FROM ${this.table()} WHERE ${sql}`;
    const row = await this.db.prepare(query).bind(...params).first<{ c: number }>();
    return Number(row?.c ?? 0);
  }

  async upsert(args: any = {}): Promise<Row> {
    const existing = await this.findUnique({ where: args.where });
    if (existing) {
      return this.update({ where: args.where, data: args.update });
    }
    const createData = { ...args.create };
    const whereData: any = {};
    for (const [key, val] of Object.entries(args.where)) {
      if (val && typeof val === 'object' && !(val instanceof Date) && !Array.isArray(val)) {
        Object.assign(whereData, val);
      } else if (!(key in createData)) {
        whereData[key] = val;
      }
    }
    const data = { ...createData, ...whereData };
    return this.create({ data });
  }

  async groupBy(args: any = {}): Promise<Row[]> {
    const by = args.by || [];
    const selectParts = [...by];
    const aggParts: { alias: string; sql: string }[] = [];
    const counts: Record<string, string> = args._count || {};
    for (const field of Object.keys(counts)) {
      const col = field === '_all' ? '*' : field;
      const alias = `_count_${field}`;
      aggParts.push({ alias, sql: `COUNT(${col}) AS ${alias}` });
    }
    const avgs = args._avg || {};
    for (const field of Object.keys(avgs)) {
      const alias = `_avg_${field}`;
      aggParts.push({ alias, sql: `AVG(${field}) AS ${alias}` });
    }
    const maxs = args._max || {};
    for (const field of Object.keys(maxs)) {
      const alias = `_max_${field}`;
      aggParts.push({ alias, sql: `MAX(${field}) AS ${alias}` });
    }
    const { sql: whereSql, params } = buildWhere(this.model, args.where);
    let orderBy = '';
    if (args.orderBy) {
      const obArr = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      const parts: string[] = [];
      for (const o of obArr) {
        const [k, v] = Object.entries(o)[0];
        if (k === '_count') {
          const [f, dir] = Object.entries(v as any)[0];
          // Prisma orders by the count of a field; when only `_all` was counted
          // (COUNT(*) per group), the field count equals the row count — fall
          // back to the _all alias so the ORDER BY references a real column.
          let alias = `_count_${f}`;
          if (!Object.prototype.hasOwnProperty.call(counts, f) && counts['_all'] !== undefined) {
            alias = '_count__all';
          }
          parts.push(`${alias} ${String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`);
        } else {
          parts.push(`${k} ${String(v).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`);
        }
      }
      orderBy = ` ORDER BY ${parts.join(', ')}`;
    }
    const take = args.take !== undefined ? ` LIMIT ${Number(args.take)}` : '';
    const query = `SELECT ${[...selectParts, ...aggParts.map((a) => a.sql)].join(', ')} FROM ${this.table()} WHERE ${whereSql} GROUP BY ${by.join(', ')}${orderBy}${take}`;
    const { results } = await this.db.prepare(query).bind(...params).all<Row>();
    return results.map((r) => {
      const out: Record<string, any> = {};
      for (const b of by) out[b] = r[b];
      if (Object.keys(counts).length) out._count = {};
      for (const field of Object.keys(counts)) {
        (out._count as any)[field] = r[`_count_${field}`];
      }
      if (Object.keys(avgs).length) out._avg = {};
      for (const field of Object.keys(avgs)) {
        (out._avg as any)[field] = r[`_avg_${field}`];
      }
      if (Object.keys(maxs).length) out._max = {};
      for (const field of Object.keys(maxs)) {
        (out._max as any)[field] = r[`_max_${field}`];
      }
      return deserialize(this.model, out);
    });
  }
}

export class D1PrismaClient {
  constructor(private db: D1DatabaseLike) {}

  private model(name: string): D1Model {
    return new D1Model(this.db, name);
  }

  get contact() { return this.model('Contact'); }
  get message() { return this.model('Message'); }
  get outboundIntent() { return this.model('OutboundIntent'); }
  get email() { return this.model('Email'); }
  get digest() { return this.model('Digest'); }
  get task() { return this.model('Task'); }
  get chatPendingItem() { return this.model('ChatPendingItem'); }
  get chatNote() { return this.model('ChatNote'); }
  get founderNote() { return this.model('FounderNote'); }
  get estimate() { return this.model('Estimate'); }
  get comment() { return this.model('Comment'); }
  get classification() { return this.model('Classification'); }
  get auditLog() { return this.model('AuditLog'); }
  get brainContext() { return this.model('BrainContext'); }
  get automation() { return this.model('Automation'); }
  get automationRun() { return this.model('AutomationRun'); }
  get priceQuote() { return this.model('PriceQuote'); }
  get setting() { return this.model('Setting'); }
  get marketingCampaign() { return this.model('MarketingCampaign'); }
  get marketingLead() { return this.model('MarketingLead'); }
  get marketingCampaignRun() { return this.model('MarketingCampaignRun'); }

  $on() {}
  $disconnect() {}

  async $queryRawUnsafe<T = any>(query: string, ...values: any[]): Promise<T[]> {
    const { sql, params } = this.translateRaw(query, values);
    const { results } = await this.db.prepare(sql).bind(...params).all<Row>();
    return results as T[];
  }

  async $executeRawUnsafe(query: string, ...values: any[]): Promise<number> {
    const { sql, params } = this.translateRaw(query, values);
    const { meta } = await this.db.prepare(sql).bind(...params).run();
    return meta.changes;
  }

  async $queryRaw<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    const sql = strings.reduce((acc, s, i) => acc + s + (i < values.length ? '?' : ''), '');
    const { sql: translated, params } = this.translateRaw(sql, values);
    const { results } = await this.db.prepare(translated).bind(...params).all<Row>();
    return results as T[];
  }

  async $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number> {
    const sql = strings.reduce((acc, s, i) => acc + s + (i < values.length ? '?' : ''), '');
    const { sql: translated, params } = this.translateRaw(sql, values);
    const { meta } = await this.db.prepare(translated).bind(...params).run();
    return meta.changes;
  }

  private translateRaw(query: string, values: any[]): { sql: string; params: any[] } {
    let sql = query;
    let params = values;
    if (sql.includes('pgvector') || sql.includes('embedding') || sql.includes('<=>') || sql.includes('vector')) {
      // pgvector paths are not supported on D1. Return an empty result set for
      // semantic queries and no-op for embedding maintenance writes.
      if (/SELECT/i.test(sql) && /embedding|<=>|vector/i.test(sql)) {
        return { sql: 'SELECT 1 WHERE 1 = 0', params: [] };
      }
      if (/UPDATE\s+"BrainContext"/i.test(sql) && /embedding/i.test(sql)) {
        return { sql: 'SELECT 1 WHERE 1 = 0', params: [] };
      }
      if (/INSERT/i.test(sql) && /embedding/i.test(sql)) {
        // Strip embedding column/values from the ON CONFLICT upsert.
        sql = sql.replace(/,\s*"embedding"\s*=[^,]*?END/gi, '');
        sql = sql.replace(/,\s*"embedding"\s*,\s*NULL/gi, '');
        sql = sql.replace(/,\s*"embedding"\s*=\s*EXCLUDED\.\w+/gi, '');
      }
    }
    sql = sql.replace(/NOW\(\)/gi, `datetime('now')`);
    sql = sql.replace(/CAST\(\$1 AS vector\)/gi, '?');
    sql = sql.replace(/ILIKE/gi, 'LIKE');
    if (sql.includes('$1') || sql.includes('$2') || sql.includes('$3')) {
      let i = 1;
      sql = sql.replace(/\$(\d+)/g, () => `?${i++}`);
    }
    params = params.map((v: any) => (v instanceof Date ? v.toISOString() : v));
    return { sql, params };
  }
}