// Extracted verbatim from routes.ts by scripts/refactor/split-module.mjs.
// routes.ts re-exports everything public here, so existing imports keep working.
import { ROOT_EMAIL } from "../types";
import type { AuthResult } from "./types";

export const json = (status: number, body: any): AuthResult => ({ status, body });

export const redirect = (location: string): AuthResult => ({ status: 302, redirect: location });

export function isRoot(me: { user: { email: string }; isRoot: boolean }): boolean {
  return me.isRoot || me.user.email === ROOT_EMAIL;
}

export function isTargetRoot(target: { isRoot: boolean; email: string }): boolean {
  return target.isRoot || target.email === ROOT_EMAIL;
}
