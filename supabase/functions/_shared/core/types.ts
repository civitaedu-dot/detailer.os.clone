// Tipos de domínio compartilhados entre o app (navegador) e as funções de servidor (Deno).
// Este diretório não pode depender de APIs específicas de Node, Deno ou DOM.

export type LatLng = { lat: number; lng: number };

export type OrderStatus = "ready" | "needs_review" | "not_found" | "excluded";

/** Precisão da localização, independente da qualidade da leitura da notinha. */
export type GeocodePrecision =
  | "rooftop" // porta / lote
  | "interpolated" // número estimado ao longo da rua
  | "street" // centro da rua
  | "neighborhood" // centro do bairro
  | "city" // centro da cidade
  | "unknown";

export type GeocodeProvenance = "provider" | "candidate_choice" | "manual_pin" | "demo_fixture";

export type ReviewReason =
  | "missing_street"
  | "missing_number"
  | "missing_city"
  | "city_inferred"
  | "illegible"
  | "ambiguous_reading"
  | "possible_restaurant_address"
  | "possible_duplicate"
  | "cep_invalid"
  | "not_found"
  | "multiple_candidates"
  | "approximate_location"
  | "number_not_confirmed"
  | "outside_service_area"
  | "manual_pin_pending"
  | "partial_match";

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  missing_street: "Rua não identificada",
  missing_number: "Número não identificado",
  missing_city: "Cidade não identificada",
  city_inferred: "Cidade assumida pela base",
  illegible: "Trecho ilegível na foto",
  ambiguous_reading: "Leitura duvidosa",
  possible_restaurant_address: "Parece ser o endereço do restaurante",
  possible_duplicate: "Possível pedido repetido",
  cep_invalid: "CEP com formato inválido",
  not_found: "Endereço não localizado",
  multiple_candidates: "Mais de um local possível",
  approximate_location: "Localização aproximada (não é a porta)",
  number_not_confirmed: "Número não confirmado no mapa",
  outside_service_area: "Fora da área esperada",
  manual_pin_pending: "Ajuste o pino no mapa",
  partial_match: "Correspondência parcial no mapa",
};

/** Reasons that only inform: they never block a ready order. */
export const INFORMATIONAL_REASONS: ReadonlySet<ReviewReason> = new Set(["city_inferred"]);

export type AddressFields = {
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  uf: string | null;
  cep: string | null;
  complement: string | null;
  reference: string | null;
};

export type ImageRegion = { x: number; y: number; width: number; height: number }; // frações 0..1

/** Pedido normalizado pronto para persistir (ainda sem localização). */
export type OrderDraft = AddressFields & {
  sourceIndex: number;
  orderCode: string | null;
  recipientName: string | null;
  phone: string | null;
  instructions: string | null;
  rawAddressText: string;
  region: ImageRegion | null;
  cityInferred: boolean;
  readingConfidence: "high" | "medium" | "low";
  reviewReasons: ReviewReason[];
};

export type GeocodeCandidate = LatLng & {
  formattedAddress: string;
  precision: GeocodePrecision;
  partialMatch: boolean;
  /** número da rua devolvido pelo provedor, se houver */
  streetNumber: string | null;
  placeId?: string | null;
};

export type GeocodeOutcome = {
  status: OrderStatus;
  chosen: GeocodeCandidate | null;
  candidates: GeocodeCandidate[];
  reasons: ReviewReason[];
};

export type TravelMode = "TWO_WHEELER" | "DRIVE" | "SIMULATED";

export type MatrixCell = { durationS: number; distanceM: number } | null; // null = sem rota

export type TravelMatrix = {
  /** índice 0 = origem; 1..n = paradas físicas na ordem recebida */
  cells: MatrixCell[][];
  travelMode: TravelMode;
  provider: string;
  simulated: boolean;
  warnings: string[];
};

export type RouteMode = "open" | "closed";

export type StopEventKind = "delivered" | "failed" | "deferred" | "undo";

export type StopEvent = {
  id: string; // gerado no cliente; garante idempotência
  orderId: string;
  kind: StopEventKind;
  reason?: string | null;
  occurredAt: string; // ISO
  /** para "undo": evento desfeito */
  undoesEventId?: string | null;
};

export type FailureReason =
  | "cliente_ausente"
  | "endereco_incorreto"
  | "recusado"
  | "acesso_bloqueado"
  | "outro";

export const FAILURE_REASON_LABEL: Record<FailureReason, string> = {
  cliente_ausente: "Cliente ausente",
  endereco_incorreto: "Endereço incorreto",
  recusado: "Pedido recusado",
  acesso_bloqueado: "Sem acesso ao local",
  outro: "Outro motivo",
};
