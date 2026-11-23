import type { RouteGeometry, RoutingProvider } from "../core/planning.ts";
import type { LatLng, MatrixCell, TravelMatrix, TravelMode } from "../core/types.ts";
import { ProviderError } from "./googleGeocoding.ts";

const MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
/** computeRouteMatrix: origens × destinos ≤ 625 elementos (TRAFFIC_AWARE) → 25 × 25. */
const MAX_POINTS = 25;
/** computeRoutes: até 25 intermediários por chamada. */
const MAX_INTERMEDIATES = 25;

import { DRIVE_FALLBACK_NOTICE, TWO_WHEELER_NOTICE } from "../core/notices.ts";
export { DRIVE_FALLBACK_NOTICE, TWO_WHEELER_NOTICE };

const wp = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
const seconds = (d: string | undefined) => (d ? Number.parseFloat(d.replace(/s$/, "")) : 0);

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code?: number; message?: string };
  condition?: "ROUTE_EXISTS" | "ROUTE_NOT_FOUND" | "ROUTE_MATRIX_ELEMENT_CONDITION_UNSPECIFIED";
  distanceMeters?: number;
  duration?: string;
};

/**
 * Routes API (Google): matriz de tempos pelas vias com trânsito (TRAFFIC_AWARE) e perfil de moto
 * (TWO_WHEELER). Se o perfil de moto não for aceito, recalcula com DRIVE e avisa — nunca bicicleta.
 */
export class GoogleRoutesProvider implements RoutingProvider {
  readonly name = "google-routes";
  readonly simulated = false;
  readonly maxMatrixPoints = MAX_POINTS;
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {
    if (!apiKey) throw new ProviderError("not_configured", "Cálculo de rotas não configurado.");
  }

  private async post(url: string, fieldMask: string, body: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.apiKey, "X-Goog-FieldMask": fieldMask },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ProviderError("unavailable", "Sem conexão com o serviço de rotas.", true);
    }
  }

  private async raise(res: Response): Promise<never> {
    if (res.status === 429) throw new ProviderError("quota", "Limite do serviço de rotas atingido.", true);
    if (res.status === 401 || res.status === 403) throw new ProviderError("denied", "Serviço de rotas recusou a chave configurada.");
    if (res.status === 400) throw new ProviderError("invalid", "Pedido de rota inválido para o fornecedor.");
    throw new ProviderError("unavailable", `Serviço de rotas respondeu ${res.status}.`, res.status >= 500);
  }

  private async matrixFor(points: LatLng[], mode: "TWO_WHEELER" | "DRIVE"): Promise<MatrixElement[]> {
    const res = await this.post(MATRIX_URL, "originIndex,destinationIndex,status,condition,distanceMeters,duration", {
      origins: points.map((p) => ({ waypoint: wp(p) })),
      destinations: points.map((p) => ({ waypoint: wp(p) })),
      travelMode: mode,
      routingPreference: "TRAFFIC_AWARE",
      languageCode: "pt-BR",
      regionCode: "BR",
      units: "METRIC",
    });
    if (!res.ok) await this.raise(res);
    const body = await res.json();
    if (!Array.isArray(body)) throw new ProviderError("unavailable", "Resposta de matriz inesperada.", true);
    return body as MatrixElement[];
  }

  async computeMatrix(points: LatLng[]): Promise<TravelMatrix> {
    if (points.length > MAX_POINTS) throw new ProviderError("invalid", `Máximo de ${MAX_POINTS} pontos por matriz.`);
    let mode: "TWO_WHEELER" | "DRIVE" = "TWO_WHEELER";
    const warnings = [TWO_WHEELER_NOTICE];
    let elements: MatrixElement[];
    try {
      elements = await this.matrixFor(points, mode);
    } catch (e) {
      if (!(e instanceof ProviderError) || e.code !== "invalid") throw e;
      mode = "DRIVE";
      warnings.splice(0, 1, DRIVE_FALLBACK_NOTICE);
      elements = await this.matrixFor(points, mode);
    }
    const n = points.length;
    const cells: MatrixCell[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? { durationS: 0, distanceM: 0 } : null)),
    );
    let missing = 0;
    for (const el of elements) {
      const i = el.originIndex ?? 0;
      const j = el.destinationIndex ?? 0;
      if (i === j || i >= n || j >= n) continue;
      const ok = (!el.status || !el.status.code) && el.condition === "ROUTE_EXISTS";
      if (ok) cells[i][j] = { durationS: Math.round(seconds(el.duration)), distanceM: el.distanceMeters ?? 0 };
      else missing++;
    }
    if (missing) warnings.push(`${missing} trecho(s) sem rota conhecida entre pontos.`);
    return { cells, travelMode: mode, provider: this.name, simulated: false, warnings };
  }

  async computeRoute(orderedPoints: LatLng[], travelMode: TravelMode): Promise<RouteGeometry> {
    const mode = travelMode === "DRIVE" ? "DRIVE" : "TWO_WHEELER";
    const result: RouteGeometry = { encodedPolylines: [], distanceM: 0, durationS: 0, legs: [], travelMode: mode, warnings: [] };
    // Divide em trechos com até 25 intermediários, encadeados pelo último ponto.
    const chunkSize = MAX_INTERMEDIATES + 1;
    for (let start = 0; start < orderedPoints.length - 1; start += chunkSize) {
      const chunk = orderedPoints.slice(start, Math.min(orderedPoints.length, start + chunkSize + 1));
      const res = await this.post(
        ROUTES_URL,
        "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters,routes.warnings",
        {
          origin: wp(chunk[0]),
          destination: wp(chunk[chunk.length - 1]),
          intermediates: chunk.slice(1, -1).map(wp),
          travelMode: mode,
          routingPreference: "TRAFFIC_AWARE",
          polylineQuality: "OVERVIEW",
          languageCode: "pt-BR",
          regionCode: "BR",
          units: "METRIC",
        },
      );
      if (!res.ok) await this.raise(res);
      const body = (await res.json()) as {
        routes?: Array<{ duration?: string; distanceMeters?: number; polyline?: { encodedPolyline?: string }; legs?: Array<{ duration?: string; distanceMeters?: number }>; warnings?: string[] }>;
      };
      const route = body.routes?.[0];
      if (!route) {
        for (let i = 0; i < chunk.length - 1; i++) result.legs.push(null);
        result.warnings.push("O fornecedor não encontrou rota para um dos trechos.");
        continue;
      }
      if (route.polyline?.encodedPolyline) result.encodedPolylines.push(route.polyline.encodedPolyline);
      result.distanceM += route.distanceMeters ?? 0;
      result.durationS += Math.round(seconds(route.duration));
      for (const leg of route.legs ?? []) result.legs.push({ durationS: Math.round(seconds(leg.duration)), distanceM: leg.distanceMeters ?? 0 });
      for (const w of route.warnings ?? []) result.warnings.push(w);
    }
    return result;
  }
}
