import { useCallback, useEffect, useState } from "react";
import { cacheBundle, cachedBundle } from "@/data/offlineQueue.ts";
import { useApp } from "@/data/session.tsx";
import type { BatchBundle } from "@/data/types.ts";

/** Carrega o lote; sem conexão, usa a última cópia guardada no aparelho (somente leitura). */
export function useBundle(batchId: string, opts: { cache?: boolean } = {}) {
  const { backend } = useApp();
  const [bundle, setBundle] = useState<BatchBundle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const b = await backend.getBundle(batchId);
      setBundle(b);
      setError(null);
      setFromCache(null);
      if (opts.cache && b.route) cacheBundle(b);
    } catch (e) {
      const cached = opts.cache ? cachedBundle(batchId) : null;
      if (cached) { setBundle(cached); setFromCache(cached.cachedAt); setError(null); }
      else setError(e instanceof Error ? e : new Error("Falha ao carregar o lote."));
    } finally {
      setLoading(false);
    }
  }, [backend, batchId, opts.cache]);

  useEffect(() => { void reload(); }, [reload]);
  return { bundle, error, loading, reload, fromCache, setBundle };
}
