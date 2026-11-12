// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.


export interface AuthResult {
  status: number;
  body?: any;
  setCookie?: string;
  redirect?: string;
}
