'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Enquiry, Comment, Agent, Activity, EnquiryItem } from '../types';
import { toEnquiry, toComment, initialsOf } from '@/enquiry/normalize';
import { matchesEnquiryQuery } from '@/enquiry/search';
import { useLiveEvent } from './useLiveData';

// Live enquiry tracker: reads/writes go to the backend (/api/enquiries), which
// persists to D1/Postgres and broadcasts every change over the EventHub. Open
// dashboards update instantly (no localStorage).
//
// Row normalization lives in @/enquiry/normalize (single home); queue
// predicates in @/enquiry/queue; pricing math in @/enquiry/pricing.
export function useEnquiryData(view: "sales" | "procurement" = "sales", paging?: { pageSize?: number }) {
  const AGENT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16'];
  const redactedView = view === "procurement";
  // Cursor-capped queue mode: pageSize > 0 loads the newest pageSize rows and
  // Load-mores the rest by keyset cursor (flat D1 cost per page — ~100 rows
  // read no matter how large the table grows). 0/absent = full list (sales
  // tracker behaviour, unchanged).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(paging?.pageSize ?? 0);
  const [total, setTotal] = useState<number | null>(null);
  const cursorMode = (paging?.pageSize ?? 0) > 0;
  const [hasMore, setHasMore] = useState(false);
  const nextCursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  // Server search (EST no., enquiry no., client/contact, title, item/vendor
  // text) across ALL rows — old + new, past the 100-cap. Debounced 300ms,
  // min 2 chars, in-flight requests aborted. While active the list IS the
  // match set: background merges and new-row prepends stay out so results
  // never get polluted; clearing restores the queue page.
  //
  // Queue-split (procurement) views are local-first: the gate above serves
  // local matches instantly and this server path runs only on a local miss.
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [searching, setSearching] = useState(false);
  // Local-first search (queue-split procurement view only — the sales tracker
  // below keeps server-first): the store already holds EVERY row, so a query
  // that matches locally filters instantly with zero backend traffic.
  // `searchLocal` = showing local matches; the database search fires only on
  // a local miss. Sales behaviour is untouched (queueSplit false → skipped).
  const [searchLocal, setSearchLocal] = useState(false);
  const searchActiveRef = useRef(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  // Latest query text (mirrored): lets a late search response check whether
  // the box still holds the query it was dispatched for before overwriting
  // the list — otherwise clearing mid-flight freezes the match set on screen
  // with an empty box and no way back (stuck `searchActive`).
  const searchQueryRef = useRef("");
  const clearSearch = useCallback(() => { setSearchQuery(""); }, []);
  const setPageSize = useCallback((n: number) => { setPageSizeState(n); setPage(1); }, []);  // Procurement tab always reads the server-redacted payload (?view=procurement)
  // so privileged users preview exactly what procurement sees — never raw PII.
  const qs = redactedView ? "?view=procurement" : "";
  // Cursor mode must send `cursor=` (even empty) on the FIRST load: without
  // it the backend falls into page/offset mode capped at 50 rows with no
  // nextCursor, so "Load older" dead-ends and rows past #50 (e.g. Geetu,
  // 21 SEP) never load. Empty cursor = first keyset page (100 rows).
  const baseQs = cursorMode
    ? `${qs ? "&" : "?"}limit=${pageSize}&cursor=`
    : (pageSize > 0 ? `${qs ? "&" : "?"}page=${page}&limit=${pageSize}` : "");

  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [clients, setClients] = useState<Array<{ name: string; openEstimates: number; enquiries: number }>>([]);
  const [loaded, setLoaded] = useState(false);
  // Last item/enquiry save failure, shown as a banner (never a silent
  // console-only revert — sales re-clicking a "stuck" save is how duplicates
  // and lost items happened). Cleared on the next mutation attempt.
  const [saveError, setSaveError] = useState<string | null>(null);
  const dismissSaveError = useCallback(() => setSaveError(null), []);
  // False when the backend has no AI keys: the redacted view then withholds
  // free text with an explicit banner (not silent blanks).
  const [aiConfigured, setAiConfigured] = useState(true);
  // Login email (same session as these fetches): resolves the signed-in
  // sales agent to their own roster row for currentAgent below.
  const [userEmail, setUserEmail] = useState("");
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUserEmail(String(d?.user?.email ?? "").toLowerCase().trim()))
      .catch(() => {});
  }, []);

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

  // Slow-moving lookups load once per mount. The live path refetches the
  // enquiries list only — agents/clients almost never change mid-session.
  const fetchStatic = useCallback(async () => {
    try {
      const [agentsRes, clientsRes] = await Promise.all([
        fetch(`/api/enquiries/agents${qs}`),
        fetch(`/api/enquiries/clients${qs}`),
      ]);
      if (agentsRes.ok) {
        const raw = await agentsRes.json();
        const sales = Array.isArray(raw) ? raw : [];
        setAgents(sales.map((a: any, i: number) => ({
          id: String(a.id),
          name: a.name,
          initials: initialsOf(a.name),
          color: AGENT_COLORS[i % AGENT_COLORS.length],
          status: 'active',
          email: a?.email ? String(a.email) : null,
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
      console.error('Failed to load enquiry lookups:', e);
    }
  }, [qs]);

  // Procurement queue view reads server-partitioned queues off ONE cached
  // scan (`GET /api/enquiries/queues`): `proc-pending` AND `proc-history`
  // both arrive COMPLETE (every row, however old — no page boundary hides
  // anything), combined into the one store the memos split. Same redacted
  // bytes as `?view=procurement`; mutations, optimistic writes, search and
  // toasts below keep working untouched. Per render: KV reads only, zero D1
  // within the 60s TTL.
  const queueSplit = redactedView && cursorMode;

  // mode: 'reset' replaces the list (mount). 'more' appends the next cursor
  // page (Load more — deduped by id, so rows shifting between pages never
  // duplicate). 'merge' upserts page 1 into the accumulated list (polls,
  // estimates events, redacted debounced refetches) so background refreshes
  // never yank away already-loaded older pages. In queue-split mode 'merge'
  // replaces instead (pending membership flips rows between queues).
  const fetchEnquiries = useCallback(async (mode: 'reset' | 'more' | 'merge' = 'reset') => {
    // Search results are frozen: background merges stay out while a search
    // is active (explicit clear restores the queue).
    if (mode === 'merge' && searchActiveRef.current) return;
    if (mode === 'more') {
      if (!cursorMode || !nextCursorRef.current || loadingMoreRef.current) return;
      loadingMoreRef.current = true;
    }
    try {
      // Queue-split fetch (procurement view only): pending-complete plus
      // history-complete, combined into the one store the memos split.
      // Everything arrives complete so 'more' is a no-op in this mode.
      if (mode === 'more' && queueSplit) return;
      const url = mode === 'more'
        ? `/api/enquiries${qs}${qs ? "&" : "?"}limit=${pageSize}&cursor=${encodeURIComponent(nextCursorRef.current ?? '')}`
        : `/api/enquiries${qs}${baseQs}`;
      const parts = queueSplit && mode !== 'more'
        // allSettled: one leg failing (network/5xx) must never blank the
        // other queue — each leg degrades to empty independently.
        ? await Promise.allSettled([
            fetch('/api/enquiries/queues?queue=proc-pending').then(async (r) => {
              if (!r.ok) throw new Error('load failed');
              return r.json();
            }),
            fetch('/api/enquiries/queues?queue=proc-history&all=1').then(async (r) => {
              if (!r.ok) throw new Error('load failed');
              return r.json();
            }),
          ]).then((settled) => {
            const ok = settled.map((s) => (s.status === "fulfilled" ? (s.value as any) : null));
            if (!ok[0] && !ok[1]) throw new Error('load failed');
            return [{ enquiries: [], comments: [], ...ok[0] }, { enquiries: [], comments: [], ...ok[1] }];
          })
        : null;
      const enqRes = parts ? null : await fetch(url);
      if (enqRes && !enqRes.ok) throw new Error('load failed');
      const data = parts
        ? {
            enquiries: [...(parts[0].enquiries ?? []), ...(parts[1].enquiries ?? [])],
            comments: [...(parts[0].comments ?? []), ...(parts[1].comments ?? [])],
            nextCursor: undefined,
            hasMore: false,
            aiConfigured: parts[0].aiConfigured ?? parts[1].aiConfigured,
          }
        : await (enqRes as Response).json();
      const list = Array.isArray(data.enquiries) ? data.enquiries : [];
      const coms = Array.isArray(data.comments) ? data.comments : [];
      if (cursorMode && mode === 'more') {
        const freshRows = list.map(toEnquiry);
        const freshComs = coms.map(toComment);
        setEnquiriesSynced((prev) => {
          const ids = new Set(prev.map((x) => x.id));
          return [...prev, ...freshRows.filter((x: Enquiry) => !ids.has(x.id))];
        });
        setComments((prev) => {
          const ids = new Set(prev.map((x) => x.id));
          return [...prev, ...freshComs.filter((x: Comment) => !ids.has(x.id))];
        });
      } else if (cursorMode && mode === 'merge' && !queueSplit) {
        const freshRows = list.map(toEnquiry);
        const freshComs = coms.map(toComment);
        const pageIds = new Set(freshRows.map((x: Enquiry) => x.id));
        setEnquiriesSynced((prev) => [...freshRows, ...prev.filter((x) => !pageIds.has(x.id))]);
        setComments((prev) => [...prev.filter((c) => !pageIds.has(c.enquiryId)), ...freshComs]);
      } else {
        setEnquiriesSynced(list.map(toEnquiry));
        setComments(coms.map(toComment));
      }
      if (cursorMode) {
        // Merge keeps the existing cursor/hasMore — page 1 tells us nothing
        // about the tail.
        if (mode !== 'merge') {
          const nc = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
          nextCursorRef.current = nc;
          setHasMore(data.hasMore === true && !!nc);
        }
        setTotal(null);
      } else {
        setTotal(typeof data.total === 'number' ? data.total : null);
      }
      if (typeof data.aiConfigured === 'boolean') setAiConfigured(data.aiConfigured);
    } catch (e) {
      console.error('Failed to load enquiries:', e);
    } finally {
      if (mode === 'more') loadingMoreRef.current = false;
      setLoaded(true);
    }
  }, [qs, baseQs, cursorMode, queueSplit]);

  useEffect(() => {
    void fetchStatic();
    void fetchEnquiries('reset');
  }, [fetchStatic, fetchEnquiries]);

  useEffect(() => {
    const q = searchQuery.trim();
    searchQueryRef.current = searchQuery;
    if (q.length < 2) {
      // Clearing the box must also kill an in-flight search: without the
      // abort its late response would overwrite the restored queue with a
      // stale match set and wedge `searchActive` on (empty box, no ×).
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearching(false);
      setSearchLocal(false);
      if (searchActiveRef.current) {
        searchActiveRef.current = false;
        setSearchActive(false);
        setSearching(false);
        void fetchEnquiries('reset');
      }
      return;
    }
    // Local-first gate (queue-split only): the gate and the tab memos share
    // `matchesEnquiryQuery`, so a gate "hit" always renders and a "miss"
    // always falls through to the database below. Synchronous — no debounce,
    // results paint on the same keystroke.
    if (queueSplit && enquiriesRef.current.some((e) => matchesEnquiryQuery(e, q))) {
      searchAbortRef.current?.abort();
      searchAbortRef.current = null;
      setSearching(false);
      if (searchActiveRef.current) {
        // Coming back from a server match set: restore the complete store so
        // the local filter has everything to work on.
        searchActiveRef.current = false;
        setSearchActive(false);
        setSearchLocal(true);
        void fetchEnquiries('reset');
      } else {
        setSearchLocal(true);
      }
      return;
    }
    setSearchLocal(false);
    setSearching(true);
    const t = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const ac = new AbortController();
      searchAbortRef.current = ac;
      try {
        const res = await fetch(
          `/api/enquiries${qs}${qs ? "&" : "?"}q=${encodeURIComponent(q.slice(0, 40))}&limit=50`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error('search failed');
        const data = await res.json();
        if (searchAbortRef.current !== ac) return; // superseded
        // Box moved on while we were in flight (cleared / retyped and the
        // abort landed too late): never paint a stale match set over it.
        if (searchQueryRef.current.trim() !== q) return;
        setEnquiriesSynced((data.enquiries ?? []).map(toEnquiry));
        setComments(((data.comments ?? []) as any[]).map(toComment));
        searchActiveRef.current = true;
        setSearchActive(true);
        setSearchLocal(false);
        if (cursorMode) setHasMore(data.hasMore === true);
        else setTotal(typeof data.total === 'number' ? data.total : ((data.enquiries ?? []).length));
        if (typeof data.aiConfigured === 'boolean') setAiConfigured(data.aiConfigured);
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error('Search failed:', e);
      } finally {
        if (searchAbortRef.current === ac) { searchAbortRef.current = null; setSearching(false); }
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, qs, cursorMode, fetchEnquiries]);

  // Live updates: the backend broadcasts scope-safe SUMMARIES only (counts +
  // label parts — never PII, free text, or vendor rates). The full view then
  // fetches the ONE changed row (`GET /api/enquiries/:id`, server-scoped)
  // and merges it — no full-list refetch, no debounce settling, no stale
  // reads landing after a save. The redacted (procurement) view keeps the
  // debounced list refetch: its payload only comes from the list endpoint
  // (single-row returns 403 for restricted viewers by design).
  // Legacy full-row events (ev.enquiry) still merge directly for
  // backwards compatibility.
  // Background refreshes merge page 1 in cursor mode (never wipe loaded
  // older pages); full-list mode keeps the legacy replace.
  const fetchEnquiriesRef = useRef<() => void>(() => {});
  fetchEnquiriesRef.current = () => { void fetchEnquiries(cursorMode ? 'merge' : 'reset'); };
  const loadMore = useCallback(() => { void fetchEnquiries('more'); }, [fetchEnquiries]);
  const pageSizeRef = useRef(pageSize);
  pageSizeRef.current = pageSize;
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefetch = useCallback((ms: number) => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => { void fetchEnquiriesRef.current(); }, ms);
  }, []);
  // Single-row live merge (full view only): fetch the changed row scoped to
  // this viewer and splice it in, replacing that row's thread. Falls back to
  // a list refetch when the row is gone (deleted) or unreadable (403).
  const mergeSingle = useCallback(async (id: string) => {
    // While searching, updates to visible rows still merge but brand-new
    // rows never intrude into the match set.
    if (searchActiveRef.current && !enquiriesRef.current.some((x) => x.id === id)) return;
    try {
      const res = await fetch(`/api/enquiries/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setEnquiriesSynced(enquiriesRef.current.filter((x) => x.id !== id));
        setComments((prev) => prev.filter((c) => c.enquiryId !== id));
        return;
      }
      if (!res.ok) throw new Error('single fetch failed');
      const data = await res.json();
      if (!data?.enquiry) throw new Error('empty row');
      const row = toEnquiry(data.enquiry);
      setEnquiriesSynced(enquiriesRef.current.some((x) => x.id === id)
        ? enquiriesRef.current.map((x) => (x.id === id ? row : x))
        : [row, ...enquiriesRef.current]);
      if (Array.isArray(data.comments)) {
        const fresh = data.comments.map(toComment);
        const freshIds = new Set(fresh.map((c: Comment) => c.id));
        setComments((prev) => [...prev.filter((c) => c.enquiryId !== id || !freshIds.has(c.id)), ...fresh]);
      }
    } catch {
      void fetchEnquiriesRef.current();
    }
  }, []);
  // Zoho status chip goes live via Estimate changes (5-min zoho-sent sync).
  // Enquiries subscribe only to `enquiries` events, but Estimate status
  // flips broadcast `estimates` — also refetch enquiries so the Zoho chip
  // updates without an extra poll.
  // Safety net: if live WebSocket drops and a fresh enquiry is still AI-reading (empty), poll every 4s so it auto-populates without manual refresh
  useEffect(() => {
    const hasFreshEmpty = enquiries.some((e: any) => {
      const createdMs = new Date(e.createdAt).getTime();
      const isFresh = Number.isFinite(createdMs) && Date.now() - createdMs < 15 * 60 * 1000;
      const hasSource = !!(e.description?.trim() || (e.imageUrls ?? []).length > 0 || (e.additionalRequirements ?? []).length > 0);
      const empty = !(e.items && e.items.length > 0);
      return isFresh && hasSource && empty;
    });
    if (!hasFreshEmpty) return;
    const id = setInterval(() => void fetchEnquiriesRef.current(), 4000);
    return () => clearInterval(id);
  }, [enquiries]);

  // Generic staleness guard: even without a fresh-empty row, a dropped WS
  // (30s retry + 60s ping in useLiveData) can leave the list stale. Poll
  // every 60s as a cheap safety net, matching ZohoEstimates 15m pattern but
  // tighter for sales.
  useEffect(() => {
    const id = setInterval(() => void fetchEnquiriesRef.current(), 60000);
    return () => clearInterval(id);
  }, []);

  useLiveEvent((e) => {
    const t = (e as any)?.type;
    if (!e || (t !== 'enquiries' && t !== 'estimates' && t !== 'data-changed')) return;
    if (t === 'estimates') { void fetchEnquiriesRef.current(); return; }
    if (t === 'data-changed') {
      const p = String((e as any)?.path ?? '');
      // Generic fallback from auto-live (context.ts) — only refetch when it
      // is an enquiry write that had no typed event.
      if (p.includes('/api/enquiries')) void fetchEnquiriesRef.current();
      return;
    }

    const ev = e as any;
    // Summary-only event (current backend): full view merges the one changed
    // row; redacted view refetches its list payload (debounced).
    if (!ev.enquiry && !ev.comment) {
      if (redactedView) { scheduleRefetch(300); return; }
      const id = String(ev.id ?? ev.enquiryId ?? '');
      if (!id) { scheduleRefetch(300); return; }
      if (ev.action === 'deleted') {
        setEnquiriesSynced(enquiriesRef.current.filter((x) => x.id !== id));
        return;
      }
      // Created rows shift counts/paging — full refetch; everything else
      // (updated, requirement, estimate-claimed, comment) merges one row.
      if (ev.action === 'created' && pageSizeRef.current <= 0) {
        void mergeSingle(id);
        return;
      }
      if (ev.action === 'created') { void fetchEnquiriesRef.current(); return; }
      void mergeSingle(id);
      return;
    }
    // Comment-only event (no content — refetch the scoped thread).
    if (ev.action === 'comment' && ev.comment === undefined) {
      scheduleRefetch(redactedView ? 300 : 300);
      return;
    }
    if (redactedView) {
      scheduleRefetch(300);
      return;
    }
    // Paged queue tables refetch the page on creates (row counts shift);
    // updates merge into the visible page when present.
    const paged = pageSizeRef.current > 0;
    if (ev.action === 'created' && ev.enquiry) {
      if (paged) { void fetchEnquiriesRef.current(); return; }
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

  const currentAgent = useMemo(() => {
    const fallback = { id: '', name: 'Sales Agent', initials: 'SA', color: '#6366f1', status: 'active' as const };
    if (userEmail) {
      const local = (e: string): string => e.split('@')[0].trim();
      // Same roster rule as the backend lead inference: exact email first,
      // then local-part (bare `buisales4` vs full login), so the signed-in
      // agent always resolves to their own MIS roster row (e.g. Muskan).
      const self = agents.find((a) => {
        const e = String((a as any)?.email ?? '').toLowerCase().trim();
        return e && (e === userEmail || local(e) === local(userEmail));
      });
      if (self) return self;
    }
    return agents[0] || fallback;
  }, [agents, userEmail]);

  const persist = async (method: string, path: string, body?: any) => {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error((data && (data.error || data.message)) || 'request failed');
    }
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

  // Optimistic: applies locally the instant it is made (near-instant UI for
  // high-speed sales work), then reconciles with server truth; a failure
  // resyncs from the server so the UI never sits on a lie.
  const updateEnquiry = useCallback(async (id: string, updates: Partial<Enquiry>) => {
    const prev = enquiriesRef.current;
    const current = prev.find((x) => x.id === id);
    setSaveError(null);
    if (current) {
      setEnquiriesSynced(prev.map((x) => (x.id === id
        ? { ...x, ...updates, updatedAt: new Date().toISOString() } as Enquiry
        : x)));
    }
    try {
      const saved = await persist('PATCH', `/api/enquiries/${id}`, updates);
      setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === id ? toEnquiry(saved) : x)));
      return saved;
    } catch (err) {
      console.error('updateEnquiry failed, resyncing:', err);
      setSaveError(err instanceof Error ? err.message : 'Save failed — your change was NOT saved. Retry.');
      void fetchEnquiriesRef.current();
      throw err;
    }
  }, []);

  const deleteEnquiry = useCallback(async (id: string) => {
    await persist('DELETE', `/api/enquiries/${id}`);
    setEnquiriesSynced(enquiriesRef.current.filter((x) => x.id !== id));
    setComments((prev) => prev.filter((c) => c.enquiryId !== id));
  }, []);

  // Optimistic: echo instantly with a temp id, swap in server truth on
  // success, drop the echo on failure (live events converge other writers).
  const addComment = useCallback(async (comment: Comment) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const echo: Comment = { ...comment, id: tempId, createdAt: new Date().toISOString() };
    setComments((prev) => [...prev, echo]);
    try {
      const saved = await persist('POST', `/api/enquiries/${comment.enquiryId}/comments`, {
        agentId: comment.agentId, content: comment.content, parentId: comment.parentId,
        imageUrl: comment.imageUrl, visibility: comment.visibility || undefined,
      });
      const row = toComment(saved);
      setComments((prev) => prev.some((x) => x.id === row.id)
        ? prev.filter((x) => x.id !== tempId)
        : prev.map((x) => (x.id === tempId ? row : x)));
      return saved;
    } catch (err) {
      setComments((prev) => prev.filter((x) => x.id !== tempId));
      throw err;
    }
  }, []);

  const addRequirement = useCallback(async (enquiryId: string, text: string, imageUrl?: string, imageUrls?: string[]) => {
    setSaveError(null);
    try {
      const saved = await persist('POST', `/api/enquiries/${enquiryId}/additional-requirements`, { text, imageUrl, imageUrls });
      if (saved.enquiry) setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === enquiryId ? toEnquiry(saved.enquiry) : x)));
      return saved.requirement;
    } catch (err) {
      console.error('addRequirement failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Add-via-AI failed — nothing was added. Retry.');
      throw err;
    }
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
    surface?: "sales" | "procurement" | "management",
  ) => {
    const run = async () => {
      // Updater form reads the LATEST items at execution time (after every
      // queued write resolved) — never a stale render snapshot. This is what
      // makes rapid add→delete→remark sequences lossless.
      const base = enquiriesRef.current.find((x) => x.id === enquiryId)?.items ?? [];
      const items = typeof itemsOrFn === "function" ? itemsOrFn(base) : itemsOrFn;
      setSaveError(null);
      setEnquiriesSynced(enquiriesRef.current.map((x) =>
        x.id === enquiryId ? { ...x, items: items as EnquiryItem[] } : x));
      try {
        const saved = await persist('PATCH', `/api/enquiries/${enquiryId}`, surface ? { items, surface } : { items });
        setEnquiriesSynced(enquiriesRef.current.map((x) => (x.id === enquiryId ? toEnquiry(saved) : x)));
        return saved;
      } catch (err) {
        console.error('updateItems failed, resyncing:', err);
        setSaveError(err instanceof Error ? err.message : 'Save failed — your change was NOT saved. Retry.');
        void fetchEnquiriesRef.current();
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

  // Single-row merge: dashboard modals fetch the open row whole on demand
  // (queue payloads strip media bytes for size). Merges by id so the modal
  // re-renders with full media the moment it lands; queue memos re-split it
  // like any other store update.
  const upsertEnquiry = useCallback((row: Enquiry) => {
    setEnquiriesSynced((prev) => {
      if (!prev.some((x) => x.id === row.id)) return [...prev, row];
      return prev.map((x) => (x.id === row.id ? row : x));
    });
  }, [setEnquiriesSynced]);

  return {
    enquiries,
    comments, setComments,
    agents,
    clients,
    currentAgent,
    loaded,
    aiConfigured,
    total, page, pageSize, setPage, setPageSize,
    hasMore, loadMore, loadedCount: enquiries.length,
    searchQuery, setSearchQuery, searchActive, searching, searchLocal, clearSearch,
    addEnquiry,
    updateEnquiry,
    deleteEnquiry,
    addComment,
    addRequirement,
    updateItems,
    saveError, dismissSaveError,
    upsertEnquiry,
    makeActivity,
    refresh: fetchEnquiries,
  };
}