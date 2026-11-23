import { deriveProgress } from "@core/progress.ts";
import type { StopEvent } from "@core/types.ts";
import type { StopEventRow } from "./types.ts";

export const toCoreEvent = (e: StopEventRow): StopEvent => ({
  id: e.id, orderId: e.orderId, kind: e.kind, reason: e.reason, occurredAt: e.occurredAt, undoesEventId: e.undoesEventId,
});

/** Contagem de entregues/sem sucesso a partir dos registros (mesmas regras da tela de entrega). */
export function countOutcomes(events: StopEventRow[]) {
  const orderIds = [...new Set(events.map((e) => e.orderId))];
  const p = deriveProgress(orderIds, events.map(toCoreEvent));
  return { delivered: p.delivered, failed: p.failed };
}
