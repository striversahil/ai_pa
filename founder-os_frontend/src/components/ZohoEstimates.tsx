"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useLiveRefresh } from "@/hooks/useLiveEvents";
import ZohoEstimatesHeader from "./zoho/ZohoEstimatesHeader";
import KpiCards, { type KpiCardConfig } from "./zoho/KpiCards";
import DailyMovementTracker, { type MovementRow, type RangePreset } from "./zoho/DailyMovementTracker";
import ActiveFilters from "./zoho/ActiveFilters";
import CallingPriorityChecklist from "./zoho/CallingPriorityChecklist";
import type { FilterRule } from "./zoho/types";
import { getCommentAgeHours, getTodayDateString, istToday, istMonthStart, inDateRange, sumTotals } from "./zoho/utils";
import { orgLabel, isMultiOrg } from "./zoho/orgs";
import { REGIONS } from "@/telecalling/regions";
import { KPI_FILTERS } from "./zoho-estimates/helpers";

export default function ZohoEstimates() {
  const [estimates, setEstimates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [kpiInverted, setKpiInverted] = useState<Record<string, boolean>>({});

  const [baseline, setBaseline] = useState<any[]>([]);
  const [baselineDate, setBaselineDate] = useState<string>("");
  const [baselineStale, setBaselineStale] = useState(false);
  const [showClosed, setShowClosed] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [lastCompleteSyncAt, setLastCompleteSyncAt] = useState<string | null>(null);
  // Live Zoho Books sales orders for the range ride on /api/estimates/movement.
  // Multi-org (BUI + DPG): org ids present in the payload + the active filter.
  const [organizations, setOrganizations] = useState<string[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>("all");
  // Region scope: every KPI + estimate list + movement tile filters to it.
  // '' (Unmapped) estimates land in the UNMAPPED bucket.
  const [regionFilter, setRegionFilter] = useState<string>("all");
  // Consumer/reseller scope (same resolution as the leaderboard: rules +
  // sales-head overrides + Customer-Master exact match).
  const [segmentFilter, setSegmentFilter] = useState<string>("all");
  const [segments, setSegments] = useState<Record<string, string> | null>(null);
  // Custom movement range (default Today, matching the old "today" tiles).
  const [rangeFrom, setRangeFrom] = useState<string>(() => istToday());
  const [rangeTo, setRangeTo] = useState<string>(() => istToday());
  const [rangePreset, setRangePreset] = useState<RangePreset>("today");
  // Server-aggregated sales orders for the range (region/org scoped).
  const [soMovement, setSoMovement] = useState<{ count: number; totalValue: number; rows: any[]; byRegion?: Record<string, { count: number; totalValue: number }> } | null>(null);
  const [soLoading, setSoLoading] = useState<boolean>(false);

  useEffect(() => {
    setCurrentPage(1);
  }, [showClosed, filters, orgFilter, regionFilter, segmentFilter, rangeFrom, rangeTo]);

  // Latest scope for the movement fetch (avoids stale closures in the poll +
  // live-refresh callbacks below).
  const movementScope = useRef({ from: rangeFrom, to: rangeTo, region: regionFilter, org: orgFilter });
  movementScope.current = { from: rangeFrom, to: rangeTo, region: regionFilter, org: orgFilter };

  const fetchMovement = useCallback(async () => {
    const p = movementScope.current;
    setSoLoading(true);
    try {
      const res = await fetch(`/api/estimates/movement?from=${p.from}&to=${p.to}&region=${p.region}&org=${p.org}`);
      const data = await res.json();
      if (data?.salesOrders) setSoMovement({ ...data.salesOrders, byRegion: data.byRegion });
    } catch {
      // Movement tiles keep their last good values on a failed tick.
    } finally {
      setSoLoading(false);
    }
  }, []);

  const fetchSegments = useCallback(async () => {
    try {
      const res = await fetch("/api/estimates/segments");
      const data = await res.json();
      if (data && typeof data === "object" && !Array.isArray(data)) setSegments(data);
    } catch {
      // Segment filter stays on 'all'-equivalent (everything unclassified) on failure.
    }
  }, []);

  const lastSyncTimeStr = useMemo(() => {
    if (!lastCompleteSyncAt) return null;
    return new Date(lastCompleteSyncAt).toLocaleString();
  }, [lastCompleteSyncAt]);

  const fetchEstimates = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/estimates");
      const data = await res.json();
      setEstimates(data.estimates ?? []);
      setLastCompleteSyncAt(data.lastCompleteSyncAt ?? null);
      setOrganizations(Array.isArray(data.organizations) ? data.organizations : []);
    } catch (e) {
      console.error("Error loading Zoho estimates:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEstimates();
    fetchBaseline();
    fetchMovement();
    fetchSegments();
    // Safety-net poll; primary freshness comes from useLiveEvents below.
    const t = setInterval(() => { fetchEstimates(); fetchBaseline(); fetchMovement(); fetchSegments(); }, 15 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchMovement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeFrom, rangeTo, regionFilter, orgFilter]);

  useLiveRefresh(
    (event) => event.type === "estimates" || event.type === "baseline" || event.type === "automation",
    () => { fetchEstimates(); fetchBaseline(); fetchMovement(); fetchSegments(); },
  );

  const fetchBaseline = async () => {
    try {
      const res = await fetch("/api/estimates/baseline");
      const data = await res.json();
      if (data.isStale) {
        // Today's freeze hasn't run yet (before 01:00 AM IST) — show a clean day-start
        // state instead of yesterday's accumulated movement.
        setBaseline([]);
        setBaselineStale(true);
        setBaselineDate(data.date ?? "");
      } else if (data.baseline && data.baseline.length > 0) {
        setBaseline(data.baseline);
        setBaselineStale(false);
        setBaselineDate(data.date);
      }
    } catch (e) {
      console.error("Error loading shared baseline:", e);
    }
  };

  const handleCopyTSV = () => {
    if (estimates.length === 0) {
      alert("No data available to copy.");
      return;
    }

    const escapeTSV = (val: any) => {
      if (val === undefined || val === null) return "";
      return val.toString().replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
    };

    const headers = [
      "Estimate Number",
      "Customer Name",
      "Sales Agent",
      "Total Amount",
      "Created Date",
      "Intent Score",
      "Reasoning",
      "Meaningful Update?",
      "Not Answering?",
      "Latest Zoho Comment"
    ];

    const rows = estimates.map((e) => {
      const c = e.classification || {};
      const latestComment = e.comments && e.comments[0];
      const commentStr = latestComment ? `[${latestComment.date}] ${latestComment.commentedBy || 'Agent'}: ${latestComment.description}` : "No comments logged.";
      return [
        e.estimateNumber,
        e.customerName,
        c.salesAgent || "Unassigned",
        e.total,
        e.date,
        c.intentScore || 0,
        c.reasoning || "No comments review log.",
        c.meaningfulUpdate ? "Yes" : "No",
        c.notAnswering || "No",
        commentStr
      ].map(escapeTSV).join("\t");
    });

    const tsvContent = [headers.join("\t"), ...rows].join("\n");
    navigator.clipboard.writeText(tsvContent)
      .then(() => alert("Zoho estimates analysis copied as TSV! Paste directly into Excel or Google Sheets."))
      .catch((err) => alert("Failed to copy data: " + err));
  };

  const handleCopyCategoryEstimates = () => {
    if (priorityList.length === 0) {
      alert("No estimates in the active list to copy.");
      return;
    }

    const estimatesText = priorityList.map(est => {
      const activeCats: string[] = [];
      const c = est.classification || {};

      if (c.meaningfulUpdate) activeCats.push("Meaningful Update");
      if (!c.meaningfulUpdate) activeCats.push("No Meaningful Update");
      if (c.notAnswering === "Yes") activeCats.push("Not Answering");
      if (est.total > 80000) activeCats.push("High Value");
      if (est.total > 50000) activeCats.push("Above ₹50k");
      if (c.movingSlow === "Yes") activeCats.push("Moving Slow (>5d)");
      if (c.underDiscussion === "Yes") activeCats.push("Under Discussion");
      if (c.confirm === "Yes") activeCats.push("Confirmed");

      const catString = activeCats.join(", ") || "Unclassified";

      const lastComment = est.comments && est.comments.length > 0 ? est.comments[0] : null;
      const lastCommentDate = lastComment
        ? (lastComment.dateFormatted || lastComment.dateDescription || lastComment.date || "Unknown date")
        : "No comments";
      const lastCommentText = lastComment?.description ? lastComment.description.trim() : "";
      const lastCommentBy = lastComment?.commentedBy ? lastComment.commentedBy : "";

      const summary = c.summary ? c.summary.trim() : "";

      let line = `${est.estimateNumber} - ${est.customerName} [Agent: ${c.salesAgent || "Unassigned"}] (₹${est.total.toLocaleString()}) - ${catString} - Created on: ${est.date || "Unknown"}`;
      line += `\n  Last Comment [${lastCommentDate}]${lastCommentBy ? ` by ${lastCommentBy}` : ""}:`;
      line += `\n  "${lastCommentText || "No comment text"}"`;
      line += `\n  Audit: ${c.reasoning || "No review details."}`;
      if (summary) {
        line += `\n  Summary: ${summary}`;
      }
      return line;
    }).join("\n\n");

    const textToCopy = `## Estimates:\n\n${estimatesText}`;

    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        setCopiedEstimates(true);
        setTimeout(() => setCopiedEstimates(false), 2000);
      })
      .catch(err => {
        console.error("Failed to copy estimates: ", err);
      });
  };

  const handleDownloadTXT = () => {
    if (priorityList.length === 0) {
      alert("No estimates in the active list to download.");
      return;
    }

    const estimatesText = priorityList.map(est => {
      const activeCats: string[] = [];
      const c = est.classification || {};

      if (c.meaningfulUpdate) activeCats.push("Meaningful Update");
      if (!c.meaningfulUpdate) activeCats.push("No Meaningful Update");
      if (c.notAnswering === "Yes") activeCats.push("Not Answering");
      if (est.total > 80000) activeCats.push("High Value");
      if (est.total > 50000) activeCats.push("Above ₹50k");
      if (c.movingSlow === "Yes") activeCats.push("Moving Slow (>5d)");
      if (c.underDiscussion === "Yes") activeCats.push("Under Discussion");
      if (c.confirm === "Yes") activeCats.push("Confirmed");

      const catString = activeCats.join(", ") || "Unclassified";

      const lastComment = est.comments && est.comments.length > 0 ? est.comments[0] : null;
      const lastCommentDate = lastComment
        ? (lastComment.dateFormatted || lastComment.dateDescription || lastComment.date || "Unknown date")
        : "No comments";
      const lastCommentText = lastComment?.description ? lastComment.description.trim() : "";
      const lastCommentBy = lastComment?.commentedBy ? lastComment.commentedBy : "";

      const summary = c.summary ? c.summary.trim() : "";

      let line = `${est.estimateNumber} - ${est.customerName} [Agent: ${c.salesAgent || "Unassigned"}] (₹${est.total.toLocaleString()}) - ${catString} - Created on: ${est.date || "Unknown"}`;
      line += `\n  Last Comment [${lastCommentDate}]${lastCommentBy ? ` by ${lastCommentBy}` : ""}:`;
      line += `\n  "${lastCommentText || "No comment text"}"`;
      line += `\n  Audit: ${c.reasoning || "No review details."}`;
      if (summary) {
        line += `\n  Summary: ${summary}`;
      }
      return line;
    }).join("\n\n");

    const textToSave = `## Estimates:\n\n${estimatesText}`;
    const blob = new Blob([textToSave], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const todayStr = getTodayDateString();
    link.download = `zoho_estimates_audit_${todayStr}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyPrompt = () => {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const d = new Date();
    const formattedDate = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    const todayDay = days[d.getDay()];

    const parsedPrompt = customPrompt
      .replace(/\{\{TODAY_DATE\}\}/g, formattedDate)
      .replace(/\{\{TODAY_DAY\}\}/g, todayDay)
      .replace(/\{\{TOTAL_ESTIMATES\}\}/g, String(priorityList.length));

    navigator.clipboard.writeText(parsedPrompt)
      .then(() => {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 2000);
      })
      .catch(err => {
        console.error("Failed to copy prompt: ", err);
      });
  };

  const handleCopyAnalytics = () => {
    const todayStr = getTodayDateString();

    const lines: string[] = [];
    lines.push(`## Zoho Sent Estimates Analytics — ${todayStr}`);
    lines.push("");

    lines.push(`## Overall KPIs`);
    lines.push(`Total Sent Estimates: ${stats.totalCount}`);
    lines.push(`Total Value: ₹${stats.totalValue.toLocaleString()}`);
    lines.push(`Not Answering: ${stats.notAnsweringCount}`);
    lines.push("");

    lines.push(`## Category Counts`);
    lines.push(`Meaningful Update: ${filterOptionCounts.satisfactory}`);
    lines.push(`No Meaningful Update: ${stats.totalCount - filterOptionCounts.satisfactory}`);
    lines.push(`Not Answering: ${filterOptionCounts.notAnswering}`);
    lines.push(`High Value (₹80k+): ${filterOptionCounts.high_value}`);
    lines.push(`Above ₹50k: ${filterOptionCounts.value_above_50k}`);
    lines.push(`Moving Slow (>5d): ${filterOptionCounts.movingSlow}`);
    lines.push(`Under Discussion: ${filterOptionCounts.underDiscussion}`);
    lines.push(`Confirmed: ${filterOptionCounts.confirm}`);
    lines.push(`Last Comment ≤5h: ${filterOptionCounts.last_comment_within_5h}`);
    lines.push(`Last Comment ≤10h: ${filterOptionCounts.last_comment_within_10h}`);
    lines.push(`Last Comment >5h: ${filterOptionCounts.last_comment_older_5h}`);
    lines.push("");

    const meaningfulEstimates = priorityList.filter(est => est.classification && est.classification.meaningfulUpdate);
    const noMeaningfulEstimates = priorityList.filter(est => !(est.classification && est.classification.meaningfulUpdate));
    lines.push(`## Meaningful Update Breakdown`);
    lines.push(`Meaningful Updates: ${meaningfulEstimates.length}`);
    lines.push(`No Meaningful Update: ${noMeaningfulEstimates.length}`);

    const textToCopy = lines.join("\n");

    navigator.clipboard.writeText(textToCopy)
      .then(() => {
        setCopiedAnalytics(true);
        setTimeout(() => setCopiedAnalytics(false), 2000);
      })
      .catch(err => {
        console.error("Failed to copy analytics: ", err);
      });
  };

  const toggleCardComments = (estId: string) => {
    setExpandedCards(prev => ({
      ...prev,
      [estId]: !prev[estId]
    }));
  };

  // Scope: org × region. One filtered list drives the checklist, KPI cards,
  // counts and movement tiles together — 'all' keeps the merged view.
  const isLiveEstimate = (e: any): boolean => String(e?.status ?? "").toLowerCase() === "sent";
  const bucketOfEstimate = (e: any): string => String(e?.region ?? "").trim().toUpperCase() || "UNMAPPED";
  // Consumer/reseller bucket ('' = Unclassified until the segments fetch lands).
  const segOfEstimate = (e: any): string => String(segments?.[(e as any)?.estimateId] ?? "") || "unset";
  const orgScopedEstimates = useMemo(() => (
    orgFilter === "all"
      ? estimates
      : estimates.filter(e => String(e.organizationId ?? "") === orgFilter)
  ), [estimates, orgFilter]);
  const scopedEstimates = useMemo(() => {
    const byRegion = regionFilter === "all"
      ? orgScopedEstimates
      : orgScopedEstimates.filter(e => bucketOfEstimate(e) === regionFilter);
    if (segmentFilter === "all") return byRegion;
    return byRegion.filter(e => segOfEstimate(e) === segmentFilter);
  }, [orgScopedEstimates, regionFilter, segmentFilter, segments]);

  // Range-scoped estimate movements (client-side: payload already carries
  // date/declinedAt). New = created in range AND still sent.
  const rangeMovements = useMemo(() => {
    const declined = scopedEstimates.filter(e => inDateRange((e as any)?.declinedAt, rangeFrom, rangeTo));
    const created = scopedEstimates.filter(e => String(e.status).toLowerCase() === "sent" && inDateRange((e as any)?.date, rangeFrom, rangeTo));
    return { declined, created };
  }, [scopedEstimates, rangeFrom, rangeTo]);

  // Region pill counts (org scope, region NOT applied — stays stable while
  // filtering). Live (sent) estimates only, matching the KPI cards.
  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = { R1: 0, R2: 0, R3: 0, R4: 0, UNMAPPED: 0 };
    for (const e of orgScopedEstimates) {
      if (!isLiveEstimate(e)) continue;
      counts[bucketOfEstimate(e)] = (counts[bucketOfEstimate(e)] ?? 0) + 1;
    }
    return counts;
  }, [orgScopedEstimates]);

  const liveOrgScopedCount = useMemo(() => orgScopedEstimates.filter(isLiveEstimate).length, [orgScopedEstimates]);

  // Type pill counts (org × region scope, type NOT applied — stays stable while
  // filtering). Live (sent) estimates only, matching the KPI cards.
  const segmentCounts = useMemo(() => {
    const counts: Record<string, number> = { consumer: 0, reseller: 0, unset: 0 };
    const base = regionFilter === "all"
      ? orgScopedEstimates
      : orgScopedEstimates.filter(e => bucketOfEstimate(e) === regionFilter);
    for (const e of base) {
      if (!isLiveEstimate(e)) continue;
      const s = segOfEstimate(e);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [orgScopedEstimates, regionFilter, segments]);

  const liveBaseCount = useMemo(() => {
    const base = regionFilter === "all"
      ? orgScopedEstimates
      : orgScopedEstimates.filter(e => bucketOfEstimate(e) === regionFilter);
    return base.filter(isLiveEstimate).length;
  }, [orgScopedEstimates, regionFilter]);

  const applyPreset = (p: Exclude<RangePreset, "custom">) => {
    const today = istToday();
    if (p === "today") { setRangeFrom(today); setRangeTo(today); }
    else if (p === "week") { const d = new Date(Date.now() - 6 * 86400000 + 5.5 * 3600 * 1000); setRangeFrom(d.toISOString().slice(0, 10)); setRangeTo(today); }
    else if (p === "days30") { const d = new Date(Date.now() - 29 * 86400000 + 5.5 * 3600 * 1000); setRangeFrom(d.toISOString().slice(0, 10)); setRangeTo(today); }
    else { setRangeFrom(istMonthStart()); setRangeTo(today); }
    setRangePreset(p);
    setCurrentPage(1);
  };

  const rangeTiles = useMemo(() => ({
    salesOrders: { count: soMovement?.count ?? 0, totalValue: soMovement?.totalValue ?? 0 },
    declined: { count: rangeMovements.declined.length, totalValue: sumTotals(rangeMovements.declined) },
    newEstimates: { count: rangeMovements.created.length, totalValue: sumTotals(rangeMovements.created) },
  }), [soMovement, rangeMovements]);

  const movementRows = useMemo<MovementRow[]>(() => {
    const rows: MovementRow[] = [];
    for (const o of soMovement?.rows ?? []) {
      rows.push({
        kind: "so", key: `so-${o.so || o.customer}-${o.createdDate}`,
        badge: "Sales Order", badgeCls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        primary: String(o.so || "SO"), customer: String(o.customer || ""),
        total: Number(o.total) || 0, meta: String(o.ref ? `↳ ${o.ref}` : o.createdDate || ""),
      });
    }
    const estRow = (est: any, kind: MovementRow["kind"], badge: string, badgeCls: string): MovementRow => {
      const c = est.classification || {};
      const lines: string[] = [];
      if (c.summary) lines.push(`AI Summary: ${c.summary}`);
      if (c.reasoning) lines.push(`LLM Analysis: ${c.reasoning}`);
      return {
        kind, key: `${kind}-${est.estimateId}`,
        badge, badgeCls, primary: String(est.estimateNumber || ""),
        customer: String(est.customerName || ""), total: Number(est.total) || 0,
        meta: String(est.date || "").slice(0, 10), lines,
      };
    };
    for (const est of rangeMovements.declined) rows.push(estRow(est, "declined", "Declined", "bg-rose-500/10 text-rose-400 border-rose-500/20"));
    for (const est of rangeMovements.created) rows.push(estRow(est, "new", "New Created", "bg-indigo-500/10 text-indigo-400 border-indigo-500/20"));
    return rows;
  }, [soMovement, rangeMovements]);

  const priorityList = useMemo(() => {
    const filteredEstimates = showClosed
      ? scopedEstimates
      : scopedEstimates.filter(e => String(e.status).toLowerCase() === 'sent');

    let items = filteredEstimates.map((e) => {
      if (!e.classification) {
        return {
          ...e,
          classification: {
            intentScore: 0,
            reasoning: "Classification pending / rate-limited. Click Sync & Analyze Zoho to retry sync.",
            meaningfulUpdate: false,
            notAnswering: "No",
            movingSlow: "No",
            underDiscussion: "No",
            confirm: "No"
          }
        };
      }
      return e;
    });

    if (filters.length > 0) {
      items = items.filter(est => {
        return filters.every(rule => {
          let estValue = false;
          const c = est.classification || {};

          if (rule.field === "satisfactory") {
            estValue = c.meaningfulUpdate === true;
          } else if (rule.field === "high_value") {
            estValue = est.total > 80000;
          } else if (rule.field === "value_above_50k") {
            estValue = est.total > 50000;
          } else if (rule.field === "last_comment_within_5h") {
            const latest = est.comments && est.comments[0];
            const age = (latest && latest.dateFormatted) ? getCommentAgeHours(latest.dateFormatted) : Infinity;
            estValue = age <= 5;
          } else if (rule.field === "last_comment_within_10h") {
            const latest = est.comments && est.comments[0];
            const age = (latest && latest.dateFormatted) ? getCommentAgeHours(latest.dateFormatted) : Infinity;
            estValue = age <= 10;
          } else if (rule.field === "last_comment_older_5h") {
            const latest = est.comments && est.comments[0];
            const age = (latest && latest.dateFormatted) ? getCommentAgeHours(latest.dateFormatted) : Infinity;
            estValue = age > 5;
          } else {
            estValue = c[rule.field] === "Yes";
          }

          if (rule.operator === "is") {
            return estValue === true;
          } else {
            return estValue === false;
          }
        });
      });
    }

    const getSortGroup = (x: any) => {
      const c = x.classification || {};
      if (x.total > 80000) return 1;
      if (c.underDiscussion === "Yes") return 2;
      if (c.movingSlow === "Yes") return 3;
      return 4;
    };

    return [...items].sort((a, b) => {
      const groupA = getSortGroup(a);
      const groupB = getSortGroup(b);

      if (groupA !== groupB) {
        return groupA - groupB;
      }

      const scoreA = a.classification.intentScore || 0;
      const scoreB = b.classification.intentScore || 0;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }

      return b.total - a.total;
    });
  }, [scopedEstimates, filters, showClosed]);

  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isPromptDirty, setIsPromptDirty] = useState<boolean>(false);
  const [isPromptOpen, setIsPromptOpen] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [copiedEstimates, setCopiedEstimates] = useState<boolean>(false);
  const [copiedAnalytics, setCopiedAnalytics] = useState<boolean>(false);

  const defaultPromptTemplate = `## Role
You are a senior sales operations analyst reviewing Zoho CRM/Books comments to build a same-day, priority-ranked call list for the sales team.
## Context
Today's date: {{TODAY_DATE}} {{TODAY_DAY}}
Use this to judge "overdue," "delay," and "recent" — do not assume.
## Task
Analyze every estimate provided below and produce a single, fully-sorted priority call list — highest priority to call first.
## Step 1 — Analyze each estimate (internal reasoning, do this before sorting)
For every estimate, evaluate:
- Latest internal comment + what it signals
- Follow-up history and any gaps/delays (using today's date)
- Customer responses / questions asked
- Deal stage and urgency
- Purchase intent (explicit vs implied)
- Risk of losing the order
- Expected order value (if stated — never estimate or invent one)
If the comments don't give enough signal to judge urgency, mark that estimate as:
"Insufficient information to determine urgency" — and still include it in the final list at 🟢 Low priority (do not drop it).
## Step 2 — Assign priority tier
🔴 Critical — customer is actively waiting on us, hot buying signal, or imminent risk of losing the order
🟠 High — strong intent or overdue follow-up, not yet at risk of loss
🟡 Medium — engaged but no urgency signal / early-stage discussion
🟢 Low — asked to be contacted later, closed/converted, no current intent, or insufficient info
Tie-break logic when signals conflict:
1. "Customer waiting on us" always outranks "high value" alone.
2. Risk-of-loss outranks stage/value.
3. Higher value only breaks ties between estimates in the same tier.
## Step 3 — Sort
Order all estimates highest → lowest priority. Within the same tier, most urgent/time-sensitive first.
## Step 4 — Self-check before responding
Count the estimates you were given vs. the estimates in your output. They must match exactly. If any are missing, add them before finalizing.
## Output format (WhatsApp-ready, use for every estimate, no exceptions)
📞 PRIORITY CALL LIST
Total estimates: {{TOTAL_ESTIMATES}}
1️⃣ EST-XXXXX | Customer Name
🔴 Critical
Reason: (max 2–3 lines, grounded only in the comments provided — never invented)
Why call now?: (one motivating line)
Action: (single clear objective — close order / clarify doubts / send revised quote / negotiate / revive lead / collect feedback)
────────────────────
## Hard rules
- Cover every single estimate provided — zero exceptions, verify via Step 4.
- Never hallucinate value, intent, or comments not present in the data.
- Keep reasons factual and concise — 2–3 lines max.
- Prioritize by conversion probability + urgency + engagement — not estimate value alone.`;

  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("zoho_custom_prompt_template");
      if (saved) {
        setCustomPrompt(saved);
        setIsPromptDirty(true);
      } else {
        setCustomPrompt(defaultPromptTemplate);
      }
    }
  }, []);

  const handleResetPrompt = () => {
    setIsPromptDirty(false);
    setCustomPrompt(defaultPromptTemplate);
    if (typeof window !== "undefined") {
      localStorage.removeItem("zoho_custom_prompt_template");
    }
  };

  const handlePromptChange = (value: string) => {
    setIsPromptDirty(true);
    setCustomPrompt(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("zoho_custom_prompt_template", value);
    }
  };

  const movement = useMemo(() => {
    if (baselineStale) {
      return { accepted: [], declined: [], stillPending: [], newCreated: [], baselineCount: 0, baselineValue: 0, pending: true };
    }
    if (baseline.length === 0) return null;

    const accepted: any[] = [];
    const declined: any[] = [];
    const stillPending: any[] = [];
    const newCreated: any[] = [];

    const baselineMap = new Map(baseline.map(b => [b.estimateId, b]));

    estimates.forEach(est => {
      const baseItem = baselineMap.get(est.estimateId);
      if (baseItem) {
        if (est.status !== baseItem.status) {
          const newStatus = String(est.status).toLowerCase();
          if (newStatus.includes("accept") || newStatus === "accepted") {
            accepted.push(est);
          } else if (newStatus.includes("decline") || newStatus === "declined" || newStatus === "void" || newStatus === "cancelled") {
            declined.push(est);
          }
        } else {
          if (String(est.status).toLowerCase() === "sent") {
            stillPending.push(est);
          }
        }
      } else if (String(est.status).toLowerCase() === "sent") {
        // Genuinely created/sent after the baseline froze.
        newCreated.push(est);
      }
      // else: historical accepted/declined estimates were never part of any
      // baseline snapshot — they are NOT today's movement, skip them.
    });

    return {
      accepted,
      declined,
      stillPending,
      newCreated,
      baselineCount: baseline.length,
      baselineValue: baseline.reduce((sum, item) => sum + item.total, 0),
      pending: false
    };
  }, [estimates, baseline, baselineStale]);

  const isTodayRange = rangeFrom === istToday() && rangeTo === istToday();
  const movementCaption = isTodayRange
    ? (baselineStale
      ? "⏳ New day started — waiting for the 01:00 AM IST baseline freeze. Counters reset to 0 then."
      : `Baseline captured: ${baselineDate || "—"} (${movement?.baselineCount ?? 0} open, value: ₹${(movement?.baselineValue ?? 0).toLocaleString()}) — auto-frozen at 01:00 AM IST`)
    : `Range: ${rangeFrom} → ${rangeTo} · declined stamps the lost day, new = still sent`;

  const filterOptionCounts = useMemo(() => {
    const counts: Record<string, number> = {
      satisfactory: 0,
      notAnswering: 0,
      high_value: 0,
      value_above_50k: 0,
      movingSlow: 0,
      underDiscussion: 0,
      confirm: 0,
      last_comment_within_5h: 0,
      last_comment_within_10h: 0,
      last_comment_older_5h: 0
    };

    scopedEstimates.filter(e => String(e.status).toLowerCase() === 'sent').forEach(est => {
      const c = est.classification || {};

      if (c.meaningfulUpdate === true) counts.satisfactory++;
      if (c.notAnswering === "Yes") counts.notAnswering++;
      if (est.total > 80000) counts.high_value++;
      if (est.total > 50000) counts.value_above_50k++;
      if (c.movingSlow === "Yes") counts.movingSlow++;
      if (c.underDiscussion === "Yes") counts.underDiscussion++;
      if (c.confirm === "Yes") counts.confirm++;

      const latest = est.comments && est.comments[0];
      const age = (latest && latest.dateFormatted) ? getCommentAgeHours(latest.dateFormatted) : Infinity;
      if (age <= 5) counts.last_comment_within_5h++;
      if (age <= 10) counts.last_comment_within_10h++;
      if (age > 5) counts.last_comment_older_5h++;
    });

    return counts;
  }, [scopedEstimates]);

  const stats = useMemo(() => {
    let totalValue = 0;
    let notAnsweringCount = 0;

    scopedEstimates.filter(e => String(e.status).toLowerCase() === 'sent').forEach((e) => {
      totalValue += e.total;
      const c = e.classification;
      if (c) {
        if (c.notAnswering === "Yes") notAnsweringCount++;
      }
    });

    return {
      totalCount: scopedEstimates.filter(e => String(e.status).toLowerCase() === 'sent').length,
      totalValue,
      notAnsweringCount
    };
  }, [scopedEstimates]);

  const applyKpiFilter = (field: string, inverted: boolean) => {
    const operator: "is" | "is_not" = inverted ? "is_not" : "is";
    setFilters(prev => {
      const existing = prev.find(f => f.field === field);
      if (existing && existing.operator === operator) {
        return prev.filter(f => f.field !== field);
      }
      if (existing) {
        return prev.map(f => (f.field === field ? { ...f, operator } : f));
      }
      return [...prev, { id: Date.now(), field, operator }];
    });
  };

  // Single-click cycle: inactive → active (normal) → active (reversed) → inactive.
  const handleKpiClick = (field: string) => {
    const isActive = filters.some((f) => f.field === field);
    const inv = !!kpiInverted[field];
    if (!isActive) {
      setKpiInverted((prev) => ({ ...prev, [field]: false }));
      applyKpiFilter(field, false);
    } else if (!inv) {
      setKpiInverted((prev) => ({ ...prev, [field]: true }));
      applyKpiFilter(field, true);
    } else {
      setKpiInverted((prev) => ({ ...prev, [field]: false }));
      applyKpiFilter(field, true); // operator matches → removes the filter
    }
  };

  const kpiCards: KpiCardConfig[] = KPI_FILTERS.map(k => ({
    ...k,
    count: filterOptionCounts[k.field] ?? 0,
  }));

  return (
    <div className="space-y-6 text-zinc-900 dark:text-zinc-100">
      <ZohoEstimatesHeader
        lastSyncTimeStr={lastSyncTimeStr}
        hasEstimates={estimates.length > 0}
        hasPriority={priorityList.length > 0}
        copiedEstimates={copiedEstimates}
        copiedAnalytics={copiedAnalytics}
        copiedPrompt={copiedPrompt}
        isPromptOpen={isPromptOpen}
        customPrompt={customPrompt}
        onCopyEstimates={handleCopyCategoryEstimates}
        onCopyAnalytics={handleCopyAnalytics}
        onDownloadTXT={handleDownloadTXT}
        onCopyTSV={handleCopyTSV}
        onCopyPrompt={handleCopyPrompt}
        onTogglePrompt={() => setIsPromptOpen(!isPromptOpen)}
        onResetPrompt={handleResetPrompt}
        onPromptChange={handlePromptChange}
        onClosePrompt={() => setIsPromptOpen(false)}
      />

      {/* Scope bar: organization + region + type sit on top so no scroll is
          needed to activate a filter. All three feed every KPI, list and
          movement tile. */}
      <div className="space-y-2">
        {isMultiOrg(organizations) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Organization</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setOrgFilter("all")}
                className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${orgFilter === "all" ? "bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border-indigo-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
              >
                All ({estimates.filter(isLiveEstimate).length})
              </button>
              {organizations.map((org) => {
                const n = estimates.filter(e => String(e.organizationId ?? "") === org && isLiveEstimate(e)).length;
                const active = orgFilter === org;
                return (
                  <button
                    key={org}
                    onClick={() => setOrgFilter(active ? "all" : org)}
                    title={org}
                    className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${active ? "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
                  >
                    {orgLabel(org, organizations)} ({n})
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Region</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setRegionFilter("all")}
              className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${regionFilter === "all" ? "bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border-indigo-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
            >
              All regions ({liveOrgScopedCount})
            </button>
            {REGIONS.map((r) => {
              const active = regionFilter === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setRegionFilter(active ? "all" : r.id)}
                  title={r.name}
                  className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${active ? "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
                >
                  {r.id} · {r.name.replace(" Region", "")} ({regionCounts[r.id] ?? 0})
                </button>
              );
            })}
            <button
              onClick={() => setRegionFilter(regionFilter === "UNMAPPED" ? "all" : "UNMAPPED")}
              title="Estimates with no mapped region"
              className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${regionFilter === "UNMAPPED" ? "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
            >
              Unmapped ({regionCounts.UNMAPPED ?? 0})
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Type</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSegmentFilter("all")}
              className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${segmentFilter === "all" ? "bg-indigo-500/15 text-indigo-500 dark:text-indigo-300 border-indigo-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
            >
              All ({liveBaseCount})
            </button>
            {([
              { id: "consumer", label: "End consumer" },
              { id: "reseller", label: "Reseller" },
              { id: "unset", label: "Unclassified" },
            ] as const).map((t) => {
              const active = segmentFilter === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSegmentFilter(active ? "all" : t.id)}
                  className={`px-3 py-1.5 rounded-full border font-bold transition-colors cursor-pointer ${active ? "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/40" : "bg-zinc-100/60 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 border-zinc-300/60 dark:border-zinc-700/60"}`}
                >
                  {t.label} ({segmentCounts[t.id] ?? 0})
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <KpiCards
        totalCount={stats.totalCount}
        totalValue={stats.totalValue}
        notAnsweringCount={stats.notAnsweringCount}
        kpiCards={kpiCards}
        filters={filters}
        inverted={kpiInverted}
        onCardClick={handleKpiClick}
      />

      <DailyMovementTracker
        from={rangeFrom}
        to={rangeTo}
        preset={rangePreset}
        onFromChange={(v) => { setRangeFrom(v); setRangePreset("custom"); setCurrentPage(1); }}
        onToChange={(v) => { setRangeTo(v); setRangePreset("custom"); setCurrentPage(1); }}
        onPreset={applyPreset}
        tiles={rangeTiles}
        rows={movementRows}
        caption={movementCaption}
        captionPending={isTodayRange && baselineStale}
        loading={soLoading}
      />

      <ActiveFilters
        filters={filters}
        resultCount={priorityList.length}
        onAdd={() => setFilters([...filters, { id: Date.now(), field: "notAnswering", operator: "is" }])}
        onUpdate={(id, patch) => setFilters(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)))}
        onRemove={(id) => setFilters(prev => prev.filter(f => f.id !== id))}
        onClear={() => setFilters([])}
      />

      <CallingPriorityChecklist
        isLoading={isLoading}
        priorityList={priorityList}
        showClosed={showClosed}
        currentPage={currentPage}
        expandedCards={expandedCards}
        onToggleShowClosed={() => setShowClosed(prev => !prev)}
        onToggleComments={toggleCardComments}
        onPageChange={setCurrentPage}
        getOrgLabel={(orgId) => (isMultiOrg(organizations) ? orgLabel(orgId, organizations) : null)}
      />
    </div>
  );
}
