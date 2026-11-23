import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { realBackendConfigured } from "@/lib/env.ts";
import type { Backend, SessionUser } from "./backend.ts";
import { DemoBackend } from "./demoBackend.ts";
import { clearLocalData, syncEvents } from "./offlineQueue.ts";
import { SupabaseBackend } from "./supabaseBackend.ts";
import { BackendError, type AppContextData, type BackendConfig } from "./types.ts";

type Status = "loading" | "signed_out" | "needs_onboarding" | "ready" | "error";

type SessionValue = {
  status: Status;
  backend: Backend | null;
  mode: "real" | "demo" | null;
  user: SessionUser | null;
  ctx: AppContextData | null;
  config: BackendConfig | null;
  configError: string | null;
  error: string | null;
  realAvailable: boolean;
  isManager: boolean;
  refresh: () => Promise<void>;
  startDemo: (role?: "owner" | "driver") => Promise<void>;
  chooseReal: () => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

const MODE_KEY = "rp-mode";
let real: SupabaseBackend | null = null;
const demo = new DemoBackend();

/** Instância única do backend real (evita dois clientes de autenticação). */
export function getRealBackend(): SupabaseBackend | null {
  return realBackendConfigured ? (real ??= new SupabaseBackend()) : null;
}

function pickBackend(): Backend | null {
  const saved = localStorage.getItem(MODE_KEY);
  if (saved === "demo" && DemoBackend.hasSession()) return demo;
  if (realBackendConfigured) return (real ??= new SupabaseBackend());
  return null;
}

const FALLBACK_CONFIG: BackendConfig = {
  ocr: false, geocoding: false, routing: "simulated", limits: { maxOrdersPerRoute: 15, maxImagesPerBatch: 8, retentionDays: 7 },
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(() => pickBackend());
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ctx, setCtx] = useState<AppContextData | null>(null);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async (b: Backend | null) => {
    const seq = ++loadSeq.current;
    if (!b) { setStatus("signed_out"); setUser(null); setCtx(null); return; }
    try {
      const u = await b.getUser();
      if (seq !== loadSeq.current) return;
      setUser(u);
      if (!u) { setStatus("signed_out"); setCtx(null); return; }
      const c = await b.loadContext();
      if (seq !== loadSeq.current) return;
      setCtx(c);
      setError(null);
      setStatus(c.org ? "ready" : "needs_onboarding");
      b.config()
        .then((cfg) => { setConfig(cfg); setConfigError(null); })
        .catch((e) => { setConfig(FALLBACK_CONFIG); setConfigError(e instanceof BackendError ? e.message : "Servidor de processamento indisponível."); });
      if (u) void syncEvents(b, u.id);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      if (e instanceof BackendError && e.status === 401) { setStatus("signed_out"); return; }
      setError(e instanceof Error ? e.message : "Erro ao carregar a conta.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load(backend);
    if (!backend) return;
    const off = backend.onAuthChange((_u, event) => {
      if (event === "TOKEN_REFRESHED") return;
      void load(backend);
    });
    return off;
  }, [backend, load]);

  // Sincroniza registros pendentes ao reconectar
  useEffect(() => {
    if (!backend || !user) return;
    const onOnline = () => void syncEvents(backend, user.id);
    window.addEventListener("online", onOnline);
    const t = window.setInterval(onOnline, 30_000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(t); };
  }, [backend, user]);

  const startDemo = useCallback(async (role: "owner" | "driver" = "owner") => {
    if (real) await real.signOut().catch(() => undefined);
    await demo.start(role);
    localStorage.setItem(MODE_KEY, "demo");
    setStatus("loading");
    setBackend(demo);
    await load(demo);
  }, [load]);

  const chooseReal = useCallback(() => {
    localStorage.setItem(MODE_KEY, "real");
    const b = realBackendConfigured ? (real ??= new SupabaseBackend()) : null;
    setBackend(b);
  }, []);

  const signOut = useCallback(async () => {
    if (backend) await backend.signOut();
    await clearLocalData();
    localStorage.removeItem(MODE_KEY);
    setCtx(null);
    setUser(null);
    const next = realBackendConfigured ? (real ??= new SupabaseBackend()) : null;
    setBackend(next);
    setStatus("signed_out");
  }, [backend]);

  const value = useMemo<SessionValue>(() => ({
    status, backend, mode: backend?.mode ?? null, user, ctx, config, configError, error,
    realAvailable: realBackendConfigured,
    isManager: ctx?.role === "owner" || ctx?.role === "manager",
    refresh: () => load(backend), startDemo, chooseReal, signOut,
  }), [status, backend, user, ctx, config, configError, error, load, startDemo, chooseReal, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession fora do provider");
  return v;
}

/** Atalho para telas autenticadas: garante backend e contexto carregados. */
export function useApp() {
  const s = useSession();
  if (!s.backend || !s.ctx || !s.user) throw new Error("useApp sem sessão");
  return { ...s, backend: s.backend, ctx: s.ctx, user: s.user };
}
