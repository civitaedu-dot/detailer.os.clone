/**
 * Alguns ambientes (janela privada, iframes restritos) bloqueiam localStorage/sessionStorage.
 * Nesse caso, usamos um armazenamento em memória para o app continuar funcionando na sessão.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  try {
    const s = window[name];
    const probe = "__rp_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
  } catch {
    try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch { /* sem alternativa */ }
  }
}
