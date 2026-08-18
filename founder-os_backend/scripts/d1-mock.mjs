// In-memory D1 mock that understands the subset of SQL the founder-os worker
// emits (INSERT/UPDATE/SELECT with ? params, ON CONFLICT upserts, ORDER BY,
// LIMIT, LIKE, first/all/run). Used only by smoke tests.
export function fakeD1() {
  const tables = new Map();

  function ensure(name) {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  }

  function parseColumnsInsert(sql) {
    const m = sql.match(/INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*\((.*)\)/i);
    if (!m) return null;
    const table = m[1];
    const cols = m[2].split(',').map((c) => c.trim().replace(/"/g, ''));
    const vals = m[3];
    const nPlaceholders = (vals.match(/\?/g) || []).length;
    const suffix = sql.slice(m[0].length);
    return { table, cols, nPlaceholders, suffix };
  }

  function uniqueCols(table) {
    // model table singular/plural normalization is handled by INSERT table name
    return null;
  }

  const handle = {
    prepare: (query) => handle._query(query),
    _query(q) {
      const prep = {
        _q: q,
        _values: [],
        bind(...v) { prep._values = v; return prep; },
        async run() {
          const q = prep._q;
          const vals = prep._values;
          const ins = parseColumnsInsert(q);
          if (ins) {
            const table = ensure(ins.table);
            const row = {};
            ins.cols.forEach((c, i) => {
              const v = vals[i];
              row[c] = v;
            });
            if (!row.id) row.id = String(table.length + 1);
            // ON CONFLICT upsert: match on the first non-id unique column present
            if (/on conflict/i.test(ins.suffix) && ins.cols.length) {
              const conflictKey = ins.cols.find((c) => c !== 'id');
              if (conflictKey !== undefined) {
                const idx = table.findIndex((r) => r[conflictKey] === row[conflictKey]);
                if (idx >= 0) {
                  const prev = table[idx];
                  const merged = {};
                  for (const k of Object.keys(prev)) {
                    merged[k] = Object.prototype.hasOwnProperty.call(row, k) ? row[k] : prev[k];
                  }
                  table[idx] = merged;
                  return { success: true, meta: { changes: 1, last_row_id: idx + 1 } };
                }
              }
            }
            table.push(row);
            return { success: true, meta: { changes: 1, last_row_id: table.length } };
          }
          if (/^update/i.test(q)) {
            const m = q.match(/UPDATE (\w+)\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*)/i);
            if (!m) return { success: true, meta: { changes: 0 } };
            const table = ensure(m[1]);
            const setParts = m[2].split(',').map((s) => s.trim());
            const setCols = setParts.map((s) => s.match(/^(\w+)\s*=/)[1]);
            const setVals = setParts.map((s) => (s.includes('?') ? undefined : s.replace(/^[^=]+=\s*/, '').replace(/^['"]|['"]$/g, '')));
            let vi = 0;
            const setResolved = setCols.map((c) => {
              if (setVals[setCols.indexOf(c)] !== undefined) return { c, v: setVals[setCols.indexOf(c)] };
              return { c, v: vals[vi++] };
            });
            const whereClause = m[3];
            const whereCond = whereClause;
            let changes = 0;
            for (const r of table) {
              if (matchWhere(r, whereCond, vals, vi)) {
                for (const { c, v } of setResolved) r[c] = v;
                changes++;
              }
            }
            return { success: true, meta: { changes } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async first() {
          const { results } = await prep.all();
          return results[0] ?? null;
        },
        async all() {
          const q = prep._q;
          const vals = prep._values;
          const m = q.match(/FROM (\w+)/i);
          if (!m) return { results: [] };
          const table = ensure(m[1]);
          let rows = [...table];
          const whereIdx = q.toUpperCase().indexOf(' WHERE ');
          if (whereIdx >= 0) {
            const rest = q.slice(whereIdx + 7);
            const orderIdx = rest.toUpperCase().indexOf(' ORDER BY ');
            const limitIdx = rest.toUpperCase().indexOf(' LIMIT ');
            let where = rest;
            if (orderIdx >= 0) where = rest.slice(0, orderIdx);
            else if (limitIdx >= 0) where = rest.slice(0, limitIdx);
            rows = rows.filter((r) => matchWhere(r, where, vals, 0));
          }
          const orderIdx = q.toUpperCase().indexOf(' ORDER BY ');
          if (orderIdx >= 0) {
            const orderSpec = q.slice(orderIdx + 10).split(' LIMIT ')[0].trim();
            const [col, dir] = orderSpec.split(/\s+/);
            rows.sort((a, b) => {
              const av = a[col]; const bv = b[col];
              if (av === bv) return 0;
              const cmp = av === null || av === undefined ? 1 : bv === null || bv === undefined ? -1 : av < bv ? -1 : 1;
              return /desc/i.test(dir) ? -cmp : cmp;
            });
          }
          const limitIdx = q.toUpperCase().indexOf(' LIMIT ');
          if (limitIdx >= 0) {
            const spec = q.slice(limitIdx + 7).trim();
            const limit = spec.includes('?') ? vals[vals.length - 1] : parseInt(spec);
            rows = rows.slice(0, limit);
          }
          return { results: rows };
        },
        async raw() {
          const { results } = await prep.all();
          return results;
        },
      };
      return prep;
    },
    async exec() { return { success: true }; },
    async batch(stmts) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    async dump() { return new ArrayBuffer(0); },
    async raw() { return []; },
  };
  return handle;
}

function matchWhere(row, where, vals, startIdx) {
  let vi = startIdx;
  // Supports: col = ?, col != ?, col LIKE ?, col >= ?, col <= ?, col IS ?, AND
  const conds = where.split(/\s+AND\s+/i);
  for (let cond of conds) {
    cond = cond.trim();
    const m = cond.match(/^(\w+)\s*(=|!=|<>|LIKE|>=|<=|>|<|IS NOT|IS)\s*(.+)$/i);
    if (!m) continue;
    const col = m[1];
    const op = m[2].toUpperCase();
    let val = m[3].trim();
    if (val === '?') {
      val = vals[vi++];
    } else {
      val = val.replace(/^['"]|['"]$/g, '');
    }
    const rv = row[col];
    switch (op) {
      case '=': if (String(rv) !== String(val)) return false; break;
      case '!=': case '<>': if (String(rv) === String(val)) return false; break;
      case '>': if (!(rv > val)) return false; break;
      case '<': if (!(rv < val)) return false; break;
      case '>=': if (!(rv >= val)) return false; break;
      case '<=': if (!(rv <= val)) return false; break;
      case 'LIKE': {
        const pat = String(val).replace(/%/g, '.*');
        if (!new RegExp('^' + pat + '$', 'i').test(String(rv ?? ''))) return false;
        break;
      }
      case 'IS': if ((rv ?? null) !== (val === 'NULL' ? null : val)) return false; break;
      case 'IS NOT': if ((rv ?? null) === (val === 'NULL' ? null : val)) return false; break;
    }
  }
  return true;
}