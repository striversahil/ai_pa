"use client";

import React, { useState } from "react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { CheckCircle2, Copy, RefreshCw, Image as ImageIcon, CalendarDays, FlaskConical } from "lucide-react";

interface LinkedinPost {
  id: string;
  topic: string;
  pillar: string;
  format: string;
  researchBrief: string;
  postDraft: string;
  postFinal: string;
  hashtags: string;
  visualBrief: string;
  hasImage: boolean;
  imageUrl: string | null;
  status: string;
  picked: boolean;
  postedAt: string | null;
  linkedinUrn: string | null;
  linkedinUrl: string | null;
}

interface LinkedinBatch {
  date: string;
  ready: boolean;
  posts: LinkedinPost[];
  recentBatches?: string[];
  linkedin?: { connected: boolean; expiresAt: number | null };
}

async function fetchBatch(date?: string): Promise<LinkedinBatch> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  const r = await fetch(`/api/linkedin/today${q}`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// The model sometimes returns the Hook/Post/Hashtags shape as a JSON object
// instead of markdown (30/09 batch). Compose either shape into a finished
// post — mirrors scripts/linkedin-format.js in the runner.
function displayFinal(text: string): string {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return raw;
  try {
    const o = JSON.parse(raw.slice(start, end + 1));
    if (!o || typeof o !== "object") return raw;
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = (o as any)[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    };
    // Key names drift run to run — accept every variant seen live.
    const post = pick("Post", "post", "body", "post_draft", "postDraft", "body_draft", "bodyDraft", "post_body", "postBody");
    if (!post) return raw;
    const hookA = pick("Hook A", "hookA", "hook_a");
    const tagRaw = (o as any).Hashtags ?? (o as any).hashtags ?? (o as any).tags;
    const rawTags = Array.isArray(tagRaw) ? tagRaw.join(" ") : String(tagRaw ?? "");
    let out = hookA ? `${hookA}\n\n${post}` : post;
    if (rawTags.trim()) out += `\n\n${rawTags.trim()}`;
    return out;
  } catch {
    return raw;
  }
}

function copyText(t: string) {
  navigator.clipboard?.writeText(t).catch(() => {});
}

export default function LinkedinDashboard() {
  const [day, setDay] = useState<string | null>(null); // null = today
  const batch = useLiveDashboard(() => fetchBatch(day ?? undefined), { deps: [day] });
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"final" | "research" | "visual">("final");
  const [regenMsg, setRegenMsg] = useState<string | null>(null);
  const [postMsg, setPostMsg] = useState<string | null>(null);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [ideaId, setIdeaId] = useState("");

  const dates = batch.data?.recentBatches ?? [];

  const connected = !!batch.data?.linkedin?.connected;

  const postNow = async (id: string) => {
    if (!window.confirm("Post this draft to your LinkedIn profile now?")) return;
    setBusy("postnow");
    setPostMsg(null);
    try {
      const r = await fetch("/api/linkedin/post-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id }),
      });
      const j = await r.json().catch(() => ({}));
      setPostMsg(j.ok ? `📮 Posted — view it here: ${j.url}` : `❌ Post failed: ${j.error ?? "unknown error"}`);
    } catch {
      setPostMsg("❌ Post failed — try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const posts = batch.data?.posts ?? [];
  const post = posts[Math.min(active, Math.max(0, posts.length - 1))];

  const act = async (path: string, body: any, label: string) => {
    setBusy(label);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(null);
    }
  };

  const regen = async () => {
    setBusy("regen");
    setRegenMsg(null);
    try {
      const r = await fetch("/api/linkedin/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      setRegenMsg(j.ok ? "⚡ Batch running — fresh drafts land here live on completion." : `⏳ ${j.error ?? "busy, try again in a few minutes."}`);
    } catch {
      setRegenMsg("⏳ Trigger failed — try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  const deleteDraft = async (id: string) => {
    if (!window.confirm("Delete this draft permanently?")) return;
    setBusy("del");
    try {
      await fetch("/api/linkedin/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id }),
      });
      batch.refresh();
    } finally {
      setBusy(null);
    }
  };

  const generateOne = async () => {
    setBusy("genone");
    setGenMsg(null);
    try {
      const r = await fetch("/api/linkedin/generate-one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ideaId: ideaId.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setGenMsg(`⚡ Draft ${j.ideaId} generating — lands in today's batch live.`);
        setDay(null);
        setIdeaId("");
      } else {
        setGenMsg(`⏳ ${j.error ?? "busy, try again in a few minutes."}`);
      }
    } catch {
      setGenMsg("⏳ Trigger failed — try again in a minute.");
    } finally {
      setBusy(null);
    }
  };

  if (batch.loading) return <div className="p-6 text-zinc-400">Loading today's drafts…</div>;
  if (batch.error) return <div className="p-6 text-red-400">LinkedIn batch unavailable ({String((batch.error as Error)?.message ?? batch.error)}).</div>;
  if (!batch.data?.ready) {
    return (
      <div className="p-6 text-zinc-400 space-y-3">
        <div>
          <CalendarDays className="inline mr-2" size={16} />
          No batch on {day ?? "today yet"} — the 03:00 IST runner generates 5 drafts daily.
        </div>
        {dates.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span>Browse:</span>
            <select
              value={day ?? ""}
              onChange={(e) => setDay(e.target.value || null)}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
            >
              <option value="">Today</option>
              {dates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-zinc-400">Batch {batch.data.date} — pick one to post:</span>
        {dates.length > 0 && (
          <select
            value={day ?? ""}
            onChange={(e) => { setDay(e.target.value || null); setActive(0); }}
            title="Browse every day's batch"
            className="bg-zinc-900 border border-zinc-700 rounded-full px-2 py-1 text-xs text-zinc-200 cursor-pointer"
          >
            <option value="">📅 Today</option>
            {dates.map((d) => (
              <option key={d} value={d}>📅 {d}</option>
            ))}
          </select>
        )}
        {connected ? (
          <span className="px-2 py-0.5 text-xs rounded-full border border-emerald-600 text-emerald-300">● LinkedIn connected</span>
        ) : (
          <a
            href="/api/linkedin/oauth/start"
            className="px-3 py-1 text-xs rounded-full border border-sky-500 text-sky-200 hover:bg-sky-500/10"
          >
            🔗 Connect LinkedIn
          </a>
        )}
        <button
          onClick={regen}
          disabled={busy === "regen"}
          title="Trigger a fresh 5-draft batch now (03:00 run on demand)"
          className="ml-auto px-3 py-1 text-xs rounded-full border border-amber-600 text-amber-300 hover:bg-amber-500/10 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`inline mr-1 ${busy === "regen" ? "animate-spin" : ""}`} size={12} />
          {busy === "regen" ? "Triggering…" : "↻ Regenerate now"}
        </button>
      </div>
      {regenMsg && <div className="text-xs text-amber-300/90">{regenMsg}</div>}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-zinc-400">＋ New draft on the fly:</span>
        <input
          value={ideaId}
          onChange={(e) => setIdeaId(e.target.value.toUpperCase().replace(/[^P0-9]/g, "").slice(0, 4))}
          placeholder="P042 or blank = auto"
          className="w-36 bg-zinc-900 border border-zinc-700 rounded-full px-3 py-1 text-zinc-200 placeholder:text-zinc-600"
        />
        <button
          onClick={generateOne}
          disabled={busy === "genone"}
          title="Generate one fresh draft into today's batch (specific idea or auto-pick)"
          className="px-3 py-1 rounded-full border border-emerald-600 text-emerald-300 hover:bg-emerald-500/10 cursor-pointer disabled:opacity-50"
        >
          {busy === "genone" ? "Starting…" : "⚡ Generate"}
        </button>
        {genMsg && <span className="text-emerald-300/90">{genMsg}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {posts.map((p, i) => (
          <button
            key={p.id}
            onClick={() => { setActive(i); setTab("final"); }}
            className={`px-3 py-1 text-xs rounded-full border transition-all cursor-pointer ${
              i === active ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {p.picked ? "✓ " : ""}{i + 1}. {p.topic.slice(0, 28)}
            {p.status === "posted" ? " 📮" : ""}
          </button>
        ))}
      </div>

      {post && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex gap-2 text-xs">
              {(["final", "research", "visual"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-2 py-0.5 rounded-full border cursor-pointer ${tab === t ? "border-indigo-400 text-indigo-200" : "border-zinc-700 text-zinc-500"}`}
                >
                  {t === "final" ? "Post" : t === "research" ? "Research" : "Visual brief"}
                </button>
              ))}
              <span className="ml-auto text-zinc-500">Pillar {post.pillar} · {post.format} · {post.status}</span>
            </div>
            {tab === "final" && <pre className="whitespace-pre-wrap text-sm text-zinc-200 font-sans">{displayFinal(post.postFinal)}</pre>}
            {tab === "research" && <pre className="whitespace-pre-wrap text-xs text-zinc-400 font-sans">{displayFinal(post.researchBrief)}</pre>}
            {tab === "visual" && <pre className="whitespace-pre-wrap text-xs text-zinc-400 font-sans">{post.visualBrief}</pre>}
            {post.hashtags && <div className="text-xs text-sky-300">{post.hashtags}</div>}
            <div className="flex gap-2 flex-wrap pt-1">
              <button
                onClick={() => { copyText(`${displayFinal(post.postFinal)}\n\n${post.hashtags}`); }}
                className="px-3 py-1 text-xs rounded-full border border-zinc-700 text-zinc-300 hover:border-zinc-400 cursor-pointer"
              >
                <Copy className="inline mr-1" size={12} /> Copy post
              </button>
              {!post.picked ? (
                <button
                  onClick={() => act("/api/linkedin/pick", { id: post.id }, "pick")}
                  disabled={busy === "pick"}
                  className="px-3 py-1 text-xs rounded-full border border-emerald-600 text-emerald-300 hover:bg-emerald-500/10 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="inline mr-1" size={12} /> {busy === "pick" ? "Picking…" : "Pick this one"}
                </button>
              ) : post.status !== "posted" ? (
                <button
                  onClick={() => postNow(post.id)}
                  disabled={busy === "postnow" || !connected}
                  title={connected ? "Publish to your LinkedIn profile now" : "Connect LinkedIn first"}
                  className="px-3 py-1 text-xs rounded-full border border-indigo-500 text-indigo-200 hover:bg-indigo-500/10 cursor-pointer disabled:opacity-50"
                >
                  📮 {busy === "postnow" ? "Posting…" : "Post now"}
                </button>
              ) : (
                post.linkedinUrl ? (
                  <a
                    href={post.linkedinUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1 text-xs rounded-full border border-zinc-700 text-emerald-300 hover:border-emerald-500"
                  >
                    📮 Posted — view on LinkedIn ↗
                  </a>
                ) : (
                  <span className="px-3 py-1 text-xs rounded-full border border-zinc-700 text-zinc-500">📮 Posted</span>
                )
              )}
              {postMsg && <div className="text-xs text-zinc-300 w-full">{postMsg}</div>}
              {post.status !== "posted" && (
                <button
                  onClick={() => deleteDraft(post.id)}
                  disabled={busy === "del"}
                  title="Delete this draft permanently"
                  className="px-3 py-1 text-xs rounded-full border border-red-900 text-red-400 hover:bg-red-500/10 cursor-pointer disabled:opacity-50"
                >
                  🗑 {busy === "del" ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col items-center justify-center min-h-[280px]">
            {post.hasImage && post.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.imageUrl} alt={`Visual for ${post.topic}`} className="rounded-lg max-w-full" />
            ) : (
              <div className="text-zinc-500 text-sm flex items-center gap-2">
                {post.status === "draft" ? <RefreshCw className="animate-spin" size={14} /> : <ImageIcon size={14} />}
                {post.status === "draft" ? "Visual generating…" : "No visual for this draft"}
              </div>
            )}
            <div className="mt-3 text-[11px] text-zinc-500 flex items-center gap-1">
              <FlaskConical size={11} /> AI explainer visual — diagrams only, never machines or sites
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
