import type { LatLng } from "@core/types.ts";

export type GeoError = "unsupported" | "denied" | "unavailable" | "timeout" | "insecure";

export class GeolocationError extends Error {
  constructor(public code: GeoError, message: string) {
    super(message);
  }
}

/** Pede a localização só quando necessário (depois de explicar o motivo na interface). */
export function getCurrentPosition(timeoutMs = 12000): Promise<LatLng & { accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new GeolocationError("insecure", "A localização exige conexão segura (HTTPS)."));
    if (!("geolocation" in navigator)) return reject(new GeolocationError("unsupported", "Este aparelho não informa a localização."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new GeolocationError("denied", "Permissão de localização negada. Você pode sair da base ou informar a origem."));
        else if (err.code === err.TIMEOUT) reject(new GeolocationError("timeout", "A localização demorou demais. Tente novamente ao ar livre."));
        else reject(new GeolocationError("unavailable", "Localização indisponível agora."));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
