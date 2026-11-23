/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    process.env.VITE_EMBED === "1" ? null : VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icons/*.png", "demo/*.jpg"],
      manifest: {
        name: "RotaPronta",
        short_name: "RotaPronta",
        description: "Fotografe as notinhas e saia com a rota pronta.",
        lang: "pt-BR",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#F6F7F5",
        theme_color: "#1F2421",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/functions\//, /^\/rest\//, /^\/auth\//, /^\/storage\//],
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,woff2}"],
        // Nunca armazenar respostas de API (dados de clientes) no cache do service worker.
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": r("./src"),
      "@core": r("./supabase/functions/_shared/core"),
    },
  },
  server: { host: true, port: 5173 },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
