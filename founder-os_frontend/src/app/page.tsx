"use client";

import React, { useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useEnquiryData } from "../hooks/useEnquiryData";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../hooks/useToast";
import { useCSV } from "../hooks/useCSV";
import { useHashRoute } from "../hooks/useHashRoute";
import ErrorBoundary from "../components/ErrorBoundary";
import Sidebar from "../components/layout/Sidebar";
import MobileNav from "../components/layout/MobileNav";
import EnquiryModal from "../components/EnquiryModal";
import Lightbox from "../components/Lightbox";
import ToastContainer from "../components/ToastContainer";
import type { Enquiry, Comment } from "../types";

// Heavy views are lazy-loaded so only the active view's JS is fetched & parsed.
const Dashboard = dynamic(() => import("../components/Dashboard"), { ssr: false });
const EnquiryList = dynamic(() => import("../components/EnquiryList"), { ssr: false });
const EnquiryDetail = dynamic(() => import("../components/EnquiryDetail"), { ssr: false });
const FounderAssistant = dynamic(() => import("../components/FounderAssistant"), { ssr: false });
const WhatsAppDashboard = dynamic(() => import("../components/WhatsAppDashboard"), { ssr: false });
const Automations = dynamic(() => import("../components/Automations"), { ssr: false });

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
          : "dashboard";
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
    <div className="min-h-screen font-sans antialiased text-[var(--text-primary)]">
      <Sidebar activeView={activeView} onNavigate={navigateTo} theme={theme} onToggleTheme={toggleTheme} currentAgent={currentAgent} />

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border-card)] bg-[var(--bg-card)]/85 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: currentAgent.color }}>{currentAgent.initials}</div>
          <span className="font-heading text-base font-extrabold tracking-tight">Brindavan Udyog</span>
        </div>
        <button onClick={toggleTheme} className="rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-[var(--bg-input)]">
          {theme === "dark" ? (
            <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>
          ) : (
            <svg className="h-5 w-5 text-indigo-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          )}
        </button>
      </header>

      <MobileNav activeView={activeView} onNavigate={navigateTo} />

      <main className="md:pl-[284px] p-4 md:p-6 lg:p-8 mb-16 md:mb-0">
        <ErrorBoundary>
          <div className="mx-auto w-full max-w-[1600px]">
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
          </div>
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
