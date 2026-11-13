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
import { NAV_ITEMS, VIEW_TYPES, navTargetPath, type NavTarget, type ViewType } from "@/components/layout/nav";
import { WorkspaceHostProvider } from "@/workspaces/WorkspaceHost";
import { useWorkspaces } from "@/workspaces/useWorkspaces";
import { canonicalNavSlug } from "@/workspaces/aliases";

// Heavy views are lazy-loaded so only the active view's JS is fetched & parsed.
const FounderAssistant = dynamic(() => import("../components/FounderAssistant"), { ssr: false });
const WhatsAppDashboard = dynamic(() => import("../components/WhatsAppDashboard"), { ssr: false });
const AutomationsView = dynamic(() => import("../views/automations/AutomationsView"), { ssr: false });
const SessionView = dynamic(() => import("../views/session/SessionView"), { ssr: false });
const ChatRoom = dynamic(() => import("../components/ChatRoom"), { ssr: false });
const DelegationView = dynamic(() => import("../components/delegation/DelegationView"), { ssr: false });
const EmailDashboard = dynamic(() => import("../components/EmailDashboard"), { ssr: false });
const SettingsDashboard = dynamic(() => import("../components/SettingsDashboard"), { ssr: false });

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
  // Workspaces (dashboards) live at /session/<slug>. Legacy URLs —
  // /automations/<slug> bookmarks and absorbed slugs (payment-tracker,
  // telecalling, …) — are redirected in place (replace, no back-button trap).
  const sub = route.view === "session" ? route.sub : null;
  useEffect(() => {
    if (route.view === "automations" && route.sub) {
      navigate(`/session/${canonicalNavSlug(route.sub)}`, { replace: true });
    } else if (route.view === "session" && route.sub && canonicalNavSlug(route.sub) !== route.sub) {
      navigate(`/session/${canonicalNavSlug(route.sub)}`, { replace: true });
    }
  }, [route.view, route.sub, navigate]);
  // Unknown paths fall back to /automations; a viewer without registry access
  // is then auto-routed to their first accessible view (Workspace) below.
  const activeView: ViewType = VIEW_TYPES.includes(route.view as ViewType) ? (route.view as ViewType) : "automations";

  // Views this user can actually reach: accessible main nav views + role-granted dashboards.
  const accessibleMain = useMemo(() => NAV_ITEMS.filter((i) => canView(i.view)), [canView]);
  const dashboards = useDashboardNav();
  const { workspaces, loading: workspacesLoading } = useWorkspaces();

  const viewDenied =
    activeView !== "admin" &&
    !(activeView === "session" && sub
      ? // Workspace slugs are resolved against the live, server-filtered list
        // (GET /api/session/workspaces) so new dashboards need zero per-slug
        // edits here; canView() is the fallback (admins, implied scopes).
        workspaces.some((w) => w.slug === sub) || canView(sub)
      : canView(activeView));

  // If the current view is denied but the user has SOMETHING they can access,
  // auto-route them to it. Only users with literally nothing granted keep seeing
  // the "Access pending" panel.
  useEffect(() => {
    if (loading || !me) return;
    if (!viewDenied) return;
    // A legacy /automations/<slug> link is being redirected to /session/<slug>
    // by the effect above — don't race it to the first accessible view.
    if (route.view === "automations" && route.sub) return;
    // Don't bounce a workspace deep link before the workspace list arrives.
    if (activeView === "session" && sub && workspacesLoading) return;
    // Dashboards arrive async (useWorkspaces); routing before they load sends
    // normal users to Delegation even though a dashboard exists. Wait for the
    // list for everyone except root (root has no dashboard rows by design —
    // it opens everything from the Workspace page).
    if (!me.isRoot && workspacesLoading) return;
    const first: NavTarget | null =
      dashboards[0]
        ? { type: "dashboard", slug: dashboards[0].slug }
        : accessibleMain[0]
          ? { type: "view", view: accessibleMain[0].view }
          : null;
    if (first) navigate(navTargetPath(first));
  }, [viewDenied, loading, me, accessibleMain, dashboards, navigate, activeView, sub, workspacesLoading, route.view, route.sub]);

  const navigateTo = useCallback((target: NavTarget) => {
    navigate(navTargetPath(target));
  }, [navigate]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-label text-[var(--text-secondary)]">Loading session…</div>;
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
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-brand-indigo)] text-xs font-bold text-white">
              {(me.user.name || me.user.email || "U").charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-heading text-base font-extrabold tracking-tight">Brindavan Udyog India</span>
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
              <h2 className="font-heading text-section text-[var(--text-primary)]">Access pending</h2>
              <p className="max-w-md text-label text-[var(--text-secondary)]">Your account doesn't have permission for this section yet. Ask the administrator to grant access.</p>
            </div>
          ) : activeView === "admin" ? (
            <UserAdmin />
          ) : (
          <>
          {activeView === "briefing" && <FounderAssistant />}
          {activeView === "delegation" && <DelegationView />}
          {activeView === "whatsapp" && <WhatsAppDashboard />}
          {activeView === "chat" && <ChatRoom />}
          {activeView === "email" && <EmailDashboard />}
          {activeView === "settings" && <SettingsDashboard />}
          {activeView === "session" && (
            <WorkspaceHostProvider basePath="/session" navigate={navigate}>
              <SessionView slug={sub} />
            </WorkspaceHostProvider>
          )}
          {activeView === "automations" && (
            <WorkspaceHostProvider basePath="/automations" navigate={navigate}>
              <AutomationsView />
            </WorkspaceHostProvider>
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