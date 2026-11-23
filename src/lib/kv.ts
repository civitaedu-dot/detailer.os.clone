import { clear as idbClear, del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";

/** idb-keyval com reserva em memória quando o IndexedDB está bloqueado. */
const mem = new Map<string, unknown>();
let idbOk = true;

async function attempt<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
  if (!idbOk) return fallback();
  try {
    return await fn();
  } catch {
    idbOk = false;
    return fallback();
  }
}

export const get = <T>(k: string) => attempt(() => idbGet<T>(k), () => mem.get(k) as T | undefined);
export const set = (k: string, v: unknown) => attempt(() => idbSet(k, v), () => { mem.set(k, v); });
export const del = (k: string) => attempt(() => idbDel(k), () => { mem.delete(k); });
export const clear = () => attempt(() => idbClear(), () => mem.clear());
