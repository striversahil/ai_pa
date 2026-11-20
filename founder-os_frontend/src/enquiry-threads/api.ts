// enquiry-threads/api.ts — the ONLY place that spells /api/enquiry-threads.
// Every call names the acting desk; the Worker filters what that desk may see.
import { api } from "@/api/client";
import type { EnquiryThread, ThreadDesk, ThreadStatus } from "./types";

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const fetchEnquiryThreads = (desk: ThreadDesk, enquiryId: string) =>
  api.get<{ threads: EnquiryThread[] }>(`/enquiry-threads?${q({ desk, enquiryId })}`).then((r) => r.threads ?? []);

export const fetchThreadInbox = (desk: ThreadDesk, status: ThreadStatus) =>
  api.get<{ threads: EnquiryThread[] }>(`/enquiry-threads/inbox?${q({ desk, status })}`).then((r) => r.threads ?? []);

export const startThread = (body: { desk: ThreadDesk; to: ThreadDesk; enquiryId: string; itemIndex: number; itemName: string; text: string }) =>
  api.post<{ thread: EnquiryThread }>(`/enquiry-threads`, body).then((r) => r.thread);

export const actOnThread = (id: string, op: "reply" | "resolve" | "reopen", desk: ThreadDesk, text?: string) =>
  api.post<{ thread: EnquiryThread }>(`/enquiry-threads/${encodeURIComponent(id)}/${op}`, { desk, text }).then((r) => r.thread);

/** Management only: ask procurement about a sales thread (opens a separate, private thread). */
export const forwardThread = (id: string, text: string) =>
  api.post<{ thread: EnquiryThread }>(`/enquiry-threads/${encodeURIComponent(id)}/forward`, { text }).then((r) => r.thread);
