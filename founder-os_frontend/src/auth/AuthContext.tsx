"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AuthUserMe, canView } from "./permissions";

interface AuthContextValue {
  me: AuthUserMe | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  canView: (viewOrSlug: string) => boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AuthUserMe | null>(null);
  const [loading, setLoading] = useState(true);

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
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
  }, []);

  const canViewFn = useCallback((viewOrSlug: string) => canView(me, viewOrSlug), [me]);

  return (
    <AuthContext.Provider value={{ me, loading, login, logout, canView: canViewFn, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
