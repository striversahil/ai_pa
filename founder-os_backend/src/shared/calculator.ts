// calculator.ts — default `calculate` tool for engine copilots.
//
// Deterministic multi-step arithmetic (LLMs must NEVER do math mentally).
// Supports assignments + chained steps in one call:
//   "qty = 220; rate = 145; total = qty * rate * 1.25"
// Steps reference earlier variables plus `ans` (previous step value).
// Operators: + - * / ^ % (postfix percent) and parentheses.
// Functions: sqrt abs round floor ceil min max pow.
// Pure + dependency-free (safe hand-written parser — NEVER eval/Function).
// Limits: expression ≤ 500 chars, ≤ 25 steps. Values normalized to 6dp
// (pricing-friendly); division by zero / non-finite = hard error.
import type { ToolDefinition } from './ai-gateway';

export const CALCULATE_TOOL = 'calculate';

export interface CalcStep {
  expr: string;
  value: number;
}

export interface CalcOutput {
  steps: CalcStep[];
  result: number;
  error?: string;
}

export function calculateToolDef(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: CALCULATE_TOOL,
      description: 'Evaluate arithmetic PRECISELY — always use this for any numeric computation instead of mental math. Multi-step chains with assignments in one call, e.g. "qty = 220; rate = 145; total = qty * rate * 1.25". Operators + - * / ^ % (percent) and parentheses; functions sqrt abs round floor ceil min max pow. Later steps reuse earlier variables plus ans (previous value).',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'One expression or ;-separated assignment steps' },
        },
        required: ['expression'],
      },
    },
  };
}

const MAX_EXPR = 500;
const MAX_STEPS = 25;
const MAX_TOKENS = 500;

interface Tok { t: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma' | 'eq'; v: string }

function tokenize(s: string): Tok[] | string {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      toks.push({ t: 'num', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < s.length && ((s[j] >= 'a' && s[j] <= 'z') || (s[j] >= 'A' && s[j] <= 'Z') || (s[j] >= '0' && s[j] <= '9') || s[j] === '_')) j++;
      toks.push({ t: 'id', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '(') { toks.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rp', v: c }); i++; continue; }
    if (c === ',') { toks.push({ t: 'comma', v: c }); i++; continue; }
    if (c === '=') { toks.push({ t: 'eq', v: c }); i++; continue; }
    if ('+-*/^%'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    return `bad character "${c}"`;
  }
  return toks;
}

const FUNCS: Record<string, { n: number[]; f: (...a: number[]) => number }> = {
  sqrt: { n: [1], f: (x) => Math.sqrt(x) },
  abs: { n: [1], f: (x) => Math.abs(x) },
  round: { n: [1, 2], f: (x, d = 0) => { const p = Math.pow(10, Math.min(6, Math.max(0, Math.floor(d)))); return Math.round(x * p) / p; } },
  floor: { n: [1], f: (x) => Math.floor(x) },
  ceil: { n: [1], f: (x) => Math.ceil(x) },
  min: { n: [2], f: (a, b) => Math.min(a, b) },
  max: { n: [2], f: (a, b) => Math.max(a, b) },
  pow: { n: [2], f: (a, b) => Math.pow(a, b) },
};

class Parser {
  toks: Tok[];
  pos = 0;
  vars: Map<string, number>;
  constructor(toks: Tok[], vars: Map<string, number>) { this.toks = toks; this.vars = vars; }
  peek(): Tok | null { return this.toks[this.pos] ?? null; }
  next(): Tok | null { return this.toks[this.pos++] ?? null; }
  parseExpr(): number {
    let v = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op' || (t.v !== '+' && t.v !== '-')) return v;
      this.next();
      const r = this.parseTerm();
      v = t.v === '+' ? v + r : v - r;
    }
  }
  parseTerm(): number {
    let v = this.parsePower();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op' || (t.v !== '*' && t.v !== '/')) return v;
      this.next();
      const r = this.parsePower();
      if (t.v === '*') v = v * r;
      else {
        if (r === 0) throw new Error('division by zero');
        v = v / r;
      }
    }
  }
  parsePower(): number {
    const base = this.parseUnary();
    const t = this.peek();
    if (t && t.t === 'op' && t.v === '^') {
      this.next();
      const exp = this.parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }
  parseUnary(): number {
    const t = this.peek();
    if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
      this.next();
      const v = this.parseUnary();
      return t.v === '-' ? -v : v;
    }
    return this.parsePostfix();
  }
  parsePostfix(): number {
    let v = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && t.v === '%') { this.next(); v = v / 100; }
      else return v;
    }
  }
  parsePrimary(): number {
    const t = this.next();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') {
      const v = Number(t.v);
      if (!Number.isFinite(v)) throw new Error(`bad number "${t.v}"`);
      return v;
    }
    if (t.t === 'lp') {
      const v = this.parseExpr();
      const c = this.next();
      if (!c || c.t !== 'rp') throw new Error('missing )');
      return v;
    }
    if (t.t === 'id') {
      const nx = this.peek();
      if (nx && nx.t === 'lp') {
        this.next();
        const fn = FUNCS[t.v.toLowerCase()];
        if (!fn) throw new Error(`unknown function "${t.v}"`);
        const argv: number[] = [];
        if (this.peek()?.t !== 'rp') {
          for (;;) {
            argv.push(this.parseExpr());
            const s = this.peek();
            if (s && s.t === 'comma') { this.next(); continue; }
            break;
          }
        }
        const c = this.next();
        if (!c || c.t !== 'rp') throw new Error('missing )');
        if (!fn.n.includes(argv.length)) throw new Error(`${t.v} takes ${fn.n.join('/')} args`);
        return fn.f(...argv);
      }
      const name = t.v.toLowerCase();
      if (!this.vars.has(name)) throw new Error(`unknown variable "${t.v}"`);
      return this.vars.get(name) as number;
    }
    throw new Error(`unexpected "${t.v}"`);
  }
}

function normVal(v: number): number {
  if (!Number.isFinite(v)) throw new Error('non-finite result');
  if (Math.abs(v) > 1e15) throw new Error('result out of range');
  return Math.round(v * 1e6) / 1e6;
}

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function execCalculate(expression: string): CalcOutput {
  const src = String(expression ?? '').trim().slice(0, MAX_EXPR + 50);
  if (!src) return { steps: [], result: 0, error: 'empty expression' };
  if (src.length > MAX_EXPR) return { steps: [], result: 0, error: `expression over ${MAX_EXPR} chars` };
  const raws = src.split(/;|\n/).map((s) => s.trim()).filter(Boolean);
  if (raws.length === 0) return { steps: [], result: 0, error: 'empty expression' };
  if (raws.length > MAX_STEPS) return { steps: [], result: 0, error: `over ${MAX_STEPS} steps` };
  const vars = new Map<string, number>();
  const steps: CalcStep[] = [];
  try {
    for (const raw of raws) {
      const toks = tokenize(raw);
      if (typeof toks === 'string') throw new Error(toks);
      if (toks.length === 0) continue;
      if (toks.length > MAX_TOKENS) throw new Error('step too long');
      let value: number;
      let label = raw;
      // assignment: name = expr
      if (toks.length >= 3 && toks[0].t === 'id' && toks[1].t === 'eq') {
        const name = toks[0].v.toLowerCase();
        if (!NAME_RE.test(toks[0].v)) throw new Error(`bad variable name "${toks[0].v}"`);
        if (FUNCS[name]) throw new Error(`"${toks[0].v}" is a function name`);
        const p = new Parser(toks.slice(2), vars);
        value = p.parseExpr();
        if (p.pos !== toks.length - 2) throw new Error(`trailing input in "${raw.slice(0, 60)}"`);
        value = normVal(value);
        vars.set(name, value);
      } else {
        const p = new Parser(toks, vars);
        value = p.parseExpr();
        if (p.pos !== toks.length) throw new Error(`trailing input in "${raw.slice(0, 60)}"`);
        value = normVal(value);
      }
      vars.set('ans', value);
      steps.push({ expr: label.slice(0, 200), value });
    }
  } catch (e: any) {
    return { steps, result: steps.length ? steps[steps.length - 1].value : 0, error: String(e?.message ?? 'calc failed').slice(0, 200) };
  }
  if (!steps.length) return { steps: [], result: 0, error: 'empty expression' };
  return { steps, result: steps[steps.length - 1].value };
}

/** Chime label for the UI (engine uses this directly, not the dept def). */
export function calculateActivity(args: Record<string, any>, out: { result: unknown }): string {
  const r = (out.result ?? {}) as CalcOutput;
  if (r.error && r.steps.length === 0) return 'Calc failed';
  return `Calculated = ${r.result}`;
}
