"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useAuth } from "@/auth/AuthContext";
import EnquiryList from "@/components/EnquiryList";
import EnquiryKanban from "@/components/EnquiryKanban";
import EnquiryDetail from "@/components/EnquiryDetail";
import EnquiryModal from "@/components/EnquiryModal";
import Lightbox from "@/components/Lightbox";
import type { Enquiry, Comment } from "@/types";

// Enquiry Tracker dashboard (mounted as the `enquiry-tracker` automation).
// Persists to the backend and updates live via the EventHub.
export default function EnquiryTracker() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEnquiry, setEditingEnquiry] = useState<Enquiry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const [boardView, setBoardView] = useState<"list" | "board">("list");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Sales | Procurement scoped views (telecalling pattern: scope-gated tabs)
  // Sales = full PII + lead attribution. Procurement = same pipeline, client
  // PII + lead identity hidden (also enforced by the API, never UI-only).
  const { me } = useAuth();
  const scopes = me?.scopes ?? [];
  const privileged = !!me && (me.isAdmin || scopes.includes("mis"));
  const isSalesTeam = privileged || scopes.includes("sales");
  const isProcurementTeam = privileged || scopes.includes("procurement");
  const [teamView, setTeamView] = useState<"sales" | "procurement">("sales");
  // Procurement-marked staff without a sales-side grant land on procurement.
  useEffect(() => {
    if (!isSalesTeam && isProcurementTeam) setTeamView("procurement");
  }, [isSalesTeam, isProcurementTeam]);
  const showSalesTab = isSalesTeam || (!isSalesTeam && !isProcurementTeam);
  const redacted = teamView === "procurement";
  const {
    enquiries, comments, agents, currentAgent, loaded,
    syncState, addEnquiry, updateEnquiry, deleteEnquiry,
    addComment, addRequirement, updateItems, makeActivity, clients,
  } = useEnquiryData(redacted ? "procurement" : "sales");

  const selectedEnquiry = enquiries.find((e) => e.id === selectedId) || null;

  const handleSaveEnquiry = useCallback(async (data: any) => {
    if (!data.estNumber) return;
    setIsSaving(true);
    setSaveError(null);
    let newId: string | null = null;
    try {
      const additionalRequirements = Array.isArray(data.additionalRequirements) ? data.additionalRequirements.filter((r: string) => r.trim()) : [];

      if (editingEnquiry) {
        const original = editingEnquiry;
        const changes: string[] = [];
        if (original.status !== data.status) changes.push(`Status updated from ${original.status.toUpperCase()} to ${data.status.toUpperCase()}`);
        if (original.priority !== data.priority) changes.push(`Priority changed from ${original.priority.toUpperCase()} to ${data.priority.toUpperCase()}`);
        if (original.assignedAgentId !== data.assignedAgentId) changes.push(`Lead changed to ${agents.find((a) => a.id === data.assignedAgentId)?.name || ""}`);
        const activities = [...(original.activities || [])];
        changes.forEach((text) => activities.push(makeActivity("status_change", text, original.assignedAgentId)));
        await updateEnquiry(original.id, {
          estNumber: data.estNumber,
          clientCompany: data.clientCompany, contactName: data.contactName, contactEmail: data.contactEmail,
          contactPhone: data.contactPhone, title: data.title, description: data.description,
          priority: data.priority, status: data.status, assignedAgentId: data.assignedAgentId,
          additionalRequirements, activities,
        });
      } else {
        const saved = await addEnquiry({
          estNumber: data.estNumber, clientCompany: data.clientCompany, contactName: data.contactName,
          contactEmail: data.contactEmail, contactPhone: data.contactPhone, title: data.title,
          description: data.description, priority: data.priority, status: data.status,
          assignedAgentId: data.assignedAgentId || "", imageUrls: data.imageUrls || [],
          activities: data.activities || [], additionalRequirements,
          id: "", createdAt: "", updatedAt: "",
        } as any);
        newId = saved?.id || null;
      }
      // No polling: the save is applied optimistically above, and the
      // backend's AI extraction broadcasts a live `enquiries/updated` event
      // (handled in useEnquiryData) that merges the structured fields into
      // the visible row within seconds.
      setIsAddModalOpen(false);
      setEditingEnquiry(null);
      if (newId) setSelectedId(newId);
    } catch (e: any) {
      console.error("save failed", e);
      setSaveError(e?.message || "Failed to save enquiry");
    } finally {
      setIsSaving(false);
    }
  }, [agents, editingEnquiry, updateEnquiry, addEnquiry, makeActivity]);

  const handleOpenLightbox = useCallback((url: string, list?: string[], idx?: number) => {
    const images = Array.isArray(list) && list.length > 0 ? list.filter(Boolean) : [url].filter(Boolean);
    if (images.length === 0) return;
    const index = typeof idx === "number" && images[idx] ? idx : Math.max(0, images.indexOf(url));
    setLightbox({ images, index });
  }, []);

  const handleDeleteEnquiry = useCallback(async (id: string) => {
    await deleteEnquiry(id);
    if (selectedId === id) setSelectedId(null);
  }, [selectedId, deleteEnquiry]);

  const handleUpdateStatus = useCallback(async (id: string, newStatus: Enquiry["status"]) => {
    await updateEnquiry(id, { status: newStatus });
  }, [updateEnquiry]);

  const handleUpdateAgent = useCallback(async (id: string, newAgentId: string) => {
    await updateEnquiry(id, { assignedAgentId: newAgentId });
  }, [updateEnquiry]);

  const handleAddComment = useCallback(async (newComment: Comment) => {
    await addComment(newComment);
  }, [addComment]);

  const handleUpdateItems = useCallback(async (id: string, items: Array<{ name: string; qty: string; spec: string; media?: Array<{ type: 'image' | 'video'; url: string }> }>) => {
    await updateItems(id, items);
  }, [updateItems]);

  const handleExportCSV = useCallback(() => {
    const rows = redacted
      ? [["Title", "Priority"]]
      : [["EST No.", "Company", "Contact", "Title", "Status", "Priority"]];
    for (const e of enquiries) {
      rows.push(redacted
        ? [e.title, e.priority]
        : [e.estNumber, e.clientCompany, e.contactName, e.title, e.status, e.priority]);
    }
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "enquiries.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [enquiries, redacted]);

  if (!loaded) {
    return <div className="flex min-h-[50vh] items-center justify-center text-zinc-500 animate-pulse">Loading enquiries…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Enquiry Tracker</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-900 p-0.5 text-xs font-bold">
            <button onClick={() => setBoardView("list")}
              className={`px-3 py-1.5 rounded-md transition-colors ${boardView === "list" ? "bg-[var(--bg-card)] shadow-sm text-[var(--text-primary)]" : "text-zinc-500 dark:text-zinc-400"}`}>
              List
            </button>
            <button onClick={() => setBoardView("board")}
              className={`px-3 py-1.5 rounded-md transition-colors ${boardView === "board" ? "bg-[var(--bg-card)] shadow-sm text-[var(--text-primary)]" : "text-zinc-500 dark:text-zinc-400"}`}>
              Board
            </button>
          </div>
          <button onClick={() => { setEditingEnquiry(null); setIsAddModalOpen(true); }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
            + New Enquiry
          </button>
        </div>
      </div>

      {(showSalesTab || isProcurementTeam) && (
        <nav className="flex flex-row flex-wrap gap-2">
          {showSalesTab && (
            <button onClick={() => setTeamView("sales")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${teamView === "sales" ? "bg-indigo-600 text-white shadow-sm" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
              <span className="text-base leading-none">🤝</span>Sales
            </button>
          )}
          {isProcurementTeam && (
            <button onClick={() => setTeamView("procurement")}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${teamView === "procurement" ? "bg-indigo-600 text-white shadow-sm" : "bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}>
              <span className="text-base leading-none">📦</span>Procurement
            </button>
          )}
        </nav>
      )}

{selectedEnquiry ? (
        <EnquiryDetail selectedEnquiry={selectedEnquiry} agents={agents} currentAgent={currentAgent} comments={comments}
          redacted={redacted}
          onUpdateStatus={(id, s) => void handleUpdateStatus(id, s)}
          onUpdateAgent={(id, a) => void handleUpdateAgent(id, a)}
          onAddComment={(c) => void handleAddComment(c)}
          onAddRequirement={addRequirement}
          onUpdateItems={(id, items) => void handleUpdateItems(id, items)}
          onDeleteEnquiry={(id) => void handleDeleteEnquiry(id)}
          onOpenEdit={(e) => { setEditingEnquiry(e); setIsAddModalOpen(true); }}
          onBack={() => setSelectedId(null)}
          onOpenLightbox={handleOpenLightbox}
        />
      ) : boardView === "board" ? (
        <EnquiryKanban enquiries={enquiries} agents={agents} redacted={redacted}
          onViewDetail={(id) => { setSelectedId(id); }}
          onUpdateStatus={(id, s) => void handleUpdateStatus(id, s)}
        />
      ) : (
        <EnquiryList enquiries={enquiries} agents={agents} redacted={redacted}
          onViewDetail={(id) => { setSelectedId(id); }}
          onOpenCreate={() => { setEditingEnquiry(null); setIsAddModalOpen(true); }}
          onExportCSV={handleExportCSV}
          onImportCSV={() => {}}
          fileInputRef={fileInputRef}
          triggerCSVInput={() => fileInputRef.current?.click()}
        />
      )}

      {isAddModalOpen && (
        <EnquiryModal key={editingEnquiry?.id || "new-enquiry"}
          isOpen={isAddModalOpen} onClose={() => { if (!isSaving) { setIsAddModalOpen(false); setEditingEnquiry(null); } }}
          editingEnquiry={editingEnquiry} agents={agents} currentAgent={currentAgent}
          clients={clients}
          redacted={redacted}
          onSave={(d) => void handleSaveEnquiry(d)}
          isSaving={isSaving} saveError={saveError}
        />
      )}

      {lightbox && (
        <Lightbox
          images={lightbox.images}
          initialIndex={lightbox.index}
          image={null}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}