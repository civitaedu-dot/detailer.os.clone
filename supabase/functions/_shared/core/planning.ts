import { locationKey } from "./geo.ts";
import { pathCost, solveSequence, UNREACHABLE, type SequenceProblem } from "./optimizer.ts";
import type { LatLng, MatrixCell, RouteMode, TravelMatrix, TravelMode } from "./types.ts";

export type RouteGeometry = {
  encodedPolylines: string[];
  distanceM: number;
  durationS: number;
  legs: Array<{ distanceM: number; durationS: number } | null>;
  travelMode: TravelMode;
  warnings: string[];
};

/** Contrato de troca de fornecedor de rotas. */
export interface RoutingProvider {
  readonly name: string;
  readonly simulated: boolean;
  /** limite de pontos (origens = destinos) por matriz quadrada */
  readonly maxMatrixPoints: number;
  computeMatrix(points: LatLng[]): Promise<TravelMatrix>;
  computeRoute(orderedPoints: LatLng[], travelMode: TravelMode): Promise<RouteGeometry>;
}

export type PlanOrder = { id: string; location: LatLng; /** ordem original de leitura */ readIndex: number };

export type PhysicalStop = { key: string; location: LatLng; orderIds: string[] };

export type PlanRequest = {
  orders: PlanOrder[];
  origin: LatLng;
  mode: RouteMode;
  /** ponto de retorno quando mode = closed */
  returnTo: LatLng | null;
  serviceSecondsPerOrder: number;
  /** sequência manual por id de pedido (opcional) */
  manualOrderIds?: string[];
  maxOrders: number;
};

export type PlannedLeg = { durationS: number; distanceM: number } | null;

export type PlanResult = {
  stops: PhysicalStop[]; // na ordem de visita
  orderSequence: string[]; // ids de pedidos na ordem de visita (pedidos do mesmo endereço ficam juntos)
  points: LatLng[]; // origem, paradas..., retorno?
  legs: PlannedLeg[];
  travelS: number;
  distanceM: number;
  serviceS: number;
  totalS: number;
  method: "exact" | "heuristic" | "trivial" | "manual";
  unreachable: boolean;
  travelMode: TravelMode;
  simulated: boolean;
  warnings: string[];
  /** comparação com a ordem original nas mesmas condições (só quando confiável) */
  comparison: { originalTravelS: number; plannedTravelS: number } | null;
};

export class PlanningError extends Error {
  constructor(public code: "too_many_orders" | "no_orders" | "matrix_too_large", message: string) {
    super(message);
  }
}

export function groupPhysicalStops(orders: PlanOrder[]): PhysicalStop[] {
  const map = new Map<string, PhysicalStop>();
  const sorted = [...orders].sort((a, b) => a.readIndex - b.readIndex);
  for (const o of sorted) {
    const key = locationKey(o.location);
    const s = map.get(key);
    if (s) s.orderIds.push(o.id);
    else map.set(key, { key, location: o.location, orderIds: [o.id] });
  }
  return [...map.values()];
}

function cellCost(cell: MatrixCell | undefined): number | null {
  return cell ? cell.durationS : null;
}

/**
 * Monta o problema, pede a matriz ao fornecedor e ordena as paradas.
 * Nenhum pedido válido é descartado: se houver trecho sem rota, o pedido permanece na sequência
 * e o plano é marcado com aviso.
 */
export async function planRoute(req: PlanRequest, routing: RoutingProvider): Promise<PlanResult> {
  if (req.orders.length === 0) throw new PlanningError("no_orders", "Nenhum pedido pronto para a rota.");
  if (req.orders.length > req.maxOrders) {
    throw new PlanningError(
      "too_many_orders",
      `O lote tem ${req.orders.length} pedidos e o limite por saída é ${req.maxOrders}. Retire pedidos desta saída ou divida o lote.`,
    );
  }
  const stops = groupPhysicalStops(req.orders);
  const sameEnd = req.mode === "closed" && req.returnTo && locationKey(req.returnTo) === locationKey(req.origin);
  const points: LatLng[] = [req.origin, ...stops.map((s) => s.location)];
  let endIndex: number | null = null;
  if (req.mode === "closed") {
    if (sameEnd || !req.returnTo) endIndex = 0;
    else {
      points.push(req.returnTo);
      endIndex = points.length - 1;
    }
  }
  if (points.length > routing.maxMatrixPoints) {
    throw new PlanningError("matrix_too_large", `O fornecedor de rotas aceita até ${routing.maxMatrixPoints} pontos por cálculo.`);
  }

  const matrix = await routing.computeMatrix(points);
  const cost = matrix.cells.map((row) => row.map(cellCost));
  const stopIdx = stops.map((_, i) => i + 1);
  const problem: SequenceProblem = { cost, start: 0, end: endIndex, stops: stopIdx };

  let order: number[];
  let method: PlanResult["method"];
  if (req.manualOrderIds?.length) {
    const pos = new Map(req.manualOrderIds.map((id, i) => [id, i]));
    order = [...stopIdx].sort((a, b) => {
      const pa = Math.min(...stops[a - 1].orderIds.map((id) => pos.get(id) ?? Infinity));
      const pb = Math.min(...stops[b - 1].orderIds.map((id) => pos.get(id) ?? Infinity));
      return pa - pb;
    });
    method = "manual";
    // dentro do mesmo endereço, respeita a ordem manual
    for (const s of stops) s.orderIds.sort((x, y) => (pos.get(x) ?? 0) - (pos.get(y) ?? 0));
  } else {
    const r = solveSequence(problem);
    order = r.order;
    method = r.method;
  }

  const seq = [0, ...order, ...(endIndex === null ? [] : [endIndex])];
  const legs: PlannedLeg[] = [];
  let travelS = 0;
  let distanceM = 0;
  let unreachable = false;
  for (let i = 0; i + 1 < seq.length; i++) {
    const cell = matrix.cells[seq[i]][seq[i + 1]];
    if (!cell) { unreachable = true; legs.push(null); continue; }
    legs.push({ durationS: cell.durationS, distanceM: cell.distanceM });
    travelS += cell.durationS;
    distanceM += cell.distanceM;
  }
  const warnings = [...matrix.warnings];
  if (unreachable) warnings.push("Há trecho sem rota conhecida pelo fornecedor. Confira os pedidos sinalizados; totais não incluem esse trecho.");

  // Comparação com a ordem original de leitura, nas mesmas condições da matriz.
  let comparison: PlanResult["comparison"] = null;
  if (!matrix.simulated && !unreachable && method !== "manual") {
    const originalOrder = [...stopIdx]; // stops já estão na ordem de leitura
    const originalCost = pathCost(problem, originalOrder);
    const plannedCost = pathCost(problem, order);
    if (originalCost < UNREACHABLE && plannedCost < UNREACHABLE) {
      comparison = { originalTravelS: originalCost, plannedTravelS: plannedCost };
    }
  }

  const orderedStops = order.map((i) => stops[i - 1]);
  const serviceS = req.orders.length * req.serviceSecondsPerOrder;
  return {
    stops: orderedStops,
    orderSequence: orderedStops.flatMap((s) => s.orderIds),
    points: seq.map((i) => points[i]),
    legs,
    travelS,
    distanceM,
    serviceS,
    totalS: travelS + serviceS,
    method,
    unreachable,
    travelMode: matrix.travelMode,
    simulated: matrix.simulated,
    warnings,
    comparison,
  };
}

/** Horário estimado de chegada a cada parada (segundos a partir da saída). */
export function etaOffsets(legs: PlannedLeg[], stops: PhysicalStop[], serviceSecondsPerOrder: number): number[] {
  const out: number[] = [];
  let t = 0;
  stops.forEach((s, i) => {
    t += legs[i]?.durationS ?? 0;
    out.push(t);
    t += s.orderIds.length * serviceSecondsPerOrder;
  });
  return out;
}
