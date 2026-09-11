"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useEnquiryData } from "@/hooks/useEnquiryData";
import { useLiveEvent } from "@/hooks/useLiveData";
import EnquiryList from "@/components/EnquiryList";
import EnquiryDetail from "@/components/EnquiryDetail";
import EnquiryModal from "@/components/EnquiryModal";
import Lightbox from "@/components/Lightbox";
import type { Enquiry, Comment } from "@/types";
import { enquiryLabel } from "@/types";

// Sales Enquiries dashboard (mounted as the `enquiry-tracker` automation).
// Sales-only: the full daily pipeline with PII + lead attribution.
// Procurement and Management have their own pending-only dashboards
// (`enquiry-procurement`, `enquiry-management`) — no tabs here.
export default function EnquiryTracker() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingEnquiry, setEditingEnquiry] = useState<Enquiry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Live intimations: toast when an enquiry transitions to finalized
  // (rates ready) or gains a spec flag (needs correction) while open.
  const [rateToast, setRateToast] = useState<{ id: string; label: string; title: string; kind: "rates" | "spec" | "specdiff" | "request" } | null>(null);
  const rateStatusRef = useRef<Record<string, string>>({});
  const flagCountRef = useRef<Record<string, number>>({});
  const specDiffCountRef = useRef<Record<string, number>>({});
  const requestCountRef = useRef<Record<string, number>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashToast = useCallback((id: string, label: string, title: string, kind: "rates" | "spec" | "specdiff" | "request") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setRateToast({ id, label, title, kind });
    toastTimer.current = setTimeout(() => setRateToast(null), 10000);
  }, []);

  const flashRateToast = useCallback((id: string, label: string, title: string) => {
    flashToast(id, label, title, "rates");
  }, [flashToast]);

  // Access is governed ONLY by the admin-panel grant (enquiry-tracker scope):
  // whoever can open this dashboard sees the full sales pipeline — no
  // in-view department gates here.
  const {
    enquiries, comments, agents, currentAgent, loaded,
    syncState, addEnquiry, updateEnquiry, deleteEnquiry,
    addComment, updateItems, makeActivity, clients,
  } = useEnquiryData("sales");

  const selectedEnquiry = enquiries.find((e) => e.id === selectedId) || null;

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Seed known statuses from the initial fetch (fills gaps only — live events
  // own the refs after that), so the first transition after opening still fires.
  useEffect(() => {
    if (!loaded) return;
    for (const e of enquiries) {
      if (rateStatusRef.current[e.id] === undefined) rateStatusRef.current[e.id] = e.rateStatus ?? "";
      if (flagCountRef.current[e.id] === undefined) {
        flagCountRef.current[e.id] = (e.items ?? []).filter((it) => it.specIssue).length;
      }
      if (specDiffCountRef.current[e.id] === undefined) {
        specDiffCountRef.current[e.id] = (e.items ?? []).reduce((n, it) => n + (it.rates ?? []).filter((r) => r.specSame === false).length, 0);
      }
      if (requestCountRef.current[e.id] === undefined) {
        requestCountRef.current[e.id] = (e.items ?? []).filter((it) => it.ratesRequested).length;
      }
    }
  }, [loaded, enquiries]);

  useLiveEvent((e: any) => {
    if (!e || e.type !== "enquiries" || !e.enquiry) return;
    const id = String(e.enquiry.id ?? "");
    if (!id) return;
    const raw = e.enquiry;
    const label = enquiryLabel({ dailyNo: raw.dailyNo ?? null, createdAt: raw.createdAt ?? "", source: raw.source ?? "TL" });
    const title = String(raw.title || "Untitled enquiry");
    const next = String(raw.rateStatus ?? "");
    const prev = rateStatusRef.current[id];
    rateStatusRef.current[id] = next;
    if (next === "finalized" && prev !== undefined && prev !== "finalized") {
      flashRateToast(id, label, title);
    }
    const flagged = ((raw.items ?? []) as any[]).filter((it) => it?.specIssue).length;
    const prevFlagged = flagCountRef.current[id];
    flagCountRef.current[id] = flagged;
    if (prevFlagged !== undefined && flagged > prevFlagged) {
      flashToast(id, label, title, "spec");
    }
    const diffs = ((raw.items ?? []) as any[]).reduce((n, it) => n + ((it?.rates ?? []).filter((r: any) => r?.specSame === false).length), 0);
    const prevDiffs = specDiffCountRef.current[id];
    specDiffCountRef.current[id] = diffs;
    if (prevDiffs !== undefined && diffs > prevDiffs) {
      flashToast(id, label, title, "specdiff");
    }
    const requested = ((raw.items ?? []) as any[]).filter((it) => it?.ratesRequested).length;
    const prevRequested = requestCountRef.current[id];
    requestCountRef.current[id] = requested;
    if (prevRequested !== undefined && requested > prevRequested) {
      flashToast(id, label, title, "request");
    }
  });

  const handleSaveEnquiry = useCallback(async (data: any) => {
    // EST No. is optional — may be filled in later via Edit Details.
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
          source: data.source,
          clientCompany: data.clientCompany, contactName: data.contactName, contactEmail: data.contactEmail,
          contactPhone: data.contactPhone, description: data.description,
          priority: data.priority, status: data.status, assignedAgentId: data.assignedAgentId,
          additionalRequirements, activities, items: data.items || [],
        });
      } else {
        const saved = await addEnquiry({
          estNumber: data.estNumber, source: data.source || "TL", clientCompany: data.clientCompany, contactName: data.contactName,
          contactEmail: data.contactEmail, contactPhone: data.contactPhone, title: "",
          description: data.description, priority: data.priority, status: data.status,
          assignedAgentId: data.assignedAgentId || "", imageUrls: data.imageUrls || [],
          activities: data.activities || [], additionalRequirements, items: data.items || [],
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

  const handleUpdateItems = useCallback(async (id: string, items: Array<{ name: string; qty: string; spec: string; media?: Array<{ type: 'image' | 'video' | 'pdf'; url: string; name?: string }> }>) => {
    await updateItems(id, items);
  }, [updateItems]);

  const handleExportCSV = useCallback(() => {
    const rows = [["EST No.", "Company", "Contact", "Title", "Status", "Priority"]];
    for (const e of enquiries) {
      rows.push([e.estNumber, e.clientCompany, e.contactName, e.title, e.status, e.priority]);
    }
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
        <h1 className="text-2xl font-bold font-heading text-zinc-900 dark:text-white">Daily Enquiries</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEditingEnquiry(null); setIsAddModalOpen(true); }}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500">
            + New Enquiry
          </button>
        </div>
      </div>

{selectedEnquiry ? (
        <EnquiryDetail selectedEnquiry={selectedEnquiry} agents={agents} currentAgent={currentAgent} comments={comments}
          ratesMode="none"
          onUpdateStatus={(id, s) => void handleUpdateStatus(id, s)}
          onUpdateAgent={(id, a) => void handleUpdateAgent(id, a)}
          onAddComment={(c) => void handleAddComment(c)}
          onUpdateItems={(id, items) => void handleUpdateItems(id, items)}
          onDeleteEnquiry={(id) => void handleDeleteEnquiry(id)}
          onOpenEdit={(e) => { setEditingEnquiry(e); setIsAddModalOpen(true); }}
          onBack={() => setSelectedId(null)}
          onOpenLightbox={handleOpenLightbox}
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
          clients={clients}
          onSave={(d) => void handleSaveEnquiry(d)}
          isSaving={isSaving} saveError={saveError}
        />
      )}

      {rateToast && (
        <div className={`fixed bottom-5 right-5 z-50 max-w-sm rounded-2xl border p-4 shadow-2xl animate-scale-up bg-[var(--bg-card)] ${
          rateToast.kind === "spec" ? "border-red-500/40" : rateToast.kind === "specdiff" ? "border-amber-500/40" : rateToast.kind === "request" ? "border-indigo-500/40" : "border-emerald-500/40"
        }`}>
          <div className="flex items-start gap-3">
            <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-base ${
              rateToast.kind === "spec" ? "bg-red-500/15" : rateToast.kind === "specdiff" ? "bg-amber-500/15" : rateToast.kind === "request" ? "bg-indigo-500/15" : "bg-emerald-500/15"
            }`}>{rateToast.kind === "spec" ? "🚩" : rateToast.kind === "specdiff" ? "⚠" : rateToast.kind === "request" ? "📩" : "💰"}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-extrabold ${
                rateToast.kind === "spec" ? "text-red-500" : rateToast.kind === "specdiff" ? "text-amber-600 dark:text-amber-400" : rateToast.kind === "request" ? "text-indigo-500" : "text-emerald-600 dark:text-emerald-400"
              }`}>{rateToast.kind === "spec" ? "Spec flagged — correction needed" : rateToast.kind === "specdiff" ? "Vendor quoted a different spec" : rateToast.kind === "request" ? "Management requested more rates" : "Rates ready"}</p>
              <p className="truncate text-sm font-bold text-[var(--text-primary)]">{rateToast.title}</p>
              <p className="text-[11px] font-semibold text-[var(--color-brand-indigo)]">{rateToast.label}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => { setSelectedId(rateToast.id); setRateToast(null); }}
                  className={`px-3 py-1.5 rounded-lg text-white text-xs font-bold cursor-pointer border-0 ${
                    rateToast.kind === "spec" ? "bg-red-500 hover:bg-red-400" : rateToast.kind === "specdiff" ? "bg-amber-500 hover:bg-amber-400" : rateToast.kind === "request" ? "bg-indigo-600 hover:bg-indigo-500" : "bg-emerald-600 hover:bg-emerald-500"
                  }`}
                >
                  {rateToast.kind === "rates" ? "View rates" : "View item"}
                </button>
                <button
                  type="button"
                  onClick={() => setRateToast(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
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