"use client";

// SpecsEditor.tsx — the spec-ask of ONE product, editable in place.
//
// Founders' rule (2026-11-23): everything about a spec is editable from the
// dashboard — label, type, enum values, bounds, default, required, order,
// add/remove — because the KYP JSON is exported from exactly this data.
// `attrKey` stays read-only: stored quotes and the spec index key off it
// (rename = add + delete).
//
// Ordering is optimistic drag-and-drop (2026-11-23 v2): the row moves the
// instant it is dropped and the server write follows; a failure snaps back.
// Enum values are visible on the collapsed row, so you never click to find out
// whether a spec is a choice or free text.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, GripVertical, Plus, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui";
import { field, ghostBtn, iconBtn, label, primaryBtn } from "../product-line-dashboard/helpers";
import { SpecRowEditor, TYPES } from "./SpecRowEditor";
import { productLineApi, type GuideWrite } from "@/product-line/api";
import type { GuideRow, KypProduct, SpecType } from "@/product-line/types";

const SPEC_TYPES: SpecType[] = TYPES;
const errMsg = (e: unknown) => String((e as any)?.message ?? "save failed");

function enumText(enumJson?: string | null): string {
  if (!enumJson) return "";
  try {
    const v = JSON.parse(enumJson);
    return Array.isArray(v) ? v.join(", ") : String(v);
  } catch {
    return String(enumJson);
  }
}

function enumList(enumJson?: string | null): string[] {
  const t = enumText(enumJson);
  return t ? t.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** A stored default is JSON text (`"pu"`, `1`, `true`). */
function defaultText(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "";
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.join(", ") : String(v);
  } catch {
    return String(raw);
  }
}

interface Props {
  product: KypProduct;
  guide: GuideRow[];
  onChanged: () => void;
  onError: (msg: string | null) => void;
}

export function SpecsEditor({ product, guide, onChanged, onError }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<SpecType>("string");
  const [expanded, setExpanded] = useState<string | null>(null);
  /** Optimistic order (ids). Cleared whenever the server list disagrees. */
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [confirmSpec, setConfirmSpec] = useState<GuideRow | null>(null);
  const dragFrom = useRef<string | null>(null);

  const serverRows = useMemo(
    () => [...guide].sort((a, b) => a.sortOrder - b.sortOrder).map((g) => g.id),
    [guide],
  );
  const visibleRows = useMemo(() => {
    const byId = new Map(guide.map((g) => [g.id, g]));
    const ids = order && order.length === serverRows.length && order.every((id) => byId.has(id))
      ? order
      : serverRows;
    return ids.map((id) => byId.get(id)).filter(Boolean) as GuideRow[];
  }, [guide, order, serverRows]);

  // Once the refreshed list matches what we already show, forget the override.
  useEffect(() => {
    if (order && order.join() === serverRows.join()) setOrder(null);
  }, [order, serverRows]);

  const save = async (id: string, body: GuideWrite) => {
    setBusy(id);
    onError(null);
    try {
      await productLineApi.updateGuide(id, body);
      onChanged();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, attrKey: string) => {
    setBusy(id);
    onError(null);
    try {
      await productLineApi.deleteGuide(id);
      onChanged();
    } catch (e) {
      // Server refuses while quotes still answer this spec — show its count.
      onError(`${attrKey}: ${errMsg(e)}`);
    } finally {
      setBusy(null);
    }
  };

  /** Drop = reorder now, persist after. */
  const drop = async (targetId: string) => {
    const fromId = dragFrom.current ?? dragId;
    setDragId(null);
    setOverId(null);
    dragFrom.current = null;
    if (!fromId || fromId === targetId) return;
    const current = visibleRows.map((r) => r.id);
    const from = current.indexOf(fromId);
    const to = current.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...current];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next); // optimistic
    setBusy("reorder");
    onError(null);
    try {
      await productLineApi.reorderGuide(product.id, next);
      onChanged();
    } catch (e) {
      setOrder(null); // snap back
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const question = newLabel.trim();
    if (!question) return;
    setBusy("add");
    onError(null);
    try {
      await productLineApi.createGuide({ productId: product.id, question, type: newType });
      setNewLabel("");
      setNewType("string");
      setAdding(false);
      onChanged();
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={label}>Spec ask ({visibleRows.length})</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">drag the handle to reorder</span>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
          {product.required.length} required
        </span>
      </div>

      {visibleRows.map((g) => {
        const index = visibleRows.findIndex((r) => r.id === g.id);
        const spec = product.props[g.attrKey];
        const open = expanded === g.id;
        const typed = (String(g.type ?? spec?.type ?? "string") as SpecType) || "string";
        const choices = enumList(g.enumJson);
        const fallbackChoices = (spec?.enum ?? []).filter((v) => !choices.includes(v));
        const allChoices = [...choices, ...fallbackChoices];
        const dflt = defaultText(g.defaultValue ?? (spec?.default != null ? JSON.stringify(spec.default) : null));
        const dragging = dragId === g.id;
        const isOver = overId === g.id && dragId !== g.id;
        return (
          <div
            key={g.id}
            draggable={busy !== "reorder"}
            onDragStart={() => {
              dragFrom.current = g.id;
              setDragId(g.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (overId !== g.id) setOverId(g.id);
            }}
            onDragLeave={() => setOverId((prev) => (prev === g.id ? null : prev))}
            onDrop={(e) => {
              e.preventDefault();
              void drop(g.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverId(null);
              dragFrom.current = null;
            }}
            className={`border rounded-xl bg-[var(--bg-card)] transition-all ${
              isOver
                ? "border-brand-indigo border-dashed ring-1 ring-brand-indigo/40"
                : "border-[var(--border-card)]"
            } ${dragging ? "opacity-50" : ""}`}
          >
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <span
                className="cursor-grab active:cursor-grabbing text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] px-0.5"
                title="Drag to reorder"
              >
                <GripVertical size={14} />
              </span>
              <span className="w-5 text-[10px] tabular-nums text-[var(--text-tertiary)]">{index + 1}</span>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : g.id)}
                className="flex-1 min-w-0 text-left"
                title="Edit label, type, choices, default and bounds"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] font-bold text-[var(--text-primary)] truncate">{g.question}</span>
                  {g.isRequired ? (
                    <span className="shrink-0 px-1 py-px rounded text-[9px] font-bold bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] text-[var(--color-danger)]">
                      required
                    </span>
                  ) : null}
                  <span className="shrink-0 px-1 py-px rounded text-[9px] font-bold bg-[var(--bg-input)] text-[var(--text-tertiary)] uppercase">
                    {typed}
                  </span>
                  {dflt ? (
                    <span className="shrink-0 px-1 py-px rounded text-[9px] font-bold bg-emerald-500/12 text-emerald-600">
                      default {dflt}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 mt-0.5 min-w-0 overflow-hidden">
                  <span className="text-[10px] font-mono text-[var(--text-tertiary)] shrink-0">{g.attrKey}</span>
                  {allChoices.length ? (
                    <>
                      <span className="text-[10px] text-[var(--text-tertiary)]">·</span>
                      {allChoices.slice(0, 6).map((c) => (
                        <span
                          key={c}
                          className={`px-1 py-px rounded text-[9px] font-semibold whitespace-nowrap ${
                            c === dflt ? "bg-emerald-500/15 text-emerald-700" : "bg-[var(--bg-input)] text-[var(--text-secondary)]"
                          }`}
                        >
                          {c}
                        </span>
                      ))}
                      {allChoices.length > 6 ? (
                        <span className="text-[9px] text-[var(--text-tertiary)]">+{allChoices.length - 6}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--text-tertiary)] truncate">
                      free text{g.minNum != null || g.maxNum != null ? ` · ${g.minNum ?? "…"}–${g.maxNum ?? "…"}` : ""}
                    </span>
                  )}
                </div>
              </button>
              <button
                type="button"
                className={iconBtn}
                title="Toggle required"
                disabled={busy === g.id}
                onClick={() => void save(g.id, { isRequired: !g.isRequired })}
              >
                <Check size={14} className={g.isRequired ? "text-emerald-500" : "text-[var(--text-tertiary)]"} />
              </button>
              <button type="button" className={iconBtn} title="Remove spec" disabled={busy === g.id} onClick={() => setConfirmSpec(g)}>
                <Trash2 size={14} />
              </button>
            </div>

            {open ? (
              <SpecRowEditor
                guide={g}
                typed={typed}
                choices={choices}
                allChoices={allChoices}
                dflt={dflt}
                save={(body) => void save(g.id, body)}
              />
            ) : null}
          </div>
        );
      })}

      {adding ? (
        <div className="border border-dashed border-[var(--border-card)] rounded-xl p-3 space-y-2">
          <input
            autoFocus
            className={field}
            placeholder="New question, e.g. Bore diameter (mm)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
          />
          <div className="flex items-center gap-2">
            <select className={`${field} w-32`} value={newType} onChange={(e) => setNewType(e.target.value as SpecType)}>
              {SPEC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button type="button" className={primaryBtn} disabled={busy === "add" || !newLabel.trim()} onClick={() => void add()}>
              <Plus size={13} /> Add spec
            </button>
            <button type="button" className={ghostBtn} onClick={() => { setAdding(false); setNewLabel(""); }}>
              <X size={13} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" className={ghostBtn} onClick={() => setAdding(true)}><Plus size={13} /> Add spec</button>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Deleting a spec is blocked while vendor quotes still answer it.
          </span>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmSpec}
        title="Remove this spec?"
        message={
          <>
            <b>{confirmSpec?.question}</b> (<span className="font-mono">{confirmSpec?.attrKey}</span>) leaves the spec ask
            {confirmSpec?.isRequired ? " and stops being required" : ""}. Quotes that already answer it block the delete —
            if any do, the server will tell you how many.
          </>
        }
        confirmLabel="Remove spec"
        busy={!!busy}
        onConfirm={() => {
          const g = confirmSpec;
          setConfirmSpec(null);
          if (g) void remove(g.id, g.attrKey);
        }}
        onCancel={() => setConfirmSpec(null)}
      />
    </div>
  );
}
