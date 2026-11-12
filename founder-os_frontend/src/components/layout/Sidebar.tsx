"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  NAV_ITEMS,
  type ViewType,
  type NavTarget,
} from "./nav";
import { useDashboardNav } from "@/hooks/useDashboardNav";
import { useAuth } from "@/auth/AuthContext";
import {
  applyOrder,
  dashKey,
  floatStorageKey,
  orderStorageKey,
  useSidebarFloat,
  useSidebarOrder,
} from "@/hooks/useSidebarCustom";
import { APP_THEMES, APP_ACCENTS } from "@/hooks/useTheme";
import { LayoutGrid, Palette, Check, Pin, PinOff, RotateCcw } from "lucide-react";
import type { SidebarProps, SidebarRow } from "./sidebar/types";
import { DASH_ICONS } from "./sidebar/helpers";

export type { ViewType } from "./nav";

/**
 * Collapsed icon rail that expands to the full sidebar on hover (or when a
 * child receives keyboard focus, so tabbing through the nav still shows the
 * labels it is landing on).
 *
 * Width math: the rail is 76px with `px-4` (32px of padding), leaving a 44px
 * content box. A nav row is `px-3` + a 20px icon, so 12 + 20 + 12 = 44 — the
 * icons sit exactly centred in the rail with no conditional alignment classes.
 * Everything past 44px is clipped by `overflow-hidden`, and the trailing
 * labels fade out via opacity so nothing reflows mid-animation.
 */
export default function Sidebar({ activeView, activeSlug, onNavigate, theme, onSetTheme, accent, onSetAccent, me, onLogout, canView }: SidebarProps) {
  const visible = NAV_ITEMS.filter((i) => canView(i.view));
  const dashboards = useDashboardNav();
  const { me: authMe } = useAuth();
  /* Root/admin keeps the exact legacy static sidebar — reorder + floating
     are non-root features only. */
  const reorderable = !authMe?.isAdmin;
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // A saved accent outside the preset swatches → the custom chip is active.
  const custom = !!accent && !APP_ACCENTS.some((a) => a.value.toLowerCase() === accent.toLowerCase());
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  /* ── Dashboard order (per user, this browser only). Main views stay
     fixed exactly as before — only dashboard rows are draggable. ── */
  const defaultRows = useMemo<SidebarRow[]>(
    () =>
      dashboards.map((d) => ({
        key: dashKey(d.slug),
        label: d.name,
        icon: DASH_ICONS[d.slug] ?? LayoutGrid,
        target: { type: "dashboard", slug: d.slug } as NavTarget,
        isActive: d.slug === activeSlug,
        isDashboard: true,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dashboards.map((d) => d.slug).join("|"), activeSlug],
  );
  const { order, move, reset } = useSidebarOrder(
    orderStorageKey(me?.email),
    useMemo(() => defaultRows.map((r) => r.key), [defaultRows]),
  );
  const rows = useMemo(
    () => applyOrder(defaultRows, (r) => r.key, order),
    [defaultRows, order],
  );
  const { floating, x, y, undock, dock, setPos, commitPos } = useSidebarFloat(floatStorageKey(me?.email));
  /* Effective floating is non-root only — root never undocks. */
  const floatingOn = reorderable && floating;

  /* ── Pick-up-and-drop reorder: the whole row is draggable, the list
     re-flows live under the cursor with a FLIP slide animation. ── */
  const [dragKey, setDragKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const prevRects = useRef(new Map<string, DOMRect>());

  const snapshotRects = () => {
    const m = new Map<string, DOMRect>();
    rowRefs.current.forEach((el, k) => {
      /* Finish any in-flight slide before measuring — mid-animation rects
         feed back into the next delta and cause the bottom shake. */
      try {
        el.getAnimations().forEach((a) => a.finish());
      } catch {
        /* noop — animation API unavailable */
      }
      m.set(k, el.getBoundingClientRect());
    });
    prevRects.current = m;
  };

  /* After every live re-flow, slide rows from their old position. */
  useLayoutEffect(() => {
    if (!dragKey) return;
    rowRefs.current.forEach((el, k) => {
      const prev = prevRects.current.get(k);
      if (!prev) return;
      const dy = prev.top - el.getBoundingClientRect().top;
      if (dy !== 0) {
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
          { duration: 200, easing: "cubic-bezier(0.2,0,0,1)" },
        );
      }
    });
  }, [rows, dragKey]);

  const expanded = floatingOn || hovered || focusWithin;

  /* All colours route through theme tokens so the shell renders correctly on
     the warm Sage canvas and on every dark preset alike. */
  const itemClass = (isActive: boolean) =>
    `group relative flex w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-left text-label font-semibold transition-colors duration-150 ${
      isActive
        ? "bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]"
        : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
    }`;

  const activeBar = (isActive: boolean) =>
    isActive && (
      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[var(--color-brand-indigo)]" />
    );

  /* Labels fade in slightly after the rail starts growing so the text is not
     mid-squeeze while the width animates. */
  const labelClass = expanded
    ? "opacity-100 transition-opacity duration-200 delay-75"
    : "opacity-0 transition-opacity duration-100";

  const collapse = () => {
    if (floatingOn) return;
    setHovered(false);
    setFocusWithin(false);
    // The popover is wider than the rail, so it can't outlive the expansion.
    setAppearanceOpen(false);
  };

  /* Floating-panel drag (header is the handle; position persists on release). */
  const floatDrag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onFloatPointerDown = (e: React.PointerEvent) => {
    if (!floatingOn) return;
    floatDrag.current = { startX: e.clientX, startY: e.clientY, origX: x, origY: y };
  };
  const onFloatPointerMove = (e: React.PointerEvent) => {
    const d = floatDrag.current;
    if (!d) return;
    setPos(d.origX + e.clientX - d.startX, d.origY + e.clientY - d.startY);
  };
  const onFloatPointerUp = () => {
    if (floatDrag.current) {
      floatDrag.current = null;
      commitPos();
    }
  };

  const onRowKeyDown = (e: React.KeyboardEvent, key: string, index: number) => {
    if (!e.altKey) return;
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      move(key, index - 1);
    } else if (e.key === "ArrowDown" && index < rows.length - 1) {
      e.preventDefault();
      move(key, index + 1);
    }
  };

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={collapse}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocusWithin(false);
          setAppearanceOpen(false);
        }
      }}
      aria-label="Main navigation"
      style={floatingOn ? { left: x, top: y } : undefined}
      className={`${
        floatingOn
          ? "fixed z-50 flex max-h-[calc(100vh-32px)] w-[260px] flex-col overflow-hidden rounded-2xl border border-[var(--border-card)] bg-[var(--bg-sidebar)] px-4 py-6 shadow-[var(--shadow-float)]"
          : `sticky top-0 z-40 hidden h-screen shrink-0 self-start flex-col overflow-hidden border-r border-[var(--border-card)] bg-[var(--bg-sidebar)] px-4 py-6 transition-[width] duration-300 ease-out motion-reduce:transition-none md:flex ${
              expanded ? "md:w-[260px]" : "md:w-[76px]"
            }`
      }`}
    >
      <div
        className={`mb-8 flex items-center gap-3 px-1.5 ${floatingOn ? "cursor-move touch-none select-none" : ""}`}
        onPointerDown={onFloatPointerDown}
        onPointerMove={onFloatPointerMove}
        onPointerUp={onFloatPointerUp}
        title={floatingOn ? "Drag to move · position is saved" : undefined}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-gradient-to-br from-[var(--color-brand-indigo)] to-[var(--color-indigo-500)] text-white shadow-[var(--shadow-soft)]">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <div className={`min-w-0 leading-tight ${labelClass}`}>
          <span className="block truncate font-heading text-sm font-bold tracking-tight text-[var(--text-primary)]">Brindavan Udyog India</span>
          <span className="block truncate text-[11px] font-medium tracking-wide text-[var(--text-tertiary)]">Founder OS</span>
        </div>
        {reorderable && expanded && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (floatingOn) dock();
              else undock();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title={floatingOn ? "Dock sidebar back" : "Undock sidebar — drag it anywhere"}
            aria-label={floatingOn ? "Dock sidebar back" : "Undock sidebar"}
            className={`ml-auto shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] ${labelClass}`}
          >
            {floatingOn ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
          </button>
        )}
      </div>

      <nav
        className="scrollbar-thin -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-1"
        onDragOver={(e) => {
          if (reorderable && dragKey) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!reorderable) return;
          e.preventDefault();
          setDragKey(null);
        }}
      >
        {reorderable ? (
          <>
            {visible.map((item) => {
              const Icon = item.icon;
              const isActive = item.view === activeView;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => onNavigate({ type: "view", view: item.view })}
                  className={itemClass(isActive)}
                  title={expanded ? undefined : item.label}
                  aria-label={expanded ? undefined : item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  {activeBar(isActive)}
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
                  <span className={`truncate whitespace-nowrap ${labelClass}`}>{item.label}</span>
                </button>
              );
            })}

            {rows.length > 0 && (
              <div className="mt-4">
                <div className={`px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] ${labelClass}`}>
                  Dashboards
                </div>
                <div className="flex flex-col gap-1">
                  {rows.map((row, index) => {
                    const Icon = row.icon;
                    return (
                      <div
                        key={row.key}
                        ref={(el) => {
                          if (el) rowRefs.current.set(row.key, el);
                          else rowRefs.current.delete(row.key);
                        }}
                        draggable={expanded}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", row.key);
                          e.dataTransfer.effectAllowed = "move";
                          snapshotRects();
                          setDragKey(row.key);
                        }}
                        onDragOver={(e) => {
                          if (!dragKey || dragKey === row.key) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const from = rows.findIndex((r) => r.key === dragKey);
                          if (from === index) return;
                          /* Only re-flow once the pointer crosses the hovered
                             row's midpoint — this stops the rapid back-and-forth
                             shake on tiny movements. */
                          const rect = e.currentTarget.getBoundingClientRect();
                          const middle = rect.top + rect.height / 2;
                          if (from < index && e.clientY < middle) return;
                          if (from > index && e.clientY > middle) return;
                          snapshotRects();
                          move(dragKey, index);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragKey(null);
                        }}
                        onDragEnd={() => setDragKey(null)}
                        onKeyDown={(e) => onRowKeyDown(e, row.key, index)}
                        className={`rounded-[var(--radius-control)] transition-opacity duration-150 ${
                          dragKey === row.key ? "opacity-40" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onNavigate(row.target)}
                          className={`${itemClass(row.isActive)} cursor-grab select-none active:cursor-grabbing`}
                          title={row.label}
                          aria-label={`${row.label} dashboard`}
                          aria-current={row.isActive ? "page" : undefined}
                        >
                          {activeBar(row.isActive)}
                          <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
                          <span className={`truncate whitespace-nowrap ${labelClass}`}>{row.label}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            {visible.map((item) => {
              const Icon = item.icon;
              const isActive = item.view === activeView;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => onNavigate({ type: "view", view: item.view })}
                  className={itemClass(isActive)}
                  title={expanded ? undefined : item.label}
                  aria-label={expanded ? undefined : item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  {activeBar(isActive)}
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
                  <span className={`truncate whitespace-nowrap ${labelClass}`}>{item.label}</span>
                </button>
              );
            })}

            {dashboards.length > 0 && (
              <div className="mt-4">
                <div className={`px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] ${labelClass}`}>
                  Dashboards
                </div>
                <div className="flex flex-col gap-1">
                  {dashboards.map((d) => {
                    const Icon = DASH_ICONS[d.slug] ?? LayoutGrid;
                    const isActive = d.slug === activeSlug;
                    return (
                      <button
                        key={d.slug}
                        type="button"
                        onClick={() => onNavigate({ type: "dashboard", slug: d.slug })}
                        className={itemClass(isActive)}
                        title={d.name}
                        aria-current={isActive ? "page" : undefined}
                      >
                        {activeBar(isActive)}
                        <Icon className="h-5 w-5 shrink-0" strokeWidth={2} />
                        <span className={`truncate whitespace-nowrap ${labelClass}`}>{d.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-[var(--border-card)] pt-4">
        <div className="relative">
          <button
            onClick={() => setAppearanceOpen((v) => !v)}
            type="button"
            className="flex w-full items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] px-3 py-2.5 text-label font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]"
            title={expanded ? undefined : "Appearance"}
            aria-label={expanded ? undefined : "Appearance"}
            aria-expanded={appearanceOpen}
          >
            <Palette className="h-5 w-5 shrink-0" />
            <span className={`truncate whitespace-nowrap ${labelClass}`}>Appearance</span>
          </button>
          {appearanceOpen && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-[var(--radius-control)] border border-[var(--border-card)] bg-[var(--surface-raised)] p-3 shadow-[var(--shadow-float)] animate-scale-up">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Theme</p>
              <div className="space-y-1">
                {APP_THEMES.map((t) => {
                  const active = theme === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => onSetTheme(t.id)}
                      type="button"
                      className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-caption font-medium transition-colors ${
                        active
                          ? "bg-[var(--surface-soft)] text-[var(--color-brand-indigo)]"
                          : "text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span className="h-6 w-6 shrink-0 rounded-md border border-[var(--border-card)]" style={{ backgroundColor: t.swatch }} />
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                      {active && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand-indigo)]" />}
                    </button>
                  );
                })}
              </div>
              <p className="mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Accent</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {APP_ACCENTS.map((a) => {
                  const active = accent?.toLowerCase() === a.value;
                  return (
                    <button
                      key={a.value}
                      onClick={() => onSetAccent(a.value)}
                      title={a.name}
                      type="button"
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform ${
                        active ? "scale-110 border-[var(--text-primary)]" : "border-transparent hover:scale-105"
                      }`}
                      style={{ backgroundColor: a.value }}
                    >
                      {active && <Check className="h-3 w-3 text-white drop-shadow" />}
                    </button>
                  );
                })}
                {/* Any hex is valid — the ramp is generated from it in the
                    direction the active preset needs (see accentCssVars). */}
                <label
                  title={custom ? `Custom accent — ${accent}` : "Custom accent colour"}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-full border-2 transition-transform ${
                    custom ? "scale-110 border-[var(--text-primary)]" : "border-[var(--border-card)] hover:scale-105"
                  }`}
                  style={{ background: "conic-gradient(from 0deg, #f43f5e, #f59e0b, #10b981, #0ea5e9, #8b5cf6, #f43f5e)" }}
                >
                  <input
                    type="color"
                    value={custom ? accent! : "#5b5ef0"}
                    onChange={(e) => onSetAccent(e.target.value)}
                    aria-label="Custom accent colour"
                    className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
                  />
                  {custom && <Check className="h-3 w-3 text-white drop-shadow" />}
                </label>
                {accent && (
                  <button
                    onClick={() => onSetAccent(null)}
                    type="button"
                    title="Use theme default accent"
                    className="ml-auto rounded-[var(--radius-sm)] border border-[var(--border-card)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    Auto
                  </button>
                )}
              </div>
              {custom && (
                <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{accent}</p>
              )}
              {reorderable && (
                <div className="mt-3 border-t border-[var(--border-card)] pt-2.5">
                  <button
                    onClick={reset}
                    type="button"
                    title="Restore the default navigation order"
                    className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-caption font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)]"
                  >
                    <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                    Reset sidebar order
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onLogout}
          type="button"
          className={`flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-sunken)] py-2.5 text-left transition-colors hover:bg-[var(--surface-soft)] ${
            expanded ? "px-3" : "px-1"
          }`}
          title={expanded ? undefined : "Sign out"}
          aria-label={me?.name ? `Sign out ${me.name}` : "Sign out"}
        >
          {me?.picture ? (
            <img src={me.picture} alt="" className="h-9 w-9 flex-shrink-0 rounded-full" />
          ) : (
            <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--surface-soft)] font-bold text-[var(--color-brand-indigo)]">
              {(me?.name || me?.email || "U").charAt(0).toUpperCase()}
            </div>
          )}
          <div className={`min-w-0 leading-tight ${labelClass}`}>
            <span className="block truncate text-label font-semibold text-[var(--text-primary)]">{me?.name || "Signed in"}</span>
            <span className="block truncate text-caption text-[var(--text-tertiary)]">{me?.email}</span>
          </div>
          <span className={`ml-auto shrink-0 whitespace-nowrap text-caption font-medium text-[var(--color-danger)] ${labelClass}`}>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
