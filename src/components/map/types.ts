import type { LatLng } from "@core/types.ts";

export type MapStopState = "pending" | "next" | "done" | "failed" | "deferred" | "review";

export type MapStop = LatLng & { id: string; label: string; state: MapStopState; title?: string };

export type RouteMapProps = {
  origin?: LatLng | null;
  end?: LatLng | null;
  stops: MapStop[];
  /** sequência de pontos (origem, paradas, retorno) para a linha */
  path?: LatLng[];
  /** polylines codificadas do fornecedor (somente com mapa Google) */
  encodedPolylines?: string[];
  /** ponto ajustável (correção de localização) */
  pin?: LatLng | null;
  onPinChange?: (p: LatLng) => void;
  onStopClick?: (id: string) => void;
  className?: string;
  ariaLabel: string;
};

export const STOP_COLORS: Record<MapStopState, { fill: string; text: string; ring: string }> = {
  next: { fill: "#0d8a3d", text: "#ffffff", ring: "#3ddc84" },
  pending: { fill: "#1f2421", text: "#ffffff", ring: "#1f2421" },
  done: { fill: "#e2f5e9", text: "#0a6d30", ring: "#0d8a3d" },
  failed: { fill: "#fde9e7", text: "#b42318", ring: "#b42318" },
  deferred: { fill: "#fff3dc", text: "#8a4304", ring: "#e8a23a" },
  review: { fill: "#fff3dc", text: "#8a4304", ring: "#e8a23a" },
};
