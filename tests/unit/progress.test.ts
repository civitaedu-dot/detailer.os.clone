import { describe, expect, it } from "vitest";
import { deriveProgress } from "@core/progress.ts";
import type { StopEvent } from "@core/types.ts";

const route = ["o1", "o2", "o3", "o4"];
const ev = (id: string, orderId: string, kind: StopEvent["kind"], t: number, extra: Partial<StopEvent> = {}): StopEvent =>
  ({ id, orderId, kind, occurredAt: new Date(Date.UTC(2026, 10, 23, 12, t)).toISOString(), ...extra });

describe("progresso das entregas", () => {
  it("conta conclusões e aponta a próxima parada", () => {
    const p = deriveProgress(route, [ev("e1", "o1", "delivered", 1), ev("e2", "o2", "failed", 2, { reason: "cliente_ausente" })]);
    expect(p.delivered).toBe(1);
    expect(p.failed).toBe(1);
    expect(p.nextOrderId).toBe("o3");
    expect(p.reasonByOrder.o2).toBe("cliente_ausente");
  });

  it("repetir a sincronização do mesmo evento não duplica a conclusão", () => {
    const e = ev("e1", "o1", "delivered", 1);
    const p = deriveProgress(route, [e, { ...e }, { ...e }]);
    expect(p.delivered).toBe(1);
  });

  it("voltar depois mantém o pedido pendente, no fim da fila", () => {
    const p = deriveProgress(route, [ev("e1", "o1", "deferred", 1)]);
    expect(p.statusByOrder.o1).toBe("deferred");
    expect(p.queue).toEqual(["o2", "o3", "o4", "o1"]);
    expect(p.remaining).toBe(4);
  });

  it("desfazer conclusão acidental devolve o pedido à fila", () => {
    const p = deriveProgress(route, [ev("e1", "o1", "delivered", 1), ev("u1", "o1", "undo", 2, { undoesEventId: "e1" })]);
    expect(p.statusByOrder.o1).toBe("pending");
    expect(p.nextOrderId).toBe("o1");
  });

  it("estado é reconstruído apenas dos registros (recarregar a página dá o mesmo resultado)", () => {
    const events = [ev("e3", "o3", "delivered", 3), ev("e1", "o1", "delivered", 1), ev("e2", "o2", "deferred", 2)];
    expect(deriveProgress(route, events)).toEqual(deriveProgress(route, [...events].reverse()));
  });

  it("termina quando não há pendentes", () => {
    const p = deriveProgress(["x"], [ev("e", "x", "delivered", 1)]);
    expect(p.finished).toBe(true);
  });
});
