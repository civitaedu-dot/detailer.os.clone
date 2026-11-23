/** Configuração pública do app (somente chaves que podem estar no navegador). */
export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "",
  supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "",
  /** Chave pública do Maps JavaScript API — restrinja por domínio e por API no Google Cloud. */
  mapsBrowserKey: (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string | undefined)?.trim() || "",
  mapsMapId: (import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined)?.trim() || "DEMO_MAP_ID",
};

export const realBackendConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
