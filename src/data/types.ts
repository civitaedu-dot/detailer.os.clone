import type {
  GeocodeCandidate,
  GeocodePrecision,
  GeocodeProvenance,
  ImageRegion,
  OrderStatus,
  ReviewReason,
  RouteMode,
  StopEventKind,
  TravelMode,
} from "@core/types.ts";

export type Role = "owner" | "manager" | "driver";
export type OrgKind = "restaurant" | "solo";
export type BatchStatus = "draft" | "processing" | "review" | "ready" | "in_progress" | "completed" | "canceled";
export type StartFrom = "base" | "current";

export type Preferences = {
  startFrom: StartFrom;
  returnToBase: boolean;
  serviceMinutes: number;
  mapsTravelMode: "two-wheeler" | "driving";
};

export const DEFAULT_PREFERENCES: Preferences = {
  startFrom: "base",
  returnToBase: false,
  serviceMinutes: 3,
  mapsTravelMode: "two-wheeler",
};

export type Base = {
  id: string;
  orgId: string;
  name: string;
  addressLine: string;
  city: string;
  uf: string;
  lat: number;
  lng: number;
  provenance: GeocodeProvenance;
};

export type Org = { id: string; name: string; kind: OrgKind; defaultBaseId: string | null; settings: Partial<Preferences> };

export type Profile = {
  userId: string;
  email: string | null;
  displayName: string | null;
  accountType: "restaurant" | "driver" | null;
  activeOrgId: string | null;
  preferences: Partial<Preferences>;
};

export type AppContextData = {
  profile: Profile;
  org: Org | null;
  role: Role | null;
  base: Base | null;
  preferences: Preferences;
};

export type Member = { userId: string; role: Role; displayName: string | null };

export type BatchImage = {
  id: string;
  batchId: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  width: number | null;
  height: number | null;
  mime: string;
  status: "uploaded" | "extracting" | "extracted" | "failed";
  errorCode: string | null;
  extraction: {
    quality?: string;
    quality_notes?: string | null;
    receipts_detected?: number;
    orders?: number;
    discarded_non_delivery?: number;
    warnings?: string[];
  } | null;
  createdAt: string;
};

export type Order = {
  id: string;
  batchId: string;
  sourceImageId: string | null;
  sourceIndex: number | null;
  origin: "ocr" | "manual" | "demo";
  orderCode: string | null;
  recipientName: string | null;
  phone: string | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  uf: string | null;
  cep: string | null;
  complement: string | null;
  reference: string | null;
  instructions: string | null;
  rawAddressText: string | null;
  region: ImageRegion | null;
  cityInferred: boolean;
  readingConfidence: "high" | "medium" | "low" | null;
  reviewReasons: ReviewReason[];
  status: OrderStatus;
  excludedReason: string | null;
  duplicateOf: string | null;
  lat: number | null;
  lng: number | null;
  geocodePrecision: GeocodePrecision | null;
  provenance: GeocodeProvenance | null;
  candidates: GeocodeCandidate[] | null;
  geocodeAttemptedAt: string | null;
  createdAt: string;
};

export type Route = {
  id: string;
  batchId: string;
  version: number;
  mode: RouteMode;
  travelMode: TravelMode;
  provider: string;
  simulated: boolean;
  method: "exact" | "heuristic" | "trivial" | "manual";
  originLat: number;
  originLng: number;
  endLat: number | null;
  endLng: number | null;
  distanceM: number;
  travelS: number;
  serviceS: number;
  totalS: number;
  originalTravelS: number | null;
  polylines: string[];
  warnings: string[];
  createdAt: string;
};

export type RouteStop = {
  id: string;
  routeId: string;
  orderId: string;
  position: number;
  stopGroup: number;
  legDurationS: number | null;
  legDistanceM: number | null;
  etaOffsetS: number | null;
};

export type StopEventRow = {
  id: string;
  batchId: string;
  orderId: string;
  kind: StopEventKind;
  reason: string | null;
  undoesEventId: string | null;
  occurredAt: string;
  recordedAt?: string | null;
};

export type Batch = {
  id: string;
  orgId: string;
  createdBy: string;
  assignedDriverId: string | null;
  baseId: string | null;
  title: string | null;
  status: BatchStatus;
  processingStep: "uploading" | "extracting" | "geocoding" | "planning" | null;
  lastError: string | null;
  startFrom: StartFrom;
  returnToBase: boolean;
  serviceMinutes: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type BatchSummary = Batch & {
  orderCount: number;
  delivered: number;
  failed: number;
  creatorName: string | null;
  driverName: string | null;
};

export type BatchBundle = {
  batch: Batch;
  images: BatchImage[];
  orders: Order[];
  route: Route | null;
  stops: RouteStop[];
  events: StopEventRow[];
  base: Base | null;
};

export type BackendConfig = {
  ocr: boolean;
  geocoding: boolean;
  routing: "google" | "simulated";
  limits: { maxOrdersPerRoute: number; maxImagesPerBatch: number; retentionDays: number };
};

export type ManualOrderInput = {
  orderCode: string | null;
  recipientName: string | null;
  phone: string | null;
  street: string;
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  uf: string | null;
  cep: string | null;
  complement: string | null;
  reference: string | null;
};

export type OrderPatch = Partial<
  Pick<
    Order,
    | "orderCode" | "recipientName" | "phone" | "street" | "number" | "neighborhood" | "city" | "uf" | "cep"
    | "complement" | "reference" | "instructions" | "status" | "excludedReason" | "reviewReasons" | "lat" | "lng"
    | "geocodePrecision" | "provenance" | "cityInferred"
  >
>;

export type PlanOptions = {
  mode: RouteMode;
  serviceMinutes: number;
  startFrom: StartFrom;
  origin?: { lat: number; lng: number } | null;
  manualOrderIds?: string[];
  onlyOrderIds?: string[];
};

export type UploadInput = { blob: Blob; sha256: string; width: number; height: number; mime: string; originalSha256: string };

export class BackendError extends Error {
  constructor(public code: string, message: string, public status = 0, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "BackendError";
  }
}
