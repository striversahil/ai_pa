// Session cookie helpers. We emit a raw `Set-Cookie` header string so the exact
// same code works in Hono (Worker) and Express — both accept a Set-Cookie header.

export const SESSION_COOKIE = "fos_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (seconds)

export function sessionCookieHeader(id: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${id}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionCookie(header?: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}
