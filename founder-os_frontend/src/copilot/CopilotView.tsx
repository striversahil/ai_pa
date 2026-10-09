// copilot/CopilotView.tsx — shared copilot chrome (popup + pill + thread).
//
// One look/behavior everywhere: backdrop, popup shell, header (title,
// live dot, refresh, close, optional mode tabs), message thread (user
// bubbles, activity chips, thinking dropdown, markdown answers), thinking
// tile, composer pill (mic, send/stop). Departments inject ONLY their
// proposal cards via renderProposals + optional headerExtra/extra slots.
// State + transport come from useCopilotTurn — this file holds zero logic.
'use client';

import React from 'react';
import type { ReactNode } from 'react';
import Markdown from '../components/Markdown';
import { useCopilotTurn, type ProposalApi } from './useCopilotTurn';
import type { CopilotEndpoints, CopilotMsg, CopilotViewConfig } from './types';

export interface CopilotViewProps {
  endpoints: CopilotEndpoints;
  view: CopilotViewConfig;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  renderProposals: (msg: CopilotMsg, mi: number, api: ProposalApi) => ReactNode;
  /** Rendered after the pill (e.g. sales image Lightbox). */
  extra?: ReactNode;
}

const FONT = "'Geist', 'Outfit', Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

export default function CopilotView({ endpoints, view, open, onClose, onOpen, renderProposals, extra }: CopilotViewProps) {
  const t = useCopilotTurn(endpoints, open, onOpen);
  const api: ProposalApi = {
    send: t.send, confirm: t.confirm, executeAction: t.executeAction, notify: t.notify,
    confirmed: t.confirmed, applying: t.applying,
  };
  const userInitial = (view.userInitial ?? 'S').charAt(0).toUpperCase();

  return (
    <>
      {t.visible && (
        <div className={`fixed inset-0 z-40 bg-black/30 backdrop-blur-sm ${t.exiting ? 'animate-fade-out' : 'animate-fade-in'}`} onClick={onClose} />
      )}

      {t.visible && (
        <div
          className={`fixed z-50 left-1/2 -translate-x-1/2 bottom-[84px] w-[clamp(340px,94vw,600px)] md:w-[clamp(520px,62vw,780px)] xl:w-[clamp(640px,48vw,920px)] h-[clamp(440px,74dvh,620px)] md:h-[clamp(520px,78dvh,800px)] xl:h-[clamp(560px,82dvh,920px)] rounded-2xl bg-[var(--bg-card)] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden ${t.exiting ? 'animate-scale-down' : 'animate-scale-up'}`}
          role="dialog"
          aria-label={view.title}
          style={{ fontFamily: FONT }}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07] bg-[var(--bg-card)]">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <span className="text-[10px] font-extrabold text-white tracking-wider">AI</span>
              </div>
              <div>
                <p className="text-[14px] font-bold text-[var(--text-primary)] tracking-tight leading-tight">{view.title}</p>
                <p className="text-[11px] text-[var(--text-tertiary)] font-medium leading-tight">{view.subtitle}</p>
              </div>
              <span className="ml-2 h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse" />
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => t.reset()}
                aria-label={view.resetTitle ?? 'New chat'}
                title={view.resetTitle ?? 'New chat'}
                className="group p-2 rounded-full hover:bg-white/[0.06] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent transition-colors duration-200"
              >
                <svg className="w-[16px] h-[16px] transition-transform duration-500 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close"
                className="p-2 rounded-full hover:bg-white/[0.06] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] cursor-pointer border-0 bg-transparent transition-all duration-300 hover:rotate-90"
              >
                <svg className="w-[16px] h-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {view.modes && view.modes.length > 1 && (
            <div className="flex gap-1 px-5 pt-3">
              {view.modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { if (m.id !== view.mode) view.onModeChange?.(m.id); }}
                  className={`flex-1 px-3 py-1.5 text-[12px] font-bold rounded-full border-0 cursor-pointer transition-colors duration-200 ${m.id === view.mode
                    ? 'bg-violet-600 text-white'
                    : 'bg-white/[0.04] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-white/[0.08]'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          {view.headerExtra && <div className="px-5 pt-3">{view.headerExtra}</div>}

          <div ref={t.scrollRef} className="relative flex-1 overflow-y-auto px-5 py-5 space-y-5 bg-transparent scrollbar-thin scroll-smooth">
            {t.msgs.length === 0 && !t.busy ? (
              <div className="space-y-4 py-2 animate-fade-in">
                <p className="text-[15px] font-medium leading-relaxed text-[var(--text-secondary)]">{view.emptyText}</p>
                <div className="flex flex-wrap gap-2">
                  {view.suggestions.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void t.send(s)}
                      style={{ animationDelay: `${i * 60}ms` }}
                      className="animate-chat-in px-4 py-2 text-[13px] font-medium rounded-full border border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:bg-white/[0.08] hover:border-violet-500/30 hover:text-[var(--text-primary)] cursor-pointer text-left transition-colors duration-200"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {t.msgs.map((m, mi) => (
                  <div
                    key={mi}
                    className={m.role === 'user' ? 'animate-chat-in-right' : 'animate-chat-in'}
                    style={{ animationDelay: `${Math.min(mi * 40, 200)}ms` }}
                  >
                    {m.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="flex items-start gap-2.5 max-w-[85%]">
                          <div className="rounded-2xl rounded-br-md bg-blue-600 text-white px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap font-medium">
                            {m.text}
                          </div>
                          <div className="h-8 w-8 rounded-full bg-blue-700 flex items-center justify-center text-white text-[13px] font-bold flex-shrink-0 mt-0.5">{userInitial}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2.5 items-start">
                        <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0 mt-1">AI</div>
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {m.activity && m.activity.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {m.activity.map((a, ai) => (
                                <span key={ai} className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full bg-[var(--bg-input)] text-[var(--text-secondary)] border border-white/[0.06]${a.pending ? ' animate-pulse' : ''}`}>
                                  <span>{a.pending ? '⏳' : (view.toolIcons[a.tool] ?? '⚙️')}</span>{a.label}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.thinking && (
                            <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
                              <summary className="cursor-pointer text-[12px] font-bold text-[var(--text-tertiary)] select-none">Thinking</summary>
                              <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap max-h-48 overflow-y-auto">{m.thinking}</p>
                            </details>
                          )}
                          <div className="bg-[var(--bg-input)] border border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3 text-[15px] leading-[1.7] text-[var(--text-primary)] chat-markdown">
                            <Markdown text={m.text} className="md-text !text-[15px] !leading-[1.7]" />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)] px-1 font-medium">
                            <span>Just now</span>
                          </div>
                          {renderProposals(m, mi, api)}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {t.showThinking && (
                  <div className="flex gap-2.5 items-center animate-fade-in">
                    <div className="h-8 w-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-[11px] font-extrabold flex-shrink-0">AI</div>
                    <div className="bg-[var(--bg-input)] border border-white/[0.06] rounded-2xl rounded-tl-md px-4 py-3 flex items-center gap-1.5 max-w-[85%]">
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce flex-shrink-0" style={{ animationDelay: '0ms', animationDuration: '1.4s' }} />
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce flex-shrink-0" style={{ animationDelay: '150ms', animationDuration: '1.4s' }} />
                      <span className="h-2 w-2 rounded-full bg-[var(--text-tertiary)] animate-bounce flex-shrink-0" style={{ animationDelay: '300ms', animationDuration: '1.4s' }} />
                      <span className="ml-2 text-[13px] font-medium text-[var(--text-secondary)] truncate">{t.thinking || (t.thinkSecs > 2 ? `Thinking… ${t.thinkSecs}s` : 'Thinking…')}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {view.chrome !== 'popup' && (
        <div className="fixed z-50 left-1/2 -translate-x-1/2 bottom-4 w-[clamp(340px,94vw,600px)] md:w-[clamp(520px,62vw,780px)] xl:w-[clamp(640px,48vw,920px)] animate-fade-in">
          <div
            className="group flex items-center gap-2 bg-[var(--bg-card)] backdrop-blur-xl border border-white/[0.08] rounded-full px-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-white/[0.12] focus-within:border-violet-500/40 transition-colors duration-200"
            style={{ fontFamily: FONT }}
            onClick={() => { if (!open) onOpen(); t.inputRef.current?.focus(); }}
          >
            <input
              ref={t.inputRef}
              value={t.input}
              onChange={(e) => t.setInput(e.target.value)}
              onFocus={() => { if (!open) onOpen(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void t.send(t.input); } }}
              placeholder="Message..."
              className="flex-1 bg-transparent outline-none text-[16px] font-medium placeholder:text-[var(--text-tertiary)] text-[var(--text-primary)] px-3 py-1"
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); t.toggleMic(); }}
              aria-label={t.listening ? 'Stop listening' : 'Voice input'}
              className={`p-2.5 rounded-full cursor-pointer border-0 flex items-center justify-center transition-colors duration-200 ${t.listening ? 'bg-red-500 text-white' : 'hover:bg-white/[0.06] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-transparent'}`}
              title={t.listening ? 'Listening…' : 'Voice input'}
            >
              <svg className="w-[16px] h-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 10a7 7 0 01-14 0M12 18v3M8 21h8" />
              </svg>
            </button>
            {t.busy ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); t.stop(); }}
                aria-label="Stop"
                title="Stop the agent"
                className="h-9 w-9 rounded-full border-0 flex items-center justify-center cursor-pointer transition-colors duration-200 bg-red-500/90 text-white hover:bg-red-500"
              >
                <svg className="w-[13px] h-[13px]" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); void t.send(t.input); }}
                disabled={!t.input.trim()}
                aria-label="Send"
                className={`h-9 w-9 rounded-full border-0 flex items-center justify-center cursor-pointer transition-colors duration-200 disabled:opacity-40 ${t.input.trim() ? 'bg-violet-600 text-white hover:bg-violet-500' : 'bg-white/[0.06] text-[var(--text-tertiary)]'}`}
              >
                <svg className="w-[14px] h-[14px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h12M12 5l7 7-7 7" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      {extra}
    </>
  );
}
