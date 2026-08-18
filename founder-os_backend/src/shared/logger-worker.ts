const levelRank: Record<string, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const currentLevel = (globalThis as any).__WORKER_LOG_LEVEL__ || 'info';

function fmtArg(a: any): any {
  if (a instanceof Error) return a.stack || a.message;
  if (a instanceof Date) return a.toISOString();
  if (typeof a === 'object' && a !== null) return JSON.stringify(a);
  return a;
}

function emit(level: string, args: any[]): void {
  if (levelRank[level] < levelRank[currentLevel]) return;
  let msg = '';
  const rest: any[] = [];
  for (const a of args) {
    if (typeof a === 'string' && !msg) msg = a;
    else if (msg) rest.push(fmtArg(a));
    else rest.push(fmtArg(a));
  }
  const line = msg ? `${level}: ${msg}${rest.length ? ' ' + rest.join(' ') : ''}` : `${level}: ${rest.join(' ')}`;
  if (level === 'error' || level === 'fatal') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  level: currentLevel,
  trace: (...a: any[]) => emit('trace', a),
  debug: (...a: any[]) => emit('debug', a),
  info: (...a: any[]) => emit('info', a),
  warn: (...a: any[]) => emit('warn', a),
  error: (...a: any[]) => emit('error', a),
  fatal: (...a: any[]) => emit('fatal', a),
  child: () => logger,
};

export type Logger = typeof logger;