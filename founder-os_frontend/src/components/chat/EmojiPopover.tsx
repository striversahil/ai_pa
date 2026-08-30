"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";

const PANEL_W = 360;
const PANEL_H = 430;
const MARGIN = 12;

function placeFor(rect: DOMRect): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw < 640) {
    return { position: "fixed", left: 0, right: 0, bottom: 0, top: "auto", width: "100%", maxHeight: "55vh" };
  }
  const w = Math.min(PANEL_W, vw - MARGIN * 2);
  const h = PANEL_H;
  let left = Math.min(Math.max(MARGIN, rect.right - w), vw - w - MARGIN);
  left = Math.max(MARGIN, left);
  let top = rect.bottom + 8;
  if (top + h > vh - MARGIN) top = rect.top - h - 8;
  if (top < MARGIN) top = MARGIN;
  return { position: "fixed", left, top, width: w, maxHeight: h };
}

export default function EmojiPopover({
  rect,
  onPick,
  onClose,
  dark,
  accent,
  keepOpenOnPick = false,
}: {
  rect: DOMRect;
  onPick: (emoji: string) => void;
  onClose: () => void;
  dark: boolean;
  accent: string;
  keepOpenOnPick?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cbRef = useRef({ onPick, onClose, keepOpenOnPick });
  cbRef.current = { onPick, onClose, keepOpenOnPick };

  const [style, setStyle] = useState<React.CSSProperties>(() => placeFor(rect));

  useLayoutEffect(() => {
    setStyle(placeFor(rect));
  }, [rect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cbRef.current.onClose(); };
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      cbRef.current.onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", cbRef.current.onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", cbRef.current.onClose);
    };
  }, []);

  const picker = useMemo(
    () => (
      <Picker
        data={data}
        onEmojiSelect={(emoji: { native?: string }) => {
          if (!emoji?.native) return;
          cbRef.current.onPick(emoji.native);
          if (!cbRef.current.keepOpenOnPick) cbRef.current.onClose();
        }}
        theme={dark ? "dark" : "light"}
        accentColor={accent}
        previewPosition="none"
        skinTonePosition="none"
        emojiSize={20}
        emojiButtonSize={36}
      />
    ),
    [dark, accent],
  );

  return (
    <>
      <div className="fixed inset-0 z-[120]" onClick={() => cbRef.current.onClose()} />
      <div
        ref={panelRef}
        className="z-[121] overflow-hidden rounded-xl border border-[var(--chat-border)] bg-[var(--chat-panel)] shadow-2xl"
        style={style}
      >
        {picker}
      </div>
    </>
  );
}
