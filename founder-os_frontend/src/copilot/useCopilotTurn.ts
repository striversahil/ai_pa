// copilot/useCopilotTurn.ts — shared copilot transport + conversation state.
//
// One user message may take several HTTP hops (server saves per-step state and
// answers `continued`); hop 0 shows the user bubble, later hops append fresh
// assistant bubbles on the same thread. busy stays true across hops.
// Extracted verbatim from the ChatbaseCopilot ↔ CopilotChat fork — the only
// per-department differences are the endpoint config (URLs, session strategy,
// budgets) and the proposal cards (rendered by the caller).
'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CopilotActivity, CopilotEndpoints, CopilotMsg, CopilotProposal } from './types';

const MAX_HOPS = 9;
const THINK_TAIL = 140;
const THINK_CAP = 6000;

function mintSession(): string {
  try {
    const s = (crypto as any)?.randomUUID?.() ?? '';
    if (s) return s;
  } catch {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Edge pages are HTML, never chat text — surface them plainly instead of
 *  dumping `<!DOCTYPE…` into the thread. Server-side state was saved per
 *  step, so "continue" resumes. */
function cleanErr(m: string): string {
  const t = String(m ?? '');
  if (t.includes('<!DOCTYPE') || t.trimStart().startsWith('<html') || /HTTP \d+ </.test(t)) {
    return 'Server hiccup mid-turn (edge error page) — work so far is saved. Say continue to resume.';
  }
  return t;
}

export function useCopilotTurn(ep: CopilotEndpoints, open: boolean, onOpen: () => void) {
  const [msgs, setMsgs] = useState<CopilotMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState('');
  const [thinkSecs, setThinkSecs] = useState(0);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [applying, setApplying] = useState<Set<number>>(new Set());
  const [listening, setListening] = useState(false);
  const [visible, setVisible] = useState(open);
  const [exiting, setExiting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recogRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userStoppedRef = useRef(false);
  const sessionRef = useRef<string>('');
  const epRef = useRef(ep);
  epRef.current = ep;

  const volatileSession = ep.sessionMode === 'volatile';
  if (volatileSession && !sessionRef.current) sessionRef.current = mintSession();

  // Liveness clock: ticks while a turn is in flight so even a long silent
  // wait (cold worker, model queue) shows elapsed time, not a dead screen.
  useEffect(() => {
    if (!busy) { setThinkSecs(0); return; }
    const started = Date.now();
    const id = setInterval(() => setThinkSecs(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [busy]);

  const reset = useCallback(() => {
    setMsgs([]);
    setConfirmed(new Set());
    setApplying(new Set());
    setThinking('');
    if (epRef.current.sessionMode === 'volatile') sessionRef.current = mintSession();
    try { epRef.current.onReset?.(); } catch {}
  }, []);
  useEffect(() => { reset(); }, [ep.resetKey, reset]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open, visible]);
  useEffect(() => {
    if (open) { setVisible(true); setExiting(false); setTimeout(() => inputRef.current?.focus(), 120); }
    else if (visible) {
      setExiting(true);
      const t = setTimeout(() => { setVisible(false); setExiting(false); }, 260);
      return () => clearTimeout(t);
    }
  }, [open, visible]);

  const stop = useCallback(() => {
    userStoppedRef.current = true;
    try { abortRef.current?.abort(); } catch {}
  }, []);

  /** Append a plain assistant note (execute-action outcomes, status notes). */
  const notify = useCallback((text: string) => {
    setMsgs((p) => [...p, { role: 'assistant', text }]);
  }, []);

  const budget = (ms: number | undefined): number | undefined => {
    const b = ms ?? 60000;
    return b > 0 ? b : undefined;
  };

  const messageBody = (message: string): Record<string, unknown> => ({
    message,
    ...(volatileSession ? { session: sessionRef.current } : {}),
    ...(epRef.current.extraBody ?? {}),
  });

  const send = useCallback(async (text: string, hop = 0): Promise<void> => {
    const endpoints = epRef.current;
    const q = text.trim();
    if (!q) return;
    if (hop === 0) {
      if (busy) return;
      userStoppedRef.current = false;
      if (!open) onOpen();
      setBusy(true);
      setThinking('');
      // Assistant placeholder goes up INSTANTLY (before any network), so the
      // thinking chip is visible through the whole dead window: connect +
      // worker boot + model queue, not just after the first token.
      setMsgs((p) => [...p, { role: 'user', text: q }, { role: 'assistant', text: '', activity: [], proposals: [] }]);
      setInput('');
    } else {
      setMsgs((p) => [...p, { role: 'assistant', text: '', activity: [], proposals: [] }]);
    }
    const chainNext = async (): Promise<void> => {
      if (userStoppedRef.current || hop >= MAX_HOPS) {
        if (!userStoppedRef.current) {
          setMsgs((p) => [...p, { role: 'assistant', text: 'Paused after a long run — say continue to resume.', proposals: [], activity: [] }]);
        }
        setBusy(false);
        return;
      }
      return send('continue', hop + 1);
    };
    const tryStream = async (): Promise<'done' | 'continued' | 'failed'> => {
      try {
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const t = budget(endpoints.timeoutMs) ? setTimeout(() => ctrl.abort(), budget(endpoints.timeoutMs)) : undefined;
        const res = await fetch(endpoints.streamUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(messageBody(q)),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const raw = await res.text().catch(() => '');
          const errText = cleanErr(raw).slice(0, 200) || `HTTP ${res.status}`;
          if (res.status === 429) throw new Error('Rate-limited');
          throw new Error(`HTTP ${res.status} ${errText.slice(0, 120)}`);
        }
        if (!res.body) throw new Error('no body');
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('text/event-stream')) throw new Error('not SSE');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accText = '';
        let accThink = '';
        let accActivity: CopilotActivity[] = [];
        let accProposals: CopilotProposal[] = [];
        let sawDone = false;
        let streamContinued = false;
        // Placeholder was already appended in send() — don't add a second one.
        const readBudget = budget(endpoints.timeoutMs);
        const timeout = readBudget ? setTimeout(() => { try { reader.cancel(); } catch {} }, readBudget) : undefined;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const raw of lines) {
              const line = raw.trim();
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (payload === '[DONE]') { sawDone = true; break; }
              try {
                const evt = JSON.parse(payload);
                if (evt.type === 'delta' && typeof evt.data?.text === 'string') {
                  accText += evt.data.text;
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === 'assistant') last.text = accText;
                    return [...cp];
                  });
                } else if (evt.type === 'activity-start' && evt.data) {
                  // Tool announced BEFORE it runs — pulsing chip until the
                  // completion event settles it in place.
                  const chip = { ...(evt.data as CopilotActivity), pending: true };
                  accActivity = [...accActivity, chip];
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === 'assistant') last.activity = [...accActivity];
                    return [...cp];
                  });
                } else if (evt.type === 'activity' && evt.data) {
                  // Completion settles the matching pending chip in place
                  // (first pending with the same tool); unmatched appends.
                  const settled = { ...(evt.data as CopilotActivity), pending: false };
                  const idx = accActivity.findIndex((a) => a.tool === settled.tool && a.pending);
                  accActivity = idx >= 0
                    ? [...accActivity.slice(0, idx), settled, ...accActivity.slice(idx + 1)]
                    : [...accActivity, settled];
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === 'assistant') last.activity = [...accActivity];
                    return [...cp];
                  });
                } else if (evt.type === 'thinking' && typeof evt.data?.text === 'string') {
                  const t = String(evt.data.text);
                  if (t) {
                    // Full reasoning stream onto the message (minimized
                    // dropdown); the chip keeps only the tail.
                    accThink = (accThink + t).slice(-THINK_CAP);
                    setThinking(accThink.slice(-THINK_TAIL).trim());
                    const frozen = accThink;
                    setMsgs((p) => {
                      const cp = [...p]; const last = cp[cp.length - 1];
                      if (last?.role === 'assistant') last.thinking = frozen;
                      return [...cp];
                    });
                  }
                } else if (evt.type === 'done' && evt.data) {
                  setThinking('');
                  // Keep the live-streamed text — replacing it with the final
                  // reply is what made streamed output vanish mid-turn.
                  if (!accText) accText = String(evt.data.reply ?? '');
                  accActivity = Array.isArray(evt.data.activity) ? evt.data.activity : accActivity;
                  accProposals = Array.isArray(evt.data.proposals) ? evt.data.proposals : [];
                  if ((evt.data as any)?.continued) streamContinued = true;
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === 'assistant') {
                      last.text = accText || 'No answer.';
                      last.activity = accActivity;
                      last.proposals = accProposals;
                    }
                    return [...cp];
                  });
                  sawDone = true;
                } else if (evt.type === 'error') {
                  setMsgs((p) => {
                    const cp = [...p]; const last = cp[cp.length - 1];
                    if (last?.role === 'assistant' && !last.text) last.text = String(evt.data?.error || 'No answer.');
                    return [...cp];
                  });
                }
              } catch {}
            }
            if (sawDone) break;
          }
        } finally {
          if (timeout) clearTimeout(timeout);
          if (t) clearTimeout(t);
          if (abortRef.current === ctrl) abortRef.current = null;
          try { reader.releaseLock(); } catch {}
        }
        if (!accText && accProposals.length === 0 && accActivity.length === 0) throw new Error('empty stream');
        return streamContinued ? 'continued' : 'done';
      } catch {
        // KEEP the placeholder: the non-streaming fallback fills it in place
        // and thinking stays live while it runs (no dead-silent gap).
        return 'failed';
      }
    };
    const s = await tryStream();
    if (s === 'done') { setBusy(false); return; }
    // Turn yielded for transport (server saved state): follow silently on the
    // same thread — the user sees one continuous working thread.
    if (s === 'continued') return chainNext();
    // User hit stop mid-stream: do NOT run the fallback — the partial bubble
    // stays as-is (server kept per-step state; "continue" resumes).
    if (userStoppedRef.current) {
      setMsgs((p) => {
        const cp = [...p]; const last = cp[cp.length - 1];
        if (last?.role === 'assistant' && !last.text && (last.proposals?.length ?? 0) === 0 && (last.activity?.length ?? 0) === 0) {
          last.text = 'Stopped — nothing had arrived yet. Send anything to resume.';
        }
        return [...cp];
      });
      setBusy(false); return;
    }
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const t = budget(endpoints.timeoutMs) ? setTimeout(() => ctrl.abort(), budget(endpoints.timeoutMs)) : undefined;
      const res = await fetch(endpoints.chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageBody(q)),
        signal: ctrl.signal,
      });
      if (t) clearTimeout(t);
      if (abortRef.current === ctrl) abortRef.current = null;
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        const errText = cleanErr(raw) || `HTTP ${res.status}`;
        if (res.status === 429) throw new Error('Rate-limited — please wait a minute and retry.');
        throw new Error(errText);
      }
      const data = await res.json();
      // Fill the waiting placeholder in place — append only if it went
      // missing, so replies never duplicate.
      const fill = (text: string, proposals: any[] = [], activity: any[] = []) => {
        setMsgs((p) => {
          const cp = [...p]; const last = cp[cp.length - 1];
          if (last?.role === 'assistant' && !last.text && (last.proposals?.length ?? 0) === 0) {
            cp[cp.length - 1] = { ...last, text, proposals, activity };
            return [...cp];
          }
          return [...p, { role: 'assistant', text, proposals, activity }];
        });
      };
      fill(
        String(data.reply || data.error || 'No answer.'),
        Array.isArray(data.proposals) ? data.proposals : [],
        Array.isArray(data.activity) ? data.activity : [],
      );
      // Fallback hop also yields for transport: chain it the same way.
      if ((data as any)?.continued && !userStoppedRef.current) return chainNext();
    } catch (e: any) {
      abortRef.current = null;
      // A user stop is not an error: partial work stays in the bubble and
      // the server kept per-step state, so "continue" resumes the turn.
      const msg = cleanErr(userStoppedRef.current
        ? 'Stopped — partial work is kept. Say continue to resume.'
        : e?.name === 'AbortError' ? 'Chat timed out — please retry.' : String(e?.message || 'Chat failed — please retry.').slice(0, 200));
      setMsgs((p) => {
        const cp = [...p]; const last = cp[cp.length - 1];
        if (last?.role === 'assistant' && !last.text && (last.proposals?.length ?? 0) === 0) {
          cp[cp.length - 1] = { ...last, text: msg };
          return [...cp];
        }
        return [...p, { role: 'assistant', text: msg }];
      });
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, open, onOpen, ep.streamUrl, ep.chatUrl, ep.timeoutMs, ep.sessionMode, volatileSession]);

  const executeAction = useCallback(async (action: Record<string, unknown>): Promise<any> => {
    const url = epRef.current.executeUrl;
    if (!url) throw new Error('read-only copilot');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Session threads the outcome into THIS chat's server memory, so the
      // next turn knows the write happened without re-looking up.
      body: JSON.stringify({
        action,
        ...(epRef.current.sessionMode === 'volatile' ? { session: sessionRef.current } : {}),
      }),
    });
    return res.json();
  }, []);

  const confirm = useCallback(async (msgIdx: number, pIdx: number, p: CopilotProposal) => {
    if (!epRef.current.executeUrl) return;
    const key = msgIdx * 100 + pIdx;
    if (confirmed.has(key) || applying.has(key)) return;
    setApplying((s) => new Set(s).add(key));
    try {
      const data = await executeAction(p as unknown as Record<string, unknown>);
      if (data.applied && data.applied !== 'none') {
        setConfirmed((s) => new Set(s).add(key));
        setMsgs((ms) => [...ms, { role: 'assistant', text: `✓ ${p.label} — applied.` }]);
      } else {
        setMsgs((ms) => [...ms, { role: 'assistant', text: `Could not apply: ${data.error || 'rejected'}.` }]);
      }
    } catch {
      setMsgs((ms) => [...ms, { role: 'assistant', text: 'Apply failed — please retry.' }]);
    } finally {
      setApplying((s) => { const n = new Set(s); n.delete(key); return n; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, applying, executeAction]);

  const toggleMic = useCallback(() => {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { inputRef.current?.focus(); return; }
    if (listening && recogRef.current) { try { recogRef.current.stop(); } catch {} setListening(false); return; }
    try {
      const rec = new SR();
      recogRef.current = rec;
      rec.lang = 'en-IN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => setListening(true);
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      rec.onresult = (e: any) => {
        const transcript = e.results?.[0]?.[0]?.transcript as string | undefined;
        if (transcript) { setInput(transcript); setTimeout(() => inputRef.current?.focus(), 50); }
        setListening(false);
      };
      rec.start();
    } catch { setListening(false); }
  }, [listening]);

  // Thinking status shows only while the answer hasn't started streaming —
  // once text arrives the bubble itself is the progress.
  const lastMsg = msgs[msgs.length - 1];
  const showThinking = busy && (!lastMsg || (lastMsg.role === 'assistant' && !lastMsg.text));

  return {
    msgs, input, setInput, busy, thinking, thinkSecs, showThinking,
    confirmed, applying, listening, visible, exiting,
    scrollRef, inputRef,
    send: (text: string) => void send(text),
    stop, reset, confirm, executeAction, toggleMic, notify,
  };
}

export type CopilotTurn = ReturnType<typeof useCopilotTurn>;
export interface ProposalApi {
  send: (text: string) => void;
  confirm: (msgIdx: number, pIdx: number, p: CopilotProposal) => void;
  executeAction: (action: Record<string, unknown>) => Promise<any>;
  notify: (text: string) => void;
  confirmed: Set<number>;
  applying: Set<number>;
}
export interface ProposalApi {
  send: (text: string) => void;
  confirm: (msgIdx: number, pIdx: number, p: CopilotProposal) => void;
  executeAction: (action: Record<string, unknown>) => Promise<any>;
  confirmed: Set<number>;
  applying: Set<number>;
}
