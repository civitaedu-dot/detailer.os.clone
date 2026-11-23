import { haversineM } from "./geo.ts";
import type { RouteGeometry, RoutingProvider } from "./planning.ts";
import type { LatLng, TravelMatrix, TravelMode } from "./types.ts";

/**
 * SIMULAÇÃO identificada: tempos e distâncias aproximados a partir da linha reta,
 * com fator de desvio urbano e velocidade média de moto. Não considera ruas,
 * sentidos de circulação nem trânsito — a interface deve dizer isso ao usuário.
 */
export const SIMULATION_NOTICE =
  "Simulação: distância e tempo aproximados em linha reta (sem ruas, sentidos ou trânsito).";

export class SimulatedRoutingProvider implements RoutingProvider {
  readonly name = "simulacao-linha-reta";
  readonly simulated = true;
  readonly maxMatrixPoints = 40;
  constructor(private speedKmh = 22, private detour = 1.35) {}

  private cell(a: LatLng, b: LatLng) {
    const distanceM = Math.round(haversineM(a, b) * this.detour);
    return { distanceM, durationS: Math.round((distanceM / 1000 / this.speedKmh) * 3600) };
  }

  async computeMatrix(points: LatLng[]): Promise<TravelMatrix> {
    return {
      cells: points.map((a) => points.map((b) => this.cell(a, b))),
      travelMode: "SIMULATED",
      provider: this.name,
      simulated: true,
      warnings: [SIMULATION_NOTICE],
    };
  }

  async computeRoute(orderedPoints: LatLng[], _mode: TravelMode): Promise<RouteGeometry> {
    const legs = orderedPoints.slice(1).map((p, i) => this.cell(orderedPoints[i], p));
    return {
      encodedPolylines: [],
      distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
      durationS: legs.reduce((s, l) => s + l.durationS, 0),
      legs,
      travelMode: "SIMULATED",
      warnings: [SIMULATION_NOTICE],
    };
  }
}
