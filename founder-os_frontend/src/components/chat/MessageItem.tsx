"use client";

import React, { useRef } from "react";
import { CornerUpLeft, Pencil, Reply, SmilePlus, Trash2, FileText } from "lucide-react";
import MarkdownBody from "./Markdown";
import {
  ChatAttachment,
  ChatMessage,
  ChatReaction,
  formatBytes,
  isPpt,
  timeLabel,
  userColor,
  dayKey,
  dayDividerLabel,
} from "./types";
import { ChatSettings, fontPx } from "./theme";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

interface Props {
  m: ChatMessage;
  prev: ChatMessage | null;
  settings: ChatSettings;
  selfIds: string[];
  canModify: boolean;
  reactions: ChatReaction[];
  pickerOpen: boolean;
  onPickerOpen: (rect: DOMRect) => void;
  editing: boolean;
  onEditStart: () => void;
  onEditCancel: () => void;
  editText: string;
  onEditChange: (v: string) => void;
  onEditSave: () => void;
  onReply: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  onJump: (id: number) => void;
  onOpenImages: (m: ChatMessage, key: string) => void;
  onOpenFile: (a: ChatAttachment) => void;
  highlight: boolean;
  onContext?: (x: number, y: number) => void;
}

export function Avatar({ src, name, size, color }: { src: string | null; name: string; size: string; color: string }) {
  if (src) return <img src={src} alt="" className={`${size} shrink-0 rounded-full object-cover`} />;
  return (
    <div className={`${size} flex shrink-0 items-center justify-center rounded-full font-bold text-white`} style={{ backgroundColor: color }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function AttachmentList({
  m,
  onOpenImages,
  onOpenFile,
}: {
  m: ChatMessage;
  onOpenImages: (m: ChatMessage, key: string) => void;
  onOpenFile: (a: ChatAttachment) => void;
}) {
  return (
    <div className="mb-1 flex flex-col gap-1.5">
      {m.attachments.map((a) => {
        const url = `/api/chat/files/${a.key}`;
        if (a.type.startsWith("image/")) {
          return (
            <button key={a.key} onClick={() => onOpenImages(m, a.key)} title={a.name}
              className="cursor-zoom-in self-start overflow-hidden rounded-lg border border-[var(--chat-border)] transition hover:opacity-90">
              <img src={url} alt={a.name} className="max-h-64 max-w-[min(420px,100%)] object-cover" />
            </button>
          );
        }
        if (a.type === "application/pdf") {
          return (
            <button key={a.key} onClick={() => onOpenFile(a)}
              className="flex cursor-zoom-in items-center gap-3 self-start overflow-hidden rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] text-left transition hover:opacity-90">
              <iframe src={url} title={a.name} className="pointer-events-none h-56 w-[280px]" />
              <span className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs text-[var(--chat-text)]">
                <FileText className="h-4 w-4 shrink-0 text-rose-400" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="text-[var(--chat-muted)]">{formatBytes(a.size)} · click to view</span>
                </span>
              </span>
            </button>
          );
        }
        if (a.type.startsWith("video/")) {
          return (
            <video key={a.key} src={url} controls preload="metadata" onClick={() => onOpenFile(a)}
              className="max-h-80 max-w-md cursor-pointer rounded-lg border border-[var(--chat-border)]" />
          );
        }
        if (a.type.startsWith("audio/")) {
          return (
            <div key={a.key} className="flex max-w-full items-center gap-2 self-start rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] px-2.5 py-1.5">
              <audio controls src={url} preload="metadata" className="h-9 max-w-[220px]" />
              <span className="min-w-0 text-xs text-[var(--chat-text)]">
                <span className="block truncate font-semibold">{a.name}</span>
                <span className="text-[var(--chat-muted)]">{formatBytes(a.size)}</span>
              </span>
            </div>
          );
        }
        return (
          <button key={a.key} onClick={() => onOpenFile(a)}
            className="flex max-w-full items-center gap-2 self-start rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] px-3 py-2 text-xs text-[var(--chat-text)] transition hover:opacity-80">
            <FileText className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="truncate font-semibold">{a.name}</span>
            <span className="ml-1 shrink-0 text-[var(--chat-muted)]">{formatBytes(a.size)}{isPpt(a) ? " · view" : " · download"}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function MessageItem({
  m,
  prev,
  settings,
  selfIds,
  canModify,
  reactions,
  pickerOpen,
  onPickerOpen,
  editing,
  onEditStart,
  onEditCancel,
  editText,
  onEditChange,
  onEditSave,
  onReply,
  onDelete,
  onReact,
  onJump,
  onOpenImages,
  onOpenFile,
  highlight,
  onContext,
}: Props) {
  const own = selfIds.includes(m.senderId);
  const compact = settings.density === "compact";
  const nameColor = userColor(m.senderId);
  const touchStart = useRef<number | null>(null);
  const touchMove = useRef<number | null>(null);

  const grouped =
    !!prev &&
    prev.senderId === m.senderId &&
    !m.replyTo &&
    !m.deletedAt &&
    !prev.deletedAt &&
    dayKey(prev.createdAt) === dayKey(m.createdAt) &&
    new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;

  const showHeader = !compact && !grouped;

  const groupedReactions = React.useMemo(() => {
    const map = new Map<string, { emoji: string; count: number; users: string[]; mine: boolean }>();
    for (const r of reactions) {
      const e = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, users: [], mine: false };
      e.count += 1;
      e.users.push(r.userName);
      if (selfIds.includes(r.userId)) e.mine = true;
      map.set(r.emoji, e);
    }
    return [...map.values()];
  }, [reactions, selfIds]);

  const replyColor = m.replyTo ? userColor(m.replyTo.senderName || String(m.replyTo.id)) : "";

  const divider = !grouped && prev && dayKey(prev.createdAt) !== dayKey(m.createdAt);

  const row = (
    <div
      data-mid={m.id}
      className={`group relative ${compact ? "px-4 py-px" : grouped ? "px-4 py-0.5" : "px-4 pb-0.5 pt-3"} transition-colors ${
        editing || pickerOpen || highlight ? "" : "hover:bg-[var(--chat-hover)]"
      }`}
      style={editing || pickerOpen || highlight ? { backgroundColor: "rgba(var(--chat-accent-rgb), 0.11)" } : undefined}
      onContextMenu={(e) => { e.preventDefault(); onContext?.(e.clientX, e.clientY); }}
      onTouchStart={(e) => { touchStart.current = e.touches[0].clientX; }}
      onTouchMove={(e) => { touchMove.current = e.touches[0].clientX; }}
      onTouchEnd={() => {
        const dx = (touchMove.current ?? 0) - (touchStart.current ?? 0);
        touchStart.current = null;
        touchMove.current = null;
        if (dx > 60) onReply();
      }}
    >
      {divider && (
        <div className="relative -mx-4 mb-2 mt-4 flex items-center px-4 first:mt-0">
          <div className="h-px flex-1 bg-[var(--chat-divider)]" />
          <span className="rounded-full border border-[var(--chat-border)] bg-[var(--chat-panel)] px-2 py-0.5 text-[10px] font-bold text-[var(--chat-muted)]">
            {dayDividerLabel(m.createdAt)}
          </span>
          <div className="h-px flex-1 bg-[var(--chat-divider)]" />
        </div>
      )}
      <div className={`flex ${settings.bubbles && own ? "justify-end" : "gap-4"}`}>
        {settings.bubbles && !compact && !own && (
          <Avatar src={m.senderPicture} name={m.senderName} size="h-8 w-8" color={nameColor} />
        )}
        {compact ? (
          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-[var(--chat-muted)] opacity-0 transition group-hover:opacity-100">
            [{timeLabel(m.createdAt, settings.clock24h)}]
          </span>
        ) : !settings.bubbles && (
          <div className="w-10 shrink-0">
            {showHeader ? (
              <Avatar src={m.senderPicture} name={m.senderName} size="h-10 w-10" color={nameColor} />
            ) : (
              <span className="hidden pt-1 text-center text-[10px] text-[var(--chat-muted)] opacity-0 group-hover:block">
                {timeLabel(m.createdAt, settings.clock24h)}
              </span>
            )}
          </div>
        )}
        <div className={`min-w-0 flex-1 ${compact ? "" : settings.bubbles ? "max-w-[78%]" : ""} ${settings.bubbles && own ? "text-right" : ""}`}>
          {showHeader && (
            <div className="flex items-baseline gap-2">
              <span className="cursor-pointer font-semibold hover:underline" style={{ color: nameColor }}>
                {m.senderName}
              </span>
              <span className="text-[11px] text-[var(--chat-muted)]">
                {new Date(m.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })} at {timeLabel(m.createdAt, settings.clock24h)}
              </span>
            </div>
          )}
          {compact && !grouped && (
            <span className="mr-1.5 font-semibold hover:underline" style={{ color: nameColor }}>
              {m.senderName}
            </span>
          )}

          {m.replyTo && (
            <button
              onClick={() => onJump(m.replyTo!.id)}
              title="Jump to message"
              className={`mb-1 flex max-w-md items-stretch overflow-hidden rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] text-left transition hover:border-[var(--chat-accent)] ${
                settings.bubbles && own ? "ml-auto" : ""
              }`}
            >
              <span className="w-1 shrink-0" style={{ backgroundColor: replyColor }} />
              <span className="min-w-0 px-2.5 py-1.5">
                <span className="block text-xs font-bold" style={{ color: replyColor }}>
                  {m.replyTo.senderName}
                </span>
                <span className="block truncate text-xs text-[var(--chat-muted)]">{m.replyTo.body || "(attachment)"}</span>
              </span>
            </button>
          )}

          {m.deletedAt ? (
            <p className="italic text-[var(--chat-muted)]">Message deleted</p>
          ) : editing ? (
            <div className="mt-1">
              <textarea
                value={editText}
                onChange={(e) => onEditChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEditSave(); }
                  if (e.key === "Escape") onEditCancel();
                }}
                autoFocus
                rows={2}
                className="w-full resize-none rounded-lg border border-[var(--chat-accent)] bg-[var(--chat-input)] px-3 py-2 text-[var(--chat-text)] outline-none"
                style={{ fontSize: fontPx(settings) }}
              />
              <p className="mt-1 text-[11px] text-[var(--chat-muted)]">
                escape to <button onClick={onEditCancel} className="text-[var(--chat-accent)] hover:underline">cancel</button> · enter to{" "}
                <button onClick={onEditSave} className="text-[var(--chat-accent)] hover:underline">save</button>
              </p>
            </div>
          ) : (
            <div
              className={
                settings.bubbles
                  ? `inline-block max-w-full rounded-2xl px-3.5 py-2 text-left break-words ${
                      own ? "text-white" : "bg-[var(--chat-bubble)] text-[var(--chat-text)]"
                    }`
                  : "break-words text-[var(--chat-text)]"
              }
              style={settings.bubbles && own ? { backgroundColor: settings.accent } : { fontSize: fontPx(settings) }}
            >
              <MarkdownBody text={m.body} />
              {m.editedAt && <span className="ml-1 align-baseline text-[10px] text-[var(--chat-muted)]">(edited)</span>}
            </div>
          )}

          {!m.deletedAt && m.attachments.length > 0 && <AttachmentList m={m} onOpenImages={onOpenImages} onOpenFile={onOpenFile} />}

          {groupedReactions.length > 0 && (
            <div className={`mt-1 flex flex-wrap gap-1 ${settings.bubbles && own ? "justify-end" : ""}`}>
              {groupedReactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={() => onReact(r.emoji)}
                  title={`${r.users.join(", ")} reacted with ${r.emoji}`}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                    r.mine
                      ? "border-[var(--chat-accent)] bg-[rgba(var(--chat-accent-rgb),0.15)]"
                      : "border-[var(--chat-border)] bg-[var(--chat-float)] hover:border-[var(--chat-accent)]"
                  }`}
                >
                  <span className="text-sm leading-none">{r.emoji}</span>
                  <span className={`font-semibold ${r.mine ? "text-[var(--chat-accent)]" : "text-[var(--chat-muted)]"}`}>{r.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {!m.deletedAt && (
        <div
          className={`absolute -top-3.5 right-4 z-10 hidden items-center overflow-hidden rounded-lg border border-[var(--chat-border)] bg-[var(--chat-float)] shadow-lg group-hover:flex ${
            editing || pickerOpen ? "!flex" : ""
          }`}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onPickerOpen(e.currentTarget.getBoundingClientRect()); }}
            title="Add reaction"
            className="p-1.5 text-[var(--chat-muted)] transition hover:bg-[var(--chat-active)] hover:text-[var(--chat-text)]"
          >
            <SmilePlus className="h-4 w-4" />
          </button>
          <button onClick={onReply} title="Reply"
            className="p-1.5 text-[var(--chat-muted)] transition hover:bg-[var(--chat-active)] hover:text-[var(--chat-text)]">
            <Reply className="h-4 w-4" />
          </button>
          {canModify && (
            <>
              <button onClick={onEditStart} title="Edit"
                className="p-1.5 text-[var(--chat-muted)] transition hover:bg-[var(--chat-active)] hover:text-[var(--chat-text)]">
                <Pencil className="h-4 w-4" />
              </button>
              <button onClick={onDelete} title="Delete"
                className="p-1.5 text-[var(--chat-muted)] transition hover:bg-[var(--chat-active)] hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}

    </div>
  );

  return row;
}
