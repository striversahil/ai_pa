"use client";

// LoopCards — the ONE loop UI for every surface (sales / procurement /
// management). Deterministic records replace the old free-form thread:
// each card is one ask with an explicit holder (who must act) and status.
// Actions are scoped by surface: only the holder can answer, only the opener
// can withdraw, only management forwards or rejects.
import React, { useState } from "react";
import type { EnquiryItem, EnquiryMedia, LoopKind, LoopParty, LoopRecord, LoopStatus } from "@/types";
import { openLoops, allLoops } from "@/enquiry/loops";
import { filesToUploadedMedia } from "@/lib/imageFiles";

type Mode = "management" | "procurement" | "sales";

const KIND_LABEL: Record<LoopKind, string> = {
  spec: "Spec ask",
  query: "Sales query",
  rates: "Rate ask",
  not_available: "Not available",
  note: "Note",
};

const KIND_TONE: Record<LoopKind, string> = {
  spec: "border-red-500/30 bg-red-500/5",
  query: "border-sky-500/30 bg-sky-500/5",
  rates: "border-indigo-500/30 bg-indigo-500/5",
  not_available: "border-amber-500/30 bg-amber-500/5",
  note: "border-[var(--border-card)] bg-[var(--bg-input)]/40",
};

const STATUS_LABEL: Record<LoopStatus, string> = {
  open: "Open",
  answered: "Answered ✓",
  withdrawn: "Withdrawn",
  rejected: "Rejected",
};

function holderChip(l: LoopRecord, mode: Mode): string {
  if (l.status !== "open") return STATUS_LABEL[l.status];
  if (l.holder === mode) return "With you — answer below";
  return `With ${l.holder}`;
}

function fmtWhen(at?: string): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function MediaThumbs({ media, onOpenLightbox }: { media?: EnquiryMedia[]; onOpenLightbox?: (url: string, list?: string[], idx?: number) => void }) {
  if (!media || media.length === 0) return null;
  const imgs = media.filter((m) => m.type !== "pdf" && m.type !== "video");
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {media.map((m, i) =>
        m.type === "pdf" ? (
          <a key={i} href={m.url} target="_blank" rel="noreferrer" className="px-2 py-1 rounded border border-[var(--border-card)] bg-red-500/10 text-[10px] font-bold">PDF</a>
        ) : m.type === "video" ? (
          <video key={i} src={m.url} controls preload="metadata" className="w-20 h-12 rounded-lg object-cover border border-[var(--border-card)] bg-black" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={m.url} alt="attachment" className="w-14 h-14 rounded-lg object-cover border border-[var(--border-card)] cursor-zoom-in"
            onClick={() => onOpenLightbox?.(m.url, imgs.map((x) => x.url), Math.max(0, imgs.findIndex((x) => x.url === m.url)))} />
        ),
      )}
    </div>
  );
}

export interface LoopCardsProps {
  item: EnquiryItem;
  mode: Mode;
  readOnly?: boolean;
  onOpen: (kind: LoopKind, text: string, media?: EnquiryMedia[]) => void;
  onAnswer: (id: string, text: string, media?: EnquiryMedia[]) => void;
  onForward?: (id: string, to: "management" | "procurement") => void;
  onWithdraw?: (id: string) => void;
  onReject?: (id: string, text?: string) => void;
  onOpenLightbox?: (url: string, list?: string[], idx?: number) => void;
  /** Which kinds this surface may open (ask composer). */
  askKinds?: LoopKind[];
  askLabels?: Partial<Record<LoopKind, string>>;
}

export default function LoopCards({
  item, mode, readOnly = false, onOpen, onAnswer, onForward, onWithdraw, onReject, onOpenLightbox, askKinds = [], askLabels = {},
}: LoopCardsProps) {
  const [answerOpenId, setAnswerOpenId] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [answerMedia, setAnswerMedia] = useState<EnquiryMedia[]>([]);
  const [askKind, setAskKind] = useState<LoopKind | null>(null);
  const [askText, setAskText] = useState("");
  const [askMedia, setAskMedia] = useState<EnquiryMedia[]>([]);
  const [busy, setBusy] = useState(false);

  const records = allLoops(item);
  // Bypassed items run no quoting loop (rate available / not available /
  // internal handling) — new asks on them are pure noise no desk can clear
  // by quoting. Existing records keep their answer/withdraw actions; only
  // the new-ask composer hides. (The old notes-only exception died with the
  // Note composer — notes are audit-only now, never user-composed.)
  const bypassed = !!item.rateAvailable || !!(item as any).notAvailable || !!item.internalRates;
  const askable = bypassed ? [] : askKinds;
  const asksHidden = askKinds.length > askable.length;
  // A composer left open on a now-hidden kind never renders.
  const askShown = askKind && (askable as (LoopKind | null)[]).includes(askKind) ? askKind : null;
  if (records.length === 0 && askable.length === 0) return null;

  const resetAnswer = () => { setAnswerOpenId(null); setAnswerText(""); setAnswerMedia([]); };
  const resetAsk = () => { setAskKind(null); setAskText(""); setAskMedia([]); };

  const sendAnswer = async (id: string) => {
    if (!answerText.trim() && answerMedia.length === 0) return;
    setBusy(true);
    try {
      await onAnswer(id, answerText.trim(), answerMedia.length ? answerMedia : undefined);
      resetAnswer();
    } finally {
      setBusy(false);
    }
  };

  const sendAsk = async (kind: LoopKind) => {
    if (!askText.trim()) return;
    setBusy(true);
    try {
      await onOpen(kind, askText.trim(), askMedia.length ? askMedia : undefined);
      resetAsk();
    } finally {
      setBusy(false);
    }
  };

  const attach = async (files: FileList | null, set: (m: EnquiryMedia[]) => void, cur: EnquiryMedia[]) => {
    if (!files || files.length === 0) return;
    const { media } = await filesToUploadedMedia(files);
    if (media.length) set([...cur, ...media]);
  };

  return (
    <div className="space-y-2">
      {records.map((l) => {
        const open = l.status === "open";
        const mine = open && l.holder === mode;
        const canWithdraw = open && l.openedBy === mode && !!onWithdraw && !readOnly;
        return (
          <div key={l.id} className={`rounded-lg border p-2.5 text-[11px] leading-relaxed ${KIND_TONE[l.kind]} ${l.internal ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">{KIND_LABEL[l.kind]}</span>
              <span className={`px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide rounded-full border whitespace-nowrap ${open ? (mine ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30") : "bg-[var(--bg-input)] text-[var(--text-tertiary)] border-[var(--border-card)]"}`}>
                {holderChip(l, mode)}
              </span>
              {l.forwarded && (
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {l.forwarded.from} → {l.forwarded.to}
                </span>
              )}
              <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{fmtWhen(open ? l.openedAt : l.closedAt)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[var(--text-primary)]">{l.text}</p>
            <MediaThumbs media={l.media} onOpenLightbox={onOpenLightbox} />
            {l.answer && (
              <div className="mt-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] p-2">
                <p className="text-[10px] font-extrabold text-[var(--text-tertiary)]">
                  {l.status === "rejected" ? `Rejected by ${l.answer.by}` : `Answered by ${l.answer.by}`} · {fmtWhen(l.answer.at)}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[var(--text-secondary)]">{l.answer.text}</p>
                <MediaThumbs media={l.answer.media} onOpenLightbox={onOpenLightbox} />
              </div>
            )}
            {!readOnly && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {mine && (
                  answerOpenId === l.id ? (
                    <div className="w-full space-y-1.5">
                      <textarea
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value)}
                        placeholder={`Answer as ${mode} — visible to everyone on this loop`}
                        rows={2}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="px-2 py-1 border border-dashed border-[var(--border-card)] rounded-lg text-[10px] font-bold text-[var(--text-secondary)] cursor-pointer">
                          + Photo
                          <input type="file" accept="image/*,video/*,.pdf" multiple className="hidden"
                            onChange={(e) => { void attach(e.target.files, setAnswerMedia, answerMedia); e.target.value = ""; }} />
                        </label>
                        {answerMedia.length > 0 && <span className="text-[10px] text-[var(--text-tertiary)]">{answerMedia.length} attached</span>}
                        <button type="button" onClick={() => void sendAnswer(l.id)} disabled={busy || (!answerText.trim() && answerMedia.length === 0)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-50">
                          {busy ? "…" : "Send answer"}
                        </button>
                        <button type="button" onClick={resetAnswer}
                          className="px-2 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setAnswerOpenId(l.id); setAnswerText(""); setAnswerMedia([]); }}
                      className="px-2.5 py-1.5 bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] rounded-lg cursor-pointer border border-emerald-500/30">
                      Answer
                    </button>
                  )
                )}
                {open && mode === "management" && l.kind === "query" && !!onForward && (
                  l.holder === "management" ? (
                    <button type="button" onClick={() => onForward(l.id, "procurement")}
                      className="px-2.5 py-1.5 bg-transparent border border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)] font-bold text-[11px] rounded-lg cursor-pointer">
                      Send to procurement
                    </button>
                  ) : (
                    <button type="button" onClick={() => onForward(l.id, "management")}
                      className="px-2.5 py-1 bg-transparent border-0 text-[11px] font-bold text-sky-400 hover:text-sky-300 cursor-pointer">
                      ← Pull back
                    </button>
                  )
                )}
                {open && mode === "management" && l.kind === "not_available" && !!onReject && (
                  <button type="button" onClick={() => onReject(l.id)}
                    className="px-2.5 py-1.5 bg-transparent border border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-input)] font-bold text-[11px] rounded-lg cursor-pointer">
                    Reject — keep in procurement
                  </button>
                )}
                {canWithdraw && (
                  <button type="button" onClick={() => onWithdraw(l.id)}
                    className="px-2 py-1 bg-transparent border-0 text-[10px] font-bold text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer">
                    Withdraw
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && asksHidden && (
        <p className="text-[10px] text-[var(--text-tertiary)]">
          {item.rateAvailable ? "Rate available — no further asks needed." : "Not in the quoting loop — no further asks needed."}
        </p>
      )}
      {!readOnly && askable.length > 0 && (
        askShown ? (
          <div className="rounded-lg border border-dashed border-[var(--border-card)] p-2.5 space-y-1.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">
              {askLabels[askShown!] ?? `New ${KIND_LABEL[askShown!].toLowerCase()}`}
            </p>
            <textarea
              value={askText}
              onChange={(e) => setAskText(e.target.value)}
              placeholder={askShown === "query" ? "Ask for alternate make or reference…" : askShown === "spec" ? "What is wrong with the spec…" : "Details…"}
              rows={2}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] bg-[var(--bg-card)] text-xs text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="px-2 py-1 border border-dashed border-[var(--border-card)] rounded-lg text-[10px] font-bold text-[var(--text-secondary)] cursor-pointer">
                + Photo
                <input type="file" accept="image/*,video/*,.pdf" multiple className="hidden"
                  onChange={(e) => { void attach(e.target.files, setAskMedia, askMedia); e.target.value = ""; }} />
              </label>
              {askMedia.length > 0 && <span className="text-[10px] text-[var(--text-tertiary)]">{askMedia.length} attached</span>}
              <button type="button" onClick={() => void sendAsk(askShown!)} disabled={busy || !askText.trim()}
                className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] rounded-lg cursor-pointer border-0 disabled:opacity-50">
                {busy ? "…" : "Send"}
              </button>
              <button type="button" onClick={resetAsk}
                className="px-2 py-1 font-bold text-[11px] rounded-lg cursor-pointer border-0 bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {askable.map((k) => (
              <button key={k} type="button" onClick={() => { setAskKind(k); setAskText(""); setAskMedia([]); }}
                className="px-2.5 py-1.5 bg-transparent border border-dashed border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold text-[11px] rounded-lg cursor-pointer">
                + {askLabels[k] ?? KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

