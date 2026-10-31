"use client";

// ReportingSheetView — weekly management review across departments.
//
// Root/MIS see every department; a head sees only their own. Each section is a
// descriptor-driven EntryForm (auto-fill where a live source exists, hand entry
// elsewhere). Subscribes only to the typed `reporting` live event.
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useLiveQuery } from "@/hooks/useLiveData";
import { getCapabilities, getFilledPeriods, getReportingSheet } from "@/reporting/api";
import type {
  ReportDepartment, ReportEntryView, ReportingPayload, ReportSectionView,
} from "@/reporting/types";
import { Card, EmptyState, ErrorState, Skeleton, TabBar, Badge } from "@/components/ui";

const EntryForm = dynamic(() => import("./EntryForm"), { ssr: false });

function fmtDate(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.slice(0, 10));
  if (!m) return iso.slice(0, 10);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function originBadge(origin: ReportEntryView["origin"]) {
  if (origin === "autofill") return <Badge tone="info">auto-filled</Badge>;
  if (origin === "adjusted") return <Badge tone="warning">auto + adjusted</Badge>;
  return <Badge tone="neutral">hand-entered</Badge>;
}

/** One-line computed insight under the form for sections that earn it. */
function SectionInsight({ section }: { section: ReportSectionView }) {
  const p = section.entry?.payload ?? {};
  const n = (k: string) => Number(p[k] ?? 0) || 0;
  if (section.section === "b2b") {
    const total = n("alibaba") + n("indiamart") + n("tradeindia") + n("eexporter");
    const conv = n("converted");
    if (!total && !conv) return null;
    const ratio = total > 0 ? `${Math.round((conv / total) * 100)}%` : "—";
    return (
      <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
        {total.toLocaleString("en-IN")} portal inquiries → {conv.toLocaleString("en-IN")} converted ({ratio} conversion)
      </p>
    );
  }
  if (section.section === "outstanding") {
    if (!n("invoicedTotal") && !n("advanceReceived")) return null;
    return (
      <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
        ₹{n("invoicedTotal").toLocaleString("en-IN")} invoiced − ₹{n("advanceReceived").toLocaleString("en-IN")} advances ={" "}
        <strong className="text-[var(--text-primary)]">₹{n("netDue").toLocaleString("en-IN")} outstanding</strong>
      </p>
    );
  }
  if (section.section === "meta") {
    if (!n("spend") && !n("leads")) return null;
    const cpl = n("leads") > 0 ? `₹${Math.round(n("spend") / n("leads")).toLocaleString("en-IN")} / lead` : "—";
    return (
      <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
        ₹{n("spend").toLocaleString("en-IN")} → {n("leads").toLocaleString("en-IN")} leads ({cpl})
      </p>
    );
  }
  if (section.section === "ecommerce") {
    const total = n("buiBusiness") + n("smBusiness");
    const orders = n("buiOrders") + n("smOrders");
    if (!total && !orders) return null;
    return (
      <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
        ₹{total.toLocaleString("en-IN")} across {orders.toLocaleString("en-IN")} orders · {n("pendingOrders").toLocaleString("en-IN")} pending
      </p>
    );
  }
  return null;
}

export default function ReportingSheetView() {
  const [period, setPeriod] = useState<string>("");
  const [dept, setDept] = useState<ReportDepartment | "">("");
  const [filled, setFilled] = useState<string[]>([]);
  const [caps, setCaps] = useState<{ canEdit: Record<string, boolean>; isManager: boolean } | null>(null);

  const query = useLiveQuery<ReportingPayload>(
    () => getReportingSheet(period || undefined),
    { events: ["reporting"], deps: [period] },
  );
  const { data, loading, error, refresh } = query;

  useEffect(() => {
    let alive = true;
    getFilledPeriods().then((f) => { if (alive) setFilled(f); }).catch(() => {});
    getCapabilities()
      .then((c) => { if (alive) setCaps({ canEdit: c.canEdit, isManager: c.isManager }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Default to the current week once the payload arrives.
  useEffect(() => {
    if (!period && data?.period) setPeriod(data.period);
  }, [data, period]);

  const activeDept = useMemo(() => {
    if (!data) return null;
    if (dept && data.departments.some((d) => d.dept === dept)) {
      return data.departments.find((d) => d.dept === dept)!;
    }
    return data.departments[0] ?? null;
  }, [data, dept]);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <ErrorState
        title="Could not load the reporting sheet"
        message={error instanceof Error ? error.message : "The cached payload failed to load."}
        onRetry={refresh}
      />
    );
  }

  if (!data) return null;

  if (data.departments.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-xl">📊</span>}
        title="No reporting access"
        description="Ask the root to grant you the reporting-sheet viewer scope or a department scope (sales-head, crm, digital-marketing)."
      />
    );
  }

  const periodItem = data.periods.find((p) => p.key === data.period);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold text-zinc-900 dark:text-white">Reporting Sheet</h1>
          <p className="mt-0.5 text-caption text-[var(--text-secondary)]">
            Weekly management review · {periodItem ? `${periodItem.label} (${periodItem.from} → ${periodItem.to})` : data.period}
            {!data.editable && <span className="text-[var(--text-tertiary)]"> · locked (past week — root / MIS can still edit)</span>}
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Week</span>
          <select
            value={data.period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--bg-input)] px-3 py-2 text-label text-[var(--text-primary)] outline-none focus:border-[var(--color-brand-indigo)]"
          >
            {data.periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} · W{p.key.slice(-2)}{p.current ? " (current)" : ""}{filled.includes(p.key) ? " ●" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.departments.length > 1 && (
        <TabBar
          items={data.departments.map((d) => ({
            key: d.dept,
            label: d.title,
            count: d.submittedCount,
            title: `${d.submittedCount} of ${d.sectionCount} sections submitted`,
          }))}
          active={activeDept?.dept ?? ""}
          onChange={(key) => setDept(key as ReportDepartment)}
          ariaLabel="Reporting departments"
        />
      )}

      {activeDept && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-caption text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">{activeDept.title}</span>
            <span>·</span>
            <span>{activeDept.submittedCount} of {activeDept.sectionCount} sections submitted</span>
            {!activeDept.canEdit && (
              <span className="text-[var(--text-tertiary)]">
                · {caps?.isManager ? "" : "read-only for you"}
                {data.departments.length === 1 && !activeDept.canEdit ? " (management viewer)" : ""}
              </span>
            )}
            {activeDept.canEdit && !data.editable && <span className="text-[var(--color-warning)]">· week locked</span>}
          </div>

          {activeDept.sections.map((s) => (
            <Card key={s.section} padded={false} className="p-4">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="font-heading text-label font-semibold text-[var(--text-primary)]">{s.title}</h3>
                <div className="flex-1" />
                {s.entry ? (
                  <>
                    <Badge tone="success" dot>submitted</Badge>
                    {originBadge(s.entry.origin)}
                  </>
                ) : (
                  <Badge tone={activeDept.canEdit ? "warning" : "neutral"}>
                    {activeDept.canEdit ? "missing — your input needed" : "not submitted"}
                  </Badge>
                )}
              </div>
              <p className="mb-3 text-[11px] text-[var(--text-secondary)]">{s.blurb}</p>
              <EntryForm
                dept={activeDept.dept}
                section={s.section}
                period={data.period}
                entry={s.entry}
                canEdit={activeDept.canEdit && data.editable}
                onSaved={refresh}
              />
              <SectionInsight section={s} />
              {s.entry?.submittedByName && (
                <p className="mt-2 border-t border-[var(--border-card)] pt-2 text-[10px] text-[var(--text-tertiary)]">
                  Submitted by {s.entry.submittedByName} · {fmtDate(s.entry.submittedAt)}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
