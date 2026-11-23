"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AuthUserMe, canView } from "./permissions";
import { startViewAs, stopViewAs } from "@/api/auth-view-as";

interface AuthContextValue {
  me: AuthUserMe | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  canView: (viewOrSlug: string) => boolean;
  refresh: () => void;
  /** Root "view as": true when the current identity is an impersonation. */
  isViewingAs: boolean;
  viewAsBusy: boolean;
  enterViewAs: (userId: string) => Promise<void>;
  exitViewAs: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AuthUserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewAsBusy, setViewAsBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        setMe(await res.json());
      } else {
        setMe(null);
      }
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(() => {
    window.location.href = "/api/auth/google";
  }, []);

  const logout = useCallback(async () => {
    // Never leave an impersonation open behind a logout.
    await fetch("/api/auth/view-as", { method: "DELETE" }).catch(() => {});
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
  }, []);

  /** Root only (the server enforces it). Read-only: the API refuses writes
   *  while the overlay is active, so nothing here can mutate the target. */
  const enterViewAs = useCallback(async (userId: string) => {
    setViewAsBusy(true);
    try {
      await startViewAs(userId);
      await refresh();
    } finally {
      setViewAsBusy(false);
    }
  }, [refresh]);

  const exitViewAs = useCallback(async () => {
    setViewAsBusy(true);
    try {
      await stopViewAs();
      await refresh();
    } finally {
      setViewAsBusy(false);
    }
  }, [refresh]);

  const canViewFn = useCallback((viewOrSlug: string) => canView(me, viewOrSlug), [me]);

  return (
    <AuthContext.Provider
      value={{
        me,
        loading,
        login,
        logout,
        canView: canViewFn,
        refresh,
        isViewingAs: !!me?.actingAs,
        viewAsBusy,
        enterViewAs,
        exitViewAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
