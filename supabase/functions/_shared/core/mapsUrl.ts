import { isValidLatLng } from "./geo.ts";
import type { LatLng } from "./types.ts";

/**
 * Links oficiais do Google Maps (Maps URLs, api=1).
 * https://www.google.com/maps/dir/?api=1&destination=...&travelmode=...&dir_action=navigate
 *
 * - Sem `origin`, o Maps usa a localização atual do aparelho quando disponível.
 * - `dir_action=navigate` pede navegação guiada; o Maps pode exibir uma prévia
 *   (por exemplo, quando a localização atual não está disponível).
 * - Limite do link: 2.048 caracteres. Paradas intermediárias: até 3 em navegadores móveis;
 *   usamos esse limite conservador para não perder destinos.
 */
export const MAPS_DIR_BASE = "https://www.google.com/maps/dir/";
export const MAPS_URL_MAX_LENGTH = 2048;
export const MAPS_MOBILE_MAX_WAYPOINTS = 3;

export type MapsTravelMode = "two-wheeler" | "driving";

export type Destination = LatLng | string;

function encodeDestination(d: Destination): string {
  if (typeof d === "string") {
    const t = d.trim();
    if (!t) throw new Error("Destino vazio.");
    return encodeURIComponent(t);
  }
  if (!isValidLatLng(d)) throw new Error("Coordenadas inválidas para navegação.");
  return encodeURIComponent(`${d.lat.toFixed(6)},${d.lng.toFixed(6)}`);
}

export function buildNavigationUrl(opts: {
  destination: Destination;
  travelMode?: MapsTravelMode;
  origin?: Destination | null;
  navigate?: boolean;
}): string {
  const params = [
    "api=1",
    `destination=${encodeDestination(opts.destination)}`,
    `travelmode=${opts.travelMode ?? "two-wheeler"}`,
  ];
  if (opts.origin) params.push(`origin=${encodeDestination(opts.origin)}`);
  if (opts.navigate !== false) params.push("dir_action=navigate");
  return `${MAPS_DIR_BASE}?${params.join("&")}`;
}

/**
 * Link com várias paradas. Retorna null quando não cabe sem perder destinos
 * (mais paradas que o limite seguro ou link longo demais).
 */
export function buildMultiStopUrl(
  stops: Destination[],
  opts: { travelMode?: MapsTravelMode; maxWaypoints?: number } = {},
): string | null {
  const max = opts.maxWaypoints ?? MAPS_MOBILE_MAX_WAYPOINTS;
  if (stops.length < 2 || stops.length - 1 > max) return null;
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).map(encodeDestination).join("%7C");
  const url =
    `${MAPS_DIR_BASE}?api=1&destination=${encodeDestination(destination)}` +
    `&waypoints=${waypoints}&travelmode=${opts.travelMode ?? "two-wheeler"}&dir_action=navigate`;
  return url.length <= MAPS_URL_MAX_LENGTH ? url : null;
}

/** Quantas próximas paradas cabem em um único link seguro. */
export function multiStopCapacity(maxWaypoints = MAPS_MOBILE_MAX_WAYPOINTS): number {
  return maxWaypoints + 1;
}
