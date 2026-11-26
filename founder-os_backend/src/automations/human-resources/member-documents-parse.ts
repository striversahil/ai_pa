// Employee document validation: 20 MB, PDF/JPEG/PNG/WebP, stored in CHAT_FILES.
import { HrError } from "./errors";

export const MAX_MEMBER_DOC_BYTES = 20 * 1024 * 1024;

export const MEMBER_DOC_MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isMemberDocMime(value: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(MEMBER_DOC_MIME_EXT, String(value ?? ""));
}

export function memberDocExt(mime: string): string {
  return MEMBER_DOC_MIME_EXT[mime] ?? "bin";
}

export function checkMemberDocSize(size: unknown): number {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) throw new HrError("document file is required");
  if (n > MAX_MEMBER_DOC_BYTES) throw new HrError("document must be 20 MB or smaller");
  return Math.round(n);
}
