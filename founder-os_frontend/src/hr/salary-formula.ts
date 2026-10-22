// Safe arithmetic formula parser for salary structures.
// Mirror: founder-os_backend/src/automations/human-resources/salary-formula.ts

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'un'; op: string; v: Node }
  | { t: 'pct'; v: Node }
  | { t: 'call'; name: string; args: Node[] };

const FUNCTIONS = new Set(['min', 'max', 'round', 'if', 'abs']);
const VARIABLES = new Set(['input', 'basic', 'gross']);
const CACHE = new Map<string, Node>();

function tokenize(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      let dots = 0;
      while (j < source.length && /[0-9.]/.test(source[j])) { if (source[j] === '.') dots += 1; j += 1; }
      if (dots > 1) throw new Error('invalid number');
      out.push(source.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      out.push(source.slice(i, j));
      i = j;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (['<=', '>=', '==', '!='].includes(two)) { out.push(two); i += 2; continue; }
    if ('+-*/%(),<>'.includes(ch)) { out.push(ch); i += 1; continue; }
    throw new Error(`unexpected character '${ch}'`);
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: string[]) {}

  parse(): Node {
    const node = this.comparison();
    if (this.pos !== this.tokens.length) throw new Error(`unexpected token '${this.tokens[this.pos]}'`);
    return node;
  }
  private peek(): string | undefined { return this.tokens[this.pos]; }
  private eat(token?: string): string {
    const current = this.tokens[this.pos];
    if (current === undefined) throw new Error('unexpected end of formula');
    if (token !== undefined && current !== token) throw new Error(`expected '${token}'`);
    this.pos += 1;
    return current;
  }
  private comparison(): Node {
    let left = this.additive();
    while (this.peek() && ['<', '<=', '>', '>=', '==', '!='].includes(this.peek()!)) {
      const op = this.eat();
      left = { t: 'bin', op, l: left, r: this.additive() };
    }
    return left;
  }
  private additive(): Node {
    let left = this.multiplicative();
    while (this.peek() === '+' || this.peek() === '-') {
      const op = this.eat();
      left = { t: 'bin', op, l: left, r: this.multiplicative() };
    }
    return left;
  }
  private multiplicative(): Node {
    let left = this.unary();
    while (this.peek() === '*' || this.peek() === '/') {
      const op = this.eat();
      left = { t: 'bin', op, l: left, r: this.unary() };
    }
    return left;
  }
  private unary(): Node {
    if (this.peek() === '+' || this.peek() === '-') {
      const op = this.eat();
      return { t: 'un', op, v: this.unary() };
    }
    return this.postfix();
  }
  private postfix(): Node {
    let node = this.primary();
    while (this.peek() === '%') { this.eat('%'); node = { t: 'pct', v: node }; }
    return node;
  }
  private primary(): Node {
    const token = this.peek();
    if (token === undefined) throw new Error('unexpected end of formula');
    if (token === '(') {
      this.eat('(');
      const node = this.comparison();
      this.eat(')');
      return node;
    }
    if (/^[0-9.]+$/.test(token)) {
      this.eat();
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('invalid number');
      return { t: 'num', v: value };
    }
    if (/^[A-Za-z_]/.test(token)) {
      const name = this.eat();
      if (this.peek() === '(') {
        if (!FUNCTIONS.has(name)) throw new Error(`unknown function '${name}'`);
        this.eat('(');
        const args: Node[] = [];
        if (this.peek() !== ')') {
          args.push(this.comparison());
          while (this.peek() === ',') { this.eat(','); args.push(this.comparison()); }
        }
        this.eat(')');
        if (name === 'if' && args.length !== 3) throw new Error('if() needs 3 arguments');
        if ((name === 'min' || name === 'max') && args.length < 2) throw new Error(`${name}() needs at least 2 arguments`);
        if ((name === 'round' || name === 'abs') && (args.length < 1 || args.length > 2)) throw new Error(`${name}() needs 1 or 2 arguments`);
        return { t: 'call', name, args };
      }
      if (!VARIABLES.has(name)) throw new Error(`unknown variable '${name}'`);
      return { t: 'var', name };
    }
    throw new Error(`unexpected token '${token}'`);
  }
}

function compile(source: string): Node {
  const key = source.trim();
  const hit = CACHE.get(key);
  if (hit) return hit;
  if (!key) throw new Error('formula is empty');
  const node = new Parser(tokenize(key)).parse();
  collect(node);
  CACHE.set(key, node);
  return node;
}

function collect(node: Node): void {
  if (node.t === 'var') return;
  if (node.t === 'bin') { collect(node.l); collect(node.r); return; }
  if (node.t === 'un' || node.t === 'pct') { collect(node.v); return; }
  if (node.t === 'call') { for (const arg of node.args) collect(arg); }
}

function evaluate(node: Node, vars: Record<string, number>): number {
  if (node.t === 'num') return node.v;
  if (node.t === 'var') return Number(vars[node.name]) || 0;
  if (node.t === 'un') return node.op === '-' ? -evaluate(node.v, vars) : evaluate(node.v, vars);
  if (node.t === 'pct') return evaluate(node.v, vars) / 100;
  if (node.t === 'call') {
    if (node.name === 'if') return evaluate(node.args[0], vars) > 0 ? evaluate(node.args[1], vars) : evaluate(node.args[2], vars);
    if (node.name === 'min') return Math.min(...node.args.map((a) => evaluate(a, vars)));
    if (node.name === 'max') return Math.max(...node.args.map((a) => evaluate(a, vars)));
    if (node.name === 'abs') return Math.abs(evaluate(node.args[0], vars));
    const value = evaluate(node.args[0], vars);
    const digits = node.args[1] ? Math.max(0, Math.min(6, Math.floor(evaluate(node.args[1], vars)))) : 0;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }
  const left = evaluate(node.l, vars);
  const right = evaluate(node.r, vars);
  if (node.op === '+') return left + right;
  if (node.op === '-') return left - right;
  if (node.op === '*') return left * right;
  if (node.op === '/') {
    if (right === 0) throw new Error('division by zero');
    return left / right;
  }
  if (node.op === '<') return left < right ? 1 : 0;
  if (node.op === '<=') return left <= right ? 1 : 0;
  if (node.op === '>') return left > right ? 1 : 0;
  if (node.op === '>=') return left >= right ? 1 : 0;
  if (node.op === '==') return left === right ? 1 : 0;
  if (node.op === '!=') return left !== right ? 1 : 0;
  throw new Error(`unknown operator '${node.op}'`);
}

export function validateFormula(source: string): void {
  compile(source);
}

export function evaluateFormula(source: string, vars: Record<string, number>): number {
  const value = evaluate(compile(source), vars);
  if (!Number.isFinite(value)) throw new Error('formula did not produce a finite number');
  return value;
}

export function formulaVariables(source: string): Set<string> {
  const out = new Set<string>();
  const walk = (node: Node) => {
    if (node.t === 'var') out.add(node.name);
    else if (node.t === 'bin') { walk(node.l); walk(node.r); }
    else if (node.t === 'un' || node.t === 'pct') walk(node.v);
    else if (node.t === 'call') node.args.forEach(walk);
  };
  walk(compile(source));
  return out;
}
