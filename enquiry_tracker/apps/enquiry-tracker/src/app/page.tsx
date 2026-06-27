"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { getStoredData, saveToStorage, Agent, Enquiry, Comment } from "../mockData";

// Modular sub-components
import Dashboard from "../components/Dashboard";
import EnquiryList from "../components/EnquiryList";
import EnquiryDetail from "../components/EnquiryDetail";
import EnquiryModal from "../components/EnquiryModal";
import Lightbox from "../components/Lightbox";
import ToastContainer from "../components/ToastContainer";

export default function Home() {
  // Loaded state from LocalStorage
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  // Navigation state
  const [activeView, setActiveView] = useState<"dashboard" | "enquiries" | "detail">("dashboard");
  const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(null);

  // Active simulated Agent (Alice Vance - Agent 1)
  const currentAgent = useMemo<Agent>(() => {
    return agents.find(a => a.id === 1) || { id: 1, name: "Alice Vance", initials: "AV", color: "#6366f1", status: "active" };
  }, [agents]);

  // Comment & dialog overlays state
  const [toasts, setToasts] = useState<{ id: number; text: string; type: string }[]>([]);
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("theme") || "dark";
    }
    return "dark";
  });

  // Modal forms state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEnquiry, setEditingEnquiry] = useState<Enquiry | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[] | undefined>(undefined);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);

  const handleOpenLightbox = (url: string, list?: string[], idx = 0) => {
    setLightboxImage(url);
    setLightboxImages(list);
    setLightboxIndex(idx);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load initial data from local storage asynchronously to avoid hydration mismatch
  useEffect(() => {
    const data = getStoredData();
    Promise.resolve().then(() => {
      setEnquiries(data.enquiries);
      setComments(data.comments);
      setAgents(data.agents);
    });
  }, []);

  // Sync state helper
  const syncState = (updatedEnquiries: Enquiry[], updatedComments: Comment[], updatedAgents: Agent[]) => {
    setEnquiries(updatedEnquiries);
    setComments(updatedComments);
    setAgents(updatedAgents);
    saveToStorage(updatedEnquiries, updatedComments, updatedAgents);
  };

  // Sync Tailwind dark mode
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Toast notification helper
  const showToast = (text: string, type = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  // Theme toggle
  const toggleTheme = () => {
    setTheme(prev => (prev === "dark" ? "light" : "dark"));
  };

  // Currently selected enquiry
  const selectedEnquiry = useMemo(() => {
    return enquiries.find(e => e.id === selectedEnquiryId) || null;
  }, [enquiries, selectedEnquiryId]);

  // Open creation modal
  const handleOpenCreate = () => {
    setEditingEnquiry(null);
    setIsAddModalOpen(true);
  };

  // Open edit modal
  const handleOpenEdit = (enq: Enquiry) => {
    setEditingEnquiry(enq);
    setIsAddModalOpen(true);
  };

  // Form submission handler from EnquiryModal
  const handleSaveEnquiry = (data: {
    clientCompany: string;
    title: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    estimatedValue: string;
    priority: "high" | "medium" | "low";
    status: Enquiry["status"];
    assignedAgentId: string;
    description: string;
    imageUrls: string[];
    createdAt?: string;
  }) => {
    if (!data.clientCompany || !data.title || !data.contactName || !data.estimatedValue) {
      showToast("Please fill in all required fields", "warning");
      return;
    }

    const valueNum = parseFloat(data.estimatedValue);
    if (isNaN(valueNum) || valueNum < 0) {
      showToast("Value must be a positive number", "warning");
      return;
    }

    if (editingEnquiry) {
      // Modify
      const original = enquiries.find(eq => eq.id === editingEnquiry.id);
      if (!original) return;

      const changes: string[] = [];
      if (original.status !== data.status) changes.push(`Status updated from ${original.status.toUpperCase()} to ${data.status.toUpperCase()}`);
      if (original.priority !== data.priority) changes.push(`Priority changed from ${original.priority.toUpperCase()} to ${data.priority.toUpperCase()}`);
      if (original.assignedAgentId !== parseInt(data.assignedAgentId)) {
        const nextAgentName = agents.find(a => a.id === parseInt(data.assignedAgentId))?.name || "Unassigned";
        changes.push(`Assigned agent changed to ${nextAgentName}`);
      }
      if (data.createdAt && new Date(original.createdAt).toDateString() !== new Date(data.createdAt).toDateString()) {
        changes.push(`Received date changed to ${new Date(data.createdAt).toDateString()}`);
      }

      const updatedActivities = [...(original.activities || [])];
      changes.forEach(ch => {
        updatedActivities.push({
          id: `act-edit-${Date.now()}-${Math.random()}`,
          type: "status_change",
          text: ch,
          timestamp: new Date().toISOString(),
          agentId: currentAgent.id
        });
      });

      const updatedEnquiries = enquiries.map(eq => {
        if (eq.id === editingEnquiry.id) {
          return {
            ...eq,
            clientCompany: data.clientCompany,
            contactName: data.contactName,
            contactEmail: data.contactEmail,
            contactPhone: data.contactPhone,
            title: data.title,
            description: data.description,
            priority: data.priority,
            status: data.status,
            assignedAgentId: parseInt(data.assignedAgentId),
            estimatedValue: valueNum,
            activities: updatedActivities,
            imageUrls: data.imageUrls,
            createdAt: data.createdAt || eq.createdAt
          };
        }
        return eq;
      });

      syncState(updatedEnquiries, comments, agents);
      showToast("Enquiry details saved", "success");
    } else {
      // Create
      const newId = `enq-${Date.now()}`;
      const saveCreatedAt = data.createdAt || new Date().toISOString();
      const newEnquiry: Enquiry = {
        id: newId,
        clientCompany: data.clientCompany,
        contactName: data.contactName,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        title: data.title,
        description: data.description,
        priority: data.priority,
        status: data.status,
        assignedAgentId: parseInt(data.assignedAgentId),
        estimatedValue: valueNum,
        createdAt: saveCreatedAt,
        imageUrls: data.imageUrls,
        activities: [
          {
            id: `act-create-${Date.now()}`,
            type: "creation",
            text: "Enquiry initialized manually.",
            timestamp: saveCreatedAt,
            agentId: currentAgent.id
          }
        ]
      };

      syncState([newEnquiry, ...enquiries], comments, agents);
      showToast("Enquiry logged successfully", "success");
    }

    setIsAddModalOpen(false);
  };

  // Delete Enquiry
  const handleDeleteEnquiry = (enquiryId: string) => {
    if (confirm("Are you sure you want to delete this enquiry and all nested comments?")) {
      const updatedEnquiries = enquiries.filter(e => e.id !== enquiryId);
      const updatedComments = comments.filter(c => c.enquiryId !== enquiryId);
      syncState(updatedEnquiries, updatedComments, agents);
      showToast("Enquiry deleted", "danger");
      setSelectedEnquiryId(null);
      setActiveView("enquiries");
    }
  };

  // Update Status from Detail View
  const handleUpdateStatus = (enquiryId: string, newStatus: Enquiry["status"]) => {
    const updatedEnquiries = enquiries.map(e => {
      if (e.id === enquiryId) {
        return {
          ...e,
          status: newStatus,
          activities: [
            ...(e.activities || []),
            {
              id: `act-status-${Date.now()}`,
              type: "status_change" as const,
              text: `Status updated to ${newStatus.toUpperCase()}`,
              timestamp: new Date().toISOString(),
              agentId: currentAgent.id
            }
          ]
        };
      }
      return e;
    });
    syncState(updatedEnquiries, comments, agents);
    showToast(`Status updated to ${newStatus.toUpperCase()}`, "success");
  };

  // Update Assigned Agent from Detail View
  const handleUpdateAgent = (enquiryId: string, newAgentId: string) => {
    const nextAgent = agents.find(a => a.id === parseInt(newAgentId));
    const agentName = nextAgent ? nextAgent.name : "Unassigned";

    const updatedEnquiries = enquiries.map(e => {
      if (e.id === enquiryId) {
        return {
          ...e,
          assignedAgentId: parseInt(newAgentId),
          activities: [
            ...(e.activities || []),
            {
              id: `act-assign-${Date.now()}`,
              type: "assignment" as const,
              text: `Enquiry assigned to ${agentName}`,
              timestamp: new Date().toISOString(),
              agentId: currentAgent.id
            }
          ]
        };
      }
      return e;
    });
    syncState(updatedEnquiries, comments, agents);
    showToast(`Assigned to ${agentName}`, "success");
  };

  // Add Comment to List
  const handleAddComment = (newComment: Comment) => {
    const updatedComments = [...comments, newComment];
    syncState(enquiries, updatedComments, agents);
    showToast(newComment.parentId ? "Reply posted to thread" : "Status comment added", "success");
  };

  // CSV Export
  const handleExportCSV = () => {
    if (enquiries.length === 0) {
      showToast("No records available to export", "warning");
      return;
    }

    const headers = ["ID", "Company", "Title", "Contact Name", "Contact Email", "Contact Phone", "Priority", "Status", "Value", "Date Created"];
    const rows = enquiries.map(e => [
      e.id,
      `"${e.clientCompany.replace(/"/g, '""')}"`,
      `"${e.title.replace(/"/g, '""')}"`,
      `"${e.contactName.replace(/"/g, '""')}"`,
      e.contactEmail,
      e.contactPhone,
      e.priority,
      e.status,
      e.estimatedValue,
      e.createdAt
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `b2b_enquiries_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV file downloaded", "success");
  };

  // Trigger file upload dialog
  const triggerCSVInput = () => {
    fileInputRef.current?.click();
  };

  // CSV Import Parser
  const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length <= 1) {
          showToast("CSV file is empty", "warning");
          return;
        }

        const parseLine = (line: string) => {
          const result = [];
          let current = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              result.push(current);
              current = "";
            } else {
              current += char;
            }
          }
          result.push(current);
          return result;
        };

        const imported: Enquiry[] = [];

        for (let i = 1; i < lines.length; i++) {
          const cols = parseLine(lines[i]);
          if (cols.length < 3) continue;

          const company = cols[1] || "Imported Company";
          const title = cols[2] || "Imported Enquiry";
          const contact = cols[3] || "Contact Name";
          const email = cols[4] || "imported@email.com";
          const phone = cols[5] || "";
          
          let priority: Enquiry["priority"] = "medium";
          if (cols[6]?.toLowerCase() === "high") priority = "high";
          if (cols[6]?.toLowerCase() === "low") priority = "low";

          const possibleStatus = cols[7]?.toLowerCase() as Enquiry["status"];
          const status: Enquiry["status"] = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"].includes(possibleStatus) ? possibleStatus : "new";
          
          const valueVal = parseFloat(cols[8]);
          const value = isNaN(valueVal) ? 10000 : valueVal;

          imported.push({
            id: `enq-imported-${Date.now()}-${i}`,
            clientCompany: company,
            contactName: contact,
            contactEmail: email,
            contactPhone: phone,
            title: title,
            description: "Imported via CSV file.",
            priority,
            status,
            assignedAgentId: currentAgent.id,
            estimatedValue: value,
            createdAt: new Date().toISOString(),
            activities: [
              {
                id: `act-imp-${Date.now()}-${i}`,
                type: "creation",
                text: "Enquiry imported via CSV upload.",
                timestamp: new Date().toISOString(),
                agentId: currentAgent.id
              }
            ]
          });
        }

        if (imported.length > 0) {
          syncState([...imported, ...enquiries], comments, agents);
          showToast(`Successfully imported ${imported.length} B2B enquiries!`, "success");
        } else {
          showToast("No valid records found to import", "warning");
        }
      } catch (err) {
        console.error(err);
        showToast("Error processing CSV format", "danger");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // Reset file picker
  };

  return (
    <div className="flex flex-col md:grid md:grid-cols-[260px_1fr] min-h-screen relative font-sans antialiased text-[var(--text-primary)]">
      
      {/* SIDEBAR NAVIGATION - DESKTOP */}
      <aside className="hidden md:flex flex-col h-screen sticky top-0 bg-[var(--bg-sidebar)] text-[#a1a1aa] p-6 border-r border-white/5 z-40">
        <div className="flex items-center gap-3 text-white font-extrabold text-xl mb-10">
          <svg className="w-8 h-8 text-brand-indigo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="font-heading tracking-tight text-white">Brindavan Udyog</span>
        </div>

        <nav className="flex flex-col gap-2 flex-grow">
          <button 
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-200 text-left cursor-pointer border-0 w-full ${activeView === "dashboard" ? "bg-brand-indigo text-white shadow-lg shadow-indigo-600/25" : "hover:bg-white/5 hover:text-white bg-transparent"}`}
            onClick={() => { setActiveView("dashboard"); setSelectedEnquiryId(null); }}
            type="button"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            <span>Dashboard</span>
          </button>

          <button 
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-200 text-left cursor-pointer border-0 w-full ${activeView === "enquiries" || activeView === "detail" ? "bg-brand-indigo text-white shadow-lg shadow-indigo-600/25" : "hover:bg-white/5 hover:text-white bg-transparent"}`}
            onClick={() => { setActiveView("enquiries"); setSelectedEnquiryId(null); }}
            type="button"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <span>Enquiries</span>
          </button>
        </nav>

        <div className="flex flex-col gap-4 pt-6 border-t border-white/5 mt-auto">
          <button onClick={toggleTheme} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all duration-200 cursor-pointer border-0">
            {theme === "dark" ? (
              <>
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span>Dark Mode</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white relative flex-shrink-0" style={{ backgroundColor: currentAgent.color }}>
              {currentAgent.initials}
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-brand-emerald border-2 border-[var(--bg-sidebar)]"></span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-semibold text-white text-sm truncate">{currentAgent.name}</span>
              <span className="text-xs text-zinc-500">B2B Agent</span>
            </div>
          </div>
        </div>
      </aside>

      {/* MOBILE HEADER BAR */}
      <header className="md:hidden flex justify-between items-center px-4 py-3 bg-[var(--bg-card)] border-b border-[var(--border-card)] z-30 sticky top-0">
        <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white" style={{ backgroundColor: currentAgent.color }}>
              {currentAgent.initials}
            </div>
            <span className="font-heading font-extrabold text-base tracking-tight">Brindavan Udyog</span>
        </div>
        <button onClick={toggleTheme} className="p-2 rounded-lg bg-[var(--bg-input)] hover:opacity-80 transition-all duration-200 border-0 cursor-pointer">
          {theme === "dark" ? (
            <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-indigo-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </header>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[var(--bg-card)] border-t border-[var(--border-card)] flex justify-around items-center z-40 px-2">
        <button 
          onClick={() => { setActiveView("dashboard"); setSelectedEnquiryId(null); }}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-semibold border-0 bg-transparent cursor-pointer ${activeView === "dashboard" ? "text-brand-indigo" : "text-[var(--text-secondary)]"}`}
          type="button"
        >
          <svg className="w-6 h-6 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          <span>Dashboard</span>
        </button>

        <button 
          onClick={() => { setActiveView("enquiries"); setSelectedEnquiryId(null); }}
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-xs font-semibold border-0 bg-transparent cursor-pointer ${activeView === "enquiries" || activeView === "detail" ? "text-brand-indigo" : "text-[var(--text-secondary)]"}`}
          type="button"
        >
          <svg className="w-6 h-6 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
          <span>Enquiries</span>
        </button>
      </nav>

      {/* MAIN VIEWPORT CONTENT */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto mb-16 md:mb-0 max-w-full">
        {/* VIEW: DASHBOARD */}
        {activeView === "dashboard" && (
          <Dashboard 
            enquiries={enquiries}
            agents={agents}
            currentAgent={currentAgent}
            onOpenCreate={handleOpenCreate}
            onViewDetail={(id) => { setSelectedEnquiryId(id); setActiveView("detail"); }}
            onViewAllEnquiries={() => setActiveView("enquiries")}
          />
        )}

        {/* VIEW: ENQUIRY LIST */}
        {activeView === "enquiries" && (
          <EnquiryList 
            enquiries={enquiries}
            agents={agents}
            onViewDetail={(id) => { setSelectedEnquiryId(id); setActiveView("detail"); }}
            onOpenCreate={handleOpenCreate}
            onExportCSV={handleExportCSV}
            onImportCSV={handleImportCSV}
            fileInputRef={fileInputRef}
            triggerCSVInput={triggerCSVInput}
          />
        )}

        {/* VIEW: ENQUIRY DETAILS */}
        {activeView === "detail" && selectedEnquiry && (
          <EnquiryDetail 
            selectedEnquiry={selectedEnquiry}
            agents={agents}
            currentAgent={currentAgent}
            comments={comments}
            onUpdateStatus={handleUpdateStatus}
            onUpdateAgent={handleUpdateAgent}
            onAddComment={handleAddComment}
            onDeleteEnquiry={handleDeleteEnquiry}
            onOpenEdit={handleOpenEdit}
            onBack={() => { setActiveView("enquiries"); setSelectedEnquiryId(null); }}
            onOpenLightbox={handleOpenLightbox}
          />
        )}
      </main>

      {/* MODAL: ADD / EDIT ENQUIRY */}
      {isAddModalOpen && (
        <EnquiryModal 
          key={editingEnquiry?.id || "new-enquiry"}
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          editingEnquiry={editingEnquiry}
          agents={agents}
          currentAgent={currentAgent}
          onSave={handleSaveEnquiry}
        />
      )}

      {/* Notion-like transparent Image Lightbox */}
      {lightboxImage && (
        <Lightbox 
          key={lightboxImage + "-" + lightboxIndex}
          image={lightboxImage}
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => {
            setLightboxImage(null);
            setLightboxImages(undefined);
            setLightboxIndex(0);
          }}
        />
      )}

      {/* TOAST CONTAINER */}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
