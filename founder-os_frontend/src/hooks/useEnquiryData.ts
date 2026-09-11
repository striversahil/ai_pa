'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Enquiry, Comment, Agent, Activity, EnquiryItem } from '../types';
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
              .map((m: any) => ({
                type: m?.type === "video" ? "video" : m?.type === "pdf" ? "pdf" : "image",
                url: String(m?.url ?? ""),
                name: m?.name ? String(m.name) : undefined,
              }))
              .filter((m: any) => m.url.length > 0)
          : [],
        rates: Array.isArray(r?.rates)
          ? r.rates
              .map((q: any) => ({
                vendor: String(q?.vendor ?? ""),
                rate: Number(q?.rate ?? NaN),
                description: q?.description ? String(q.description) : undefined,
                specSame: q?.specSame === false ? false : true,
                specDiff: q?.specSame === false && q?.specDiff ? String(q.specDiff) : undefined,
                quotedAt: q?.quotedAt ? String(q.quotedAt) : undefined,
              }))
              .filter((q: any) => q.vendor.trim() && Number.isFinite(q.rate))
          : [],
        selectedVendor: r?.selectedVendor ? String(r.selectedVendor) : undefined,
        markup: r?.markup !== undefined && r?.markup !== null && r?.markup !== "" ? Number(r.markup) : undefined,
        finalRate: r?.finalRate !== undefined && r?.finalRate !== null && r?.finalRate !== "" ? Number(r.finalRate) : undefined,
        finalizedAt: r?.finalizedAt ? String(r.finalizedAt) : undefined,
        specIssue: r?.specIssue ? String(r.specIssue) : undefined,
        specFlaggedAt: r?.specFlaggedAt ? String(r.specFlaggedAt) : undefined,
        rateAvailable: r?.rateAvailable === true,
        ratesRequested: r?.ratesRequested ? String(r.ratesRequested) : undefined,
        ratesRequestedAt: r?.ratesRequestedAt ? String(r.ratesRequestedAt) : undefined,
      })).filter((r: any) => r.name.trim() || r.qty.trim() || r.spec.trim() || r.media.length > 0 || (r.rates ?? []).length > 0)
    : [];
  return {
    id: raw.id,
    estNumber: raw.estNumber || '',
    dailyNo: raw.dailyNo === undefined || raw.dailyNo === null ? null : Number(raw.dailyNo),
    source: raw.source || 'TL',
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
    rateStatus: raw.rateStatus || '',
    assignedAgentId: String(raw.assignedAgentId ?? ''),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt || raw.createdAt,
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

  // Ref-mirrored enquiries + per-enquiry write chains. Rapid successive item
  // writes (e.g. adding vendor A then vendor B) must serialize: each PATCH
  // body is built from the LATEST committed items, never a stale render
  // snapshot — otherwise the second save overwrites the first and the earlier
  // rate "shows for a second, then disappears". The ref updates synchronously
  // on every write path below (not on render), so chained steps always see
  // the previous step's result.
  const enquiriesRef = useRef<Enquiry[]>([]);
  const chainsRef = useRef<Record<string, Promise<any>>>({});
  const setEnquiriesSynced = useCallback((next: Enquiry[] | ((prev: Enquiry[]) => Enquiry[])) => {
    const resolved = typeof next === "function" ? (next as (p: Enquiry[]) => Enquiry[])(enquiriesRef.current) : next;
    enquiriesRef.current = resolved;
    setEnquiries(resolved);
  }, []);

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
      setEnquiriesSynced(list.map(toEnquiry));
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
  // The refetch is trailing-edge debounced: a burst of own-write broadcasts
  // must settle before re-reading, or a stale read lands after the save and
  // the just-added rate "disappears" until the next refresh.
  const fetchAllRef = useRef(fetchAll);
  fetchAllRef.current = fetchAll;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLiveEvent((e) => {
    if (!e || (e as any).type !== 'enquiries') return;
    if (redactedView) {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => { void fetchAllRef.current(); }, 1200);
      return;
    }
    const ev = e as any;
    if (ev.action === 'created' && ev.enquiry) {
      setEnquiriesSynced([toEnquiry(ev.enquiry), ...enquiriesRef.current.filter((x) => x.id !== ev.enquiry.id)]);
    } else if (ev.action === 'updated' && ev.enquiry) {
      setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === ev.enquiry.id ? toEnquiry(ev.enquiry) : x)));
    } else if (ev.action === 'deleted' && ev.id) {
      setEnquiriesSynced(enquiriesRef.current.filter((x) => x.id !== ev.id));
    } else if (ev.action === 'comment' && ev.comment) {
      const c = toComment(ev.comment);
      setComments((prev) => {
        if (prev.some((x) => x.id === c.id)) return prev;
        return [...prev, c];
      });
    } else if (ev.action === 'requirement' && ev.enquiry) {
      setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === ev.enquiry.id ? toEnquiry(ev.enquiry) : x)));
    }
  });

  const syncState = useCallback((updatedEnquiries: Enquiry[], updatedComments: Comment[], _updatedAgents: Agent[]) => {
    setEnquiriesSynced(updatedEnquiries);
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
      source: (enquiry as any).source || 'TL',
      clientCompany: enquiry.clientCompany, contactName: enquiry.contactName,
      contactEmail: enquiry.contactEmail, contactPhone: enquiry.contactPhone,
      title: enquiry.title, description: enquiry.description,
      priority: enquiry.priority, status: enquiry.status,
      assignedAgentId: enquiry.assignedAgentId,
      imageUrls: enquiry.imageUrls || [], activities: enquiry.activities || [],
      additionalRequirements: enquiry.additionalRequirements || [],
      items: enquiry.items || [],
    });
    setEnquiriesSynced([toEnquiry(saved), ...enquiriesRef.current]);
    return saved;
  }, []);

  const updateEnquiry = useCallback(async (id: string, updates: Partial<Enquiry>) => {
    const saved = await persist('PATCH', `/api/enquiries/${id}`, updates);
    setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === id ? toEnquiry(saved) : x)));
  }, []);

  const deleteEnquiry = useCallback(async (id: string) => {
    await persist('DELETE', `/api/enquiries/${id}`);
    setEnquiriesSynced(enquiriesRef.current.filter((x) => x.id !== id));
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
    if (saved.enquiry) setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === enquiryId ? toEnquiry(saved.enquiry) : x)));
    return saved.requirement;
  }, []);

  // Serialized per enquiry: each step builds its PATCH body from the ref
  // (fresh after the previous step resolved), so rapid writes can't fork.
  // Accepts a plain array (one-shot saves) or an updater over latest items.
  // Optimistic: the change applies locally the instant it is made — the
  // server roundtrip only reconciles afterwards, and a failure resyncs from
  // server truth so the UI never sits on a lie.
  const updateItems = useCallback(async (
    enquiryId: string,
    itemsOrFn: EnquiryItem[] | ((items: EnquiryItem[]) => EnquiryItem[]),
  ) => {
    const run = async () => {
      const base = enquiriesRef.current.find((x) => x.id === enquiryId)?.items ?? [];
      const items = typeof itemsOrFn === "function" ? itemsOrFn(base) : itemsOrFn;
      setEnquiriesSynced(enquiriesRef.current.map((x) =>
        x.id === enquiryId ? { ...x, items: items as EnquiryItem[] } : x));
      try {
        const saved = await persist('PATCH', `/api/enquiries/${enquiryId}`, { items });
        setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === enquiryId ? toEnquiry(saved) : x)));
        return saved;
      } catch (err) {
        console.error('updateItems failed, resyncing:', err);
        void fetchAllRef.current();
        throw err;
      }
    };
    const prev = chainsRef.current[enquiryId] ?? Promise.resolve();
    const next = prev.then(run, run);
    chainsRef.current[enquiryId] = next.catch(() => {});
    return next;
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