"use client";

import React, { useMemo, useState } from "react";
import {
  Search, Plus, ArrowLeft, Pencil, Trash2, X, Check, Package, ClipboardList,
  Users, Wallet, Building2, Phone, MapPin, ChevronRight, Factory, Tag,
  IndianRupee, RefreshCw, CircleDot, Info, Layers,
} from "lucide-react";
import { useLiveDashboard } from "@/hooks/useLiveData";
import { useAuth } from "@/auth/AuthContext";

// Mirror: founder-os_backend/src/automations/product-line/types.ts
interface ProductRow { id: string; category: string; name: string; aliases: string[]; active: boolean; guideCount: number; rateCount: number; }
interface GuideRow { id: string; productId: string; attrKey: string; question: string; guideNote: string | null; sortOrder: number; isRequired: boolean; condition: Record<string, unknown> | null; active: boolean; }
interface VendorRow { id: string; name: string; contactPerson: string | null; contactPhone1: string | null; contactPhone2: string | null; location: string | null; address: string | null; yearEstablished: number | null; vendorType: string; active: boolean; rateCount: number; }
interface RateRow {
  id: string; vendorId: string; vendorName: string | null; vendorType: string | null;
  productId: string | null; productName: string | null; attrKey: string; attrValues: Record<string, string>;
  pricePerUnit: number | null; unit: string; discountPercent: number | null; baseRate: number | null;
  weightPerUnit: number | null; packageQty: string | null; packageDims: string | null;
  moq: string | null; deliveryDays: number | null; quotedAt: string; enquiryRef: string | null; active: boolean;
  imageUrl: string | null; videoUrl: string | null;
}
interface Payload { products: ProductRow[]; guide: Record<string, GuideRow[]>; vendors: VendorRow[]; rates: RateRow[]; }
interface Detail { product: ProductRow & { createdAt: string }; guide: GuideRow[]; rates: RateRow[]; }

/* ── Design tokens (single place, theme-aware via app CSS vars) ── */
const panel = "bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl";
const field = "w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border-card)] rounded-xl outline-none focus:border-brand-indigo text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors";
const label = "block text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]";
const primaryBtn = "inline-flex items-center gap-1.5 px-3.5 py-2 bg-brand-indigo text-white font-bold text-xs rounded-xl hover:opacity-90 disabled:opacity-40 cursor-pointer border-0 transition-opacity";
const ghostBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-card)] hover:bg-[var(--bg-input)] font-bold text-xs rounded-xl cursor-pointer bg-transparent text-[var(--text-primary)] transition-colors";
const dangerBtn = "inline-flex items-center gap-1.5 px-3 py-1.5 font-bold text-xs rounded-xl cursor-pointer border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-white bg-transparent transition-colors";
const iconBtn = "inline-flex items-center justify-center h-7 w-7 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-input)] cursor-pointer bg-transparent border-0 transition-colors";

async function api(path: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = String((await res.json())?.error ?? msg); } catch { /* keep */ }
    throw new Error(msg);
  }
}

const fmtINR = (n: number | null | undefined): string =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

/* ── Client-side form validation (backend re-validates; the UI must never
 *  send what it can already tell is wrong, and never surface raw DB errors) ── */
const isHttpUrl = (s: string): boolean => /^https?:\/\/.+/i.test(s.trim());
/** Photo values the backend accepts: uploaded KV path or https URL. */
const isPhotoValue = (s: string): boolean => {
  const t = s.trim();
  return t !== "" && (isHttpUrl(t) || t.startsWith("/api/chat/files/"));
};
const isNum = (s: string): boolean => s.trim() !== "" && Number.isFinite(Number(s));

const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/* Stable muted hue per category (dot accents, not gradients). */
const HUES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#f97316"];
function hueFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

function attrLabel(key: string, guide: GuideRow[]): string {
  const hit = guide.find((g) => g.attrKey === key);
  if (hit) return hit.question.length > 64 ? hit.question.slice(0, 64) + "…" : hit.question;
  return key.replace(/_/g, " ");
}

function specSummary(r: RateRow): string {
  const vals = Object.values(r.attrValues ?? {});
  if (!vals.length) return r.unit || "standard spec";
  return vals.slice(0, 2).join(" · ");
}

export default function ProductLineDashboard() {
  const { me } = useAuth();
  const canEdit = !!me && (!!me.isAdmin || (me.scopes ?? []).includes("mis"));
  // Quote entry: whoever holds the `product-line` scope (Admin panel grant),
  // plus MIS/admin. Products/guide/vendors stay MIS-only.
  const canQuote = !!me && (!!me.isAdmin || (me.scopes ?? []).includes("mis") || (me.scopes ?? []).includes("product-line"));
  const dash = useLiveDashboard<Payload>(async () => {
    const res = await fetch("/api/automations/product-line/data");
    if (!res.ok) throw new Error("failed to load product line");
    return res.json();
  });

  const [tab, setTab] = useState<"products" | "vendors" | "rates">("products");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selRateId, setSelRateId] = useState<string | null>(null);
  const [compareAll, setCompareAll] = useState(false);

  const [pModal, setPModal] = useState<null | { id?: string; category: string; name: string; aliases: string; active: boolean }>(null);
  const [delProduct, setDelProduct] = useState<ProductRow | null>(null);
  const [gEdit, setGEdit] = useState<null | { id?: string; productId: string; question: string; guideNote: string; isRequired: boolean; sortOrder: string }>(null);
  const [delGuide, setDelGuide] = useState<GuideRow | null>(null);
  const [vModal, setVModal] = useState<null | { id?: string; name: string; contactPerson: string; contactPhone1: string; contactPhone2: string; location: string; address: string; yearEstablished: string; vendorType: string; active: boolean }>(null);
  const [delVendor, setDelVendor] = useState<VendorRow | null>(null);
  const [photoList, setPhotoList] = useState<{ key: string; url: string; name: string }[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = React.useRef<HTMLInputElement | null>(null);

  const loadPhotos = async () => {
    try {
      const res = await fetch("/api/product-line/photos");
      if (!res.ok) return;
      const j = await res.json();
      setPhotoList(Array.isArray(j.photos) ? j.photos : []);
    } catch { /* best-effort */ }
  };

  React.useEffect(() => {
    if (pModal) void loadPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pModal !== null]);

  const uploadPhoto = async (f: File) => {    setPhotoBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/product-line/photos", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { msg = String((await res.json())?.error ?? msg); } catch { /* keep */ }
        throw new Error(msg);
      }
      const j = await res.json();
      await loadPhotos();
      if (j?.url && rModal) setRModal({ ...rModal, imageUrl: String(j.url) });
    } catch (e: any) {
      setErr(String(e?.message ?? "photo upload failed"));
    } finally {
      setPhotoBusy(false);
    }
  };
  const [rModal, setRModal] = useState<null | {
    id?: string; vendorId: string; productId: string; price: string; unit: string; discount: string;
    weight: string; packQty: string; packDims: string; moq: string; delivery: string;
    quotedAt: string; active: boolean; imageUrl: string; videoUrl: string; attrs: { key: string; value: string }[];
  }>(null);

  const data = dash.data;
  const categories = useMemo(() => [...new Set((data?.products ?? []).map((p) => p.category))].sort(), [data]);
  const products = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.products ?? []).filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!needle) return true;
      return p.name.toLowerCase().includes(needle) || p.aliases.some((a) => a.toLowerCase().includes(needle));
    });
  }, [data, q, cat]);
  const totalQuestions = useMemo(() => Object.values(data?.guide ?? {}).reduce((n, l) => n + l.length, 0), [data]);
  const bestByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.rates ?? []) {
      if (!r.active || r.pricePerUnit == null || !r.productId) continue;
      const cur = m.get(r.productId);
      if (cur === undefined || Number(r.pricePerUnit) < cur) m.set(r.productId, Number(r.pricePerUnit));
    }
    return m;
  }, [data]);

  const mutate = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); await dash.refresh(); if (detailId) await loadDetail(detailId, true); }
    catch (e: any) { setErr(String(e?.message ?? "save failed")); }
    finally { setBusy(false); }
  };

  const loadDetail = async (id: string, silent = false) => {
    if (!silent) { setDetailId(id); setDetail(null); setSelRateId(null); setCompareAll(false); void loadPhotos(); }
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/product-line/products/${id}`);
      if (!res.ok) throw new Error("failed to load product");
      const d: Detail = await res.json();
      setDetail(d);
      const first = d.rates.find((r) => r.active) ?? d.rates[0] ?? null;
      setSelRateId(first?.id ?? null);
    } catch (e: any) {
      if (!silent) setErr(String(e?.message ?? "failed to load product"));
    } finally {
      setDetailLoading(false);
    }
  };

  const openRateModal = (productId: string, rate?: RateRow) => {
    const qs = (data?.guide[productId] ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const existing = rate?.attrValues ?? {};
    const keys = [...new Set([...qs.map((g) => g.attrKey), ...Object.keys(existing)])];
    setRModal({
      id: rate?.id,
      vendorId: rate?.vendorId ?? "",
      productId,
      price: rate?.pricePerUnit != null ? String(rate.pricePerUnit) : "",
      unit: rate?.unit ?? "",
      discount: rate?.discountPercent != null ? String(rate.discountPercent) : "",
      weight: rate?.weightPerUnit != null ? String(rate.weightPerUnit) : "",
      packQty: rate?.packageQty ?? "",
      packDims: rate?.packageDims ?? "",
      moq: rate?.moq ?? "",
      delivery: rate?.deliveryDays != null ? String(rate.deliveryDays) : "",
      quotedAt: rate?.quotedAt ? rate.quotedAt.slice(0, 10) : "",
      active: rate?.active ?? true,
      imageUrl: rate?.imageUrl ?? "",
      videoUrl: rate?.videoUrl ?? "",
      attrs: keys.map((k) => ({ key: k, value: existing[k] ?? "" })),
    });
  };

  const saveRateModal = () => {
    const m = rModal;
    if (!m || !m.vendorId || !m.productId) return;
    const attrValues: Record<string, string> = {};
    for (const a of m.attrs) {
      const k = a.key.trim();
      if (k && a.value.trim()) attrValues[k] = a.value.trim();
    }
    const body = {
      vendorId: m.vendorId, productId: m.productId,
      pricePerUnit: m.price === "" ? null : Number(m.price),
      unit: m.unit, discountPercent: m.discount === "" ? null : Number(m.discount),
      weightPerUnit: m.weight === "" ? null : Number(m.weight),
      packageQty: m.packQty, packageDims: m.packDims, moq: m.moq,
      deliveryDays: m.delivery === "" ? null : Number(m.delivery),
      quotedAt: m.quotedAt || undefined, active: m.active, attrValues,
      imageUrl: m.imageUrl.trim(), videoUrl: m.videoUrl.trim(),
    };
    return mutate(async () => {
      if (m.id) await api(`/api/product-line/rates/${m.id}`, "PATCH", body);
      else await api("/api/product-line/rates", "POST", body);
      setRModal(null);
    });
  };

  if (dash.loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-56 rounded-lg border border-[var(--border-card)]" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl border border-[var(--border-card)]" />)}
        </div>
        <div className="h-64 rounded-2xl border border-[var(--border-card)]" />
      </div>
    );
  }
  if (dash.error && !data) {
    return (
      <div className={`${panel} p-8 text-center space-y-3`}>
        <p className="font-extrabold text-[var(--text-primary)]">Couldn’t load the catalogue</p>
        <p className="text-sm text-[var(--text-tertiary)]">{String(dash.error)}</p>
        <button type="button" onClick={() => void dash.refresh()} className={ghostBtn}><RefreshCw size={14} /> Retry</button>
      </div>
    );
  }

  const selRate: RateRow | null = detail?.rates.find((r) => r.id === selRateId) ?? null;
  // Live validation for the quote form — save stays disabled until every
  // filled numeric reads as a number and discount sits in 0–100.
  const rateFormError: string | null = !rModal ? null
    : !rModal.vendorId ? "Choose a vendor."
    : !rModal.productId ? "Choose a product."
    : rModal.price !== "" && !isNum(rModal.price) ? "Price must be a number."
    : rModal.discount !== "" && !isNum(rModal.discount) ? "Discount must be a number."
    : rModal.discount !== "" && (Number(rModal.discount) < 0 || Number(rModal.discount) > 100) ? "Discount must be 0–100%."
    : rModal.weight !== "" && !isNum(rModal.weight) ? "Weight must be a number."
    : rModal.delivery !== "" && !isNum(rModal.delivery) ? "Delivery days must be a number."
    : rModal.imageUrl.trim() !== "" && !isPhotoValue(rModal.imageUrl) ? "Photo must be an uploaded photo or an https:// URL."
    : rModal.videoUrl.trim() !== "" && !isHttpUrl(rModal.videoUrl) ? "Video must be an https:// URL."
    : null;
  const cmpRows: { label: string; get: (r: RateRow) => string }[] = detail
    ? [
        { label: "Price", get: (r) => (r.pricePerUnit != null ? `${fmtINR(r.pricePerUnit)}${r.unit ? ` / ${r.unit}` : ""}` : "—") },
        { label: "Discount", get: (r) => (r.discountPercent != null ? `${r.discountPercent}%` : "—") },
        { label: "MOQ", get: (r) => r.moq ?? "—" },
        { label: "Delivery", get: (r) => (r.deliveryDays != null ? `${r.deliveryDays} days` : "—") },
        ...[...new Set(detail.rates.flatMap((r) => Object.keys(r.attrValues ?? {})))].map((k) => ({
          label: attrLabel(k, detail.guide),
          get: (r: RateRow) => r.attrValues?.[k] || "—",
        })),
      ]
    : [];
  const bestRate = detail?.rates.filter((r) => r.active && r.pricePerUnit != null)
    .sort((a, b) => Number(a.pricePerUnit) - Number(b.pricePerUnit))[0] ?? null;
  const commercialRows: [string, string, boolean][] = selRate
    ? [
        ["Price", selRate.pricePerUnit != null ? `${fmtINR(selRate.pricePerUnit)}${selRate.unit ? ` / ${selRate.unit}` : ""}` : "—", true],
        ["Discount", selRate.discountPercent != null ? `${selRate.discountPercent}%` : "—", false],
        ["Base rate", fmtINR(selRate.baseRate), false],
        ["MOQ", selRate.moq ?? "—", false],
        ["Weight / unit", selRate.weightPerUnit != null ? `${selRate.weightPerUnit} kg` : "—", false],
        ["Pack qty", selRate.packageQty ?? "—", false],
        ["Pack dims", selRate.packageDims ?? "—", false],
        ["Delivery", selRate.deliveryDays != null ? `${selRate.deliveryDays} days` : "—", false],
        ["Quoted", shortDate(selRate.quotedAt), false],
      ]
    : [];

  const stats = [
    { icon: Package, tint: "bg-indigo-500/10 text-indigo-500", value: String(data?.products.length ?? 0), label: "Products" },
    { icon: ClipboardList, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400", value: String(totalQuestions), label: "Guide questions" },
    { icon: Users, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400", value: String(data?.vendors.length ?? 0), label: "Vendors" },
    { icon: Wallet, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", value: String(data?.rates.length ?? 0), label: "Quote facts" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* ── Page head ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Catalogue</p>
          <h2 className="font-heading font-extrabold text-2xl tracking-tight text-[var(--text-primary)]">
            {detail?.product.name ?? "Product Line"}
          </h2>
          <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
            {detailId && detail
              ? `${detail.product.category}${detail.product.aliases.length ? ` · aka ${detail.product.aliases.slice(0, 3).join(", ")}` : ""}`
              : "KYP master as living data — requirements, vendors and every quoted spec."}
          </p>
        </div>
        <div className="flex-1" />
        {detailId ? (
          <button type="button" onClick={() => { setDetailId(null); setDetail(null); }} className={ghostBtn}><ArrowLeft size={14} /> All products</button>
        ) : (
          <>
            <div className="flex gap-5 border-b border-[var(--border-card)]">
              {(["products", "vendors", "rates"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`pb-2 -mb-px text-xs font-bold cursor-pointer bg-transparent border-0 border-b-2 ${tab === t ? "border-brand-indigo text-[var(--text-primary)]" : "border-transparent text-[var(--text-tertiary)]"}`}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {canEdit && tab === "products" && (
              <button type="button" disabled={busy} onClick={() => setPModal({ category: cat, name: "", aliases: "", active: true })} className={primaryBtn}><Plus size={14} /> Product</button>
            )}
            {canEdit && tab === "vendors" && (
              <button type="button" disabled={busy} onClick={() => setVModal({ name: "", contactPerson: "", contactPhone1: "", contactPhone2: "", location: "", address: "", yearEstablished: "", vendorType: "", active: true })} className={primaryBtn}><Plus size={14} /> Vendor</button>
            )}
          </>
        )}
      </div>

      {err && (
        <div className={`${panel} px-4 py-3 flex items-center gap-2.5 text-[13px] font-bold text-[var(--color-danger)]`}>
          <Info size={15} className="flex-shrink-0" /> {err}
          <button type="button" onClick={() => setErr(null)} className={iconBtn}><X size={14} /></button>
        </div>
      )}

      {/* ── Stat strip ── */}
      {!detailId && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((s) => (
            <div key={s.label} className={`${panel} px-4 py-3.5 flex items-center gap-3`}>
              <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.tint}`}><s.icon size={17} /></span>
              <div>
                <p className="text-xl font-extrabold tabular-nums tracking-tight text-[var(--text-primary)] leading-none">{s.value}</p>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ DETAIL ══ */}
      {detailId && (
        <div className="space-y-4">
          <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-[var(--bg-app)]/90 backdrop-blur">
            <button
              type="button"
              onClick={() => { setDetailId(null); setDetail(null); }}
              className={`${ghostBtn} !rounded-full !px-4`}
            >
              <ArrowLeft size={14} /> Back{detail?.product.name ? ` · ${detail.product.name}` : ""}
            </button>
          </div>
          {detailLoading && !detail && (
            <div className="space-y-3 animate-pulse">
              <div className="h-36 rounded-2xl border border-[var(--border-card)]" />
              <div className="h-48 rounded-2xl border border-[var(--border-card)]" />
            </div>
          )}
          {detail && (
            <>
              {/* Meta + KPIs */}
              <div className={`${panel} p-5`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: hueFor(detail.product.category) }}>
                    <CircleDot size={11} /> {detail.product.category}
                  </span>
                  {detail.product.active
                    ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Active</span>
                    : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-zinc-500" /> Off</span>}
                  <span className="flex-1" />
                  {canEdit && <button type="button" onClick={() => setPModal({ id: detail.product.id, category: detail.product.category, name: detail.product.name, aliases: detail.product.aliases.join(", "), active: detail.product.active })} className={ghostBtn}><Pencil size={13} /> Edit</button>}
                </div>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { icon: ClipboardList, k: "Requirements", v: String(detail.guide.length) },
                    { icon: Factory, k: "Vendor quotes", v: String(detail.rates.length) },
                    { icon: Check, k: "Active quotes", v: String(detail.rates.filter((r) => r.active).length) },
                    { icon: IndianRupee, k: "Best price", v: bestRate ? `${fmtINR(bestRate.pricePerUnit)}${bestRate.unit ? `/${bestRate.unit}` : ""}` : "—" },
                  ].map((m) => (
                    <div key={m.k} className="rounded-xl border border-[var(--border-card)]/70 px-3.5 py-3 flex items-center gap-2.5">
                      <m.icon size={16} className="text-[var(--text-tertiary)] flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[15px] font-extrabold tabular-nums tracking-tight text-[var(--text-primary)] truncate">{m.v}</p>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{m.k}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Requirements */}
              <section className={`${panel} p-5`}>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-extrabold tracking-tight text-[var(--text-primary)]">What to ask</h3>
                  <span className="text-xs tabular-nums text-[var(--text-tertiary)]">{detail.guide.length}</span>
                  <span className="flex-1" />
                  {canEdit && <button type="button" onClick={() => setGEdit({ productId: detail.product.id, question: "", guideNote: "", isRequired: true, sortOrder: String(detail.guide.length) })} className={ghostBtn}><Plus size={13} /> Question</button>}
                </div>
                <p className="mb-3 text-xs text-[var(--text-tertiary)]">KYP checklist — the spec gate intake enforces before a price is quotable.</p>
                {detail.guide.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-tertiary)]">No requirements defined yet.</p>}
                <ol className="divide-y divide-[var(--border-card)]/70">
                  {detail.guide.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((gq, i) => (
                    <li key={gq.id} className="group flex items-start gap-3.5 py-3">
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--border-card)] text-xs font-extrabold tabular-nums text-[var(--text-secondary)]">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug text-[var(--text-primary)]">{gq.question}</p>
                        {gq.guideNote && <p className="mt-1 border-l-2 border-brand-indigo/40 pl-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">{gq.guideNote}</p>}
                        <p className="mt-1 font-mono text-[11px] text-[var(--text-tertiary)]">{gq.attrKey}</p>
                      </div>
                      <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold border ${gq.isRequired ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "border-[var(--border-card)] text-[var(--text-tertiary)]"}`}>
                        {gq.isRequired ? "Required" : "Optional"}
                      </span>
                      {canEdit && (
                        <div className="flex-shrink-0 gap-1 hidden group-hover:flex">
                          <button type="button" title="Edit" onClick={() => setGEdit({ id: gq.id, productId: detail.product.id, question: gq.question, guideNote: gq.guideNote ?? "", isRequired: gq.isRequired, sortOrder: String(gq.sortOrder) })} className={iconBtn}><Pencil size={13} /></button>
                          <button type="button" title="Delete" onClick={() => setDelGuide(gq)} className={`${iconBtn} hover:!text-[var(--color-danger)]`}><Trash2 size={13} /></button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>

              {/* Vendor quotes */}
              <section className={`${panel} p-5`}>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-extrabold tracking-tight text-[var(--text-primary)]">Vendor quotes</h3>
                  <span className="text-xs tabular-nums text-[var(--text-tertiary)]">{detail.rates.length}</span>
                  <span className="flex-1" />
                  {canQuote && <button type="button" onClick={() => openRateModal(detail.product.id)} className={ghostBtn}><Plus size={13} /> Quote</button>}
                  {detail.rates.length > 1 && (
                    <button type="button" onClick={() => setCompareAll(!compareAll)} className={ghostBtn}><Layers size={13} /> {compareAll ? "Single view" : "Compare all"}</button>
                  )}
                </div>
                <p className="mb-4 text-xs text-[var(--text-tertiary)]">Each quote is pinned to the exact spec combination it was given for — same product, different spec, never conflated.</p>
                {detail.rates.length === 0 && <p className="py-4 text-center text-sm text-[var(--text-tertiary)]">No vendor quotes recorded for this product yet.</p>}

                {!compareAll && detail.rates.length > 0 && (
                  <>
                    <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Vendor quotes">
                      {detail.rates.map((r) => {
                        const active = r.id === selRateId;
                        return (
                          <button key={r.id} type="button" role="tab" aria-selected={active} onClick={() => setSelRateId(r.id)}
                            className={`flex-shrink-0 rounded-xl border-2 px-3.5 py-2.5 text-left cursor-pointer bg-transparent ${active ? "border-brand-indigo" : "border-[var(--border-card)]"}`}>
                            <p className={`text-[13px] font-extrabold ${active ? "text-brand-indigo" : "text-[var(--text-primary)]"}`}>
                              {r.vendorName ?? "Unknown"}{r.active ? "" : " · off"}
                            </p>
                            <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">{specSummary(r)}</p>
                            <p className="mt-0.5 text-[13px] font-extrabold tabular-nums text-[var(--text-primary)]">
                              {r.pricePerUnit != null ? `${fmtINR(r.pricePerUnit)}${r.unit ? `/${r.unit}` : ""}` : "No price"}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    {selRate && (
                      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
                        {(selRate.imageUrl || selRate.videoUrl) && (
                          <div className="lg:col-span-5 flex flex-wrap items-start gap-4 rounded-xl border border-[var(--border-card)]/80 p-4">
                            {selRate.imageUrl && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={selRate.imageUrl} alt={`${selRate.vendorName ?? "vendor"} item`}
                                className="h-32 w-32 rounded-xl border border-[var(--border-card)] object-cover" />
                            )}
                            {selRate.videoUrl && (
                              <div className="min-w-60 flex-1 max-w-md">
                                <p className="mb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Manufacturing video</p>
                                {/\.(mp4|webm|mov)(\?|$)/i.test(selRate.videoUrl) ? (
                                  <video src={selRate.videoUrl} controls preload="none" className="w-full rounded-xl border border-[var(--border-card)]" />
                                ) : (
                                  <a href={selRate.videoUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-brand-indigo hover:underline">Watch manufacturing video →</a>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="lg:col-span-3 rounded-xl border border-[var(--border-card)]/80 overflow-hidden">
                          <p className="px-4 py-2.5 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-card)]/70">
                            Spec as quoted · {selRate.vendorName}{selRate.vendorType ? ` — ${selRate.vendorType}` : ""}
                          </p>
                          {Object.keys(selRate.attrValues ?? {}).length === 0 && <p className="px-4 py-3 text-sm text-[var(--text-tertiary)]">No spec breakup recorded on this quote.</p>}
                          <dl>
                            {Object.entries(selRate.attrValues ?? {}).map(([k, v], idx) => (
                              <div key={k} className="flex gap-3 px-4 py-2 border-b border-[var(--border-card)]/50 last:border-0">
                                <dt className="w-2/5 flex-shrink-0 text-xs leading-relaxed text-[var(--text-secondary)]">{attrLabel(k, detail.guide)}</dt>
                                <dd className="flex-1 text-[13px] font-bold text-[var(--text-primary)]">{v || "—"}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                        <div className="lg:col-span-2 rounded-xl border border-[var(--border-card)]/80 overflow-hidden h-fit">
                          <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-card)]/70">
                            <p className="flex-1 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)]">Commercials</p>
                            {canQuote && <button type="button" onClick={() => openRateModal(detail.product.id, selRate)} className={ghostBtn}><Pencil size={12} /> Edit quote</button>}
                          </div>
                          <dl className="px-4 py-1">
                            {commercialRows.map(([k, v, hero]) => (
                              <div key={k} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-card)]/50 py-2 last:border-0">
                                <dt className="text-xs text-[var(--text-secondary)]">{k}</dt>
                                <dd className={`tabular-nums ${hero ? "text-base font-extrabold text-[var(--text-primary)]" : "text-[13px] font-bold text-[var(--text-primary)]"}`}>{v}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {compareAll && detail.rates.length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-[var(--border-card)]/80">
                    <table className="w-full text-sm min-w-[620px] border-collapse">
                      <thead>
                        <tr>
                          <th className="sticky left-0 bg-[var(--bg-card)] py-2.5 pl-4 pr-3 text-left text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">Field</th>
                          {detail.rates.map((r) => (
                            <th key={r.id} className="py-2.5 px-3 text-left align-top">
                              <p className="text-[13px] font-extrabold text-[var(--text-primary)]">{r.vendorName ?? "—"}</p>
                              {bestRate?.id === r.id && <span className="mt-0.5 inline-block rounded-full bg-emerald-500/15 px-2 py-px text-[10px] font-extrabold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Best price</span>}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {cmpRows.map((row) => (
                          <tr key={row.label} className="border-t border-[var(--border-card)]/60">
                            <td className="sticky left-0 bg-[var(--bg-card)] py-2 pl-4 pr-3 text-xs text-[var(--text-secondary)] whitespace-nowrap max-w-52 truncate" title={row.label}>{row.label}</td>
                            {detail.rates.map((r) => (
                              <td key={r.id} className={`py-2 px-3 text-[13px] tabular-nums align-top ${row.label === "Price" ? "font-extrabold text-[var(--text-primary)]" : "text-[var(--text-primary)]"}`}>{row.get(r)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {/* ══ LIST: products ══ */}
      {!detailId && tab === "products" && (
        <div className={`${panel} p-4 sm:p-5 space-y-4`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, aliases…" className={`${field} !pl-9`} />
            </div>
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={`${field} !w-auto sm:!w-60`}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs tabular-nums text-[var(--text-tertiary)]">{products.length} of {data?.products.length ?? 0}</p>
          </div>
          {products.length === 0 && (
            <div className="py-10 text-center">
              <Package size={28} className="mx-auto text-[var(--text-tertiary)]" />
              <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">Nothing matches</p>
              <p className="text-xs text-[var(--text-tertiary)]">Try a different search or category.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {products.map((p) => (
              <article key={p.id}
                onClick={() => void loadDetail(p.id)} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") void loadDetail(p.id); }}
                className="rounded-2xl border border-[var(--border-card)]/80 p-4 cursor-pointer">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: hueFor(p.category) }} />
                  <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)] truncate">{p.category}</p>
                  <span className="flex-1" />
                  <span className={`h-1.5 w-1.5 rounded-full ${p.active ? "bg-emerald-500" : "bg-zinc-500"}`} title={p.active ? "Active" : "Off"} />
                </div>
                <h3 className="mt-1.5 font-extrabold tracking-tight leading-snug text-[var(--text-primary)]">{p.name}</h3>
                {p.aliases.length > 0 && <p className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]" title={p.aliases.join(", ")}>aka {p.aliases.slice(0, 3).join(", ")}{p.aliases.length > 3 ? "…" : ""}</p>}
                <div className="mt-3 flex items-center gap-3 border-t border-[var(--border-card)]/60 pt-2.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-[var(--text-secondary)]"><ClipboardList size={12} /> {p.guideCount}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-[var(--text-secondary)]"><Wallet size={12} /> {p.rateCount}</span>
                  {bestByProduct.has(p.id) && <span className="text-[11px] font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">₹{Number(bestByProduct.get(p.id)).toLocaleString("en-IN")}+</span>}
                  <span className="flex-1" />
                  <ChevronRight size={15} className="text-[var(--text-tertiary)]" />
                </div>
                {canEdit && (
                  <div className="mt-2 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => setPModal({ id: p.id, category: p.category, name: p.name, aliases: p.aliases.join(", "), active: p.active })} className={ghostBtn}><Pencil size={12} /> Edit</button>
                    <button type="button" onClick={() => setDelProduct(p)} className={dangerBtn}><Trash2 size={12} /></button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {/* ══ LIST: vendors ══ */}
      {!detailId && tab === "vendors" && (
        <div className={`${panel} p-4 sm:p-5`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {(data?.vendors ?? []).map((v) => (
              <article key={v.id} className="rounded-2xl border border-[var(--border-card)]/80 p-4 transition-colors hover:border-[var(--text-tertiary)]">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-card)] text-[var(--text-secondary)]"><Building2 size={17} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold tracking-tight text-[var(--text-primary)] truncate">{v.name}</p>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{v.vendorType || "Type not set"}{v.yearEstablished ? ` · since ${v.yearEstablished}` : ""}</p>
                  </div>
                  <span className={`h-1.5 w-1.5 rounded-full mt-2 flex-shrink-0 ${v.active ? "bg-emerald-500" : "bg-zinc-500"}`} />
                </div>
                <div className="mt-2.5 space-y-1 text-xs text-[var(--text-secondary)]">
                  {(v.contactPerson || v.contactPhone1) && (
                    <p className="flex items-center gap-1.5"><Phone size={12} className="text-[var(--text-tertiary)] flex-shrink-0" />{[v.contactPerson, v.contactPhone1, v.contactPhone2].filter(Boolean).join(" · ")}</p>
                  )}
                  {(v.location || v.address) && (
                    <p className="flex items-center gap-1.5"><MapPin size={12} className="text-[var(--text-tertiary)] flex-shrink-0" /><span className="truncate">{[v.location, v.address].filter(Boolean).join(", ")}</span></p>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-2 border-t border-[var(--border-card)]/60 pt-2.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-[var(--text-secondary)]"><Wallet size={12} /> {v.rateCount} quotes</span>
                  {canEdit && (
                    <>
                      <span className="flex-1" />
                      <button type="button" onClick={() => setVModal({ id: v.id, name: v.name, contactPerson: v.contactPerson ?? "", contactPhone1: v.contactPhone1 ?? "", contactPhone2: v.contactPhone2 ?? "", location: v.location ?? "", address: v.address ?? "", yearEstablished: v.yearEstablished != null ? String(v.yearEstablished) : "", vendorType: v.vendorType, active: v.active })} className={ghostBtn}><Pencil size={12} /> Edit</button>
                      <button type="button" onClick={() => setDelVendor(v)} className={dangerBtn}>Off</button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
          {(data?.vendors.length ?? 0) === 0 && (
            <div className="py-10 text-center">
              <Factory size={28} className="mx-auto text-[var(--text-tertiary)]" />
              <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">No vendors yet</p>
              <p className="text-xs text-[var(--text-tertiary)]">Add the first supplier to start collecting quotes.</p>
            </div>
          )}
        </div>
      )}

      {/* ══ LIST: rates ══ */}
      {!detailId && tab === "rates" && (
        <div className={`${panel} overflow-hidden`}>
          <div className="flex items-center gap-2 px-4 sm:px-5 pt-4">
            <p className="flex-1 text-xs text-[var(--text-tertiary)]">Latest {(data?.rates ?? []).length} quote facts — open a product for full spec detail and comparison.</p>
            {canQuote && <button type="button" disabled={busy || (data?.products.length ?? 0) === 0} onClick={() => openRateModal(data?.products[0]?.id ?? "")} className={primaryBtn}><Plus size={14} /> Quote</button>}
          </div>
          <div className="overflow-x-auto p-2 sm:p-3">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left">
                  {["Product", "Vendor", "Spec", "Price", "MOQ", "Status"].map((h, i) => (
                    <th key={h} className={`py-2.5 px-3 text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-card)] ${i === 3 ? "text-right" : ""}`}>{h}</th>
                  ))}
                  {canQuote && <th className="py-2.5 px-3 border-b border-[var(--border-card)]"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody>
                {(data?.rates ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60 font-bold text-[var(--text-primary)]">
                      {r.productId
                        ? <button type="button" onClick={() => void loadDetail(r.productId as string)} className="cursor-pointer bg-transparent border-0 p-0 font-bold text-brand-indigo hover:underline text-left">{r.productName ?? "—"}</button>
                        : (r.productName ?? "—")}
                    </td>
                    <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60 text-[var(--text-secondary)]">{r.vendorName ?? "—"}</td>
                    <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60 text-xs text-[var(--text-tertiary)] max-w-56 truncate" title={Object.entries(r.attrValues ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}>{specSummary(r)}</td>
                    <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60 text-right font-extrabold tabular-nums text-[var(--text-primary)] whitespace-nowrap">{r.pricePerUnit != null ? `${fmtINR(r.pricePerUnit)}${r.unit ? `/${r.unit}` : ""}` : "—"}</td>
                    <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60 text-[var(--text-secondary)]">{r.moq || "—"}</td>
                    <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60">
                      {r.active
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> On</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-500"><span className="h-1.5 w-1.5 rounded-full bg-zinc-500" /> Off</span>}
                    </td>
                    {canQuote && (
                      <td className="py-2.5 px-3 border-b border-[var(--border-card)]/60 text-right whitespace-nowrap">
                        <button type="button" onClick={() => openRateModal(r.productId ?? "", r)} className={ghostBtn}><Pencil size={12} /> Edit</button>{" "}
                        <button type="button" disabled={busy} onClick={() => void mutate(() => api(`/api/product-line/rates/${r.id}`, "PATCH", { active: !r.active }).then(() => {}))} className={ghostBtn}>{r.active ? "Turn off" : "Turn on"}</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {(data?.rates.length ?? 0) === 0 && (
              <div className="py-10 text-center">
                <Tag size={26} className="mx-auto text-[var(--text-tertiary)]" />
                <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">No quotes recorded yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Product modal ── */}
      {pModal && (
        <ModalShell title={pModal.id ? "Edit product" : "New product"} onClose={() => setPModal(null)}>
          <label className={label}>Category
            <input value={pModal.category} onChange={(e) => setPModal({ ...pModal, category: e.target.value })} list="pl-cats" className={`${field} mt-1.5 font-normal normal-case tracking-normal`} placeholder="e.g. Conveying Accessories" />
            <datalist id="pl-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className={label}>Product name
            <input value={pModal.name} onChange={(e) => setPModal({ ...pModal, name: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <label className={label}>Aliases <span className="normal-case font-medium">(comma separated)</span>
            <input value={pModal.aliases} onChange={(e) => setPModal({ ...pModal, aliases: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-[var(--text-primary)]">
            <input type="checkbox" checked={pModal.active} onChange={(e) => setPModal({ ...pModal, active: e.target.checked })} className="h-4 w-4 accent-indigo-500" /> Active in catalogue
          </label>
          <ModalFoot onCancel={() => setPModal(null)} busy={busy}
            disabled={!pModal.category.trim() || !pModal.name.trim()}
            onSave={() => void mutate(async () => {
              const body = { category: pModal.category, name: pModal.name, aliases: pModal.aliases, active: pModal.active };
              if (pModal.id) await api(`/api/product-line/products/${pModal.id}`, "PATCH", body);
              else await api("/api/product-line/products", "POST", body);
              setPModal(null);
            })} />
        </ModalShell>
      )}

      {delProduct && (
        <ModalShell title={`Delete ${delProduct.name}?`} onClose={() => setDelProduct(null)} narrow>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Its {delProduct.guideCount} guide question(s) go with it.{" "}
            {delProduct.rateCount > 0
              ? <span className="font-bold text-[var(--color-danger)]">Blocked while {delProduct.rateCount} vendor rate(s) reference it — unlink those first.</span>
              : "This cannot be undone."}
          </p>
          <ModalFoot onCancel={() => setDelProduct(null)} busy={busy} danger="Delete" disabled={delProduct.rateCount > 0}
            onSave={() => void mutate(async () => { await api(`/api/product-line/products/${delProduct.id}`, "DELETE"); setDelProduct(null); })} />
        </ModalShell>
      )}

      {gEdit && (
        <ModalShell title={gEdit.id ? "Edit question" : "New question"} onClose={() => setGEdit(null)}>
          <label className={label}>Question
            <textarea value={gEdit.question} onChange={(e) => setGEdit({ ...gEdit, question: e.target.value })} rows={3} className={`${field} mt-1.5 font-normal normal-case tracking-normal resize-y`} />
          </label>
          <label className={label}>Guide note <span className="normal-case font-medium">(optional)</span>
            <input value={gEdit.guideNote} onChange={(e) => setGEdit({ ...gEdit, guideNote: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <div className="flex items-end gap-3">
            <label className={`${label} flex-1`}>Order
              <input value={gEdit.sortOrder} onChange={(e) => setGEdit({ ...gEdit, sortOrder: e.target.value })} inputMode="numeric" className={`${field} mt-1.5 font-normal`} />
            </label>
            <label className="flex items-center gap-2 pb-2 text-[13px] font-bold text-[var(--text-primary)]">
              <input type="checkbox" checked={gEdit.isRequired} onChange={(e) => setGEdit({ ...gEdit, isRequired: e.target.checked })} className="h-4 w-4 accent-indigo-500" /> Required
            </label>
          </div>
          <ModalFoot onCancel={() => setGEdit(null)} busy={busy} disabled={!gEdit.question.trim()} onSave={() => void mutate(async () => {
            if (gEdit.id) await api(`/api/product-line/guide/${gEdit.id}`, "PATCH", { question: gEdit.question, guideNote: gEdit.guideNote, isRequired: gEdit.isRequired, sortOrder: Number(gEdit.sortOrder) || 0 });
            else await api("/api/product-line/guide", "POST", { productId: gEdit.productId, question: gEdit.question, guideNote: gEdit.guideNote, isRequired: gEdit.isRequired, sortOrder: Number(gEdit.sortOrder) || 0 });
            setGEdit(null);
          })} />
        </ModalShell>
      )}

      {delGuide && (
        <ModalShell title="Delete this question?" onClose={() => setDelGuide(null)} narrow>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            attrKey <span className="font-mono text-xs">{delGuide.attrKey}</span> disappears with it. Old vendor rates keyed on it stop exact-matching.
          </p>
          <ModalFoot onCancel={() => setDelGuide(null)} busy={busy} danger="Delete"
            onSave={() => void mutate(async () => { await api(`/api/product-line/guide/${delGuide.id}`, "DELETE"); setDelGuide(null); })} />
        </ModalShell>
      )}

      {vModal && (
        <ModalShell title={vModal.id ? "Edit vendor" : "New vendor"} onClose={() => setVModal(null)}>
          <label className={label}>Vendor name
            <input value={vModal.name} onChange={(e) => setVModal({ ...vModal, name: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Type
              <select value={vModal.vendorType} onChange={(e) => setVModal({ ...vModal, vendorType: e.target.value })} className={`${field} mt-1.5 font-normal`}>
                <option value="">—</option><option>Manufacturer</option><option>Distributor</option><option>Trader</option>
              </select>
            </label>
            <label className={label}>Year est.
              <input value={vModal.yearEstablished} onChange={(e) => setVModal({ ...vModal, yearEstablished: e.target.value })} inputMode="numeric" className={`${field} mt-1.5 font-normal`} />
            </label>
          </div>
          <label className={label}>Contact person
            <input value={vModal.contactPerson} onChange={(e) => setVModal({ ...vModal, contactPerson: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Phone 1
              <input value={vModal.contactPhone1} onChange={(e) => setVModal({ ...vModal, contactPhone1: e.target.value })} className={`${field} mt-1.5 font-normal`} />
            </label>
            <label className={label}>Phone 2
              <input value={vModal.contactPhone2} onChange={(e) => setVModal({ ...vModal, contactPhone2: e.target.value })} className={`${field} mt-1.5 font-normal`} />
            </label>
          </div>
          <label className={label}>Location
            <input value={vModal.location} onChange={(e) => setVModal({ ...vModal, location: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <label className={label}>Address
            <input value={vModal.address} onChange={(e) => setVModal({ ...vModal, address: e.target.value })} className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          <label className="flex items-center gap-2 text-[13px] font-bold text-[var(--text-primary)]">
            <input type="checkbox" checked={vModal.active} onChange={(e) => setVModal({ ...vModal, active: e.target.checked })} className="h-4 w-4 accent-indigo-500" /> Active
          </label>
          {vModal.yearEstablished.trim() !== "" && (!isNum(vModal.yearEstablished) || Number(vModal.yearEstablished) < 1800 || Number(vModal.yearEstablished) > 2100) && (
            <p className="text-xs font-bold text-[var(--color-danger)]">Year must be a valid year (1800–2100).</p>
          )}
          <ModalFoot onCancel={() => setVModal(null)} busy={busy}
            disabled={!vModal.name.trim() || (vModal.yearEstablished.trim() !== "" && (!isNum(vModal.yearEstablished) || Number(vModal.yearEstablished) < 1800 || Number(vModal.yearEstablished) > 2100))}
            onSave={() => void mutate(async () => {
            const body = { name: vModal.name, contactPerson: vModal.contactPerson, contactPhone1: vModal.contactPhone1, contactPhone2: vModal.contactPhone2, location: vModal.location, address: vModal.address, yearEstablished: vModal.yearEstablished === "" ? null : Number(vModal.yearEstablished), vendorType: vModal.vendorType, active: vModal.active };
            if (vModal.id) await api(`/api/product-line/vendors/${vModal.id}`, "PATCH", body);
            else await api("/api/product-line/vendors", "POST", body);
            setVModal(null);
          })} />
        </ModalShell>
      )}

      {delVendor && (
        <ModalShell title={`Turn off ${delVendor.name}?`} onClose={() => setDelVendor(null)} narrow>
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">Soft off — its {delVendor.rateCount} rate row(s) stay queryable.</p>
          <ModalFoot onCancel={() => setDelVendor(null)} busy={busy} danger="Turn off"
            onSave={() => void mutate(async () => { await api(`/api/product-line/vendors/${delVendor.id}`, "DELETE"); setDelVendor(null); })} />
        </ModalShell>
      )}

      {/* ── Quote modal ── */}
      {rModal && (
        <ModalShell title={rModal.id ? "Edit quote" : "New quote"} onClose={() => setRModal(null)}>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Vendor
              <select value={rModal.vendorId} onChange={(e) => setRModal({ ...rModal, vendorId: e.target.value })} className={`${field} mt-1.5 font-normal`}>
                <option value="">Select…</option>
                {(data?.vendors ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}{v.active ? "" : " (off)"}</option>)}
              </select>
            </label>
            <label className={label}>Product
              <select value={rModal.productId} onChange={(e) => {
                const pid = e.target.value;
                const qs = (data?.guide[pid] ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
                const byKey = new Map(rModal.attrs.map((a) => [a.key, a.value]));
                const keys = [...new Set([...qs.map((g) => g.attrKey), ...byKey.keys()])];
                setRModal({ ...rModal, productId: pid, attrs: rModal.id ? keys.map((k) => ({ key: k, value: byKey.get(k) ?? "" })) : qs.map((g) => ({ key: g.attrKey, value: "" })) });
              }} className={`${field} mt-1.5 font-normal`}>
                <option value="">Select…</option>
                {(data?.products ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <div>
            <p className={`${label} mb-1.5`}>Spec — values for this vendor's quote</p>
            <div className="space-y-1.5">
              {rModal.attrs.map((a, i) => (
                <div key={i} className="flex gap-1.5">
                  <input value={a.key} placeholder="attribute"
                    onChange={(e) => setRModal({ ...rModal, attrs: rModal.attrs.map((x, j) => j === i ? { ...x, key: e.target.value } : x) })}
                    className={`${field} font-mono !text-xs !w-2/5`} />
                  <input value={a.value} placeholder="quoted value"
                    onChange={(e) => setRModal({ ...rModal, attrs: rModal.attrs.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}
                    className={`${field} flex-1 !text-xs`} />
                  <button type="button" aria-label="Remove spec row" onClick={() => setRModal({ ...rModal, attrs: rModal.attrs.filter((_, j) => j !== i) })} className={iconBtn}><X size={14} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setRModal({ ...rModal, attrs: [...rModal.attrs, { key: "", value: "" }] })} className={ghostBtn}><Plus size={12} /> Spec row</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>Price
              <input value={rModal.price} onChange={(e) => setRModal({ ...rModal, price: e.target.value })} inputMode="decimal" placeholder="0" className={`${field} mt-1.5 font-normal tabular-nums`} />
            </label>
            <label className={label}>Unit
              <input value={rModal.unit} onChange={(e) => setRModal({ ...rModal, unit: e.target.value })} placeholder="m / pcs / kg" className={`${field} mt-1.5 font-normal`} />
            </label>
            <label className={label}>Discount %
              <input value={rModal.discount} onChange={(e) => setRModal({ ...rModal, discount: e.target.value })} inputMode="decimal" placeholder="0" className={`${field} mt-1.5 font-normal tabular-nums`} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>Weight / unit (kg)
              <input value={rModal.weight} onChange={(e) => setRModal({ ...rModal, weight: e.target.value })} inputMode="decimal" className={`${field} mt-1.5 font-normal tabular-nums`} />
            </label>
            <label className={label}>Pack qty
              <input value={rModal.packQty} onChange={(e) => setRModal({ ...rModal, packQty: e.target.value })} className={`${field} mt-1.5 font-normal`} />
            </label>
            <label className={label}>Pack dims
              <input value={rModal.packDims} onChange={(e) => setRModal({ ...rModal, packDims: e.target.value })} className={`${field} mt-1.5 font-normal`} />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label className={label}>MOQ
              <input value={rModal.moq} onChange={(e) => setRModal({ ...rModal, moq: e.target.value })} className={`${field} mt-1.5 font-normal`} />
            </label>
            <label className={label}>Delivery (days)
              <input value={rModal.delivery} onChange={(e) => setRModal({ ...rModal, delivery: e.target.value })} inputMode="numeric" className={`${field} mt-1.5 font-normal tabular-nums`} />
            </label>
            <label className={label}>Quoted on
              <input type="date" value={rModal.quotedAt} onChange={(e) => setRModal({ ...rModal, quotedAt: e.target.value })} className={`${field} mt-1.5 font-normal`} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13px] font-bold text-[var(--text-primary)]">
            <input type="checkbox" checked={rModal.active} onChange={(e) => setRModal({ ...rModal, active: e.target.checked })} className="h-4 w-4 accent-indigo-500" /> Active quote
          </label>
          <div>
            <p className={`${label} mb-1.5`}>Item photo <span className="normal-case font-medium">(this vendor's item, optional)</span></p>
            <div className="flex gap-2">
              <select value={isPhotoValue(rModal.imageUrl) || rModal.imageUrl.trim() === "" ? rModal.imageUrl.trim() : "__custom__"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__upload__") { photoInputRef.current?.click(); return; }
                  if (v !== "__custom__") setRModal({ ...rModal, imageUrl: v });
                }}
                className={`${field} font-normal flex-1`}>
                <option value="">No photo</option>
                {photoList.map((p) => <option key={p.key} value={p.url}>{p.name}</option>)}
                {rModal.imageUrl.trim() !== "" && !photoList.some((p) => p.url === rModal.imageUrl.trim()) && (
                  <option value="__custom__">Current custom URL</option>
                )}
                <option value="__upload__">＋ Upload new photo…</option>
              </select>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = ""; }} />
            </div>
            {photoBusy && <p className="mt-1 text-xs text-[var(--text-tertiary)]">Uploading…</p>}
            {rModal.imageUrl.trim() !== "" && !isPhotoValue(rModal.imageUrl) && (
              <p className="mt-1 text-xs font-bold text-[var(--color-danger)]">Pick an uploaded photo or paste an https:// URL below.</p>
            )}
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs font-bold text-[var(--text-tertiary)]">Or paste an image URL</summary>
              <input value={/^\/api\/chat\/files\//.test(rModal.imageUrl.trim()) ? "" : rModal.imageUrl}
                onChange={(e) => setRModal({ ...rModal, imageUrl: e.target.value })} placeholder="https://…"
                className={`${field} mt-1.5 font-normal normal-case tracking-normal !text-xs`} />
            </details>
            {isPhotoValue(rModal.imageUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rModal.imageUrl.trim()} alt="preview" className="mt-2 h-24 w-24 rounded-xl border border-[var(--border-card)] object-cover" />
            )}
          </div>
          <label className={label}>Manufacturing video <span className="normal-case font-medium">(https URL, optional)</span>
            <input value={rModal.videoUrl} onChange={(e) => setRModal({ ...rModal, videoUrl: e.target.value })} placeholder="https://…"
              className={`${field} mt-1.5 font-normal normal-case tracking-normal`} />
          </label>
          {rModal.videoUrl.trim() !== "" && !isHttpUrl(rModal.videoUrl) && (
            <p className="text-xs font-bold text-[var(--color-danger)]">Video must be an https:// URL.</p>
          )}
          {rateFormError && <p className="text-xs font-bold text-[var(--color-danger)]">{rateFormError}</p>}
          <ModalFoot onCancel={() => setRModal(null)} busy={busy} disabled={!rModal.vendorId || !rModal.productId || rateFormError !== null} onSave={() => void saveRateModal()} />
        </ModalShell>
      )}
    </div>
  );
}

/* ── Shared modal chrome ── */
function ModalShell({ title, onClose, narrow, children }: { title: string; onClose: () => void; narrow?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]" onClick={onClose}>
      <div className={`${panel} w-full ${narrow ? "max-w-sm" : "max-w-md"} max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-[var(--border-card)]/70 sticky top-0 bg-[var(--bg-card)] rounded-t-2xl">
          <h3 className="flex-1 font-extrabold tracking-tight text-[var(--text-primary)]">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className={iconBtn}><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3.5">{children}</div>
      </div>
    </div>
  );
}

function ModalFoot({ onCancel, onSave, busy, disabled, danger }: { onCancel: () => void; onSave: () => void; busy: boolean; disabled?: boolean; danger?: string }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className={ghostBtn}>Cancel</button>
      {danger ? (
        <button type="button" disabled={busy || disabled} onClick={onSave} className={dangerBtn}>{busy ? "Working…" : danger}</button>
      ) : (
        <button type="button" disabled={busy || disabled} onClick={onSave} className={primaryBtn}><Check size={14} /> {busy ? "Saving…" : "Save"}</button>
      )}
    </div>
  );
}
