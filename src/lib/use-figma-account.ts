"use client";

import { useCallback, useEffect, useState } from "react";

export interface FigmaAccount {
  connected: boolean;
  handle?: string;
  email?: string | null;
  avatarUrl?: string | null;
}

interface ServerConfig {
  figmaConfigured: boolean; // the app itself has Figma sign-in set up
  geminiConfigured: boolean;
}

/**
 * Shared client-side hook for "is Figma sign-in available at all, and is
 * *this visitor* currently connected". Used by both the navbar (small
 * status pill) and the landing page (the Connect Figma card), so they
 * never disagree with each other.
 */
export function useFigmaAccount() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [account, setAccount] = useState<FigmaAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, meRes] = await Promise.all([fetch("/api/status"), fetch("/api/auth/me")]);
      setConfig(await statusRes.json());
      setAccount(await meRes.json());
    } catch {
      setConfig(null);
      setAccount({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await fetch("/api/auth/figma/logout", { method: "POST" });
    await refresh();
  }, [refresh]);

  return {
    loading,
    figmaOAuthConfigured: config?.figmaConfigured ?? false,
    geminiConfigured: config?.geminiConfigured ?? false,
    connected: account?.connected ?? false,
    handle: account?.handle,
    email: account?.email,
    avatarUrl: account?.avatarUrl,
    refresh,
    disconnect,
  };
}
