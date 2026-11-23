import { clear } from "@/lib/kv.ts";
import type { Backend } from "./backend.ts";
import { BackendError, type BatchBundle, type StopEventRow } from "./types.ts";

/**
 * Fila local de registros de entrega. Cada registro tem id gerado no aparelho; reenviar
 * depois de uma falha ou reconexão nunca duplica (o servidor ignora ids já gravados).
 */
const qKey = (userId: string) => `rp:queue:${userId}`;
const bundleKey = (batchId: string) => `rp:bundle:${batchId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento cheio ou bloqueado: segue sem cache */
  }
}

export function pendingEvents(userId: string): StopEventRow[] {
  return read<StopEventRow[]>(qKey(userId), []);
}

export function enqueueEvents(userId: string, events: StopEventRow[]) {
  const cur = pendingEvents(userId);
  const ids = new Set(cur.map((e) => e.id));
  write(qKey(userId), [...cur, ...events.filter((e) => !ids.has(e.id))]);
}

let syncing: Promise<{ sent: number; failed: boolean }> | null = null;

async function doSync(backend: Backend, userId: string): Promise<{ sent: number; failed: boolean }> {
  const pending = pendingEvents(userId);
  if (!pending.length) return { sent: 0, failed: false };
  if (!navigator.onLine) return { sent: 0, failed: true };
  try {
    await backend.recordEvents(pending);
    const sentIds = new Set(pending.map((e) => e.id));
    write(qKey(userId), pendingEvents(userId).filter((e) => !sentIds.has(e.id)));
    return { sent: pending.length, failed: false };
  } catch (e) {
    // Sem permissão: descarta (não há como reenviar); demais erros ficam para a próxima tentativa.
    if (e instanceof BackendError && (e.code === "forbidden" || e.status === 403)) write(qKey(userId), []);
    return { sent: 0, failed: true };
  }
}

/** Envia a fila; chamadas simultâneas compartilham a mesma tentativa. */
export function syncEvents(backend: Backend, userId: string): Promise<{ sent: number; failed: boolean }> {
  if (syncing) return syncing;
  const p = doSync(backend, userId);
  syncing = p;
  void p.finally(() => { if (syncing === p) syncing = null; });
  return p;
}

export function cacheBundle(bundle: BatchBundle) {
  // Só o necessário para consultar a rota ativa sem conexão (sem fotos).
  write(bundleKey(bundle.batch.id), { ...bundle, cachedAt: new Date().toISOString() });
  const ids = read<string[]>("rp:bundles", []).filter((id) => id !== bundle.batch.id);
  ids.unshift(bundle.batch.id);
  for (const old of ids.slice(3)) localStorage.removeItem(bundleKey(old)); // retém só os 3 mais recentes
  write("rp:bundles", ids.slice(0, 3));
}

export function cachedBundle(batchId: string): (BatchBundle & { cachedAt: string }) | null {
  return read<(BatchBundle & { cachedAt: string }) | null>(bundleKey(batchId), null);
}

/** Remove dados locais da conta (fila, rotas em cache, capturas pendentes). */
export async function clearLocalData() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("rp:") && k !== "rp:demo:v1") keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
  try {
    await clear();
  } catch {
    /* ignore */
  }
}
