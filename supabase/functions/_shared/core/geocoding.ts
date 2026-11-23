import { foldText, streetKey } from "./address.ts";
import { haversineM } from "./geo.ts";
import { blockingReasons } from "./extraction.ts";
import type {
  AddressFields,
  GeocodeCandidate,
  GeocodeOutcome,
  LatLng,
  OrderStatus,
  ReviewReason,
} from "./types.ts";

export type GeocodeQuery = AddressFields & {
  /** Texto completo (rua, número, bairro, cidade/UF, CEP) */
  text: string;
  /** Centro da área de atendimento, para viés e validação */
  near: LatLng | null;
  countryCode: "BR";
};

/** Contrato de troca de fornecedor de geocodificação. */
export interface GeocodingProvider {
  readonly name: string;
  readonly simulated: boolean;
  geocode(query: GeocodeQuery): Promise<GeocodeCandidate[]>;
}

export type ClassifyContext = {
  address: Pick<AddressFields, "street" | "number">;
  base: LatLng | null;
  /** raio esperado de atendimento */
  serviceRadiusM?: number;
};

const DISTINCT_CANDIDATE_M = 150;

/** As palavras significativas do nome da rua lido aparecem no endereço devolvido? */
export function streetNameMatches(street: string | null, formatted: string): boolean {
  const words = streetKey(street).split(" ").slice(1).filter((w) => w.length > 2 && !["das", "dos", "del"].includes(w));
  if (!words.length) return false;
  const got = ` ${foldText(formatted)} `;
  return words.every((w) => got.includes(` ${w} `));
}

function precisionAcceptable(c: GeocodeCandidate): boolean {
  return c.precision === "rooftop" || c.precision === "interpolated";
}

/**
 * Classifica o resultado da geocodificação. Nunca aceita centro de rua/bairro/cidade
 * como se fosse a porta do cliente, sinaliza múltiplos candidatos e locais fora da área.
 */
export function classifyGeocode(candidates: GeocodeCandidate[], ctx: ClassifyContext): GeocodeOutcome {
  const radius = ctx.serviceRadiusM ?? 30000;
  if (candidates.length === 0) {
    return { status: "not_found", chosen: null, candidates: [], reasons: ["not_found"] };
  }
  const reasons = new Set<ReviewReason>();
  const inArea = ctx.base ? candidates.filter((c) => haversineM(c, ctx.base!) <= radius) : candidates;
  const pool = inArea.length ? inArea : candidates;
  if (ctx.base && inArea.length === 0) reasons.add("outside_service_area");

  // Candidatos fisicamente diferentes
  const distinct: GeocodeCandidate[] = [];
  for (const c of pool) {
    if (!distinct.some((d) => haversineM(d, c) < DISTINCT_CANDIDATE_M)) distinct.push(c);
  }
  if (distinct.length > 1) reasons.add("multiple_candidates");

  const chosen = distinct[0];
  if (!precisionAcceptable(chosen)) reasons.add("approximate_location");
  if (chosen.partialMatch && !streetNameMatches(ctx.address.street, chosen.formattedAddress)) {
    reasons.add("partial_match");
  }
  if (ctx.address.number && foldText(chosen.streetNumber) !== foldText(ctx.address.number)) {
    reasons.add("number_not_confirmed");
  }

  const status: OrderStatus = reasons.size ? "needs_review" : "ready";
  return { status, chosen, candidates: distinct.slice(0, 5), reasons: [...reasons] };
}

/**
 * Estado final do pedido combinando dúvidas de leitura e de localização.
 * "city_inferred" é informativo e não bloqueia.
 */
export function computeOrderStatus(input: {
  excluded: boolean;
  hasLocation: boolean;
  geocodeAttempted: boolean;
  reasons: readonly ReviewReason[];
}): OrderStatus {
  if (input.excluded) return "excluded";
  if (!input.hasLocation) return input.geocodeAttempted ? "not_found" : "needs_review";
  return blockingReasons(input.reasons).length ? "needs_review" : "ready";
}

/** Motivos de leitura que continuam valendo depois de uma geocodificação. */
export const READING_REASONS: ReadonlySet<ReviewReason> = new Set<ReviewReason>([
  "missing_street", "missing_number", "missing_city", "city_inferred", "illegible",
  "ambiguous_reading", "possible_restaurant_address", "possible_duplicate", "cep_invalid",
]);

export function mergeReasons(reading: readonly ReviewReason[], geocode: readonly ReviewReason[]): ReviewReason[] {
  return [...new Set([...reading.filter((r) => READING_REASONS.has(r)), ...geocode])];
}
