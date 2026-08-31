"use client";

import React, { useState, useCallback, useRef } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import EnquiryList from "@/components/EnquiryList";
import EnquiryDetail from "@/components/EnquiryDetail";
import EnquiryModal from "@/components/EnquiryModal";
import type { Enquiry, Comment } from "@/types";

// Enquiry Tracker dashboard (mounted as the `enquiry-tracker` automation).
// Persists to the backend and updates live via the EventHub.
export default function EnquiryTracker() {
const {
    enquiries, comments, agents, currentAgent, loaded,
    syncState, addEnquiry, updateEnquiry, deleteEnquiry,
    addComment, addRequirement, makeActivity,
  } = useEnquiryData();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEnquiry, setEditingEnquiry] = useState<Enquiry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (original.assignedAgentId !== data.assignedAgentId) changes.push(`Assigned agent changed to ${agents.find((a) => a.id === data.assignedAgentId)?.name || ""}`);
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
      // Wait for the AI-formatted version to arrive (live event or poll) so the
      // user sees "Processing → formatted enquiry", then reveal it.
      await waitForFormatted(newId);
      setIsAddModalOpen(false);
      setEditingEnquiry(null);
      if (newId) setSelectedId(newId);
    } catch (e: any) {
      console.error("save failed", e);
      setSaveError(e?.message || "Failed to save enquiry");
    } finally {
      setIsSaving(false);
    }
  }, [enquiries, agents, currentAgent, editingEnquiry, updateEnquiry, addEnquiry, makeActivity]);

  // Poll the backend until the enquiry's AI-extracted fields arrive (up to ~20s),
  // so the processing step is visible and the formatted enquiry is shown.
  const waitForFormatted = useCallback(async (id: string | null) => {
    if (!id) return;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const already = enquiries.find((e) => e.id === id);
      if (already && (already.title || already.clientCompany)) return;
      try {
        const res = await fetch("/api/enquiries", { headers: { "Content-Type": "application/json" } });
        if (res.ok) {
          const data = await res.json();
          const hit = (data.enquiries || []).find((e: any) => e.id === id);
          if (hit && (hit.title || hit.clientCompany)) return;
        }
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, 800));
    }
  }, [enquiries]);

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

  const handleExportCSV = useCallback(() => {
    const rows = [["EST No.", "Company", "Contact", "Title", "Status", "Priority"]];
    for (const e of enquiries) rows.push([e.estNumber, e.clientCompany, e.contactName, e.title, e.status, e.priority]);
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "enquiries.csv"; a.click();
    URL.revokeObjectURL(url);
  }, [enquiries]);

  if (!loaded) {
    return <div className="flex min-h-[50vh] items-center justify-center text-zinc-500 animate-pulse">Loading enquiries…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Enquiry Tracker</h1>
        <button onClick={() => { setEditingEnquiry(null); setIsAddModalOpen(true); }}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
          + New Enquiry
        </button>
      </div>

{selectedEnquiry ? (
        <EnquiryDetail selectedEnquiry={selectedEnquiry} agents={agents} currentAgent={currentAgent} comments={comments}
          onUpdateStatus={(id, s) => void handleUpdateStatus(id, s)}
          onUpdateAgent={(id, a) => void handleUpdateAgent(id, a)}
          onAddComment={(c) => void handleAddComment(c)}
          onAddRequirement={addRequirement}
          onDeleteEnquiry={(id) => void handleDeleteEnquiry(id)}
          onOpenEdit={(e) => { setEditingEnquiry(e); setIsAddModalOpen(true); }}
          onBack={() => setSelectedId(null)}
          onOpenLightbox={() => {}}
        />
      ) : (
        <EnquiryList enquiries={enquiries} agents={agents}
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
          onSave={(d) => void handleSaveEnquiry(d)}
          isSaving={isSaving} saveError={saveError}
        />
      )}
    </div>
  );
}