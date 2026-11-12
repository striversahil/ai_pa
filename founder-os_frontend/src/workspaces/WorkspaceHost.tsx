"use client";

// WorkspaceHost — tells a workspace component which page it is rendered on,
// so components never hardcode `/automations` or `/session`.
//
//   const host = useWorkspaceHost();
//   host.open("stock");        // another workspace, on the same host page
//   host.home();               // back to the host's grid
//   host.navigate("/delegation");  // any other app view

import React, { createContext, useContext, useMemo } from "react";

export interface WorkspaceHostValue {
  basePath: "/session" | "/automations";
  open(slug: string): void;
  home(): void;
  navigate(path: string): void;
}

/** Fallback for components rendered outside a provider: History API push +
 *  popstate, which useHashRoute already listens to. */
function historyNavigate(path: string): void {
  if (typeof window === "undefined") return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const DEFAULT_HOST: WorkspaceHostValue = {
  basePath: "/session",
  open: (slug) => historyNavigate(`/session/${slug}`),
  home: () => historyNavigate("/session"),
  navigate: historyNavigate,
};

const HostContext = createContext<WorkspaceHostValue>(DEFAULT_HOST);

export function WorkspaceHostProvider({
  basePath,
  navigate,
  children,
}: {
  basePath: WorkspaceHostValue["basePath"];
  navigate: (path: string) => void;
  children: React.ReactNode;
}) {
  const value = useMemo<WorkspaceHostValue>(() => ({
    basePath,
    // Workspaces always open under /session (dashboards live there for everyone);
    // the /automations registry only links into them.
    open: (slug) => navigate(`/session/${slug}`),
    home: () => navigate(basePath),
    navigate,
  }), [basePath, navigate]);
  return <HostContext.Provider value={value}>{children}</HostContext.Provider>;
}

export function useWorkspaceHost(): WorkspaceHostValue {
  return useContext(HostContext);
}
