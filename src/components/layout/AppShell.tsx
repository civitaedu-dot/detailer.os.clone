import { Camera, CloudOff, FlaskConical, History, Home, UserRound } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession } from "@/data/session.tsx";
import { pendingEvents } from "@/data/offlineQueue.ts";
import { useOnline } from "@/lib/useOnline.ts";
import { cn } from "@/lib/utils.ts";
import { Wordmark } from "./Brand.tsx";

const NAV = [
  { to: "/app", label: "Início", icon: Home, end: true },
  { to: "/app/nova", label: "Nova rota", icon: Camera, end: false },
  { to: "/app/historico", label: "Histórico", icon: History, end: false },
  { to: "/app/perfil", label: "Perfil", icon: UserRound, end: false },
];

export function StatusBars() {
  const { mode, user } = useSession();
  const online = useOnline();
  const pending = user ? pendingEvents(user.id).length : 0;
  return (
    <>
      {mode === "demo" && (
        <div className="flex items-center justify-center gap-2 bg-[#fff3dc] px-3 py-1.5 text-[13px] font-semibold text-warn" role="note">
          <FlaskConical className="size-4" aria-hidden /> Modo demonstração · dados fictícios, nada é enviado
        </div>
      )}
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-graphite px-3 py-2 text-[13px] font-semibold text-white" role="status" aria-live="polite">
          <CloudOff className="size-4" aria-hidden /> Sem conexão{pending ? ` · ${pending} registro(s) aguardando envio` : " · registros ficam salvos no aparelho"}
        </div>
      )}
    </>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const focusMode = /\/entrega$/.test(pathname);
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[232px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="px-2 pb-6"><Wordmark /></div>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold", isActive ? "bg-graphite text-white" : "text-ink-2 hover:bg-sunken hover:text-ink")}>
              <n.icon className="size-5" aria-hidden />{n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-dvh min-w-0 flex-col">
        <div className="sticky top-0 z-30"><StatusBars /></div>
        <main className={cn("flex-1", !focusMode && "pb-24 md:pb-8")}>
          <Outlet />
        </main>
        {!focusMode && (
          <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur md:hidden">
            <div className="grid grid-cols-4">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[12px] font-semibold", isActive ? "text-brand-strong" : "text-ink-3")}>
                  {({ isActive }) => (<>
                    <span className={cn("grid h-8 w-14 place-items-center rounded-full", isActive && "bg-brand-soft")}><n.icon className="size-5" aria-hidden /></span>
                    {n.label}
                  </>)}
                </NavLink>
              ))}
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
