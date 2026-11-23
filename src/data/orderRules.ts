import { blockingReasons } from "@core/extraction.ts";
import { computeOrderStatus } from "@core/geocoding.ts";
import type { GeocodeCandidate, ReviewReason } from "@core/types.ts";
import type { Order, OrderPatch } from "./types.ts";

/** Regras de transição dos pedidos na revisão, iguais nos dois modos (real e demonstração). */

const KEEP_ON_USER_DECISION: ReadonlySet<ReviewReason> = new Set(["possible_duplicate", "city_inferred"]);

export function readingReasonsFor(fields: Pick<Order, "street" | "number" | "city">, cityInferred: boolean): ReviewReason[] {
  const r: ReviewReason[] = [];
  if (!fields.street) r.push("missing_street");
  if (!fields.number) r.push("missing_number");
  if (!fields.city) r.push("missing_city");
  if (cityInferred) r.push("city_inferred");
  return r;
}

/** Edição manual do endereço: o texto digitado substitui a leitura; a localização precisa ser refeita. */
export function editAddress(order: Order, patch: OrderPatch): OrderPatch {
  const next = { ...order, ...patch };
  const cityInferred = patch.city !== undefined ? false : order.cityInferred;
  const keep = order.reviewReasons.filter((r) => r === "possible_duplicate");
  return {
    ...patch,
    cityInferred,
    reviewReasons: [...new Set([...keep, ...readingReasonsFor(next, cityInferred)])],
    status: "needs_review",
    lat: null,
    lng: null,
    geocodePrecision: null,
    provenance: null,
  };
}

/** Escolha explícita de um candidato ou de um pino resolve as dúvidas de localização. */
export function applyLocation(
  order: Order,
  loc: { lat: number; lng: number },
  how: "candidate_choice" | "manual_pin",
  candidate?: GeocodeCandidate,
): OrderPatch {
  const reasons = order.reviewReasons.filter((r) => KEEP_ON_USER_DECISION.has(r));
  return {
    lat: loc.lat,
    lng: loc.lng,
    provenance: how,
    geocodePrecision: candidate?.precision ?? "rooftop",
    reviewReasons: reasons,
    status: computeOrderStatus({ excluded: false, hasLocation: true, geocodeAttempted: true, reasons }),
  };
}

/** "Está certo assim": confirma um pedido com localização, mantendo só avisos informativos. */
export function confirmOrder(order: Order): OrderPatch {
  if (order.lat === null || order.lng === null) throw new Error("Defina a localização antes de confirmar.");
  return { status: "ready", reviewReasons: order.reviewReasons.filter((r) => r === "city_inferred") };
}

export function excludeOrder(reason: string): OrderPatch {
  return { status: "excluded", excludedReason: reason.slice(0, 200) };
}

export function includeOrder(order: Order): OrderPatch {
  const status = computeOrderStatus({
    excluded: false,
    hasLocation: order.lat !== null && order.lng !== null,
    geocodeAttempted: !!order.geocodeAttemptedAt,
    reasons: order.reviewReasons,
  });
  return { status, excludedReason: null };
}

export function isBlocking(order: Order) {
  return order.status === "needs_review" || order.status === "not_found";
}

export function orderBlockingReasons(order: Order) {
  return blockingReasons(order.reviewReasons);
}
