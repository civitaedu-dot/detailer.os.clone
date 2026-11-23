import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { App } from "@/App.tsx";
import { SessionProvider } from "@/data/session.tsx";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
        <Toaster position="top-center" richColors closeButton toastOptions={{ style: { fontSize: 15 } }} />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);

// PWA: service worker só em produção; aviso quando houver nova versão.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast("Nova versão disponível", { action: { label: "Atualizar", onClick: () => void update(true) }, duration: Infinity });
      },
    });
  });
}
