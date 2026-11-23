import type { GeocodeQuery, GeocodingProvider } from "../core/geocoding.ts";
import type { GeocodeCandidate, GeocodePrecision } from "../core/types.ts";

export class ProviderError extends Error {
  constructor(public code: "not_configured" | "quota" | "denied" | "invalid" | "unavailable", message: string, public retryable = false) {
    super(message);
    this.name = "ProviderError";
  }
}

type GoogleGeocodeResult = {
  formatted_address: string;
  partial_match?: boolean;
  place_id?: string;
  types: string[];
  geometry: { location: { lat: number; lng: number }; location_type: "ROOFTOP" | "RANGE_INTERPOLATED" | "GEOMETRIC_CENTER" | "APPROXIMATE" };
  address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
};

export function precisionFromGoogle(r: GoogleGeocodeResult): GeocodePrecision {
  const t = new Set(r.types);
  switch (r.geometry.location_type) {
    case "ROOFTOP":
      return t.has("route") && !t.has("street_address") && !t.has("premise") ? "street" : "rooftop";
    case "RANGE_INTERPOLATED":
      return "interpolated";
    default:
      if (t.has("route")) return "street";
      if (t.has("neighborhood") || t.has("sublocality") || t.has("sublocality_level_1")) return "neighborhood";
      if (t.has("locality") || t.has("administrative_area_level_2")) return "city";
      if (t.has("postal_code")) return "neighborhood";
      return "unknown";
  }
}

/** Geocoding API (Google). Busca com endereço completo, país BR e viés para a área da base. */
export class GoogleGeocodingProvider implements GeocodingProvider {
  readonly name = "google-geocoding";
  readonly simulated = false;
  constructor(private apiKey: string, private fetchImpl: typeof fetch = fetch) {
    if (!apiKey) throw new ProviderError("not_configured", "Localização de endereços não configurada.");
  }

  async geocode(q: GeocodeQuery): Promise<GeocodeCandidate[]> {
    const params = new URLSearchParams({
      address: q.text,
      components: `country:${q.countryCode}`,
      region: "br",
      language: "pt-BR",
      key: this.apiKey,
    });
    if (q.near) {
      const d = 0.25; // ~25 km de viés (não restringe)
      params.set("bounds", `${q.near.lat - d},${q.near.lng - d}|${q.near.lat + d},${q.near.lng + d}`);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
    } catch {
      throw new ProviderError("unavailable", "Sem conexão com o serviço de localização.", true);
    }
    if (!res.ok) throw new ProviderError("unavailable", `Serviço de localização respondeu ${res.status}.`, res.status >= 500);
    const body = (await res.json()) as { status: string; results?: GoogleGeocodeResult[]; error_message?: string };
    switch (body.status) {
      case "OK":
        break;
      case "ZERO_RESULTS":
        return [];
      case "OVER_QUERY_LIMIT":
      case "OVER_DAILY_LIMIT":
        throw new ProviderError("quota", "Limite do serviço de localização atingido.", true);
      case "REQUEST_DENIED":
        throw new ProviderError("denied", "Serviço de localização recusou a chave configurada.");
      case "INVALID_REQUEST":
        throw new ProviderError("invalid", "Endereço inválido para busca.");
      default:
        throw new ProviderError("unavailable", "Serviço de localização indisponível.", true);
    }
    return (body.results ?? []).slice(0, 5).map((r) => ({
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
      precision: precisionFromGoogle(r),
      partialMatch: !!r.partial_match,
      streetNumber: r.address_components.find((c) => c.types.includes("street_number"))?.long_name ?? null,
      placeId: r.place_id ?? null,
    }));
  }
}
