"use client";

import React, { useState, useEffect, useMemo } from "react";
import ZohoEstimatesHeader from "./zoho/ZohoEstimatesHeader";
import KpiCards, { type KpiCardConfig } from "./zoho/KpiCards";
import DailyMovementTracker from "./zoho/DailyMovementTracker";
import ActiveFilters from "./zoho/ActiveFilters";
import CallingPriorityChecklist from "./zoho/CallingPriorityChecklist";
import type { FilterRule } from "./zoho/types";
import { getCommentAgeHours, getTodayDateString } from "./zoho/utils";

const KPI_FILTERS: Omit<KpiCardConfig, "count">[] = [
  { field: "satisfactory", label: "Satisfactory", negLabel: "Unsatisfactory", accent: "emerald" },
  { field: "notAnswering", label: "Not Answering", negLabel: "Answering", accent: "rose" },
  { field: "high_value", label: "High Value", negLabel: "Low Value", accent: "amber" },
  { field: "movingSlow", label: "Moving Slow", negLabel: "Moving Fast", accent: "orange" },
  { field: "underDiscussion", label: "Under Discussion", negLabel: "Not Discussed", accent: "indigo" },
  { field: "confirm", label: "Confirm Expected", negLabel: "No Confirm", accent: "violet" },
  { field: "last_comment_within_5h", label: "Comment ≤5h", negLabel: "Comment >5h", accent: "cyan" },
  { field: "last_comment_within_10h", label: "Comment ≤10h", negLabel: "Comment >10h", accent: "blue" },
  { field: "last_comment_older_5h", label: "Comment >5h", negLabel: "Comment ≤5h", accent: "teal" },
];

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

  useEffect(() => {
    setCurrentPage(1);
  }, [showClosed, filters]);

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
    } catch (e) {
      console.error("Error loading Zoho estimates:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEstimates();
    fetchBaseline();
    // Keep both in sync so an open tab sees the 01:00 AM IST reset without reloading.
    const t = setInterval(() => { fetchEstimates(); fetchBaseline(); }, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

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

  const priorityList = useMemo(() => {
    const filteredEstimates = showClosed
      ? estimates
      : estimates.filter(e => String(e.status).toLowerCase() === 'sent');

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
  }, [estimates, filters, showClosed]);

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

  const filterOptionCounts = useMemo(() => {
    const counts: Record<string, number> = {
      satisfactory: 0,
      notAnswering: 0,
      high_value: 0,
      movingSlow: 0,
      underDiscussion: 0,
      confirm: 0,
      last_comment_within_5h: 0,
      last_comment_within_10h: 0,
      last_comment_older_5h: 0
    };

    estimates.filter(e => String(e.status).toLowerCase() === 'sent').forEach(est => {
      const c = est.classification || {};

      if (c.meaningfulUpdate === true) counts.satisfactory++;
      if (c.notAnswering === "Yes") counts.notAnswering++;
      if (est.total > 80000) counts.high_value++;
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
  }, [estimates]);

  const stats = useMemo(() => {
    let totalValue = 0;
    let notAnsweringCount = 0;

    estimates.filter(e => String(e.status).toLowerCase() === 'sent').forEach((e) => {
      totalValue += e.total;
      const c = e.classification;
      if (c) {
        if (c.notAnswering === "Yes") notAnsweringCount++;
      }
    });

    return {
      totalCount: estimates.filter(e => String(e.status).toLowerCase() === 'sent').length,
      totalValue,
      notAnsweringCount
    };
  }, [estimates]);

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

  const handleKpiClick = (field: string) => {
    applyKpiFilter(field, !!kpiInverted[field]);
  };

  const handleKpiDoubleClick = (field: string) => {
    const inverted = !kpiInverted[field];
    setKpiInverted(prev => ({ ...prev, [field]: inverted }));
    applyKpiFilter(field, inverted);
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

      <KpiCards
        totalCount={stats.totalCount}
        totalValue={stats.totalValue}
        notAnsweringCount={stats.notAnsweringCount}
        kpiCards={kpiCards}
        filters={filters}
        inverted={kpiInverted}
        onCardClick={handleKpiClick}
        onCardDoubleClick={handleKpiDoubleClick}
      />

      {(baseline.length > 0 || baselineStale) && movement && (
        <DailyMovementTracker
          baselineCount={movement.baselineCount}
          baselineValue={movement.baselineValue}
          baselineDate={baselineDate}
          movement={movement}
          pending={movement.pending}
        />
      )}

      <ActiveFilters
        filters={filters}
        counts={filterOptionCounts}
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
      />
    </div>
  );
}