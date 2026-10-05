"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { Mail, Plug, Send, FileText, Clock, Trash2, RefreshCw, XCircle } from "lucide-react";

interface Account { id: string; label: string; email: string; status: string; connected: boolean; }
interface OutboxItem { id: string; accountId: string; to: string[]; subject: string; status: string; dueAt: number; repeatDailyAt: string; attempts: number; lastError: string; }
interface Draft { id: string; subject: string; to: string; date: string; snippet: string; }
interface LogRow { id: string; action: string; to: string; subject: string; gmailId: string; ok: boolean; error: string; createdAt: string; }

async function api(path: string, init?: RequestInit) {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const card = "rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3";
const input = "w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600";
const btn = "px-3 py-1.5 text-xs rounded-full border cursor-pointer disabled:opacity-50 transition-colors";

export default function EmailDashboard() {
  const { me } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  // connect form
  const [connEmail, setConnEmail] = useState("");
  const [connLabel, setConnLabel] = useState("");
  // compose form
  const [acct, setAcct] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // drafts
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftAcct, setDraftAcct] = useState("");
  // schedule form
  const [sendAt, setSendAt] = useState("");
  const [dailyAt, setDailyAt] = useState("");

  const refresh = useCallback(async () => {    try {
      const s = await api("/api/email/status");
      setAccounts(s.accounts ?? []);
      setOutbox((s.outbox ?? []).filter((o: OutboxItem) => o.status === "queued" || o.status === "failed"));
      if (!acct && (s.accounts ?? []).length) setAcct(s.accounts[0].id);
      if (!draftAcct && (s.accounts ?? []).length) setDraftAcct(s.accounts[0].id);
      const l = await api("/api/email/log").catch(() => ({ log: [] }));
      setLog(l.log ?? []);
    } catch (e: any) { setMsg(e.message); } finally { setLoading(false); }
  }, [acct, draftAcct]);

  useEffect(() => { refresh(); }, [refresh]);

  // Post-OAuth landing: /email?connected=<addr> after Google consent.
  useEffect(() => {
    try {
      const addr = new URLSearchParams(window.location.search).get("connected");
      if (addr) {
        setMsg(`Email connected ✓ (${addr}) — send, drafts and scheduling are live.`);
        window.history.replaceState(null, "", "/email");
      }
    } catch { /* ignore */ }
  }, []);

  if (!me?.isRoot) {
    return (
      <div className="p-6 text-center text-zinc-400 space-y-2">
        <div className="text-4xl">🔒</div>
        <div className="font-semibold text-zinc-200">Root only</div>
        <div className="text-sm">The founder email service is available to the root user only.</div>
      </div>
    );
  }
  if (loading) return <div className="p-6 text-zinc-400">Loading email service…</div>;

  const run = async (key: string, fn: () => Promise<any>, okMsg: string) => {
    setBusy(key); setMsg("");
    try { await fn(); setMsg(okMsg); await refresh(); }
    catch (e: any) { setMsg(`Error: ${e.message}`); }
    finally { setBusy(null); }
  };

  const connected = accounts.filter((a) => a.connected);
  const compose = { accountId: acct, to: to.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean), subject, body };

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Mail size={18} className="text-indigo-300" />
        <h2 className="text-lg font-bold text-zinc-100">Email</h2>
        <span className="text-xs text-zinc-500">Gmail send · drafts · scheduled &amp; cron mail — root only</span>
        <button onClick={refresh} className={`${btn} ml-auto border-zinc-700 text-zinc-300 hover:border-zinc-400`}>
          <RefreshCw size={12} className="inline mr-1" /> Refresh
        </button>
      </div>
      {msg && <div className="text-xs text-amber-300/90">{msg}</div>}

      {/* ── Accounts ── */}
      <div className={card}>
        <div className="text-sm font-semibold text-zinc-200">Connected accounts</div>
        {accounts.length === 0 && <div className="text-xs text-zinc-500">No Gmail connected yet — connect one below.</div>}
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-sm flex-wrap">
            <span className={`px-2 py-0.5 text-xs rounded-full border ${a.connected ? "border-emerald-600 text-emerald-300" : "border-red-900 text-red-400"}`}>
              {a.connected ? "● connected" : "○ not connected"}
            </span>
            <span className="text-zinc-200">{a.label}</span>
            <span className="text-zinc-500 text-xs">{a.email}</span>
            {!a.connected && (
              <a
                href={`/api/email/oauth/start?account=${encodeURIComponent(a.id)}`}
                className={`${btn} border-sky-500 text-sky-200 hover:bg-sky-500/10`}
              >
                <Plug size={12} className="inline mr-1" /> Connect
              </a>
            )}
            <button
              onClick={() => run(`dis-${a.id}`, () => api("/api/email/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: a.id }) }), "Disconnected.")}
              disabled={busy === `dis-${a.id}`}
              className={`${btn} border-zinc-700 text-zinc-400 hover:border-red-700 hover:text-red-300`}
            >
              Disconnect
            </button>
          </div>
        ))}
        <div className="flex gap-2 flex-wrap items-end pt-1">
          <input value={connEmail} onChange={(e) => setConnEmail(e.target.value)} placeholder="you@gmail.com" className={`${input} max-w-xs`} />
          <input value={connLabel} onChange={(e) => setConnLabel(e.target.value)} placeholder="Label (e.g. BUI)" className={`${input} max-w-[10rem]`} />
          <button
            disabled={!connEmail.includes("@")}
            onClick={() => { window.location.href = `/api/email/oauth/start?email=${encodeURIComponent(connEmail.trim())}&label=${encodeURIComponent(connLabel.trim() || connEmail.trim())}`; }}
            className={`${btn} border-sky-500 text-sky-200 hover:bg-sky-500/10 disabled:opacity-50`}
          >
            <Plug size={12} className="inline mr-1" /> Connect Gmail
          </button>
        </div>
      </div>

      {/* ── Compose ── */}
      <div className={card}>
        <div className="text-sm font-semibold text-zinc-200">Compose</div>
        <div className="grid md:grid-cols-2 gap-2">
          <select value={acct} onChange={(e) => setAcct(e.target.value)} className={input}>
            {connected.length === 0 && <option value="">— connect an account first —</option>}
            {connected.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
          </select>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To (comma-separated)" className={input} />
        </div>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className={input} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Body…" rows={5} className={`${input} font-sans`} />
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => run("send", () => api("/api/email/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compose) }), "Sent ✓")}
            disabled={busy === "send" || !acct || !to || !subject || !body}
            className={`${btn} border-indigo-500 text-indigo-200 hover:bg-indigo-500/10 disabled:opacity-50`}
          >
            <Send size={12} className="inline mr-1" /> {busy === "send" ? "Sending…" : "Send now"}
          </button>
          <button
            onClick={() => run("draft", () => api("/api/email/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(compose) }), "Draft saved to Gmail ✓")}
            disabled={busy === "draft" || !acct || !to || !subject || !body}
            className={`${btn} border-zinc-600 text-zinc-300 hover:border-zinc-400 disabled:opacity-50`}
          >
            <FileText size={12} className="inline mr-1" /> {busy === "draft" ? "Saving…" : "Save as Gmail draft"}
          </button>
        </div>
      </div>

      {/* ── Drafts ── */}
      <div className={card}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-200">Gmail drafts</span>
          <select value={draftAcct} onChange={(e) => setDraftAcct(e.target.value)} className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200">
            {connected.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <button
            onClick={() => run("drafts", async () => { const d = await api(`/api/email/drafts?account=${encodeURIComponent(draftAcct)}`); setDrafts(d.drafts ?? []); }, `Loaded ${drafts.length} drafts.`)}
            disabled={busy === "drafts" || !draftAcct}
            className={`${btn} border-zinc-700 text-zinc-300 hover:border-zinc-400 disabled:opacity-50`}
          >
            Load
          </button>
        </div>
        {drafts.length === 0 && <div className="text-xs text-zinc-500">No drafts loaded — pick an account and Load.</div>}
        {drafts.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm border-t border-zinc-800/60 pt-2 flex-wrap">
            <span className="text-zinc-200 truncate max-w-md">{d.subject || "(no subject)"}</span>
            <span className="text-zinc-500 text-xs truncate max-w-xs">{d.to} · {d.date}</span>
            <button
              onClick={() => run(`dd-${d.id}`, async () => { await api(`/api/email/draft?account=${encodeURIComponent(draftAcct)}&draftId=${encodeURIComponent(d.id)}`, { method: "DELETE" }); setDrafts((p) => p.filter((x) => x.id !== d.id)); }, "Draft deleted.")}
              disabled={busy === `dd-${d.id}`}
              className={`${btn} ml-auto border-red-900 text-red-400 hover:bg-red-500/10`}
            >
              <Trash2 size={12} className="inline mr-1" /> Delete
            </button>
          </div>
        ))}
      </div>

      {/* ── Schedule / outbox ── */}
      <div className={card}>
        <div className="text-sm font-semibold text-zinc-200">Schedule &amp; cron mail</div>
        <div className="text-xs text-zinc-500">Uses the Compose box above. One-shot <span className="text-zinc-300">sendAt</span>, or daily repeat <span className="text-zinc-300">HH:MM IST</span> (the per-minute worker tick sends it and re-queues for tomorrow).</div>
        <div className="flex gap-2 flex-wrap items-end">
          <label className="text-xs text-zinc-400">Send once at <input type="datetime-local" value={sendAt} onChange={(e) => { setSendAt(e.target.value); setDailyAt(""); }} className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 ml-1" /></label>
          <label className="text-xs text-zinc-400">Repeat daily <input value={dailyAt} onChange={(e) => { setDailyAt(e.target.value); setSendAt(""); }} placeholder="09:00" className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-200 ml-1" /></label>
          <button
            onClick={() => run("sched", () => api("/api/email/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...compose, sendAt: sendAt ? new Date(sendAt).toISOString() : undefined, repeatDailyAt: dailyAt || undefined }) }), "Scheduled ✓ — the worker tick sends it.")}
            disabled={busy === "sched" || !acct || !to || !subject || !body || (!sendAt && !dailyAt)}
            className={`${btn} border-amber-600 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50`}
          >
            <Clock size={12} className="inline mr-1" /> {busy === "sched" ? "Queueing…" : "Queue mail"}
          </button>
        </div>
        {outbox.length === 0 && <div className="text-xs text-zinc-500">Queue empty.</div>}
        {outbox.map((o) => (
          <div key={o.id} className="flex items-center gap-2 text-sm border-t border-zinc-800/60 pt-2 flex-wrap">
            <span className={`px-2 py-0.5 text-xs rounded-full border ${o.status === "queued" ? "border-amber-700 text-amber-300" : "border-red-900 text-red-400"}`}>{o.status}</span>
            <span className="text-zinc-200 truncate max-w-md">{o.subject}</span>
            <span className="text-zinc-500 text-xs">{o.to.join(", ").slice(0, 60)}{o.repeatDailyAt ? ` · daily ${o.repeatDailyAt} IST` : ` · due ${new Date(o.dueAt).toLocaleString("en-IN")}`}</span>
            {o.lastError && <span className="text-red-400/80 text-xs w-full">{o.lastError}</span>}
            <button
              onClick={() => run(`cx-${o.id}`, () => api(`/api/email/outbox/${encodeURIComponent(o.id)}`, { method: "DELETE" }), "Cancelled.")}
              disabled={busy === `cx-${o.id}`}
              className={`${btn} ml-auto border-zinc-700 text-zinc-400 hover:border-red-700 hover:text-red-300`}
            >
              <XCircle size={12} className="inline mr-1" /> Cancel
            </button>
          </div>
        ))}
      </div>

      {/* ── Log ── */}
      {log.length > 0 && (
        <div className={card}>
          <div className="text-sm font-semibold text-zinc-200">Recent sends</div>
          {log.slice(0, 15).map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-xs border-t border-zinc-800/60 pt-1.5 flex-wrap">
              <span className={l.ok ? "text-emerald-400" : "text-red-400"}>{l.ok ? "✓" : "✗"}</span>
              <span className="text-zinc-400">{l.action}</span>
              <span className="text-zinc-200 truncate max-w-md">{l.subject}</span>
              {!l.ok && <span className="text-red-400/80 w-full">{l.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
