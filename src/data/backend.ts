import type { GeocodeCandidate, LatLng } from "@core/types.ts";
import type {
  AppContextData,
  Base,
  Batch,
  BatchBundle,
  BatchImage,
  BatchSummary,
  BackendConfig,
  ManualOrderInput,
  Member,
  Order,
  OrderPatch,
  PlanOptions,
  Preferences,
  StopEventRow,
  UploadInput,
} from "./types.ts";

export type SessionUser = { id: string; email: string | null };

export type ExtractResult = {
  images: Array<{ id: string; status: string; error_code?: string | null; message?: string | null; warnings?: string[]; quality?: string; orders?: number; receipts_detected?: number }>;
};

/**
 * Camada de dados do app. Duas implementações com o mesmo contrato:
 * - SupabaseBackend: autenticação, banco com RLS, storage privado e função de servidor.
 * - DemoBackend: dados fictícios locais, leitura simulada apenas das imagens de exemplo.
 */
export interface Backend {
  readonly mode: "real" | "demo";

  getUser(): Promise<SessionUser | null>;
  onAuthChange(cb: (user: SessionUser | null, event: string) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>;
  requestPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;

  loadContext(): Promise<AppContextData>;
  config(): Promise<BackendConfig>;
  createOrganization(name: string, kind: "restaurant" | "solo"): Promise<string>;
  acceptInvite(code: string): Promise<string>;
  createInvite(): Promise<string>;
  listMembers(): Promise<Member[]>;
  saveBase(input: Omit<Base, "id" | "orgId"> & { id?: string }): Promise<Base>;
  savePreferences(prefs: Partial<Preferences>, scope: "org" | "user"): Promise<void>;
  updateDisplayName(name: string): Promise<void>;
  geocodeText(text: string, near: LatLng | null): Promise<GeocodeCandidate[]>;

  listBatches(opts?: { limit?: number; statuses?: Batch["status"][] }): Promise<BatchSummary[]>;
  createBatch(input: { assignedDriverId?: string | null; startFrom: Batch["startFrom"]; returnToBase: boolean; serviceMinutes: number }): Promise<Batch>;
  getBundle(batchId: string): Promise<BatchBundle>;
  uploadImage(batchId: string, input: UploadInput): Promise<BatchImage>;
  removeImage(image: BatchImage): Promise<void>;
  imageUrl(image: BatchImage): Promise<string>;
  extract(batchId: string): Promise<ExtractResult>;
  geocode(batchId: string, opts?: { orderIds?: string[]; force?: boolean }): Promise<{ processed: number; unresolved: number }>;
  addManualOrder(batchId: string, input: ManualOrderInput, clientKey: string): Promise<Order>;
  updateOrder(orderId: string, patch: OrderPatch): Promise<void>;
  plan(batchId: string, opts: PlanOptions): Promise<void>;
  recordEvents(events: StopEventRow[]): Promise<void>;
  assignDriver(batchId: string, driverId: string | null): Promise<void>;
  setBatchStatus(batchId: string, status: Batch["status"]): Promise<void>;
  deleteImages(batchId: string): Promise<void>;
  deleteBatch(batchId: string): Promise<void>;
}
