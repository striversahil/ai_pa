import type { DragEvent } from "react";
import type { EnquiryMedia } from "../types";

/** Longest edge after downscale — keeps data-URIs small enough for D1 rows
 *  and comfortably under the intake vision cap (~2M chars / 4 images). */
export const MAX_IMAGE_DIM = 1600;
/** JPEG quality for downscaled photos (legible nameplates at ~200-500KB). */
export const IMAGE_JPEG_QUALITY = 0.82;

export type MediaKind = EnquiryMedia["type"];

export function isSupportedMediaFile(f: File): boolean {
  return (
    f.type.startsWith("image/") ||
    f.type.startsWith("video/") ||
    f.type === "application/pdf" ||
    /\.pdf$/i.test(f.name)
  );
}

export function mediaKindForFile(f: File): MediaKind {
  if (f.type.startsWith("video/")) return "video";
  if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) return "pdf";
  return "image";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`cannot read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Downscale an image through canvas (max 1600px edge, JPEG). Non-images
 *  resolve unchanged as data-URIs. Rejects when the file can't be decoded
 *  (e.g. HEIC on browsers without support) — caller reports the skip. */
export function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) return readAsDataUrl(file);
  // Tiny images aren't worth re-encoding (keeps PNG screenshots crisp).
  if (file.size <= 400 * 1024) return readAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY));
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err instanceof Error ? err : new Error(`cannot decode ${file.name}`));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`cannot decode ${file.name}`));
    };
    img.src = objectUrl;
  });
}

export interface MediaLoadResult {
  media: Array<{ type: MediaKind; url: string; name: string }>;
  /** File names that were filtered out or failed to decode. */
  skipped: string[];
}

/** File picker OR drag-and-drop files → media entries, images downscaled.
 *  Unsupported types are skipped (reported, not attached). */
export async function filesToMedia(files: FileList | File[] | null): Promise<MediaLoadResult> {
  const list = files ? Array.from(files) : [];
  const media: MediaLoadResult["media"] = [];
  const skipped: string[] = [];
  for (const f of list) {
    if (!isSupportedMediaFile(f)) {
      skipped.push(f.name);
      continue;
    }
    try {
      const url = await fileToDataUrl(f);
      if (url) media.push({ type: mediaKindForFile(f), url, name: f.name });
      else skipped.push(f.name);
    } catch {
      skipped.push(f.name);
    }
  }
  return { media, skipped };
}

/** True when a drag event carries files (vs text being moved between inputs).
 *  Gate drop handlers on this so textarea drag-editing keeps working. */
export function dragHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}
