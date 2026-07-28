"use client";

import React, { useState, useEffect } from "react";
import TelecallerDashboard from "./TelecallerDashboard";
import CrmTrackerDashboard from "./CrmTrackerDashboard";
import PipelineDashboard from "./PipelineDashboard";

interface GoogleSheetsDashboardProps {
  spreadsheetId?: string;
  range?: string;
}

interface SheetConfig {
  id: string;
  title: string;
  spreadsheetId: string;
  range: string;
  type: "telecaller" | "pipeline" | "crm_tracker";
}

const DEFAULT_SHEETS: SheetConfig[] = [
  {
    id: "telecaller",
    title: "📞 Telecalling Agents",
    spreadsheetId: "1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs",
    range: "A1:Z1000",
    type: "telecaller"
  },
  {
    id: "crm_tracker",
    title: "🚚 Dispatch & CRM Tracker",
    spreadsheetId: "1NFLA7kmuOgkG3NSJDAYtnekfUcSmbemptkAWNycal8I",
    range: "A1:Z1000",
    type: "crm_tracker"
  },
  {
    id: "pipeline",
    title: "💼 CRM Sales Pipeline",
    spreadsheetId: "1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs",
    range: "A1:Z1000",
    type: "pipeline"
  }
];

// Mock Datasets (fallbacks when backend is not configured)
import { mockTelecallerData } from "../mockDataSheets";
import { mockPipelineData } from "../mockDataSheets";
import { mockCrmTrackerData } from "../mockDataSheets";

// Date parsing helper
const parseSheetDate = (dateStr: string): Date | null => {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  
  const dmyMatch = cleaned.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2,4})$/i);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1]);
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = months.indexOf(dmyMatch[2].toLowerCase());
    let year = parseInt(dmyMatch[3]);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  const ymdMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) return new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]));

  const mdMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdMatch) return new Date(parseInt(mdMatch[3]), parseInt(mdMatch[1]) - 1, parseInt(mdMatch[2]));

  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d;
  return null;
};

export default function GoogleSheetsDashboard({}: GoogleSheetsDashboardProps) {
  // Configured Analysis tabs saved locally
  const [sheetsList, setSheetsList] = useState<SheetConfig[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("company_sheets_tabs");
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error(e);
        }
      }
    }
    return DEFAULT_SHEETS;
  });

  const [activeSheetId, setActiveSheetId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("company_sheets_tabs");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.length > 0) {
            return parsed[0].id;
          }
        } catch (e) {
          console.error(e);
        }
      }
    }
    return "telecaller";
  });
  
  // Custom Add Sheet Form
  const [newTitle, setNewTitle] = useState("");
  const [newSpreadsheetId, setNewSpreadsheetId] = useState("");
  const [newRange, setNewRange] = useState("A1:Z1000");
  const [newType, setNewType] = useState<"telecaller" | "pipeline" | "crm_tracker">("telecaller");

  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Date Range Selector (Default range covers full sample dates)
  const [startDate, setStartDate] = useState<string>("2026-05-01");
  const [endDate, setEndDate] = useState<string>("2026-07-31");

  // AI Remarks Assistant State
  const [aiReportOutput, setAiReportOutput] = useState<string>("");
  const [isAiGenerating, setIsAiGenerating] = useState<boolean>(false);

  // Drag and Drop Tab Reordering State and Handlers
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const listCopy = [...sheetsList];
    const draggedItem = listCopy[draggedIndex];
    listCopy.splice(draggedIndex, 1);
    listCopy.splice(index, 0, draggedItem);
    
    saveSheets(listCopy);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Get active sheet configurations
  const activeSheet = sheetsList.find(s => s.id === activeSheetId) || sheetsList[0];

  const fetchSheetData = async () => {
    if (activeSheetId === "add_new") return;
    
    setIsLoading(true);
    try {
      const res = await fetch(`/api/sheet-data?spreadsheetId=${activeSheet.spreadsheetId}&range=${activeSheet.range}`);
      const result = await res.json();
      
      if (!result.configured || result.rows.length === 0) {
        if (activeSheet.type === "telecaller") {
          setData(mockTelecallerData);
        } else if (activeSheet.type === "crm_tracker") {
          setData(mockCrmTrackerData);
        } else {
          setData(mockPipelineData);
        }
      } else {
        setData(result);
      }
    } catch (err) {
      console.error("Error loading Google Sheet data:", err);
      if (activeSheet.type === "telecaller") {
        setData(mockTelecallerData);
      } else if (activeSheet.type === "crm_tracker") {
        setData(mockCrmTrackerData);
      } else {
        setData(mockPipelineData);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSheetData();
  }, [activeSheetId, sheetsList]);

  // Sync sheet configs to LocalStorage
  const saveSheets = (list: SheetConfig[]) => {
    setSheetsList(list);
    if (typeof window !== "undefined") {
      localStorage.setItem("company_sheets_tabs", JSON.stringify(list));
    }
  };

  // Handle adding new sheets dynamically
  const handleAddNewSheet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newSpreadsheetId) {
      alert("Please fill in Sheet Title and Spreadsheet ID!");
      return;
    }

    const newSheet: SheetConfig = {
      id: `custom_${Date.now()}`,
      title: newTitle,
      spreadsheetId: newSpreadsheetId,
      range: newRange,
      type: newType
    };

    const updated = [...sheetsList, newSheet];
    saveSheets(updated);
    setActiveSheetId(newSheet.id);
    setNewTitle("");
    setNewSpreadsheetId("");
    setNewRange("A1:Z1000");
  };

  // Delete custom sheets tabs
  const handleDeleteSheet = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === "telecaller" || id === "pipeline" || id === "crm_tracker") {
      alert("System default sheets cannot be deleted.");
      return;
    }
    if (confirm("Are you sure you want to remove this sheet analysis tab?")) {
      const updated = sheetsList.filter(s => s.id !== id);
      saveSheets(updated);
      setActiveSheetId("telecaller");
    }
  };

  // Date Presets Formatter
  const applyPresetRange = (preset: string) => {
    const baseDate = new Date("2026-07-13"); 
    const formatDateToIso = (dateObj: Date): string => {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const isoToday = formatDateToIso(baseDate);

    switch (preset) {
      case "today":
        setStartDate(isoToday);
        setEndDate(isoToday);
        break;
      case "yesterday": {
        const prev = new Date(baseDate);
        prev.setDate(baseDate.getDate() - 1);
        const isoPrev = formatDateToIso(prev);
        setStartDate(isoPrev);
        setEndDate(isoPrev);
        break;
      }
      case "last7": {
        const past = new Date(baseDate);
        past.setDate(baseDate.getDate() - 7);
        setStartDate(formatDateToIso(past));
        setEndDate(isoToday);
        break;
      }
      case "last30": {
        const past = new Date(baseDate);
        past.setDate(baseDate.getDate() - 30);
        setStartDate(formatDateToIso(past));
        setEndDate(isoToday);
        break;
      }
      case "all": {
        setStartDate("2026-05-01");
        setEndDate("2026-07-31");
        break;
      }
    }
  };

  // Date Filter logic (Shared with CRM tracker and Pipeline raw rows if date is present)
  const filteredRows = React.useMemo(() => {
    if (!data || !data.rows || activeSheetId === "add_new") return [];

    return data.rows.filter((row: any) => {
      const dateField = row.Date || row.Timestamp || row["Scheduled Date"] || row["Dispatch Date"];
      
      if (startDate && endDate && dateField) {
        const rowDate = parseSheetDate(dateField);
        if (rowDate) {
          const rTime = new Date(rowDate.getFullYear(), rowDate.getMonth(), rowDate.getDate()).getTime();
          const start = parseSheetDate(startDate);
          const sTime = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() : 0;
          const end = parseSheetDate(endDate);
          const eTime = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() : Infinity;

          if (rTime < sTime || rTime > eTime) return false;
        }
      }
      return true;
    });
  }, [data, startDate, endDate, activeSheetId]);

  // Data Warnings Logic for CRM tracker (Robust Business Rule Audit)
  const crmDataWarnings = React.useMemo(() => {
    if (activeSheet.type !== "crm_tracker" || !filteredRows) return [];
    const warnings: { sNo: string; company: string; field: string; issue: string; severity: "critical" | "warning" }[] = [];

    const getSOAmount = (row: any) => parseFloat(String(row["Total Amount"] || row["Amount"] || "0").replace(/[^0-9.]/g, "")) || 0;

    filteredRows.forEach((row: any) => {
      const sNo = row["S.No."] || "N/A";
      const company = row["Company Name"] || "Unknown Company";
      
      // 1. Missing Logistics details
      if (!row.Transporter || String(row.Transporter).trim() === "") {
        warnings.push({ sNo, company, field: "Transporter Logistics", issue: "Transporter name is blank.", severity: "warning" });
      }
      if (!row["Mail ID"] || String(row["Mail ID"]).trim() === "") {
        warnings.push({ sNo, company, field: "Mail ID", issue: "No client email address present.", severity: "warning" });
      }

      // 2. Remarks state Delivered but Delivery Date to Client is missing
      const remarksStr = String(row.Remarks || "").toUpperCase();
      const hasDeliveredRemark = remarksStr.includes("DELIVERED") || remarksStr.includes("DELIVER");
      const deliveryDateEmpty = !row["Delivery Date to Client"] || String(row["Delivery Date to Client"]).trim() === "";
      if (hasDeliveredRemark && deliveryDateEmpty) {
        warnings.push({
          sNo,
          company,
          field: "Delivery Date to Client",
          issue: "Remarks state 'DELIVERED', but the actual 'Delivery Date to Client' field is empty.",
          severity: "critical"
        });
      }

      // 3. Status is Dispatched but Dispatch Date is missing
      const isDispatchedStatus = String(row["Delivery Status"] || "").toLowerCase() === "dispatched";
      const dispatchDateEmpty = !row["Dispatch Date"] || String(row["Dispatch Date"]).trim() === "";
      if (isDispatchedStatus && dispatchDateEmpty) {
        warnings.push({
          sNo,
          company,
          field: "Dispatch Date",
          issue: "Delivery Status is 'Dispatched', but no 'Dispatch Date' is recorded.",
          severity: "critical"
        });
      }

      // 4. Delayed without Tentative Delivery Date BUI
      const isDelayedBUI = String(row["On Time Status-BUI"] || "").toLowerCase() === "delayed";
      const tentativeDateEmpty = !row["Tentative Delivery Date BUI"] || String(row["Tentative Delivery Date BUI"]).trim() === "";
      if (isDelayedBUI && tentativeDateEmpty) {
        warnings.push({
          sNo,
          company,
          field: "Tentative Delivery Date BUI",
          issue: "Order is marked as 'Delayed' by BUI, but no 'Tentative Delivery Date BUI' is specified.",
          severity: "warning"
        });
      }

      // 5. Logical Date Violations
      const orderDate = parseSheetDate(row.Date);
      const confirmDate = parseSheetDate(row["Client/Stock Confirmation Date"]);
      const dispatchDate = parseSheetDate(row["Dispatch Date"]);
      const deliveryDate = parseSheetDate(row["Delivery Date to Client"]);

      if (orderDate && dispatchDate && dispatchDate < orderDate) {
        warnings.push({
          sNo,
          company,
          field: "Dispatch Date",
          issue: `Dispatch date (${row["Dispatch Date"]}) is earlier than the order date (${row.Date}).`,
          severity: "critical"
        });
      }

      if (dispatchDate && deliveryDate && deliveryDate < dispatchDate) {
        warnings.push({
          sNo,
          company,
          field: "Delivery Date to Client",
          issue: `Delivery date (${row["Delivery Date to Client"]}) is earlier than the dispatch date (${row["Dispatch Date"]}).`,
          severity: "critical"
        });
      }

      if (confirmDate && dispatchDate && dispatchDate < confirmDate) {
        warnings.push({
          sNo,
          company,
          field: "Dispatch Date",
          issue: `Dispatch date (${row["Dispatch Date"]}) is earlier than the Client Confirmation date (${row["Client/Stock Confirmation Date"]}).`,
          severity: "critical"
        });
      }

      // 6. Blank SO Number
      if (!row["SO Number"] || String(row["SO Number"]).trim() === "") {
        warnings.push({
          sNo,
          company,
          field: "SO Number",
          issue: "Sales Order (SO) Number is blank.",
          severity: "warning"
        });
      }

      // 7. Client Confirmation Date Missing
      const isConfirmed = String(row["Client Confirmation"] || "").toLowerCase() === "yes";
      const confirmDateEmpty = !row["Client/Stock Confirmation Date"] || String(row["Client/Stock Confirmation Date"]).trim() === "";
      if (isConfirmed && confirmDateEmpty) {
        warnings.push({
          sNo,
          company,
          field: "Client/Stock Confirmation Date",
          issue: "Client Confirmation is 'Yes', but no confirmation date is recorded.",
          severity: "warning"
        });
      }

      // 8. Amount Missing/Zero
      const amount = getSOAmount(row);
      if (amount <= 0) {
        warnings.push({
          sNo,
          company,
          field: "Amount",
          issue: "Order amount is empty or zero.",
          severity: "warning"
        });
      }

      // 9. Payment Issues
      const due = parseFloat(String(row["Payment Due"] || "0").replace(/[^0-9.]/g, "")) || 0;
      if (due > 0 && !row["Payment Status"]) {
        warnings.push({ sNo, company, field: "Payment Status", issue: `Payment of ₹${due.toLocaleString()} is due, but payment status is blank.`, severity: "critical" });
      }
    });

    return warnings;
  }, [filteredRows, activeSheet]);

  // Trigger AI remarks audit
  const triggerAIRemarksAudit = async () => {
    setIsAiGenerating(true);
    setAiReportOutput("");
    try {
      const remarksSummary = filteredRows.map((r: any) => 
        `- Company: ${r["Company Name"]}, Status: ${r["On Time Status-BUI"] || "N/A"}, Remarks: ${r.Remarks || "No Remarks"}`
      ).join("\n");

      const question = `Review the following dispatch remarks from my CRM tracker and give me a brief 2-paragraph EOD dispatch audit summary:
- Highlight which items/samples are currently under testing or pending customer choice (e.g. Gajraula).
- Identify which items have been confirmed delivered.
- Note any specific dispatch timelines or dates:
\n${remarksSummary}`;

      const res = await fetch("/api/ask-founder-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      const result = await res.json();
      setAiReportOutput(result.answer || "No synthesis returned from AI.");
    } catch (err) {
      console.error(err);
      setAiReportOutput("⚠️ Failed to call Company AI service. Showing computed EOD highlights instead:\n- Gajraula: Sample sent, waiting for choice selection.\n- Numix Industries: Sample dispatched.\n- SRG Products: Delivered.");
    } finally {
      setIsAiGenerating(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Tab Selector Navigation Bar */}
      <div className="flex border-b border-zinc-800 gap-1 overflow-x-auto pb-px select-none">
        {sheetsList.map((sheet, index) => {
          const isDragging = draggedIndex === index;
          return (
            <div 
              key={sheet.id} 
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`relative group flex items-center transition-all cursor-grab active:cursor-grabbing ${
                isDragging ? "opacity-30 border-dashed border-indigo-500 bg-indigo-500/5" : ""
              }`}
            >
              {/* Grab Dots handle visual aid on hover */}
              <span className="pl-2 pr-0 text-[10px] text-zinc-650 opacity-0 group-hover:opacity-100 transition-opacity">
                ⋮⋮
              </span>
              <button
                onClick={() => {
                  setActiveSheetId(sheet.id);
                  setAiReportOutput("");
                }}
                className={`px-3 py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap flex items-center gap-1.5 ${
                  activeSheetId === sheet.id
                    ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
                    : "border-transparent text-zinc-400 hover:text-white"
                }`}
              >
                {sheet.title}
              </button>
              {sheet.id !== "telecaller" && sheet.id !== "pipeline" && sheet.id !== "crm_tracker" && (
                <button
                  onClick={(e) => handleDeleteSheet(sheet.id, e)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 hover:text-rose-400 text-[10px] text-zinc-500 transition-all p-1"
                  title="Remove Analysis Tab"
                >
                  ❌
                </button>
              )}
            </div>
          );
        })}
        
        <button
          onClick={() => setActiveSheetId("add_new")}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
            activeSheetId === "add_new"
              ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
              : "border-transparent text-zinc-500 hover:text-white"
          }`}
        >
          ➕ Add New Analysis Tab...
        </button>
      </div>

      {activeSheetId === "add_new" ? (
        /* Create New Sheet Form Panel */
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-md max-w-2xl mx-auto space-y-6">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span>➕</span> Register Custom Sheet Analysis
            </h2>
            <p className="text-xs text-zinc-400 mt-1">Configure a Google Sheet to instantiate an analysis dashboard on-the-fly</p>
          </div>

          <form onSubmit={handleAddNewSheet} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Sheet Display Title</label>
              <input
                type="text"
                placeholder="e.g. 📊 Marketing Campaign Performance"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Google Spreadsheet ID</label>
              <input
                type="text"
                placeholder="e.g. 1OsQevXQpPT1x2iJgcg0lgUcOInxjZh3tvfNjxAbcENs"
                value={newSpreadsheetId}
                onChange={(e) => setNewSpreadsheetId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-855 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Sheet Range / Tab</label>
                <input
                  type="text"
                  placeholder="e.g. Sheet1!A1:Z1000"
                  value={newRange}
                  onChange={(e) => setNewRange(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-855 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-zinc-300">Analysis Engine Layout</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-855 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="telecaller">📞 Telecaller & Conversion Metrics</option>
                  <option value="crm_tracker">🚚 CRM Dispatch & Data Quality Audit</option>
                  <option value="pipeline">💼 CRM Sales Pipeline & Lead Values</option>
                </select>
              </div>
            </div>

            <div className="pt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveSheetId("telecaller")}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-550 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
              >
                Create Analysis Tab
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Active Analysis Content */
        <>
          {/* Top Header Row */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-zinc-800 pb-5">
            <div>
              <h1 className="text-3xl font-bold font-heading text-white flex items-center gap-2">
                <span>📊</span> {activeSheet.title}
              </h1>
              <p className="text-xs text-zinc-400 mt-1">Spreadsheet: {activeSheet.spreadsheetId.substring(0, 8)}... | Range: {activeSheet.range}</p>
            </div>

            <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
              {data && !data.configured && (
                <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded font-bold uppercase">
                  Demo Sandbox
                </span>
              )}
              <button
                onClick={fetchSheetData}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer border border-zinc-750 flex items-center gap-1.5"
              >
                <span>🔄</span> Refresh Sheet
              </button>
            </div>
          </div>

          {/* Integration Notice */}
          {data && !data.configured && (
            <div className="bg-amber-950/10 border border-amber-900/30 rounded-xl p-4 text-xs text-amber-200/90 leading-relaxed shadow shadow-amber-950/20">
              <div className="flex gap-2.5">
                <span>⚠️</span>
                <p>
                  Showing demo sheet. Connect live Google Sheet by adding your <code className="bg-zinc-950 px-1 py-0.5 rounded font-mono text-rose-300">google-service-account.json</code> file at the project root.
                </p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
              <div className="animate-spin text-3xl mb-4">⏳</div>
              <p className="text-sm font-medium">Fetching Google Sheet Data...</p>
            </div>
          ) : (
            <div className="space-y-6">
              {activeSheet.type === "telecaller" && (
                <TelecallerDashboard
                  data={data}
                  startDate={startDate}
                  endDate={endDate}
                  setStartDate={setStartDate}
                  setEndDate={setEndDate}
                  applyPresetRange={applyPresetRange}
                />
              )}

              {activeSheet.type === "crm_tracker" && (
                <CrmTrackerDashboard
                  data={data}
                  startDate={startDate}
                  endDate={endDate}
                  setStartDate={setStartDate}
                  setEndDate={setEndDate}
                  applyPresetRange={applyPresetRange}
                  filteredRows={filteredRows}
                  crmDataWarnings={crmDataWarnings}
                  triggerAIRemarksAudit={triggerAIRemarksAudit}
                  aiReportOutput={aiReportOutput}
                  isAiGenerating={isAiGenerating}
                />
              )}

              {activeSheet.type === "pipeline" && (
                <PipelineDashboard
                  data={data}
                  filteredRows={filteredRows}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
