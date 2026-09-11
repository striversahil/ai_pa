'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Enquiry, Comment, Agent, Activity } from '../types';
import { useLiveEvent } from './useLiveData';

// Live enquiry tracker: reads/writes go to the backend (/api/enquiries), which
// persists to D1/Postgres and broadcasts every change over the EventHub. Open
// dashboards update instantly (no localStorage).

function toComment(raw: any): Comment {
  return {
    id: raw.id,
    enquiryId: raw.enquiryId,
    agentId: String(raw.agentId ?? ''),
    content: raw.content,
    createdAt: raw.createdAt,
    parentId: raw.parentId ?? null,
    imageUrl: raw.imageUrl || undefined,
  };
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
}

function toEnquiry(raw: any): Enquiry {
  const imageUrls = Array.isArray(raw.imageUrls) ? raw.imageUrls : [];
  const activities = Array.isArray(raw.activities) ? raw.activities : [];
  const additionalRequirements = Array.isArray(raw.additionalRequirements)
    ? raw.additionalRequirements.map((r: any) => (typeof r === "string" ? { text: r } : { text: String(r?.text ?? ""), imageUrl: r?.imageUrl || undefined }))
    : [];
  const items = Array.isArray(raw.items)
    ? raw.items.map((r: any) => ({
        name: String(r?.name ?? ""),
        qty: String(r?.qty ?? ""),
        spec: String(r?.spec ?? ""),
        media: Array.isArray(r?.media)
          ? r.media
              .map((m: any) => ({ type: m?.type === "video" ? "video" : "image", url: String(m?.url ?? "") }))
              .filter((m: any) => m.url.length > 0)
          : [],
      })).filter((r: any) => r.name.trim() || r.qty.trim() || r.spec.trim() || r.media.length > 0)
    : [];
  return {
    id: raw.id,
    estNumber: raw.estNumber || '',
    enquiryNumber: raw.enquiryNumber || '',
    sourceLead: raw.sourceLead || '',
    location: raw.location || '',
    clientCompany: raw.clientCompany,
    contactName: raw.contactName,
    contactEmail: raw.contactEmail,
    contactPhone: raw.contactPhone,
    title: raw.title,
    description: raw.description,
    priority: raw.priority || 'medium',
    status: raw.status || 'new',
    assignedAgentId: String(raw.assignedAgentId ?? ''),
    createdAt: raw.createdAt,
    activities,
    imageUrls,
    additionalRequirements,
    items,
  };
}

export function useEnquiryData(view: "sales" | "procurement" = "sales") {
  const AGENT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16'];
  const redactedView = view === "procurement";
  // Procurement tab always reads the server-redacted payload (?view=procurement)
  // so privileged users preview exactly what procurement sees — never raw PII.
  const qs = redactedView ? "?view=procurement" : "";

  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [clients, setClients] = useState<Array<{ name: string; openEstimates: number; enquiries: number }>>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [enqRes, agentsRes, clientsRes] = await Promise.all([
        fetch(`/api/enquiries${qs}`),
        fetch(`/api/enquiries/agents${qs}`),
        fetch(`/api/enquiries/clients${qs}`),
      ]);
      if (!enqRes.ok) throw new Error('load failed');
      const data = await enqRes.json();
      const list = Array.isArray(data.enquiries) ? data.enquiries : [];
      const coms = Array.isArray(data.comments) ? data.comments : [];
      setEnquiries(list.map(toEnquiry));
      setComments(coms.map(toComment));
      if (agentsRes.ok) {
        const raw = await agentsRes.json();
        const sales = Array.isArray(raw) ? raw : [];
        setAgents(sales.map((a: any, i: number) => ({
          id: String(a.id),
          name: a.name,
          initials: initialsOf(a.name),
          color: AGENT_COLORS[i % AGENT_COLORS.length],
          status: 'active',
        })));
      }
      if (clientsRes.ok) {
        const raw = await clientsRes.json();
        setClients(Array.isArray(raw) ? raw.map((c: any) => ({
          name: String(c?.name ?? ""),
          openEstimates: Number(c?.openEstimates ?? 0),
          enquiries: Number(c?.enquiries ?? 0),
        })).filter((c: any) => c.name) : []);
      }
    } catch (e) {
      console.error('Failed to load enquiries:', e);
    } finally {
      setLoaded(true);
    }
  }, [qs]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Live updates: sales view applies events optimistically; procurement view
  // refetches the redacted payload instead — live broadcasts carry FULL
  // enquiry objects, which must never be applied to the redacted screen.
  const fetchAllRef = useRef(fetchAll);
  fetchAllRef.current = fetchAll;
  useLiveEvent((e) => {
    if (!e || (e as any).type !== 'enquiries') return;
    if (redactedView) { void fetchAllRef.current(); return; }
    const ev = e as any;
    if (ev.action === 'created' && ev.enquiry) {
      setEnquiries((prev) => [toEnquiry(ev.enquiry), ...prev.filter((x) => x.id !== ev.enquiry.id)]);
    } else if (ev.action === 'updated' && ev.enquiry) {
      setEnquiries((prev) => prev.map((x) => (x.id === ev.enquiry.id ? toEnquiry(ev.enquiry) : x)));
    } else if (ev.action === 'deleted' && ev.id) {
      setEnquiries((prev) => prev.filter((x) => x.id !== ev.id));
    } else if (ev.action === 'comment' && ev.comment) {
      const c = toComment(ev.comment);
      setComments((prev) => {
        if (prev.some((x) => x.id === c.id)) return prev;
        return [...prev, c];
      });
    } else if (ev.action === 'requirement' && ev.enquiry) {
      setEnquiries((prev) => prev.map((x) => (x.id === ev.enquiry.id ? toEnquiry(ev.enquiry) : x)));
    }
  });

  const syncState = useCallback((updatedEnquiries: Enquiry[], updatedComments: Comment[], _updatedAgents: Agent[]) => {
    setEnquiries(updatedEnquiries);
    setComments(updatedComments);
  }, []);

  const currentAgent = useMemo(() => {
    return agents[0] || { id: '', name: 'Sales Agent', initials: 'SA', color: '#6366f1', status: 'active' as const };
  }, [agents]);

  const selectedEnquiry = useMemo(() => null as Enquiry | null, []);

  const persist = async (method: string, path: string, body?: any) => {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error('request failed');
    return res.json();
  };

  const addEnquiry = useCallback(async (enquiry: Enquiry) => {
    const saved = await persist('POST', '/api/enquiries', {
      estNumber: enquiry.estNumber,
      clientCompany: enquiry.clientCompany, contactName: enquiry.contactName,
      contactEmail: enquiry.contactEmail, contactPhone: enquiry.contactPhone,
      title: enquiry.title, description: enquiry.description,
      priority: enquiry.priority, status: enquiry.status,
      assignedAgentId: enquiry.assignedAgentId,
      imageUrls: enquiry.imageUrls || [], activities: enquiry.activities || [],
      additionalRequirements: enquiry.additionalRequirements || [],
    });
    setEnquiries((prev) => [toEnquiry(saved), ...prev]);
    return saved;
  }, []);

  const updateEnquiry = useCallback(async (id: string, updates: Partial<Enquiry>) => {
    const saved = await persist('PATCH', `/api/enquiries/${id}`, updates);
    setEnquiries((prev) => prev.map((x) => (x.id === id ? toEnquiry(saved) : x)));
  }, []);

  const deleteEnquiry = useCallback(async (id: string) => {
    await persist('DELETE', `/api/enquiries/${id}`);
    setEnquiries((prev) => prev.filter((x) => x.id !== id));
    setComments((prev) => prev.filter((c) => c.enquiryId !== id));
  }, []);

  const addComment = useCallback(async (comment: Comment) => {
    const saved = await persist('POST', `/api/enquiries/${comment.enquiryId}/comments`, {
      agentId: comment.agentId, content: comment.content, parentId: comment.parentId,
      imageUrl: comment.imageUrl,
    });
    setComments((prev) => (prev.some((x) => x.id === saved.id) ? prev : [...prev, toComment(saved)]));
  }, []);

  const addRequirement = useCallback(async (enquiryId: string, text: string, imageUrl?: string) => {
    const saved = await persist('POST', `/api/enquiries/${enquiryId}/additional-requirements`, { text, imageUrl });
    if (saved.enquiry) setEnquiries((prev) => prev.map((x) => (x.id === enquiryId ? toEnquiry(saved.enquiry) : x)));
    return saved.requirement;
  }, []);

  const updateItems = useCallback(async (enquiryId: string, items: Array<{ name: string; qty: string; spec: string }>) => {
    const saved = await persist('PATCH', `/api/enquiries/${enquiryId}`, { items });
    setEnquiries((prev) => prev.map((x) => (x.id === enquiryId ? toEnquiry(saved) : x)));
    return saved;
  }, []);

  // Keep a local activity helper for optimistic UI parity.
  const makeActivity = useCallback((type: Activity['type'], text: string, agentId?: string): Activity => ({
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type, text, timestamp: new Date().toISOString(), agentId,
  }), []);

  return {
    enquiries, setEnquiries,
    comments, setComments,
    agents,
    clients,
    currentAgent,
    loaded,
    syncState,
    addEnquiry,
    updateEnquiry,
    deleteEnquiry,
    addComment,
    addRequirement,
    updateItems,
    makeActivity,
    refresh: fetchAll,
  };
}