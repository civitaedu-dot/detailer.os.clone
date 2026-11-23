import type { StopEvent } from "./types.ts";

export type OrderProgressStatus = "pending" | "delivered" | "failed" | "deferred";

export type Progress = {
  statusByOrder: Record<string, OrderProgressStatus>;
  reasonByOrder: Record<string, string | null>;
  completedAtByOrder: Record<string, string>;
  /** fila restante: pendentes na ordem da rota, depois os adiados na ordem em que foram adiados */
  queue: string[];
  nextOrderId: string | null;
  delivered: number;
  failed: number;
  remaining: number;
  total: number;
  /** último evento que ainda pode ser desfeito */
  lastUndoable: StopEvent | null;
  finished: boolean;
};

function sortEvents(events: StopEvent[]): StopEvent[] {
  const unique = new Map<string, StopEvent>();
  for (const e of events) if (!unique.has(e.id)) unique.set(e.id, e); // idempotência por id
  return [...unique.values()].sort((a, b) =>
    a.occurredAt === b.occurredAt ? a.id.localeCompare(b.id) : a.occurredAt.localeCompare(b.occurredAt),
  );
}

/**
 * Estado das entregas derivado apenas dos registros feitos no app.
 * Abrir o Maps não conclui nada; "Voltar depois" mantém o pedido pendente.
 */
export function deriveProgress(routeOrderIds: string[], events: StopEvent[]): Progress {
  const sorted = sortEvents(events.filter((e) => routeOrderIds.includes(e.orderId)));
  const undone = new Set(sorted.filter((e) => e.kind === "undo" && e.undoesEventId).map((e) => e.undoesEventId!));
  const effective = sorted.filter((e) => e.kind !== "undo" && !undone.has(e.id));

  const statusByOrder: Record<string, OrderProgressStatus> = {};
  const reasonByOrder: Record<string, string | null> = {};
  const completedAtByOrder: Record<string, string> = {};
  const deferredAt: Record<string, string> = {};
  for (const id of routeOrderIds) { statusByOrder[id] = "pending"; reasonByOrder[id] = null; }

  for (const e of effective) {
    const cur = statusByOrder[e.orderId];
    if (cur === "delivered" || cur === "failed") continue; // conclusão é final até ser desfeita
    if (e.kind === "deferred") { statusByOrder[e.orderId] = "deferred"; deferredAt[e.orderId] = e.occurredAt; }
    else {
      statusByOrder[e.orderId] = e.kind as "delivered" | "failed";
      reasonByOrder[e.orderId] = e.reason ?? null;
      completedAtByOrder[e.orderId] = e.occurredAt;
    }
  }

  const pending = routeOrderIds.filter((id) => statusByOrder[id] === "pending");
  const deferred = routeOrderIds
    .filter((id) => statusByOrder[id] === "deferred")
    .sort((a, b) => deferredAt[a].localeCompare(deferredAt[b]));
  const queue = [...pending, ...deferred];
  const delivered = routeOrderIds.filter((id) => statusByOrder[id] === "delivered").length;
  const failed = routeOrderIds.filter((id) => statusByOrder[id] === "failed").length;
  const lastUndoable = [...effective].reverse().find((e) => e.kind === "delivered" || e.kind === "failed" || e.kind === "deferred") ?? null;

  return {
    statusByOrder,
    reasonByOrder,
    completedAtByOrder,
    queue,
    nextOrderId: queue[0] ?? null,
    delivered,
    failed,
    remaining: queue.length,
    total: routeOrderIds.length,
    lastUndoable,
    finished: queue.length === 0 && routeOrderIds.length > 0,
  };
}
