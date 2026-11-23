import { describe, expect, it } from "vitest";
import { groupPhysicalStops, planRoute, PlanningError, type PlanOrder, type RouteGeometry, type RoutingProvider } from "@core/planning.ts";
import { SimulatedRoutingProvider } from "@core/simulatedRouting.ts";
import type { LatLng, TravelMatrix } from "@core/types.ts";

const base = { lat: -23.5880, lng: -46.6340 };
const pts: LatLng[] = [
  { lat: -23.5900, lng: -46.6360 },
  { lat: -23.5950, lng: -46.6400 },
  { lat: -23.5850, lng: -46.6300 },
  { lat: -23.6000, lng: -46.6380 },
];
function orders(): PlanOrder[] {
  return [
    { id: "a", location: pts[0], readIndex: 0 },
    { id: "b", location: pts[1], readIndex: 1 },
    { id: "c", location: pts[1], readIndex: 2 }, // mesmo endereço de b
    { id: "d", location: pts[2], readIndex: 3 },
    { id: "e", location: pts[3], readIndex: 4 },
  ];
}

/** Fornecedor controlado com matriz assimétrica e sem simulação (para testar comparação). */
class FakeRouting implements RoutingProvider {
  name = "fake"; simulated = false; maxMatrixPoints = 25; calls = 0;
  async computeMatrix(points: LatLng[]): Promise<TravelMatrix> {
    this.calls++;
    const cells = points.map((a, i) => points.map((b, j) => {
      if (i === j) return { durationS: 0, distanceM: 0 };
      const base = Math.round(Math.hypot(a.lat - b.lat, a.lng - b.lng) * 1e5);
      return { durationS: base + (i < j ? 0 : 120), distanceM: base * 3 };
    }));
    return { cells, travelMode: "TWO_WHEELER", provider: "fake", simulated: false, warnings: [] };
  }
  async computeRoute(): Promise<RouteGeometry> { throw new Error("not used"); }
}

describe("planejamento", () => {
  it("dois pedidos no mesmo endereço continuam sendo dois pedidos em uma parada física", () => {
    const stops = groupPhysicalStops(orders());
    expect(stops).toHaveLength(4);
    expect(stops.find((s) => s.orderIds.includes("b"))!.orderIds).toEqual(["b", "c"]);
  });

  it("rota aberta preserva todas as entregas válidas", async () => {
    const r = await planRoute({ orders: orders(), origin: base, mode: "open", returnTo: null, serviceSecondsPerOrder: 180, maxOrders: 15 }, new FakeRouting());
    expect([...r.orderSequence].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.points).toHaveLength(5); // origem + 4 paradas
    expect(r.legs).toHaveLength(4);
    expect(r.serviceS).toBe(5 * 180);
    expect(r.comparison).not.toBeNull();
    expect(r.comparison!.plannedTravelS).toBeLessThanOrEqual(r.comparison!.originalTravelS);
  });

  it("rota com retorno preserva todas as entregas e termina na base", async () => {
    const r = await planRoute({ orders: orders(), origin: base, mode: "closed", returnTo: base, serviceSecondsPerOrder: 0, maxOrders: 15 }, new FakeRouting());
    expect([...r.orderSequence].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.points[r.points.length - 1]).toEqual(base);
    expect(r.legs).toHaveLength(5);
  });

  it("saída da localização atual com retorno à base usa um ponto final distinto", async () => {
    const here = { lat: -23.57, lng: -46.62 };
    const r = await planRoute({ orders: orders(), origin: here, mode: "closed", returnTo: base, serviceSecondsPerOrder: 0, maxOrders: 15 }, new FakeRouting());
    expect(r.points[0]).toEqual(here);
    expect(r.points[r.points.length - 1]).toEqual(base);
  });

  it("nunca corta pedidos silenciosamente para caber no limite", async () => {
    await expect(planRoute({ orders: orders(), origin: base, mode: "open", returnTo: null, serviceSecondsPerOrder: 0, maxOrders: 3 }, new FakeRouting()))
      .rejects.toBeInstanceOf(PlanningError);
  });

  it("ordem manual é respeitada e não exibe comparação de economia", async () => {
    const r = await planRoute({ orders: orders(), origin: base, mode: "open", returnTo: null, serviceSecondsPerOrder: 0, maxOrders: 15, manualOrderIds: ["e", "d", "c", "b", "a"] }, new FakeRouting());
    expect(r.orderSequence).toEqual(["e", "d", "c", "b", "a"]);
    expect(r.method).toBe("manual");
    expect(r.comparison).toBeNull();
  });

  it("simulação é identificada e não mostra economia", async () => {
    const r = await planRoute({ orders: orders(), origin: base, mode: "open", returnTo: null, serviceSecondsPerOrder: 0, maxOrders: 15 }, new SimulatedRoutingProvider());
    expect(r.simulated).toBe(true);
    expect(r.comparison).toBeNull();
    expect(r.warnings.join(" ")).toMatch(/Simulação/);
  });
});
