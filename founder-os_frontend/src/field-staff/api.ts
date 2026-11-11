// api.ts — Field Staff worker calls (Worker-only, no Express mirror).
// All writes broadcast live; the panel refetches via useLiveDashboard.
// Automated location tracking is discontinued — no GPS is captured or sent.

import type { FieldExpense, FieldFollowup, FieldStaffData } from "./types";

async function req(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, { ...init, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String((body as any)?.error ?? `request failed (${res.status})`));
  return body;
}

export async function fetchFieldStaff(params: { from: string; to: string; staffId?: string }): Promise<FieldStaffData> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.staffId) q.set("staffId", params.staffId);
  return req(`/api/field-staff/data?${q.toString()}`);
}

export async function checkIn(args: {
  telecallerId: string; city: string; address?: string; note?: string;
}): Promise<any> {
  return req("/api/field-staff/check-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

/** Retired with automated tracking — kept so old callers fail closed. */
export async function pingVisit(_visitId: string, _lat: number | null, _lng: number | null): Promise<void> {
  return Promise.resolve();
}

export async function checkOut(visitId: string): Promise<void> {
  await req("/api/field-staff/check-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visitId }),
  });
}

export async function deleteVisit(id: string): Promise<void> {
  await req(`/api/field-staff/visits/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteMill(id: string): Promise<void> {
  await req(`/api/field-staff/mills/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export interface MillForm {
  millName: string;
  keyContact: string;
  designation: string;
  phone: string;
  rollerPlantNos: string;
  attaChakkiNos: string;
  chakkiSize: string;
  runningTime: string;
  products: string;
  millAgeYrs: string;
  machineBrand: string;
  requirement: string;
  followUpNeeded: boolean;
  dueDate: string;
  followupNote: string;
}

export const blankMillForm = (): MillForm => ({
  millName: "", keyContact: "", designation: "", phone: "",
  rollerPlantNos: "", attaChakkiNos: "", chakkiSize: "", runningTime: "",
  products: "", millAgeYrs: "", machineBrand: "", requirement: "",
  followUpNeeded: false, dueDate: "", followupNote: "",
});

export async function addMill(visitId: string, form: MillForm): Promise<any> {
  return req(`/api/field-staff/visits/${visitId}/mills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(form),
  });
}

export async function setMillFlag(millId: string, isNew: boolean | null, followUpNeeded?: boolean, extra?: { dueDate?: string; note?: string }): Promise<void> {
  await req(`/api/field-staff/mills/${millId}/flag`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isNew, followUpNeeded, dueDate: extra?.dueDate, note: extra?.note }),
  });
}

// ── Global day-wise expenses (calendar writes here — no visit required) ──

export async function fetchExpenses(params: { from: string; to: string; staffId?: string }): Promise<{ expenses: FieldExpense[] }> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.staffId) q.set("staffId", params.staffId);
  return req(`/api/field-staff/expenses?${q.toString()}`);
}

export async function logExpenseDay(args: { day: string; staffId: string; amount: number; description: string }): Promise<any> {
  return req("/api/field-staff/expenses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

/** Compat: visit-bound expense (inherits day/staff server-side). */
export async function addExpense(visitId: string, amount: number, description: string): Promise<any> {
  return req(`/api/field-staff/visits/${visitId}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, description }),
  });
}

// ── Global follow-ups (queue is not confined to one visit) ──

export async function fetchFollowupsGlobal(params: { from: string; to: string; staffId?: string; status?: string }): Promise<{ followups: FieldFollowup[] }> {
  const q = new URLSearchParams({ from: params.from, to: params.to });
  if (params.staffId) q.set("staffId", params.staffId);
  if (params.status) q.set("status", params.status);
  return req(`/api/field-staff/followups?${q.toString()}`);
}

export async function logFollowupGlobal(args: {
  day?: string; staffId: string; visitId?: string; millVisitId?: string;
  dueDate?: string; note: string; owner?: string;
}): Promise<any> {
  return req("/api/field-staff/followups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

/** Compat: visit-bound follow-up. */
export async function addFollowup(visitId: string, args: { millVisitId?: string; dueDate?: string; note: string; owner?: string }): Promise<any> {
  return req(`/api/field-staff/visits/${visitId}/followups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export async function setFollowupStatus(id: string, status: "open" | "done" | "cancelled"): Promise<void> {
  await req(`/api/field-staff/followups/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

/** Retired with automated tracking — always resolves null. */
export function readGps(_timeoutMs = 10_000): Promise<{ lat: number | null; lng: number | null }> {
  return Promise.resolve({ lat: null, lng: null });
}

export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function tomorrowIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000 + 86400 * 1000).toISOString().slice(0, 10);
}

export function twoWeeksAgo(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000 - 13 * 86400 * 1000).toISOString().slice(0, 10);
}
