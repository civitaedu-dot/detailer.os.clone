import "@/lib/storageShim.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { App } from "@/App.tsx";
import { SessionProvider } from "@/data/session.tsx";
import "@/index.css";

/** Publicado como página embutida (VITE_EMBED=1): rotas em memória e sem service worker. */
const EMBED = import.meta.env.VITE_EMBED === "1";
const Router = EMBED ? MemoryRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <SessionProvider>
        <App />
        <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontSize: 15 } }} />
      </SessionProvider>
    </Router>
  </StrictMode>,
);

// PWA: service worker só em produção; aviso quando houver nova versão.
if (import.meta.env.PROD && !EMBED && "serviceWorker" in navigator) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast("Nova versão disponível", { action: { label: "Atualizar", onClick: () => void update(true) }, duration: Infinity });
      },
    });
  });
}
