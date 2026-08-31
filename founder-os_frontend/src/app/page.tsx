"use client";

import React, { useState, useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "../hooks/useTheme";
import { useHashRoute } from "../hooks/useHashRoute";
import { useDashboardNav } from "@/hooks/useDashboardNav";
import ErrorBoundary from "../components/ErrorBoundary";
import Sidebar from "../components/layout/Sidebar";
import MobileNav from "../components/layout/MobileNav";
import MobileDrawer from "../components/layout/MobileDrawer";
import { AuthProvider, useAuth } from "@/auth/AuthContext";
import LoginScreen from "@/components/LoginScreen";
import UserAdmin from "@/components/UserAdmin";
import { NAV_ITEMS, navTargetPath, type NavTarget, type ViewType } from "@/components/layout/nav";

// Heavy views are lazy-loaded so only the active view's JS is fetched & parsed.
const FounderAssistant = dynamic(() => import("../components/FounderAssistant"), { ssr: false });
const WhatsAppDashboard = dynamic(() => import("../components/WhatsAppDashboard"), { ssr: false });
const Automations = dynamic(() => import("../components/Automations"), { ssr: false });
const ChatRoom = dynamic(() => import("../components/ChatRoom"), { ssr: false });

export default function Home() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  const { me, loading, logout, canView } = useAuth();

  const { theme, toggleTheme, setTheme, accent, setAccent, isDark } = useTheme();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const { route, navigate } = useHashRoute();
  const sub = route.view === "automations" ? route.sub : null;
  const activeView: ViewType =
    (["briefing", "whatsapp", "automations", "chat", "admin"] as ViewType[]).includes(route.view as ViewType)
      ? (route.view as ViewType)
      : "automations";

  const viewDenied = activeView !== "admin" && !(activeView === "automations" && sub ? canView(sub) : canView(activeView));

  // Views this user can actually reach: accessible main nav views + role-granted dashboards.
  const accessibleMain = useMemo(() => NAV_ITEMS.filter((i) => canView(i.view)), [canView]);
  const dashboards = useDashboardNav();

  // If the current view is denied but the user has SOMETHING they can access,
  // auto-route them to it. Only users with literally nothing granted keep seeing
  // the "Access pending" panel.
  useEffect(() => {
    if (loading || !me) return;
    if (!viewDenied) return;
    const first: NavTarget | null =
      accessibleMain[0]
        ? { type: "view", view: accessibleMain[0].view }
        : dashboards[0]
          ? { type: "dashboard", slug: dashboards[0].slug }
          : null;
    if (first) navigate(navTargetPath(first));
  }, [viewDenied, loading, me, accessibleMain, dashboards, navigate]);

  const navigateTo = useCallback((target: NavTarget) => {
    navigate(navTargetPath(target));
  }, [navigate]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-zinc-400">Loading session…</div>;
  }
  if (!me) return <LoginScreen />;

  return (
    <div className="flex min-h-screen font-sans antialiased text-[var(--text-primary)]">
      <Sidebar activeView={activeView} activeSlug={sub} onNavigate={navigateTo} theme={theme} onSetTheme={setTheme} accent={accent} onSetAccent={setAccent} me={me ? me.user : null} onLogout={logout} canView={canView} />

      <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border-card)] bg-[var(--bg-card)]/85 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2.5">
          <button onClick={() => setMobileMenuOpen(true)} aria-label="Open menu" title="Menu"
            className="rounded-lg p-1.5 text-[var(--text-secondary)] transition hover:bg-[var(--bg-input)] md:hidden">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {me.user.picture ? (
            <img src={me.user.picture} alt="" className="h-8 w-8 rounded-full" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              {(me.user.name || me.user.email || "U").charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-heading text-base font-extrabold tracking-tight">Brindavan Udyog</span>
        </div>
        <button onClick={toggleTheme} className="rounded-lg p-2 text-[var(--text-secondary)] transition hover:bg-[var(--bg-input)]">
          {isDark ? (
            <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" /></svg>
          ) : (
            <svg className="h-5 w-5 text-indigo-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          )}
        </button>
      </header>

      <MobileDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        activeView={activeView}
        activeSlug={sub}
        onNavigate={navigateTo}
        theme={theme}
        onToggleTheme={toggleTheme}
        me={me ? me.user : null}
        onLogout={logout}
        canView={canView}
      />

      <MobileNav activeView={activeView} onNavigate={(v) => navigateTo({ type: "view", view: v })} canView={canView} />

      <main className="flex-1 p-4 md:p-6 lg:p-8 mb-16 md:mb-0">
        <ErrorBoundary>
          <div className="mx-auto w-full max-w-[1600px]">
          {viewDenied ? (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
              <div className="text-5xl">🔒</div>
              <h2 className="text-2xl font-bold">Access pending</h2>
              <p className="max-w-md text-zinc-500">Your account doesn't have permission for this section yet. Ask the administrator to grant access.</p>
            </div>
          ) : activeView === "admin" ? (
            <UserAdmin />
          ) : (
          <>
          {activeView === "briefing" && <FounderAssistant />}
          {activeView === "whatsapp" && <WhatsAppDashboard />}
          {activeView === "chat" && <ChatRoom />}
          {activeView === "automations" && (
            <Automations slug={sub} onNavigate={navigate} />
          )}
          </>
          )}
          </div>
        </ErrorBoundary>
      </main>
      </div>
    </div>
  );
}