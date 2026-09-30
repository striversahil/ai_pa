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
}

async function fetchBatch(): Promise<{ date: string; ready: boolean; posts: LinkedinPost[] }> {
  // /api/linkedin/today (not the automations data endpoint): image URLs here
  // carry a signed ?sig so <img> subrequests authenticate without cookies.
  const r = await fetch("/api/linkedin/today", { credentials: "same-origin" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// The model sometimes returns the Hook/Post/Hashtags shape as a JSON object
// instead of markdown (30/09 batch). Compose either shape into a finished
// post — mirrors scripts/linkedin-format.js in the runner.
function displayFinal(text: string): string {
  const t = String(text ?? "").trim();
  if (!t.startsWith("{")) return t;
  try {
    const o = JSON.parse(t);
    const post = String(o.Post ?? o.post ?? "");
    if (!post) return t;
    const hookA = String(o["Hook A"] ?? o.hookA ?? "").trim();
    const rawTags = Array.isArray(o.Hashtags ?? o.hashtags)
      ? (o.Hashtags ?? o.hashtags).join(" ")
      : String(o.Hashtags ?? o.hashtags ?? "");
    let out = hookA ? `${hookA}\n\n${post}` : post;
    if (rawTags.trim()) out += `\n\n${rawTags.trim()}`;
    return out;
  } catch {
    return t;
  }
}

function copyText(t: string) {
  navigator.clipboard?.writeText(t).catch(() => {});
}

export default function LinkedinDashboard() {
  const batch = useLiveDashboard(fetchBatch);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"final" | "research" | "visual">("final");

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

  if (batch.loading) return <div className="p-6 text-zinc-400">Loading today's drafts…</div>;
  if (batch.error) return <div className="p-6 text-red-400">LinkedIn batch unavailable ({String((batch.error as Error)?.message ?? batch.error)}).</div>;
  if (!batch.data?.ready) {
    return (
      <div className="p-6 text-zinc-400">
        <CalendarDays className="inline mr-2" size={16} />
        No batch yet today — the 06:00 IST runner generates 5 drafts. Check back after the morning run.
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-zinc-400">Batch {batch.data.date} — pick one to post:</span>
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
                  onClick={() => act("/api/linkedin/posted", { id: post.id }, "posted")}
                  disabled={busy === "posted"}
                  className="px-3 py-1 text-xs rounded-full border border-indigo-500 text-indigo-200 hover:bg-indigo-500/10 cursor-pointer disabled:opacity-50"
                >
                  📮 {busy === "posted" ? "Marking…" : "Mark posted"}
                </button>
              ) : (
                <span className="px-3 py-1 text-xs rounded-full border border-zinc-700 text-zinc-500">📮 Posted</span>
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
