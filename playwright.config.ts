import { defineConfig } from "@playwright/test";

/**
 * Testes de ponta a ponta no navegador (Chromium) usando o MODO DEMONSTRAÇÃO:
 * leitura, localização e rotas são simulações controladas — não provam integração externa.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://localhost:5174", locale: "pt-BR", timezoneId: "America/Sao_Paulo", trace: "off" },
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", VITE_GOOGLE_MAPS_BROWSER_KEY: "" },
  },
});
