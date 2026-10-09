"use client";

// ChatbaseCopilot — sales enquiry copilot (thin adapter over CopilotView).
//
// Sales owns ONLY its config (endpoints, suggestions, tool icons) and its
// proposal cards (price tables, spec forms, price quotes, procurement fetch).
// Transport, chaining, thinking, confirm flow, and chrome all live in
// src/copilot/* — shared verbatim with every department copilot.
// Public props are unchanged (EnquiryDetail mounts this directly).
import React, { useState, useEffect } from "react";
import SpecForm, { type SpecQuestion } from "./SpecForm";
import Lightbox from "./Lightbox";
import CopilotView from "../copilot/CopilotView";
import type { CopilotEndpoints, CopilotMsg, CopilotPriceRow, CopilotProposal, CopilotViewConfig } from "../copilot/types";
import type { ProposalApi } from "../copilot/useCopilotTurn";

const SUGGESTIONS = ["What's missing on this enquiry?", "Get AI price for an item", "Draft a note for the enquiry thread", "Help me fix an item spec"];
const TOOL_ICON: Record<string, string> = {
  get_enquiry_summary: "📋",
  propose_comment: "✍️",
  propose_spec_fix: "🛠️",
  find_price: "🔍",
  ask_specs: "📝",
  quote_price: "💰",
  web_search: "🌐",
  fetch_page: "📄",
  calculate: "🧮",
};

export default function ChatbaseCopilot({ enquiryId, open, onClose, onOpen, userInitial = "S" }: {
  enquiryId: string;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  userInitial?: string;
}) {
  // Sales-local UI state: price-row detail toggles, procurement requests,
  // image lightbox. Conversation state lives in the shared hook.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [requested, setRequested] = useState<Set<number>>(new Set());
  const [fetching, setFetching] = useState<Set<number>>(new Set());
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  useEffect(() => { setExpanded(new Set()); setRequested(new Set()); setFetching(new Set()); setLightbox(null); }, [enquiryId]);

  const endpoints: CopilotEndpoints = {
    streamUrl: `/api/enquiries/${enquiryId}/chat/stream`,
    chatUrl: `/api/enquiries/${enquiryId}/chat`,
    executeUrl: `/api/enquiries/${enquiryId}/chat/execute`,
    resetKey: enquiryId,
    // Server-side wipe (history + price session) — fire-and-forget is fine:
    // the route awaits the KV deletes before responding.
    onReset: () => { void fetch(`/api/enquiries/${enquiryId}/chat/clear`, { method: "POST" }).catch(() => {}); },
  };
  const view: CopilotViewConfig = {
    title: "AI Agent",
    subtitle: "Enquiry copilot",
    emptyText: "How can I help with this enquiry?",
    suggestions: SUGGESTIONS,
    toolIcons: TOOL_ICON,
    userInitial,
    resetTitle: "Clear chat",
  };

  // Telecaller fallback: flag the item for procurement. Rendered ONLY on
  // price cards where the lookup found no usable price (needsProcurement).
  const fetchProcurement = async (msgIdx: number, pIdx: number, p: CopilotProposal, api: ProposalApi) => {
    const key = msgIdx * 100 + pIdx;
    if (requested.has(key) || fetching.has(key)) return;
    setFetching((s) => new Set(s).add(key));
    const n = (p.itemIndex ?? 0) + 1;
    try {
      const data = await api.executeAction({ kind: "fetch_procurement", itemIndex: p.itemIndex ?? 0, label: `Fetch from procurement · Item ${n}` });
      if (data.applied && data.applied !== "none") {
        setRequested((s) => new Set(s).add(key));
        api.notify(`✓ Item ${n} sent to procurement — they'll price it and you'll see it here.`);
      } else {
        api.notify(`Could not request procurement: ${data.error || "rejected"}.`);
      }
    } catch {
      api.notify("Procurement request failed — please retry.");
    } finally {
      setFetching((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const renderProposals = (m: CopilotMsg, mi: number, api: ProposalApi) => {
    if (!m.proposals || m.proposals.length === 0) return null;
    return (
      <div className="space-y-2">
        {m.proposals.map((p, pi) => {
          const key = mi * 100 + pi;
          const done = api.confirmed.has(key);
          if (p.kind === "price_table" && Array.isArray(p.rows)) {
            const fetchBtn = p.needsProcurement ? (
              <button
                type="button"
                disabled={requested.has(key) || fetching.has(key)}
                onClick={() => void fetchProcurement(mi, pi, p, api)}
                className="mt-3 px-4 py-2 text-[13px] font-bold rounded-full bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200"
              >
                {fetching.has(key) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border-2 border-black/40 border-t-black animate-spin" />
                    Requesting…
                  </span>
                ) : requested.has(key) ? "✓ Procurement requested" : "Fetch from procurement →"}
              </button>
            ) : null;
            const mediaStrip = (urls?: string[]) => (Array.isArray(urls) && urls.length > 0 ? (
              <div className="flex gap-1.5 px-4 pb-2 pt-1">
                {urls.map((u, ui) => (
                  <img
                    key={ui}
                    src={u}
                    alt=""
                    loading="lazy"
                    onClick={() => setLightbox({ images: urls, index: ui })}
                    className="h-12 w-12 rounded-lg object-cover border border-white/10 cursor-zoom-in hover:opacity-90"
                  />
                ))}
              </div>
            ) : null);
            // Empty result: no usable price — text + (only here) procurement button.
            if (p.rows.length === 0) {
              return (
                <div key={pi} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden px-4 py-3">
                  <p className="font-bold text-[13px] text-[var(--text-primary)]">{p.label}</p>
                  {(p.text) && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{p.text}</p>}
                  {mediaStrip(p.itemMedia)}
                  {fetchBtn}
                </div>
              );
            }
            const batched = p.rows.some((r) => r.itemIndex != null);
            const applyRow = (r: CopilotPriceRow, ri: number) => {
              if (r.itemIndex == null) return;
              void api.confirm(mi, 900 + ri, {
                kind: "price_quote",
                itemIndex: r.itemIndex - 1,
                markedPrice: r.markedPrice,
                unit: r.unit,
                productName: p.productName,
                productId: p.productId,
                confidence: r.confidence ?? undefined,
                quoteAgeDays: r.quoteAgeDays ?? null,
                moq: r.moq ?? null,
                deliveryDays: r.deliveryDays ?? null,
                label: `Apply AI price · Item ${r.itemIndex}`,
              });
            };
            const groups = batched
              ? (() => {
                  const order: number[] = [];
                  const map = new Map<number, { name?: string; rows: { r: CopilotPriceRow; ri: number }[] }>();
                  p.rows.forEach((r, ri) => {
                    const k = Number(r.itemIndex ?? 0);
                    if (!map.has(k)) { map.set(k, { name: r.itemName, rows: [] }); order.push(k); }
                    map.get(k)!.rows.push({ r, ri });
                  });
                  return order.map((k) => ({ itemIndex: k, ...map.get(k)! }));
                })()
              : [{ itemIndex: 0, name: undefined, rows: p.rows.map((r, ri) => ({ r, ri })) }];
            const colSpan = batched ? 5 : 4;
            // Minimized dropdown: the full variation list stays collapsed
            // until opened — summary shows count + best price. Per-item
            // groups in batch tables collapse independently.
            const bestOf = (rows: { r: CopilotPriceRow }[]) =>
              rows.reduce((m, { r }) => Math.min(m, Number(r.markedPrice) || Infinity), Infinity);
            const tableBest = bestOf(p.rows.map((r) => ({ r })));
            return (
              <div key={pi} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                {mediaStrip(p.itemMedia)}
                <details>
                  <summary className="px-4 pt-3 pb-2 font-bold text-[13px] text-[var(--text-primary)] cursor-pointer select-none list-none flex items-center gap-2">
                    <span className="text-[var(--text-tertiary)] text-[11px]">▸</span>
                    {p.label}
                    <span className="font-bold text-[var(--text-tertiary)]">
                      · {p.rows.length} variation{p.rows.length === 1 ? "" : "s"}{Number.isFinite(tableBest) ? ` · from ₹${tableBest.toLocaleString("en-IN")}` : ""}
                    </span>
                  </summary>
                {groups.map((g) => {
                  const gBest = bestOf(g.rows);
                  const gBody = (
                  <div key={g.itemIndex}>
                    {batched && groups.length < 2 && (
                      <p className="px-4 pt-2 text-[12px] font-extrabold text-indigo-300">
                        Item {g.itemIndex}{g.name ? <span className="font-bold text-[var(--text-secondary)]"> — {g.name}</span> : null}
                      </p>
                    )}
                    <table className="w-full text-[12px] leading-snug">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] border-y border-white/[0.06]">
                          <th className="px-4 py-1.5 font-bold">Variation</th>
                          <th className="px-2 py-1.5 font-bold text-right">Price</th>
                          <th className="px-2 py-1.5 font-bold text-right">Match</th>
                          <th className="px-2 py-1.5 font-bold text-right">Age</th>
                          {batched && <th className="px-4 py-1.5 font-bold text-right">Apply</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map(({ r, ri }) => {
                          const doneKey = mi * 100 + 900 + ri;
                          const rowDone = api.confirmed.has(doneKey);
                          const expKey = `${mi}-${pi}-${ri}`;
                          const open = expanded.has(expKey);
                          const hasDetail = (Array.isArray(r.specs) && r.specs.length > 0) || !!r.imageUrl;
                          const confOk = typeof r.confidence === "number" && Number.isFinite(r.confidence);
                          return (
                            <React.Fragment key={ri}>
                              <tr className={`border-b border-white/[0.04] ${open ? "" : "last:border-0"} ${r.best ? "bg-emerald-500/[0.07]" : ""}`}>
                                <td className="px-4 py-2 text-[var(--text-secondary)]">
                                  {r.best && <span className="mr-1.5 inline-block text-[10px] font-extrabold px-1.5 py-px rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 align-middle">BEST</span>}
                                  {r.tag === "Earlier" && <span className="mr-1.5 inline-block text-[10px] font-extrabold px-1.5 py-px rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 align-middle">Earlier</span>}
                                  {r.variation}
                                  {(r.moq || r.deliveryDays != null) && (
                                    <span className="block text-[11px] text-[var(--text-tertiary)]">
                                      {[r.moq ? `MOQ ${r.moq}` : null, r.deliveryDays != null ? `${r.deliveryDays}d delivery` : null].filter(Boolean).join(" · ")}
                                    </span>
                                  )}
                                  {hasDetail && (
                                    <button
                                      type="button"
                                      onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(expKey)) n.delete(expKey); else n.add(expKey); return n; })}
                                      className="block mt-0.5 text-[11px] font-bold text-indigo-300 hover:text-indigo-200 cursor-pointer border-0 bg-transparent p-0"
                                    >
                                      {open ? "▾ Hide details" : "▸ Full specs & photo"}
                                    </button>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-right font-extrabold text-white whitespace-nowrap">
                                  ₹{Number(r.markedPrice).toLocaleString("en-IN")}{r.unit ? <span className="font-bold text-[var(--text-tertiary)]">/{r.unit}</span> : null}
                                </td>
                                <td className="px-2 py-2 text-right font-bold text-[var(--text-secondary)] whitespace-nowrap">{confOk ? `${(Number(r.confidence) * 100).toFixed(0)}%` : "actual"}</td>
                                <td className="px-2 py-2 text-right text-[var(--text-tertiary)] whitespace-nowrap">{r.quoteAgeDays != null ? `${r.quoteAgeDays}d` : "—"}</td>
                                {batched && (
                                  <td className="px-4 py-2 text-right whitespace-nowrap">
                                  <button
                                    type="button"
                                    disabled={rowDone || api.applying.has(doneKey)}
                                    onClick={() => applyRow(r, ri)}
                                    className="px-3 py-1 text-[11px] font-extrabold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200"
                                  >
                                    {api.applying.has(doneKey) ? (
                                      <span className="inline-flex items-center gap-1">
                                        <span className="h-2.5 w-2.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                                        …
                                      </span>
                                    ) : rowDone ? "✓" : "Apply →"}
                                  </button>
                                  </td>
                                )}
                              </tr>
                              {open && hasDetail && (
                                <tr className="border-b border-white/[0.04] last:border-0 bg-white/[0.02]">
                                  <td colSpan={colSpan} className="px-4 py-2">
                                    {r.imageUrl && (
                                      <img
                                        src={r.imageUrl}
                                        alt=""
                                        loading="lazy"
                                        onClick={() => setLightbox({ images: [r.imageUrl as string], index: 0 })}
                                        className="mb-2 h-20 w-20 rounded-lg object-cover border border-white/10 cursor-zoom-in hover:opacity-90"
                                      />
                                    )}
                                    {Array.isArray(r.specs) && r.specs.length > 0 && (
                                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                                        {r.specs.map((s, si) => (
                                          <React.Fragment key={si}>
                                            <dt className="font-bold text-[var(--text-tertiary)]">{s.question}</dt>
                                            <dd className="text-[var(--text-secondary)]">{s.value}</dd>
                                          </React.Fragment>
                                        ))}
                                      </dl>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  );
                  // Batch with several items: each item group is its own
                  // dropdown; a lone group renders open directly.
                  if (!batched || groups.length < 2) return gBody;
                  return (
                    <details key={g.itemIndex}>
                      <summary className="px-4 py-1.5 text-[12px] font-extrabold text-indigo-300 cursor-pointer select-none list-none">
                        ▸ Item {g.itemIndex}{g.name ? <span className="font-bold text-[var(--text-secondary)]"> — {g.name}</span> : null}
                        <span className="font-bold text-[var(--text-tertiary)]"> · {g.rows.length} variation{g.rows.length === 1 ? "" : "s"}{Number.isFinite(gBest) ? ` · from ₹${gBest.toLocaleString("en-IN")}` : ""}</span>
                      </summary>
                      {gBody}
                    </details>
                  );
                })}
                </details>
                {p.needsProcurement && <div className="px-4 pb-3">{fetchBtn}</div>}
              </div>
            );
          }
          if (p.kind === "spec_form" && Array.isArray(p.questions) && p.questions.length > 0) {
            const qs: SpecQuestion[] = p.questions.map((q) => ({
              key: q.key,
              label: q.label,
              type: q.type === "options" || q.type === "multiselect" || q.type === "number" || q.type === "date" ? q.type : "text",
              options: Array.isArray(q.options) ? q.options : [],
              hint: q.note,
              required: q.required !== false,
              section: "spec",
            }));
            return (
              <div key={pi}>
                <SpecForm
                  title={p.productName ?? p.label}
                  questions={qs}
                  onSubmit={(text) => api.send(text)}
                />
                <button
                  type="button"
                  onClick={() => api.send(`Quote with what we have for ${p.productName ?? "this item"} — skip remaining details`)}
                  className="mt-2 px-4 py-2 text-[12px] font-bold rounded-full bg-white/[0.06] text-[var(--text-secondary)] hover:bg-white/[0.1] hover:text-[var(--text-primary)] cursor-pointer border border-white/10 transition-colors duration-200"
                >
                  Quote with what we have →
                </button>
              </div>
            );
          }
          return (
            <div key={pi} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-bold text-[13px] text-[var(--text-primary)]">{p.label}</p>
              {p.kind === "price_quote" && typeof p.markedPrice === "number" && (
                <p className="mt-1 text-[22px] font-extrabold text-white tracking-tight">
                  ₹{p.markedPrice.toLocaleString("en-IN")}{p.unit ? <span className="text-[13px] font-bold text-[var(--text-secondary)]">/{p.unit}</span> : null}
                  {typeof p.confidence === "number" && Number.isFinite(p.confidence) && (
                    <span className={`ml-2 align-middle text-[11px] font-bold px-2 py-0.5 rounded-full border ${p.confidence < 0.6 ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"}`}>
                      {(p.confidence * 100).toFixed(0)}% match{p.confidence < 0.6 ? " · closest" : ""}
                    </span>
                  )}
                </p>
              )}
              {(p.text || p.spec) && <p className="mt-1.5 text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{p.text || p.spec}</p>}
              <button type="button" disabled={done || api.applying.has(key)} onClick={() => api.confirm(mi, pi, p)} className="mt-3 px-4 py-2 text-[13px] font-bold rounded-full bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50 cursor-pointer border-0 transition-colors duration-200">
                {api.applying.has(key) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Applying…
                  </span>
                ) : done ? "✓ Applied" : "Confirm & apply →"}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <CopilotView
      endpoints={endpoints}
      view={view}
      open={open}
      onClose={onClose}
      onOpen={onOpen}
      renderProposals={renderProposals}
      extra={lightbox ? (
        <Lightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          image={null}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    />
  );
}
