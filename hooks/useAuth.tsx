"use client";

import { apiGet, apiPost, clearApiCache, ClientApiError } from "@/lib/client-api";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  bookingCount: number;
  login: (payload: { email: string; password: string }) => Promise<void>;
  register: (payload: {
    email: string;
    password: string;
    name: string;
    phone?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

type MeResponse = {
  user: User | null;
  bookingCount: number;
};

const AuthContext = createContext<AuthContextType | null>(null);
const AUTH_CACHE_KEY = "auth_state_v1";
const AUTH_REFRESH_COOLDOWN_MS = 60_000;
const IS_DEV = process.env.NODE_ENV !== "production";

type CachedAuthState = {
  user: User | null;
  bookingCount: number;
  fetchedAt: number;
};

function loadCachedAuthState(): CachedAuthState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = sessionStorage.getItem(AUTH_CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CachedAuthState;
  } catch {
    return null;
  }
}

function saveCachedAuthState(state: CachedAuthState) {
  if (typeof window === "undefined") {
    return;
  }

  sessionStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(state));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookingCount, setBookingCount] = useState(0);

  const refresh = useCallback(async (force = false) => {
    const cached = loadCachedAuthState();
    if (!force && cached && Date.now() - cached.fetchedAt < AUTH_REFRESH_COOLDOWN_MS) {
      setUser(cached.user);
      setBookingCount(cached.user ? cached.bookingCount : 0);
      setLoading(false);
      if (IS_DEV) {
        console.info("[auth] refresh skipped by cooldown");
      }
      return;
    }

    setLoading(true);

    try {
      const data = await apiGet<MeResponse>("/api/auth/me");
      setUser(data.user);
      setBookingCount(data.user ? data.bookingCount : 0);
      saveCachedAuthState({
        user: data.user,
        bookingCount: data.user ? data.bookingCount : 0,
        fetchedAt: Date.now(),
      });
      if (IS_DEV) {
        console.info("[auth] /api/auth/me fetched");
      }
    } catch {
      setUser(null);
      setBookingCount(0);
      saveCachedAuthState({
        user: null,
        bookingCount: 0,
        fetchedAt: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (payload: { email: string; password: string }) => {
      await apiPost("/api/auth/login", payload);
      clearApiCache("/api/auth/me");
      await refresh(true);
    },
    [refresh],
  );

  const register = useCallback(
    async (payload: { email: string; password: string; name: string; phone?: string }) => {
      await apiPost("/api/auth/register", payload);
      clearApiCache("/api/auth/me");
      await refresh(true);
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await apiPost("/api/auth/logout");
    clearApiCache("/api/auth/me");
    setUser(null);
    setBookingCount(0);
    saveCachedAuthState({
      user: null,
      bookingCount: 0,
      fetchedAt: Date.now(),
    });
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      bookingCount,
      login,
      register,
      logout,
      refresh,
    }),
    [user, loading, bookingCount, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return ctx;
}

export function getClientErrorMessage(error: unknown) {
  if (error instanceof ClientApiError) {
    return error.message;
  }

  return "Đã có lỗi xảy ra, vui lòng thử lại.";
}
