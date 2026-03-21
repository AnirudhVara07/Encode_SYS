import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const STORAGE_BEARER = "vigil_agent_bearer";
const STORAGE_PRO = "vigil_is_pro_local";
const STORAGE_MODE = "vigil_execution_mode";

type VigilUserContextValue = {
  bearer: string;
  setBearer: (t: string) => void;
  isPro: boolean;
  setIsPro: (v: boolean) => Promise<void>;
  executionMode: "paper" | "live";
  setExecutionMode: (m: "paper" | "live") => Promise<void>;
  refreshProfile: () => Promise<void>;
  profileError: string | null;
};

const VigilUserContext = createContext<VigilUserContextValue | null>(null);

export function VigilUserProvider({ children }: { children: ReactNode }) {
  const [bearer, setBearerState] = useState("");
  const [isPro, setIsProState] = useState(false);
  const [executionMode, setExecutionModeState] = useState<"paper" | "live">("paper");
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const b = localStorage.getItem(STORAGE_BEARER) || "";
      const p = localStorage.getItem(STORAGE_PRO);
      const m = localStorage.getItem(STORAGE_MODE) as "paper" | "live" | null;
      setBearerState(b);
      if (p === "1" || p === "true") setIsProState(true);
      if (m === "live" || m === "paper") setExecutionModeState(m);
    } catch {
      /* ignore */
    }
  }, []);

  const setBearer = useCallback((t: string) => {
    setBearerState(t);
    try {
      if (t.trim()) localStorage.setItem(STORAGE_BEARER, t.trim());
      else localStorage.removeItem(STORAGE_BEARER);
    } catch {
      /* ignore */
    }
  }, []);

  const authHeaders = useCallback(() => {
    const t = bearer.trim();
    if (!t) return null;
    return { Authorization: `Bearer ${t}`, "Content-Type": "application/json" };
  }, [bearer]);

  const refreshProfile = useCallback(async () => {
    const h = authHeaders();
    if (!h) {
      setProfileError(null);
      return;
    }
    try {
      const r = await fetch("/profile", { headers: h });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Profile fetch failed");
      if (typeof data.is_pro === "boolean") setIsProState(data.is_pro);
      if (data.execution_mode === "live" || data.execution_mode === "paper") {
        setExecutionModeState(data.execution_mode);
      }
      setProfileError(null);
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : "Profile error");
    }
  }, [authHeaders]);

  const setIsPro = useCallback(
    async (v: boolean) => {
      setIsProState(v);
      try {
        localStorage.setItem(STORAGE_PRO, v ? "1" : "0");
      } catch {
        /* ignore */
      }
      const h = authHeaders();
      if (h) {
        try {
          const r = await fetch("/profile", { method: "PATCH", headers: h, body: JSON.stringify({ is_pro: v }) });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "PATCH failed");
          if (typeof data.is_pro === "boolean") setIsProState(data.is_pro);
        } catch (e) {
          setProfileError(e instanceof Error ? e.message : "Could not sync Pro to server");
        }
      }
    },
    [authHeaders],
  );

  const setExecutionMode = useCallback(
    async (m: "paper" | "live") => {
      setExecutionModeState(m);
      try {
        localStorage.setItem(STORAGE_MODE, m);
      } catch {
        /* ignore */
      }
      const h = authHeaders();
      if (h) {
        try {
          await fetch("/profile", {
            method: "PATCH",
            headers: h,
            body: JSON.stringify({ execution_mode: m }),
          });
        } catch {
          /* non-fatal */
        }
      }
    },
    [authHeaders],
  );

  const value = useMemo(
    () => ({
      bearer,
      setBearer,
      isPro,
      setIsPro,
      executionMode,
      setExecutionMode,
      refreshProfile,
      profileError,
    }),
    [bearer, setBearer, isPro, setIsPro, executionMode, setExecutionMode, refreshProfile, profileError],
  );

  return <VigilUserContext.Provider value={value}>{children}</VigilUserContext.Provider>;
}

export function useVigilUser() {
  const ctx = useContext(VigilUserContext);
  if (!ctx) throw new Error("useVigilUser outside VigilUserProvider");
  return ctx;
}
