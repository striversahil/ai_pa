"use client";

import React, { useState, useEffect, useMemo } from "react";

export default function ZohoEstimates() {
  const [estimates, setEstimates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [filters, setFilters] = useState<any[]>([]);
  const [copiedAll, setCopiedAll] = useState<boolean>(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  const [baseline, setBaseline] = useState<any[]>([]);
  const [baselineDate, setBaselineDate] = useState<string>("");
  const [showClosed, setShowClosed] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [lastCompleteSyncAt, setLastCompleteSyncAt] = useState<string | null>(null);

  const getTodayDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Count comments received on a given date (YYYY-MM-DD) for an estimate.
  const getCommentCountForDate = (est: any, dateStr: string): number => {
    if (!est.comments || !Array.isArray(est.comments)) return 0;
    return est.comments.filter((c: any) => c && c.date === dateStr).length;
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [showClosed, filters]);

  // "Last synced" reflects the last fully-completed processing pass (all new or
  // modified estimates analyzed), not just any manual/automatic sync run.
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
    if (typeof window !== "undefined") {
      const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
      const savedBaseline = localStorage.getItem(`zoho_baseline_${todayStr}`);
      if (savedBaseline) {
        setBaseline(JSON.parse(savedBaseline));
        setBaselineDate(todayStr);
      }
    }
  }, []);

  const handleSyncEstimates = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/trigger/sales-sync?force=true", { method: "POST" });
      if (!res.ok) {
        const errorText = await res.text();
        alert(`Sync failed: ${errorText}`);
        return;
      }

      // Metadata is synced to the DB immediately on the server, before AI runs.
      // Refresh the list right away so up-to-date numbers/statuses show while the
      // background analysis is still filling in classifications.
      fetchEstimates();

      // Sync runs in the background on the server. Poll its status until it
      // finishes instead of holding the request open (which times out).
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const statusRes = await fetch("/api/trigger/sales-sync/status");
        if (!statusRes.ok) continue;
        const status = await statusRes.json();
        if (!status.running) {
          if (status.lastError) {
            alert(`Sales Copilot sync failed: ${status.lastError}`);
          } else {
            alert("Sales Copilot analysis completed successfully!");
          }
          fetchEstimates();
          return;
        }
      }
      alert("Sales Copilot sync is still running. Please refresh shortly.");
      fetchEstimates();
    } catch (e: any) {
      alert(`Sync failed: ${e.message}`);
      fetchEstimates();
    } finally {
      setIsSyncing(false);
    }
  };

  // Helper: Intent score badge colors
  const getIntentScoreBadgeClass = (score: number) => {
    if (score >= 7) return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
    if (score >= 4) return "bg-amber-500/10 text-amber-400 border border-amber-500/20";
    return "bg-rose-500/10 text-rose-400 border border-rose-500/20";
  };

  // Copy TSV for Spreadsheet
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

  // Copy active category estimates list to clipboard (without prompt)
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

      // Last comment (comments are sorted newest-first)
      const lastComment = est.comments && est.comments.length > 0 ? est.comments[0] : null;
      const lastCommentDate = lastComment
        ? (lastComment.dateFormatted || lastComment.dateDescription || lastComment.date || "Unknown date")
        : "No comments";
      const lastCommentText = lastComment?.description ? lastComment.description.trim() : "";
      const lastCommentBy = lastComment?.commentedBy ? lastComment.commentedBy : "";

      // AI timeline summary
      const summary = c.summary ? c.summary.trim() : "";

      let line = `${est.estimateNumber} - ${est.customerName} (₹${est.total.toLocaleString()}) - ${catString} - Created on: ${est.date || "Unknown"}`;
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

  // Download active category estimates list as .txt file
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

      // Last comment (comments are sorted newest-first)
      const lastComment = est.comments && est.comments.length > 0 ? est.comments[0] : null;
      const lastCommentDate = lastComment
        ? (lastComment.dateFormatted || lastComment.dateDescription || lastComment.date || "Unknown date")
        : "No comments";
      const lastCommentText = lastComment?.description ? lastComment.description.trim() : "";
      const lastCommentBy = lastComment?.commentedBy ? lastComment.commentedBy : "";

      // AI timeline summary
      const summary = c.summary ? c.summary.trim() : "";

      let line = `${est.estimateNumber} - ${est.customerName} (₹${est.total.toLocaleString()}) - ${catString} - Created on: ${est.date || "Unknown"}`;
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

  // Copy active prompt template to clipboard (with dynamic placeholder replacement)
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

  // Copy a snapshot of all computed analytics (KPIs, filter counts, today's comments) to clipboard
  const handleCopyAnalytics = () => {
    const todayStr = getTodayDateString();

    const lines: string[] = [];
    lines.push(`## Zoho Sent Estimates Analytics — ${todayStr}`);
    lines.push("");

    // Overall KPIs
    lines.push(`## Overall KPIs`);
    lines.push(`Total Sent Estimates: ${stats.totalCount}`);
    lines.push(`Total Value: ₹${stats.totalValue.toLocaleString()}`);
    lines.push(`Not Answering: ${stats.notAnsweringCount}`);
    lines.push("");

    // Filter category counts
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

    // Comments-received-today analytics
    lines.push(`## Comments Received Today`);
    lines.push(`Total Comments Today: ${commentTodayStats.totalToday}`);
    lines.push(`Estimates with Comments Today: ${commentTodayStats.estimatesWithComments.length}`);
    lines.push(`Most Active Estimates Today:`);
    commentTodayStats.mostActive.forEach((x, i) => {
      lines.push(`  ${i + 1}. ${x.estimate.estimateNumber} - ${x.estimate.customerName} (${x.todayCount} comments)`);
    });
    lines.push(`Distribution (comments per estimate):`);
    commentTodayStats.buckets.forEach((b, i) => {
      const label = i === 5 ? "5+" : String(i);
      lines.push(`  ${label}: ${b.count}`);
    });
    lines.push("");

    // Per-estimate meaningful/no-meaningful breakdown
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

  // Helper: Get age of comment in hours from formatted date string
  const getCommentAgeHours = (dateFormattedStr: string) => {
    if (!dateFormattedStr) return Infinity;
    try {
      const parts = dateFormattedStr.split(" ");
      if (parts.length < 2) return Infinity;
      const dateParts = parts[0].split("/");
      const timeParts = parts[1].split(":");
      const ampm = parts[2] ? parts[2].toUpperCase() : "";
      
      let day = parseInt(dateParts[0], 10);
      let month = parseInt(dateParts[1], 10) - 1;
      let year = parseInt(dateParts[2], 10);
      
      let hours = parseInt(timeParts[0], 10);
      let minutes = parseInt(timeParts[1], 10);
      
      if (ampm === "PM" && hours < 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
      
      const commentDate = new Date(year, month, day, hours, minutes);
      const now = new Date();
      
      return (now.getTime() - commentDate.getTime()) / (1000 * 60 * 60);
    } catch (e) {
      return Infinity;
    }
  };

  // Compute calling priority list (filtered and sorted)
  const priorityList = useMemo(() => {
    // Keep priority checklist strictly for active 'sent' estimates unless showClosed is active
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
  }, [estimates, filters]);

  // States for Prompt Customization
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

  // Load custom template from localStorage if exists, else prefill default
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

  const handlePromptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setIsPromptDirty(true);
    setCustomPrompt(e.target.value);
    if (typeof window !== "undefined") {
      localStorage.setItem("zoho_custom_prompt_template", e.target.value);
    }
  };

  // Compute daily status movements relative to the frozen baseline
  const movement = useMemo(() => {
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
      } else {
        newCreated.push(est);
      }
    });

    return {
      accepted,
      declined,
      stillPending,
      newCreated,
      baselineCount: baseline.length,
      baselineValue: baseline.reduce((sum, item) => sum + item.total, 0)
    };
  }, [estimates, baseline]);

  // Compute matching counts for each filter category
  const filterOptionCounts = useMemo(() => {
    const counts = {
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

  // Compute overall stats
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

  // Comments-received-today analytics: per-estimate today counts + distribution.
  const commentTodayStats = useMemo(() => {
    const todayStr = getTodayDateString();
    const perEstimate = estimates.map(e => ({
      estimate: e,
      todayCount: getCommentCountForDate(e, todayStr)
    }));

    const totalToday = perEstimate.reduce((sum, x) => sum + x.todayCount, 0);
    const estimatesWithComments = perEstimate.filter(x => x.todayCount > 0);
    const mostActive = [...perEstimate].sort((a, b) => b.todayCount - a.todayCount).slice(0, 5);

    // Distribution buckets: # estimates that got 0, 1, 2, 3, 4, 5+ comments today
    const buckets: { label: string; count: number }[] = [
      { label: "0", count: 0 },
      { label: "1", count: 0 },
      { label: "2", count: 0 },
      { label: "3", count: 0 },
      { label: "4", count: 0 },
      { label: "5+", count: 0 }
    ];
    perEstimate.forEach(x => {
      const c = x.todayCount;
      if (c >= 5) buckets[5].count++;
      else buckets[c].count++;
    });

    return {
      todayStr,
      totalToday,
      estimatesWithComments,
      mostActive,
      buckets
    };
  }, [estimates]);

  return (
    <div className="space-y-6 text-zinc-100 pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-zinc-800 pb-5">
        <div className="flex items-start gap-3">
          <div className="hidden sm:flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 shadow-lg shadow-indigo-500/10">
            <svg className="w-5 h-5 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17h6m-6-4h6m-6-4h6M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zm0 8V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2v-8z" /></svg>
          </div>
          <div>
            <h1 className="text-3xl font-bold font-heading tracking-tight">
              <span className="bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent">Zoho Sent Estimates</span>
            </h1>
            <p className="text-sm text-zinc-400 mt-0.5">AI classification of customer intent & follow-up efficiency from comment history</p>
            {lastSyncTimeStr && (
              <p className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Last synced: <span className="font-semibold text-zinc-400">{lastSyncTimeStr}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleCopyCategoryEstimates}
            disabled={priorityList.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50"
          >
            <span>📄</span> {copiedEstimates ? "Copied Estimates!" : "Copy Category Estimates"}
          </button>
          <button
            onClick={handleCopyAnalytics}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm transition-all duration-200 cursor-pointer"
          >
            <span>📊</span> {copiedAnalytics ? "Analytics Copied!" : "Copy Analytics"}
          </button>
          <button
            onClick={handleDownloadTXT}
            disabled={priorityList.length === 0}
            className="flex items-center justify-center px-3.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50 border-0"
            title="Download Estimates as TXT"
          >
            <span>📥</span>
          </button>
          
          {/* Copy Prompt & Popover */}
          <div className="relative inline-flex items-center rounded-lg bg-zinc-800 hover:bg-zinc-750/90 transition-all duration-200 divide-x divide-zinc-700">
            <button
              onClick={handleCopyPrompt}
              disabled={priorityList.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-l-lg text-white font-medium text-sm border-0 bg-transparent cursor-pointer disabled:opacity-50"
            >
              <span>📝</span> {copiedPrompt ? "Copied Prompt!" : "Copy Prompt"}
            </button>
            <button
              onClick={() => setIsPromptOpen(!isPromptOpen)}
              disabled={priorityList.length === 0}
              className={`flex items-center justify-center px-3 py-2 rounded-r-lg text-sm border-0 bg-transparent cursor-pointer disabled:opacity-50 ${
                isPromptOpen ? "text-indigo-400 bg-zinc-700/50" : "text-zinc-400 hover:text-white hover:bg-zinc-700/30"
              }`}
              title="Edit AI Prompt Template"
            >
              <span>⚙️</span>
            </button>

            {isPromptOpen && (
              <div className="absolute right-0 top-full mt-2 w-96 max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 p-4 space-y-3">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                  <span className="font-bold text-xs text-white uppercase tracking-wider">Edit AI Prompt Template</span>
                  <button
                    onClick={handleResetPrompt}
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 font-extrabold transition-all border-0 bg-transparent cursor-pointer"
                  >
                    Reset to Default
                  </button>
                </div>
                <textarea
                  rows={10}
                  value={customPrompt}
                  onChange={handlePromptChange}
                  className="w-full bg-zinc-950 border border-zinc-850 rounded-lg p-2.5 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed resize-y"
                  placeholder="Customize the prompt rules here..."
                />
                <div className="flex justify-end gap-2 pt-1 border-t border-zinc-850">
                  <button
                    onClick={() => setIsPromptOpen(false)}
                    className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 text-xs font-bold transition-all cursor-pointer border-0"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      handleCopyPrompt();
                      setIsPromptOpen(false);
                    }}
                    className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer border-0"
                  >
                    Save & Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleCopyTSV}
            disabled={estimates.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm transition-all duration-200 cursor-pointer disabled:opacity-50"
          >
            <span>📋</span> Copy TSV for Sheets
          </button>
          <button
            onClick={handleSyncEstimates}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-600/25 disabled:opacity-50"
          >
            <span>🔄</span> {isSyncing ? "Syncing & Analyzing..." : "Sync & Analyze Zoho"}
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="group relative overflow-hidden bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-400 block mb-1">Active Sent Estimates</span>
              <span className="text-2xl font-bold text-white block">{stats.totalCount}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-400 block mb-1">Cumulative Value</span>
              <span className="text-2xl font-bold text-white block">₹{stats.totalValue.toLocaleString()}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
        <div className="group relative overflow-hidden bg-zinc-900 border border-zinc-800/80 rounded-xl p-5 shadow-sm hover:border-rose-500/40 hover:shadow-lg hover:shadow-rose-500/5 hover:-translate-y-0.5 transition-all duration-300">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-rose-500 to-orange-500" />
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs text-zinc-400 block mb-1">Not Answering</span>
              <span className="text-2xl font-bold text-rose-400 block">{stats.notAnsweringCount}</span>
            </div>
            <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 17l-4 4m0 0l-4-4m4 4V3" /></svg>
            </div>
          </div>
        </div>
      </div>

      {/* Comments Today analytics */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-zinc-800 pb-4 mb-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30 text-sm">💬</span>
              Comments Received Today
            </h3>
            <p className="text-xs text-zinc-500 mt-1">
              On <span className="font-semibold text-zinc-400">{commentTodayStats.todayStr}</span> — {commentTodayStats.estimatesWithComments.length} of {estimates.length} estimates got comments
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 bg-zinc-950/40 px-3 py-1.5 rounded-lg border border-zinc-800">
              Total comments today: <strong className="text-cyan-400">{commentTodayStats.totalToday}</strong>
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {commentTodayStats.buckets.map((b, i) => {
            const colors = ["bg-zinc-800", "bg-cyan-500/20", "bg-emerald-500/20", "bg-amber-500/20", "bg-orange-500/20", "bg-rose-500/20"];
            const textColors = ["text-zinc-400", "text-cyan-300", "text-emerald-300", "text-amber-300", "text-orange-300", "text-rose-300"];
            const borders = ["border-zinc-800", "border-cyan-500/30", "border-emerald-500/30", "border-amber-500/30", "border-orange-500/30", "border-rose-500/30"];
            const label = b.label === "0" ? "No comments" : b.label === "1" ? "1 comment" : `${b.label} comments`;
            return (
              <div key={b.label} className={`rounded-xl border ${borders[i]} ${colors[i]} p-4 text-center transition-transform hover:-translate-y-0.5`}>
                <span className={`block text-2xl font-bold font-mono ${textColors[i]}`}>{b.count}</span>
                <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider block mt-0.5">{label}</span>
              </div>
            );
          })}
        </div>

        {commentTodayStats.mostActive.some(x => x.todayCount > 0) && (
          <div className="mt-4">
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-2">Most active today</span>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {commentTodayStats.mostActive.filter(x => x.todayCount > 0).map(x => (
                <div key={x.estimate.estimateId} className="flex items-center justify-between gap-2 bg-zinc-950/40 border border-zinc-800/80 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <span className="block text-xs font-semibold text-zinc-200 truncate">{x.estimate.customerName}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">{x.estimate.estimateNumber}</span>
                  </div>
                  <span className="text-xs font-bold text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded-full shrink-0">
                    {x.todayCount} today
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Calling Priority Checklist queue */}
      <div className="space-y-6">
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md">
            <div className="border-b border-zinc-800 pb-4 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500/20 to-orange-500/20 border border-rose-500/30 text-sm">🚨</span>
                  Calling Priority Checklist
                </h3>
                <p className="text-xs text-zinc-500 mt-1">Estimates requiring urgent calls or action items, ordered by Intent Score</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-950/40 px-3 py-1.5 rounded-lg border border-zinc-800 cursor-pointer hover:border-zinc-750 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={showClosed} 
                    onChange={(e) => setShowClosed(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-800 text-indigo-650 focus:ring-indigo-650"
                  />
                  <span>Show Closed Estimates</span>
                </label>
                <button 
                  onClick={() => {
                    const todayStr = getTodayDateString();
                    const baselineData = estimates.map(e => ({
                      estimateId: e.estimateId,
                      estimateNumber: e.estimateNumber,
                      customerName: e.customerName,
                      total: e.total,
                      status: e.status
                    }));
                  localStorage.setItem(`zoho_baseline_${todayStr}`, JSON.stringify(baselineData));
                  setBaseline(baselineData);
                  setBaselineDate(todayStr);
                  alert("📸 Today's morning baseline has been successfully frozen! Subsequent status changes will be tracked.");
                }}
                className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-lg transition-colors cursor-pointer shadow-lg shadow-violet-600/20"
              >
                📸 Freeze Baseline
              </button>
            </div>
          </div>

            {/* Daily Movement Tracker */}
            {baseline.length > 0 && movement && (
              <div className="bg-zinc-950/30 border border-zinc-800/80 rounded-xl p-4 space-y-4 mb-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-zinc-800/60 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                      <span>📈</span> Daily Status Movement Tracker
                    </h4>
                    <p className="text-[10px] text-zinc-500 mt-0.5">
                      Baseline captured: <span className="font-semibold text-zinc-400">{baselineDate}</span> ({movement.baselineCount} open, value: ₹{movement.baselineValue.toLocaleString()})
                    </p>
                  </div>
                  <button 
                    onClick={() => {
                      if (confirm("Reset today's baseline to the current state?")) {
                        const todayStr = getTodayDateString();
                        const baselineData = estimates.map(e => ({
                          estimateId: e.estimateId,
                          estimateNumber: e.estimateNumber,
                          customerName: e.customerName,
                          total: e.total,
                          status: e.status
                        }));
                        localStorage.setItem(`zoho_baseline_${todayStr}`, JSON.stringify(baselineData));
                        setBaseline(baselineData);
                        setBaselineDate(todayStr);
                      }
                    }}
                    className="px-2 py-1 text-[9px] bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white font-semibold rounded border border-zinc-800 transition-colors cursor-pointer"
                  >
                    🔄 Reset Baseline
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-zinc-900/60 border border-zinc-800 p-2.5 rounded-lg text-center">
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block">Baseline Open</span>
                    <span className="text-base font-bold text-zinc-300 font-mono mt-0.5 block">{movement.baselineCount}</span>
                  </div>
                  <div className="bg-emerald-950/10 border border-emerald-900/20 p-2.5 rounded-lg text-center">
                    <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-wider block">Accepted Today</span>
                    <span className="text-base font-bold text-emerald-400 font-mono mt-0.5 block">
                      {movement.accepted.length} <span className="text-[10px] text-zinc-500">(₹{movement.accepted.reduce((sum: number, x: any) => sum + x.total, 0).toLocaleString()})</span>
                    </span>
                  </div>
                  <div className="bg-rose-950/10 border border-rose-900/20 p-2.5 rounded-lg text-center">
                    <span className="text-[9px] text-rose-500 font-bold uppercase tracking-wider block">Declined Today</span>
                    <span className="text-base font-bold text-rose-400 font-mono mt-0.5 block">
                      {movement.declined.length} <span className="text-[10px] text-zinc-500">(₹{movement.declined.reduce((sum: number, x: any) => sum + x.total, 0).toLocaleString()})</span>
                    </span>
                  </div>
                  <div className="bg-indigo-950/10 border border-indigo-900/20 p-2.5 rounded-lg text-center">
                    <span className="text-[9px] text-indigo-500 font-bold uppercase tracking-wider block">New Estimates</span>
                    <span className="text-base font-bold text-indigo-400 font-mono mt-0.5 block">
                      {movement.newCreated.length} <span className="text-[10px] text-zinc-500">(₹{movement.newCreated.reduce((sum: number, x: any) => sum + x.total, 0).toLocaleString()})</span>
                    </span>
                  </div>
                </div>

                <div className="bg-zinc-950/40 border border-zinc-800/80 p-3 rounded-xl">
                  <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block mb-1.5">Today's Timeline Feed</span>
                  
                  {movement.accepted.length === 0 && movement.declined.length === 0 && movement.newCreated.length === 0 ? (
                    <div className="text-xs text-zinc-500 italic py-2 text-center">
                      No status transitions or new estimates detected today. Click "Sync & Analyze Zoho" to poll updates.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-36 overflow-y-auto divide-y divide-zinc-800/40 pr-1 scrollbar-thin">
                      {movement.accepted.map((est: any) => {
                        const c = est.classification || {};
                        return (
                          <div key={est.estimateId} className="py-2 border-b border-zinc-800/40 text-[11px] space-y-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 text-[8px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded font-extrabold uppercase tracking-wide">Accepted</span>
                              <span className="text-zinc-400 font-mono font-bold">{est.estimateNumber}</span>
                              <span className="text-zinc-200 font-semibold truncate max-w-[180px]">{est.customerName}</span>
                              <span className="text-zinc-400 font-mono ml-auto">₹{est.total.toLocaleString()}</span>
                            </div>
                            {c.summary && (
                              <div className="text-[10px] text-zinc-400 pl-4 italic leading-relaxed">
                                <strong>AI Summary:</strong> {c.summary}
                              </div>
                            )}
                            {c.reasoning && (
                              <div className="text-[10px] text-zinc-500 pl-4 leading-relaxed">
                                <strong>LLM Analysis:</strong> {c.reasoning}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {movement.declined.map((est: any) => {
                        const c = est.classification || {};
                        return (
                          <div key={est.estimateId} className="py-2 border-b border-zinc-800/40 text-[11px] space-y-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 text-[8px] bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded font-extrabold uppercase tracking-wide">Declined</span>
                              <span className="text-zinc-400 font-mono font-bold">{est.estimateNumber}</span>
                              <span className="text-zinc-200 font-semibold truncate max-w-[180px]">{est.customerName}</span>
                              <span className="text-zinc-400 font-mono ml-auto">₹{est.total.toLocaleString()}</span>
                            </div>
                            {c.summary && (
                              <div className="text-[10px] text-zinc-400 pl-4 italic leading-relaxed">
                                <strong>AI Summary:</strong> {c.summary}
                              </div>
                            )}
                            {c.reasoning && (
                              <div className="text-[10px] text-zinc-500 pl-4 leading-relaxed">
                                <strong>LLM Analysis:</strong> {c.reasoning}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {movement.newCreated.map((est: any) => {
                        const c = est.classification || {};
                        return (
                          <div key={est.estimateId} className="py-2 border-b border-zinc-800/40 text-[11px] space-y-1 text-left">
                            <div className="flex items-center gap-2">
                              <span className="px-1.5 py-0.5 text-[8px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded font-extrabold uppercase tracking-wide">New Created</span>
                              <span className="text-zinc-400 font-mono font-bold">{est.estimateNumber}</span>
                              <span className="text-zinc-200 font-semibold truncate max-w-[180px]">{est.customerName}</span>
                              <span className="text-zinc-400 font-mono ml-auto">₹{est.total.toLocaleString()}</span>
                            </div>
                            {c.summary && (
                              <div className="text-[10px] text-zinc-400 pl-4 italic leading-relaxed">
                                <strong>AI Summary:</strong> {c.summary}
                              </div>
                            )}
                            {c.reasoning && (
                              <div className="text-[10px] text-zinc-500 pl-4 leading-relaxed">
                                <strong>LLM Analysis:</strong> {c.reasoning}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Active Filters container */}
            <div className="mb-6 space-y-3 bg-zinc-950/40 p-4 border border-zinc-800/80 rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-400">Active Filters</span>
                <button
                  onClick={() => setFilters([...filters, { id: Date.now(), field: "notAnswering", operator: "is" }])}
                  className="px-2.5 py-1 text-xs bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 font-bold rounded-lg border border-indigo-500/20 cursor-pointer"
                >
                  ➕ Add Filter
                </button>
              </div>

              {filters.length === 0 ? (
                <div className="text-xs text-zinc-500 italic">
                  Showing all estimates: <strong>{priorityList.length} estimates</strong>. Set filter rules to customize view.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-zinc-500 mb-1">
                    Showing filtered queue: <strong>{priorityList.length} estimates</strong>
                  </div>
                  {filters.map((rule, idx) => (
                    <div key={rule.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-zinc-500 w-12 font-medium">
                        {idx === 0 ? "Where" : "And"}
                      </span>
                      <select
                        value={rule.field}
                        onChange={(e) => {
                          const updated = filters.map(f => f.id === rule.id ? { ...f, field: e.target.value } : f);
                          setFilters(updated);
                        }}
                        className="bg-zinc-900 text-zinc-200 border border-zinc-800 px-2 py-1 rounded-lg cursor-pointer"
                      >
                        <option value="satisfactory">Satisfactory (Qualified) ({filterOptionCounts.satisfactory})</option>
                        <option value="notAnswering">Not Answering ({filterOptionCounts.notAnswering})</option>
                        <option value="high_value">High Value (&gt; ₹80k) ({filterOptionCounts.high_value})</option>
                        <option value="movingSlow">Moving Slow ({filterOptionCounts.movingSlow})</option>
                        <option value="underDiscussion">Under Discussion ({filterOptionCounts.underDiscussion})</option>
                        <option value="confirm">Confirm Expected ({filterOptionCounts.confirm})</option>
                        <option value="last_comment_within_5h">Last Comment within 5 Hours ({filterOptionCounts.last_comment_within_5h})</option>
                        <option value="last_comment_within_10h">Last Comment within 10 Hours ({filterOptionCounts.last_comment_within_10h})</option>
                        <option value="last_comment_older_5h">Last Comment older than 5 Hours ({filterOptionCounts.last_comment_older_5h})</option>
                      </select>

                      <select
                        value={rule.operator}
                        onChange={(e) => {
                          const updated = filters.map(f => f.id === rule.id ? { ...f, operator: e.target.value } : f);
                          setFilters(updated);
                        }}
                        className="bg-zinc-900 text-zinc-200 border border-zinc-800 px-2 py-1 rounded-lg cursor-pointer"
                      >
                        <option value="is">is</option>
                        <option value="is_not">is not</option>
                      </select>

                      <span className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-2.5 py-1 rounded-lg font-medium">
                        {rule.field === "satisfactory" ? "Satisfactory" : rule.field === "high_value" ? "High Value" : "Yes"}
                      </span>

                      <button
                        onClick={() => setFilters(filters.filter(f => f.id !== rule.id))}
                        className="p-1 hover:text-rose-400 text-zinc-500 transition-colors ml-auto bg-transparent border-0 cursor-pointer"
                        title="Remove rule"
                      >
                        ❌
                      </button>
                    </div>
                  ))}

                  <button
                    onClick={() => setFilters([])}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 font-medium transition-colors text-left w-fit cursor-pointer bg-transparent border-0 mt-1"
                  >
                    Clear all filters (show default)
                  </button>
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="space-y-6">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="p-6 md:p-8 bg-zinc-900/30 border border-zinc-800 rounded-2xl animate-pulse space-y-4">
                    <div className="flex justify-between items-center gap-4">
                      <div className="space-y-2 flex-1">
                        <div className="h-4 w-48 bg-zinc-800 rounded-md" />
                        <div className="h-3 w-64 bg-zinc-800/70 rounded-md" />
                      </div>
                      <div className="h-6 w-24 bg-zinc-800 rounded-full" />
                    </div>
                    <div className="h-3 w-full bg-zinc-800/50 rounded-md" />
                    <div className="h-3 w-4/5 bg-zinc-800/50 rounded-md" />
                    <div className="h-20 w-full bg-zinc-800/30 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : priorityList.length === 0 ? (
              <div className="text-center py-8 text-zinc-500 text-sm">No priority calls flagged.</div>
            ) : (
              <div className="space-y-6 max-h-[900px] overflow-y-auto pr-2 scrollbar-thin">
                {(showClosed ? priorityList.slice((currentPage - 1) * 100, currentPage * 100) : priorityList).map((e) => {
                  const c = e.classification;
                  const accentClass = e.total > 80000
                    ? "from-amber-500 to-rose-500"
                    : c.underDiscussion === "Yes"
                    ? "from-indigo-500 to-violet-500"
                    : c.movingSlow === "Yes"
                    ? "from-orange-500 to-amber-500"
                    : "from-zinc-600 to-zinc-700";
                  const initials = (e.customerName || "?")
                    .split(" ")
                    .filter((p: string) => p.trim())
                    .map((p: string) => p[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase();
                  return (
                    <div
                      key={e.estimateId}
                      className="relative overflow-hidden p-6 md:p-8 bg-zinc-900/30 border border-zinc-800 rounded-2xl hover:border-zinc-700/80 hover:bg-zinc-900/50 hover:shadow-lg hover:shadow-black/20 transition-all space-y-4 shadow-sm"
                    >
                      <div className={`absolute left-0 top-6 bottom-6 w-1 rounded-r-full bg-gradient-to-b ${accentClass}`} />
                      <div className="flex flex-wrap justify-between items-center gap-4 border-b border-zinc-800/60 pb-4 pl-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/30 to-violet-500/30 border border-indigo-500/30 flex items-center justify-center text-sm font-bold text-indigo-200">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <span className="font-extrabold text-lg text-zinc-100 block tracking-tight truncate">{e.customerName}</span>
                            <div className="text-xs text-zinc-400 mt-1 flex flex-wrap items-center gap-2">
                              <span>Estimate No: <strong>{e.estimateNumber}</strong></span>
                              <span>•</span>
                              <span>Value: <strong className="text-indigo-400">₹{e.total.toLocaleString()}</strong></span>
                              <span>•</span>
                              <span>Date: <strong>{e.date}</strong></span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${
                            String(e.status).toLowerCase() === 'sent'
                              ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                              : String(e.status).toLowerCase().includes('accept') || String(e.status).toLowerCase() === 'confirmed'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}>
                            {e.status}
                          </span>
                          <span className={`text-xs font-bold px-3 py-1 rounded-full ${getIntentScoreBadgeClass(c.intentScore)}`}>
                            Intent Score: {c.intentScore}/10
                          </span>
                          <span
                            className="text-xs font-bold px-3 py-1 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700"
                            title="Comments received on this estimate today"
                          >
                            💬 {getCommentCountForDate(e, getTodayDateString())} today
                          </span>
                        </div>
                      </div>

                      {/* Chip warnings row */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {c.meaningfulUpdate ? (
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                            Meaningful Update
                          </span>
                        ) : (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                            No Meaningful Update
                          </span>
                        )}
                        {c.notAnswering === "Yes" && (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                            Not Answering
                          </span>
                        )}
                        {c.movingSlow === "Yes" && (
                          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                            Moving Slow (&gt;5d)
                          </span>
                        )}
                        {c.underDiscussion === "Yes" && (
                          <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                            Under Discussion
                          </span>
                        )}
                        {c.confirm === "Yes" && (
                          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-md animate-pulse">
                            Confirmed
                          </span>
                        )}
                      </div>

                      {/* AI Timeline Summary */}
                      {c.summary && (
                        <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-800/80 text-sm leading-relaxed text-zinc-300">
                          <strong className="text-zinc-200">AI Timeline Summary:</strong> {c.summary}
                        </div>
                      )}

                      {/* LLM Assessment card block */}
                      <div className={`p-4 rounded-xl border text-sm leading-relaxed ${!c.meaningfulUpdate ? 'bg-rose-500/10 border-rose-500/20 text-rose-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'}`}>
                        <strong>LLM Audit Assessment:</strong> {c.reasoning || "No details provided."}
                      </div>

                      {/* Comments History / Timeline section */}
                      <div className="border-t border-zinc-800/80 pt-4 mt-2 space-y-3">
                        <div className="flex justify-between items-center">
                          <h4 className="text-sm font-bold text-zinc-300">
                            Comments Timeline ({e.comments ? e.comments.length : 0})
                          </h4>
                          {e.comments && e.comments.length > 0 && (
                            <button
                              onClick={() => toggleCardComments(e.estimateId)}
                              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer"
                            >
                              {expandedCards[e.estimateId] ? "Show Summary Note" : "Show History Table"}
                            </button>
                          )}
                        </div>

                        {expandedCards[e.estimateId] ? (
                          <div className="overflow-x-auto border border-zinc-800/80 rounded-xl">
                            <table className="w-full text-left text-xs border-collapse bg-zinc-950/20">
                              <thead>
                                <tr className="border-b border-zinc-800 text-zinc-500 font-semibold bg-zinc-950/40">
                                  <th className="p-3 w-32">Date</th>
                                  <th className="p-3 w-24">Author</th>
                                  <th className="p-3">Comment Content</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-800/40">
                                {e.comments.map((comm: any) => (
                                  <tr key={comm.commentId} className="text-zinc-400 hover:text-zinc-200 transition-colors">
                                    <td className="p-3 font-mono whitespace-nowrap">{comm.dateFormatted || comm.dateDescription || comm.date}</td>
                                    <td className="p-3 font-semibold">{comm.commentedBy || 'Agent'}</td>
                                    <td className="p-3 whitespace-pre-wrap">{comm.description}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="p-3.5 bg-zinc-950/40 border border-zinc-800/60 rounded-xl space-y-2">
                            {e.comments && e.comments.length > 0 ? (
                              <>
                                <div className="flex justify-between items-center text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                                  <span>Latest Sales Remark | By: {e.comments[0].commentedBy || 'Sales Agent'}</span>
                                  <span>{e.comments[0].dateFormatted || e.comments[0].dateDescription || e.comments[0].date}</span>
                                </div>
                                <div className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                  {e.comments[0].description}
                                </div>
                              </>
                            ) : (
                              <em className="text-xs text-zinc-500 block text-center py-2">No comments logged.</em>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {showClosed && priorityList.length > 100 && (
                  <div className="flex items-center justify-between border-t border-zinc-800 pt-5 mt-4">
                    <div className="text-xs text-zinc-500">
                      Showing <strong>{(currentPage - 1) * 100 + 1}-{Math.min(currentPage * 100, priorityList.length)}</strong> of <strong>{priorityList.length}</strong> estimates
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 text-zinc-300 font-semibold rounded border border-zinc-700 transition-colors cursor-pointer"
                      >
                        ◀ Previous
                      </button>
                      <span className="text-xs font-mono text-zinc-400">
                        Page {currentPage} of {Math.ceil(priorityList.length / 100)}
                      </span>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(priorityList.length / 100), p + 1))}
                        disabled={currentPage === Math.ceil(priorityList.length / 100)}
                        className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 text-zinc-300 font-semibold rounded border border-zinc-700 transition-colors cursor-pointer"
                      >
                        Next ▶
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    );
}
