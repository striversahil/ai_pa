"use client";

import React, { useState, useRef, useCallback } from "react";
import { useEnquiryData } from "../hooks/useEnquiryData";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../hooks/useToast";
import { useCSV } from "../hooks/useCSV";
import { useHashRoute } from "../hooks/useHashRoute";
import ErrorBoundary from "../components/ErrorBoundary";
import Sidebar from "../components/layout/Sidebar";
import MobileNav from "../components/layout/MobileNav";
import Dashboard from "../components/Dashboard";
import EnquiryList from "../components/EnquiryList";
import EnquiryDetail from "../components/EnquiryDetail";
import EnquiryModal from "../components/EnquiryModal";
import Lightbox from "../components/Lightbox";
import ToastContainer from "../components/ToastContainer";
import FounderAssistant from "../components/FounderAssistant";
import WhatsAppDashboard from "../components/WhatsAppDashboard";
import Automations from "../components/Automations";
import type { Enquiry, Comment } from "../types";

type ViewType = "dashboard" | "enquiries" | "detail" | "briefing" | "whatsapp" | "automations";

export default function Home() {
  const {
    enquiries, setEnquiries,
    comments, setComments,
    agents, currentAgent, loaded,
    syncState, addComment,
  } = useEnquiryData();

  const { theme, toggleTheme } = useTheme();
  const { toasts, showToast } = useToast();
  const { exportCSV, importCSV } = useCSV(showToast);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEnquiry, setEditingEnquiry] = useState<Enquiry | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [lightboxImages, setLightboxImages] = useState<string[] | undefined>(undefined);
  const [lightboxIndex, setLightboxIndex] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { route, navigate } = useHashRoute();
  const activeView: ViewType =
    route.view === "enquiries" && route.sub
      ? "detail"
      : (["dashboard", "enquiries", "briefing", "whatsapp", "automations"] as ViewType[]).includes(route.view as ViewType)
        ? (route.view as ViewType)
        : "automations";
  const selectedEnquiryId = route.view === "enquiries" ? route.sub : null;
  const selectedEnquiry = enquiries.find(e => e.id === selectedEnquiryId) || null;

  const navigateTo = useCallback((view: ViewType) => {
    const paths: Record<ViewType, string> = {
      dashboard: "#/dashboard",
      enquiries: "#/enquiries",
      detail: "#/enquiries",
      briefing: "#/briefing",
      whatsapp: "#/whatsapp",
      automations: "#/automations",
    };
    navigate(paths[view]);
  }, [navigate]);

  const handleOpenLightbox = useCallback((url: string, list?: string[], idx = 0) => {
    setLightboxImage(url);
    setLightboxImages(list);
    setLightboxIndex(idx);
  }, []);

  const handleSaveEnquiry = useCallback((data: any) => {
    if (!data.clientCompany || !data.title || !data.contactName || !data.estimatedValue) {
      showToast("Please fill in all required fields", "warning");
      return;
    }
    const valueNum = parseFloat(data.estimatedValue);
    if (isNaN(valueNum) || valueNum < 0) { showToast("Value must be a positive number", "warning"); return; }

    if (editingEnquiry) {
      const original = enquiries.find(eq => eq.id === editingEnquiry.id);
      if (!original) return;
      const changes: string[] = [];
      if (original.status !== data.status) changes.push(`Status updated from ${original.status.toUpperCase()} to ${data.status.toUpperCase()}`);
      if (original.priority !== data.priority) changes.push(`Priority changed from ${original.priority.toUpperCase()} to ${data.priority.toUpperCase()}`);
      if (original.assignedAgentId !== parseInt(data.assignedAgentId)) {
        const nextAgentName = agents.find(a => a.id === parseInt(data.assignedAgentId))?.name || "Unassigned";
        changes.push(`Assigned agent changed to ${nextAgentName}`);
      }
      const updatedActivities = [...(original.activities || [])];
      changes.forEach(ch => {
        updatedActivities.push({ id: `act-edit-${Date.now()}-${Math.random()}`, type: "status_change" as const, text: ch, timestamp: new Date().toISOString(), agentId: currentAgent.id });
      });
      const updatedEnquiries = enquiries.map(eq => eq.id === editingEnquiry.id ? {
        ...eq, clientCompany: data.clientCompany, contactName: data.contactName, contactEmail: data.contactEmail, contactPhone: data.contactPhone, title: data.title, description: data.description, priority: data.priority, status: data.status, assignedAgentId: parseInt(data.assignedAgentId), estimatedValue: valueNum, activities: updatedActivities, imageUrls: data.imageUrls, createdAt: data.createdAt || eq.createdAt
      } : eq);
      syncState(updatedEnquiries, comments, agents);
      showToast("Enquiry details saved", "success");
    } else {
      const newEnquiry: Enquiry = {
        id: `enq-${Date.now()}`, clientCompany: data.clientCompany, contactName: data.contactName, contactEmail: data.contactEmail, contactPhone: data.contactPhone, title: data.title, description: data.description, priority: data.priority, status: data.status, assignedAgentId: parseInt(data.assignedAgentId), estimatedValue: valueNum, createdAt: data.createdAt || new Date().toISOString(), imageUrls: data.imageUrls, activities: [{ id: `act-create-${Date.now()}`, type: "creation", text: "Enquiry initialized manually.", timestamp: data.createdAt || new Date().toISOString(), agentId: currentAgent.id }]
      };
      syncState([newEnquiry, ...enquiries], comments, agents);
      showToast("Enquiry logged successfully", "success");
    }
    setIsAddModalOpen(false);
  }, [enquiries, comments, agents, currentAgent, editingEnquiry, showToast, syncState]);

  const handleDeleteEnquiry = useCallback((enquiryId: string) => {
    if (confirm("Are you sure you want to delete this enquiry and all nested comments?")) {
      syncState(enquiries.filter(e => e.id !== enquiryId), comments.filter(c => c.enquiryId !== enquiryId), agents);
      showToast("Enquiry deleted", "danger");
      navigate("#/enquiries");
    }
  }, [enquiries, comments, agents, syncState, showToast, navigate]);

  const handleUpdateStatus = useCallback((enquiryId: string, newStatus: Enquiry["status"]) => {
    const updatedEnquiries = enquiries.map(e => e.id === enquiryId ? {
      ...e, status: newStatus, activities: [...(e.activities || []), { id: `act-status-${Date.now()}`, type: "status_change" as const, text: `Status updated to ${newStatus.toUpperCase()}`, timestamp: new Date().toISOString(), agentId: currentAgent.id }]
    } : e);
    syncState(updatedEnquiries, comments, agents);
    showToast(`Status updated to ${newStatus.toUpperCase()}`, "success");
  }, [enquiries, comments, agents, currentAgent, syncState, showToast]);

  const handleUpdateAgent = useCallback((enquiryId: string, newAgentId: string) => {
    const nextAgent = agents.find(a => a.id === parseInt(newAgentId));
    const agentName = nextAgent ? nextAgent.name : "Unassigned";
    const updatedEnquiries = enquiries.map(e => e.id === enquiryId ? {
      ...e, assignedAgentId: parseInt(newAgentId), activities: [...(e.activities || []), { id: `act-assign-${Date.now()}`, type: "assignment" as const, text: `Enquiry assigned to ${agentName}`, timestamp: new Date().toISOString(), agentId: currentAgent.id }]
    } : e);
    syncState(updatedEnquiries, comments, agents);
    showToast(`Assigned to ${agentName}`, "success");
  }, [enquiries, comments, agents, currentAgent, syncState, showToast]);

  const handleAddComment = useCallback((newComment: Comment) => {
    syncState(enquiries, [...comments, newComment], agents);
    showToast(newComment.parentId ? "Reply posted to thread" : "Status comment added", "success");
  }, [enquiries, comments, agents, syncState, showToast]);

  const handleOpenCreate = useCallback(() => { setEditingEnquiry(null); setIsAddModalOpen(true); }, []);
  const handleOpenEdit = useCallback((enq: Enquiry) => { setEditingEnquiry(enq); setIsAddModalOpen(true); }, []);

  const handleImportCSV = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const imported = await importCSV(e, currentAgent.id);
    if (imported.length > 0) syncState([...imported, ...enquiries], comments, agents);
  }, [importCSV, currentAgent, syncState, enquiries, comments, agents]);

  const handleExportCSV = useCallback(() => exportCSV(enquiries), [exportCSV, enquiries]);

  if (!loaded) return null;

  return (
    <div className="flex flex-col md:grid md:grid-cols-[260px_1fr] min-h-screen relative font-sans antialiased text-[var(--text-primary)]">
      <Sidebar activeView={activeView} onNavigate={navigateTo} theme={theme} onToggleTheme={toggleTheme} currentAgent={currentAgent} />

      <header className="md:hidden flex justify-between items-center px-4 py-3 bg-[var(--bg-card)] border-b border-[var(--border-card)] z-30 sticky top-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white" style={{ backgroundColor: currentAgent.color }}>{currentAgent.initials}</div>
          <span className="font-heading font-extrabold text-base tracking-tight">Brindavan Udyog</span>
        </div>
        <button onClick={toggleTheme} className="p-2 rounded-lg bg-[var(--bg-input)] hover:opacity-80 transition-all duration-200 border-0 cursor-pointer">
          {theme === "dark" ? (
            <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>
          ) : (
            <svg className="w-5 h-5 text-indigo-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          )}
        </button>
      </header>

      <MobileNav activeView={activeView} onNavigate={navigateTo} />

      <main className="flex-1 p-4 md:p-8 overflow-y-auto mb-16 md:mb-0 max-w-full">
        <ErrorBoundary>
          {activeView === "dashboard" && (
            <Dashboard enquiries={enquiries} agents={agents} currentAgent={currentAgent}
              onOpenCreate={handleOpenCreate}
              onViewDetail={(id) => navigate(`#/enquiries/${encodeURIComponent(id)}`)}
              onViewAllEnquiries={() => navigate("#/enquiries")}
            />
          )}
          {activeView === "enquiries" && (
            <EnquiryList enquiries={enquiries} agents={agents}
              onViewDetail={(id) => navigate(`#/enquiries/${encodeURIComponent(id)}`)}
              onOpenCreate={handleOpenCreate}
              onExportCSV={handleExportCSV}
              onImportCSV={handleImportCSV}
              fileInputRef={fileInputRef}
              triggerCSVInput={() => fileInputRef.current?.click()}
            />
          )}
          {activeView === "detail" && selectedEnquiry && (
            <EnquiryDetail selectedEnquiry={selectedEnquiry} agents={agents} currentAgent={currentAgent} comments={comments}
              onUpdateStatus={handleUpdateStatus}
              onUpdateAgent={handleUpdateAgent}
              onAddComment={handleAddComment}
              onDeleteEnquiry={handleDeleteEnquiry}
              onOpenEdit={handleOpenEdit}
              onBack={() => navigate("#/enquiries")}
              onOpenLightbox={handleOpenLightbox}
            />
          )}
          {activeView === "briefing" && <FounderAssistant />}
          {activeView === "whatsapp" && <WhatsAppDashboard />}
          {activeView === "automations" && (
            <Automations slug={route.view === "automations" ? route.sub : null} onNavigate={navigate} />
          )}
        </ErrorBoundary>
      </main>

      {isAddModalOpen && (
        <EnquiryModal key={editingEnquiry?.id || "new-enquiry"}
          isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)}
          editingEnquiry={editingEnquiry} agents={agents} currentAgent={currentAgent}
          onSave={handleSaveEnquiry}
        />
      )}

      {lightboxImage && (
        <Lightbox key={lightboxImage + "-" + lightboxIndex}
          image={lightboxImage} images={lightboxImages} initialIndex={lightboxIndex}
          onClose={() => { setLightboxImage(null); setLightboxImages(undefined); setLightboxIndex(0); }}
        />
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
