import { del, get, set } from "idb-keyval";
import { foldText, streetKey } from "@core/address.ts";
import { sha256Hex, findPossibleDuplicates } from "@core/dedupe.ts";
import { normalizeExtraction } from "@core/extraction.ts";
import { classifyGeocode, computeOrderStatus, mergeReasons } from "@core/geocoding.ts";
import { LIMITS } from "@core/limits.ts";
import { etaOffsets, planRoute, PlanningError } from "@core/planning.ts";
import { SimulatedRoutingProvider } from "@core/simulatedRouting.ts";
import type { GeocodeCandidate, LatLng, ReviewReason } from "@core/types.ts";
import { uuid } from "@/lib/utils.ts";
import type { Backend, ExtractResult, SessionUser } from "./backend.ts";
import { DEMO_DRIVER, DEMO_EXTRACTIONS, DEMO_LOCATIONS, DEMO_PHOTOS, DEMO_RESTAURANT, DEMO_STREET_CENTERS } from "./demoFixtures.ts";
import { countOutcomes } from "./outcomes.ts";
import {
  BackendError,
  DEFAULT_PREFERENCES,
  type AppContextData,
  type Base,
  type Batch,
  type BatchBundle,
  type BatchImage,
  type BatchSummary,
  type BackendConfig,
  type ManualOrderInput,
  type Member,
  type Order,
  type OrderPatch,
  type PlanOptions,
  type Preferences,
  type Route,
  type RouteStop,
  type StopEventRow,
  type UploadInput,
} from "./types.ts";

/**
 * MODO DEMONSTRAÇÃO — tudo fica neste navegador, separado dos dados reais.
 * - Leitura: só as imagens de exemplo são "lidas" (resposta simulada vinculada a cada imagem).
 *   Fotos arbitrárias recebem a mensagem de indisponibilidade e a opção de inclusão manual.
 * - Localização: só endereços de exemplo; o restante pede ajuste do pino.
 * - Rotas: simulação em linha reta, identificada na interface.
 */

const KEY = "rp:demo:v1";
const IMG_PREFIX = "rp-demo-img:";

type DemoImage = BatchImage & { originalSha256: string };
type DemoState = {
  version: 1;
  user: SessionUser;
  profile: AppContextData["profile"];
  org: NonNullable<AppContextData["org"]>;
  role: "owner" | "driver";
  base: Base;
  members: Member[];
  batches: Batch[];
  images: DemoImage[];
  orders: Order[];
  routes: Route[];
  stops: RouteStop[];
  events: StopEventRow[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const routing = new SimulatedRoutingProvider();

let fixtureHashes: Promise<Map<string, string>> | null = null;
/** sha256 das imagens de exemplo → arquivo (para vincular cada imagem à sua resposta simulada). */
function demoHashes() {
  fixtureHashes ??= (async () => {
    const map = new Map<string, string>();
    for (const p of DEMO_PHOTOS) {
      const res = await fetch(p.file);
      if (res.ok) map.set(await sha256Hex(await res.arrayBuffer()), p.file);
    }
    return map;
  })();
  return fixtureHashes;
}

function demoCandidates(street: string | null, number: string | null): GeocodeCandidate[] {
  const sk = streetKey(street);
  const exact = DEMO_LOCATIONS[`${foldText(sk)}|${foldText(number)}`];
  if (exact) return [{ ...exact.at, formattedAddress: exact.formatted, precision: "rooftop", partialMatch: false, streetNumber: number }];
  const center = DEMO_STREET_CENTERS[foldText(sk)];
  return center ? [center] : [];
}

function emptyOrder(batchId: string): Order {
  return {
    id: uuid(), batchId, sourceImageId: null, sourceIndex: null, origin: "demo", orderCode: null, recipientName: null, phone: null,
    street: null, number: null, neighborhood: null, city: null, uf: null, cep: null, complement: null, reference: null, instructions: null,
    rawAddressText: null, region: null, cityInferred: false, readingConfidence: null, reviewReasons: [], status: "needs_review",
    excludedReason: null, duplicateOf: null, lat: null, lng: null, geocodePrecision: null, provenance: null, candidates: null,
    geocodeAttemptedAt: null, createdAt: now(),
  };
}

export class DemoBackend implements Backend {
  readonly mode = "demo" as const;
  private listeners = new Set<(u: SessionUser | null, e: string) => void>();

  static hasSession() {
    try { return !!localStorage.getItem(KEY); } catch { return false; }
  }

  private load(): DemoState | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as DemoState) : null;
    } catch {
      return null;
    }
  }
  private save(s: DemoState) {
    localStorage.setItem(KEY, JSON.stringify(s));
  }
  private state(): DemoState {
    const s = this.load();
    if (!s) throw new BackendError("unauthorized", "A demonstração foi encerrada.", 401);
    return s;
  }
  private mutate<T>(fn: (s: DemoState) => T): T {
    const s = this.state();
    const r = fn(s);
    this.save(s);
    return r;
  }

  /** Cria a demonstração com restaurante, entregador e lotes fictícios. */
  async start(role: "owner" | "driver" = "owner") {
    const userId = "00000000-0000-4000-8000-00000000d3e0";
    const orgId = "00000000-0000-4000-8000-0000000000a1";
    const base: Base = { id: "00000000-0000-4000-8000-0000000000b1", orgId, ...DEMO_RESTAURANT.base, provenance: "demo_fixture" };
    const s: DemoState = {
      version: 1,
      user: { id: userId, email: "voce@demonstracao.rotapronta" },
      profile: { userId, email: "voce@demonstracao.rotapronta", displayName: "Rafa (demonstração)", accountType: role === "owner" ? "restaurant" : "driver", activeOrgId: orgId, preferences: {} },
      org: { id: orgId, name: DEMO_RESTAURANT.name, kind: "restaurant", defaultBaseId: base.id, settings: { serviceMinutes: 3, returnToBase: false, startFrom: "base" } },
      role,
      base,
      members: [
        { userId, role, displayName: "Rafa (demonstração)" },
        { userId: DEMO_DRIVER.userId, role: "driver", displayName: DEMO_DRIVER.displayName },
      ],
      batches: [], images: [], orders: [], routes: [], stops: [], events: [],
    };
    this.save(s);
    await this.seedHistory();
    this.emit("SIGNED_IN");
  }

  /** Lotes fictícios de exemplo: um concluído ontem e um em andamento com o Carlos. */
  private async seedHistory() {
    const make = async (offsetH: number, keys: string[], driver: string, done: number, finished: boolean) => {
      const created = new Date(Date.now() - offsetH * 3600_000).toISOString();
      const s = this.state();
      const batch: Batch = {
        id: uuid(), orgId: s.org.id, createdBy: s.user.id, assignedDriverId: driver, baseId: s.base.id, title: null,
        status: finished ? "completed" : "in_progress", processingStep: null, lastError: null, startFrom: "base", returnToBase: false,
        serviceMinutes: 3, createdAt: created, startedAt: created, completedAt: finished ? new Date(Date.parse(created) + 70 * 60_000).toISOString() : null,
      };
      const orders: Order[] = keys.map((k, i) => {
        const loc = DEMO_LOCATIONS[k];
        const [street, number] = loc.formatted.split(" - ")[0].split(", ");
        return {
          ...emptyOrder(batch.id), orderCode: `#19${30 + i}`, recipientName: ["Helena P.", "Igor C.", "Júlia M.", "Kátia R."][i] ?? null,
          street, number, neighborhood: "Vila Mariana", city: "São Paulo", uf: "SP", lat: loc.at.lat, lng: loc.at.lng, status: "ready",
          geocodePrecision: "rooftop", provenance: "demo_fixture", geocodeAttemptedAt: created, createdAt: created, sourceIndex: i,
        };
      });
      this.mutate((st) => { st.batches.push(batch); st.orders.push(...orders); });
      await this.plan(batch.id, { mode: "open", serviceMinutes: 3, startFrom: "base" });
      const stops = this.state().stops.filter((x) => this.state().routes.find((r) => r.id === x.routeId)?.batchId === batch.id);
      const events: StopEventRow[] = stops.slice(0, done).map((st, i) => ({
        id: uuid(), batchId: batch.id, orderId: st.orderId, kind: i === 1 && finished ? "failed" : "delivered",
        reason: i === 1 && finished ? "cliente_ausente" : null, undoesEventId: null,
        occurredAt: new Date(Date.parse(created) + (12 + i * 14) * 60_000).toISOString(), recordedAt: null,
      }));
      this.mutate((st) => {
        st.events.push(...events);
        const b = st.batches.find((x) => x.id === batch.id)!;
        b.status = finished ? "completed" : "in_progress";
      });
    };
    await make(26, ["rua vergueiro|2045", "rua franca pinto|610", "rua cubatao|1100"], this.state().user.id, 3, true);
    await make(1, ["rua domingos de morais|1450", "rua aurea|36", "rua aurea|112", "rua joaquim tavora|820"], DEMO_DRIVER.userId, 1, false);
  }

  private emit(event: string) {
    const s = this.load();
    for (const l of this.listeners) l(s?.user ?? null, event);
  }

  // ── autenticação (a demonstração não usa contas)
  async getUser() { return this.load()?.user ?? null; }
  onAuthChange(cb: (u: SessionUser | null, e: string) => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  async signIn(): Promise<void> { throw new BackendError("demo", "Na demonstração não há login."); }
  async signUp(): Promise<{ needsConfirmation: boolean }> { throw new BackendError("demo", "Na demonstração não há cadastro."); }
  async requestPasswordReset() { throw new BackendError("demo", "Indisponível na demonstração."); }
  async updatePassword() { throw new BackendError("demo", "Indisponível na demonstração."); }
  async signOut() {
    const s = this.load();
    if (s) for (const img of s.images) await del(IMG_PREFIX + img.id).catch(() => undefined);
    localStorage.removeItem(KEY);
    this.emit("SIGNED_OUT");
  }

  async setRole(role: "owner" | "driver") {
    this.mutate((s) => {
      s.role = role;
      s.profile.accountType = role === "owner" ? "restaurant" : "driver";
      s.members[0].role = role;
    });
  }

  // ── contexto
  async loadContext(): Promise<AppContextData> {
    const s = this.state();
    return {
      profile: s.profile, org: s.org, role: s.role, base: s.base,
      preferences: { ...DEFAULT_PREFERENCES, ...s.org.settings, ...s.profile.preferences },
    };
  }
  async config(): Promise<BackendConfig> {
    return { ocr: false, geocoding: false, routing: "simulated", limits: { maxOrdersPerRoute: LIMITS.maxOrdersPerBatch, maxImagesPerBatch: LIMITS.maxImagesPerBatch, retentionDays: 7 } };
  }
  async createOrganization(): Promise<string> { return this.state().org.id; }
  async acceptInvite(): Promise<string> { throw new BackendError("demo", "Convites não funcionam na demonstração."); }
  async createInvite() { return "DEMO1234"; }
  async listMembers() { return this.state().members; }
  async saveBase(input: Omit<Base, "id" | "orgId"> & { id?: string }) {
    return this.mutate((s) => { s.base = { ...s.base, ...input, id: s.base.id, orgId: s.org.id }; return s.base; });
  }
  async savePreferences(prefs: Partial<Preferences>, scope: "org" | "user") {
    this.mutate((s) => {
      if (scope === "org") s.org.settings = { ...s.org.settings, ...prefs };
      else s.profile.preferences = { ...s.profile.preferences, ...prefs };
    });
  }
  async updateDisplayName(name: string) {
    this.mutate((s) => { s.profile.displayName = name; s.members[0].displayName = name; });
  }
  async geocodeText(): Promise<GeocodeCandidate[]> {
    throw new BackendError("geocoding_not_configured", "Na demonstração, a busca de endereços não está disponível. Ajuste o ponto no mapa ilustrativo.");
  }

  // ── lotes
  private visible(s: DemoState, b: Batch) {
    return s.role === "owner" || b.createdBy === s.user.id || b.assignedDriverId === s.user.id;
  }
  private batch(s: DemoState, id: string) {
    const b = s.batches.find((x) => x.id === id);
    if (!b || !this.visible(s, b)) throw new BackendError("not_found", "Lote não encontrado ou sem permissão de acesso.", 404);
    return b;
  }

  async listBatches(opts: { limit?: number; statuses?: Batch["status"][] } = {}): Promise<BatchSummary[]> {
    const s = this.state();
    const names = new Map(s.members.map((m) => [m.userId, m.displayName]));
    return s.batches
      .filter((b) => this.visible(s, b) && (!opts.statuses?.length || opts.statuses.includes(b.status)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, opts.limit ?? 50)
      .map((b) => ({
        ...b,
        orderCount: s.orders.filter((o) => o.batchId === b.id && o.status !== "excluded").length,
        ...countOutcomes(s.events.filter((e) => e.batchId === b.id)),
        creatorName: names.get(b.createdBy) ?? null,
        driverName: b.assignedDriverId ? names.get(b.assignedDriverId) ?? null : null,
      }));
  }

  async createBatch(input: { assignedDriverId?: string | null; startFrom: Batch["startFrom"]; returnToBase: boolean; serviceMinutes: number }) {
    return this.mutate((s) => {
      const b: Batch = {
        id: uuid(), orgId: s.org.id, createdBy: s.user.id, assignedDriverId: input.assignedDriverId ?? null, baseId: s.base.id, title: null,
        status: "draft", processingStep: null, lastError: null, startFrom: input.startFrom, returnToBase: input.returnToBase,
        serviceMinutes: input.serviceMinutes, createdAt: now(), startedAt: null, completedAt: null,
      };
      s.batches.push(b);
      return b;
    });
  }

  async getBundle(batchId: string): Promise<BatchBundle> {
    const s = this.state();
    const batch = this.batch(s, batchId);
    const route = s.routes.filter((r) => r.batchId === batchId).sort((a, b) => b.version - a.version)[0] ?? null;
    return {
      batch, base: s.base,
      images: s.images.filter((i) => i.batchId === batchId),
      orders: s.orders.filter((o) => o.batchId === batchId),
      route,
      stops: route ? s.stops.filter((x) => x.routeId === route.id).sort((a, b) => a.position - b.position) : [],
      events: s.events.filter((e) => e.batchId === batchId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    };
  }

  async uploadImage(batchId: string, input: UploadInput): Promise<BatchImage> {
    const s = this.state();
    this.batch(s, batchId);
    const existing = s.images.find((i) => i.batchId === batchId && (i.sha256 === input.sha256 || i.originalSha256 === input.originalSha256));
    if (existing) return existing;
    if (s.images.filter((i) => i.batchId === batchId).length >= LIMITS.maxImagesPerBatch) {
      throw new BackendError("image_limit", "Este lote já tem o máximo de 8 fotos.");
    }
    await sleep(250);
    const img: DemoImage = {
      id: uuid(), batchId, storagePath: `demo/${batchId}`, sha256: input.sha256, originalSha256: input.originalSha256, bytes: input.blob.size,
      width: input.width, height: input.height, mime: input.mime, status: "uploaded", errorCode: null, extraction: null, createdAt: now(),
    };
    await set(IMG_PREFIX + img.id, input.blob);
    this.mutate((st) => { st.images.push(img); });
    return img;
  }
  async removeImage(image: BatchImage) {
    await del(IMG_PREFIX + image.id).catch(() => undefined);
    this.mutate((s) => {
      s.images = s.images.filter((i) => i.id !== image.id);
      for (const o of s.orders) if (o.sourceImageId === image.id) o.sourceImageId = null;
    });
  }
  async imageUrl(image: BatchImage) {
    const blob = await get<Blob>(IMG_PREFIX + image.id);
    if (!blob) throw new BackendError("image_unavailable", "Foto indisponível.");
    return URL.createObjectURL(blob);
  }

  async extract(batchId: string): Promise<ExtractResult> {
    const hashes = await demoHashes();
    const results: ExtractResult["images"] = [];
    this.mutate((s) => { const b = this.batch(s, batchId); b.status = "processing"; b.processingStep = "extracting"; });
    for (const img of this.state().images.filter((i) => i.batchId === batchId && i.status !== "extracted")) {
      await sleep(700);
      const file = hashes.get(img.originalSha256);
      if (!file) {
        this.mutate((s) => { const i = s.images.find((x) => x.id === img.id)!; i.status = "failed"; i.errorCode = "ocr_not_configured"; });
        results.push({ id: img.id, status: "failed", error_code: "ocr_not_configured", message: "Na demonstração, só as fotos de exemplo são lidas. Inclua estes pedidos manualmente." });
        continue;
      }
      const s0 = this.state();
      const norm = normalizeExtraction(DEMO_EXTRACTIONS[file], {
        baseCity: s0.base.city, baseUf: s0.base.uf, baseStreet: "Rua Afonso Celso", baseNumber: "77",
      });
      this.mutate((s) => {
        for (const d of norm.orders) {
          if (s.orders.some((o) => o.sourceImageId === img.id && o.sourceIndex === d.sourceIndex)) continue; // idempotente
          s.orders.push({
            ...emptyOrder(batchId), sourceImageId: img.id, sourceIndex: d.sourceIndex, orderCode: d.orderCode, recipientName: d.recipientName,
            phone: d.phone, street: d.street, number: d.number, neighborhood: d.neighborhood, city: d.city, uf: d.uf, cep: d.cep,
            complement: d.complement, reference: d.reference, instructions: d.instructions, rawAddressText: d.rawAddressText, region: d.region,
            cityInferred: d.cityInferred, readingConfidence: d.readingConfidence, reviewReasons: d.reviewReasons,
          });
        }
        const i = s.images.find((x) => x.id === img.id)!;
        i.status = "extracted";
        i.errorCode = null;
        i.extraction = { quality: norm.quality, receipts_detected: norm.receiptsDetected, orders: norm.orders.length, discarded_non_delivery: norm.discardedNonDelivery, warnings: norm.warnings };
      });
      results.push({ id: img.id, status: "extracted", orders: norm.orders.length, warnings: norm.warnings, receipts_detected: norm.receiptsDetected });
    }
    // possíveis repetições entre fotos
    this.mutate((s) => {
      const rows = s.orders.filter((o) => o.batchId === batchId);
      for (const d of findPossibleDuplicates(rows.map((r) => ({ id: r.id, sourceImageId: r.sourceImageId ?? r.id, orderCode: r.orderCode, recipientName: r.recipientName, phone: r.phone, street: r.street, number: r.number })))) {
        const o = rows.find((r) => r.id === d.id)!;
        if (o.duplicateOf || o.status === "excluded") continue;
        o.duplicateOf = d.duplicateOf;
        o.reviewReasons = [...new Set([...o.reviewReasons, "possible_duplicate" as const])];
        if (o.status === "ready") o.status = "needs_review";
      }
      const b = this.batch(s, batchId);
      b.processingStep = null;
    });
    return { images: results };
  }

  async geocode(batchId: string, opts: { orderIds?: string[]; force?: boolean } = {}) {
    let processed = 0;
    const s0 = this.state();
    const base = { lat: s0.base.lat, lng: s0.base.lng };
    await sleep(500);
    this.mutate((s) => {
      for (const o of s.orders.filter((x) => x.batchId === batchId && x.status !== "excluded" && (!opts.orderIds || opts.orderIds.includes(x.id)))) {
        const manual = o.provenance === "manual_pin" || o.provenance === "candidate_choice";
        if ((manual || o.geocodeAttemptedAt) && !opts.force) continue;
        if (!o.street) { o.status = "needs_review"; continue; }
        const outcome = classifyGeocode(demoCandidates(o.street, o.number), { address: o, base, serviceRadiusM: LIMITS.serviceRadiusKm * 1000 });
        const reasons = mergeReasons(o.reviewReasons, outcome.reasons) as ReviewReason[];
        Object.assign(o, {
          lat: outcome.chosen?.lat ?? null, lng: outcome.chosen?.lng ?? null, geocodePrecision: outcome.chosen?.precision ?? null,
          provenance: outcome.chosen ? "demo_fixture" : null, candidates: outcome.candidates, geocodeAttemptedAt: now(), reviewReasons: reasons,
          status: computeOrderStatus({ excluded: false, hasLocation: !!outcome.chosen, geocodeAttempted: true, reasons }),
        });
        processed++;
      }
      const b = this.batch(s, batchId);
      if (b.status !== "in_progress") b.status = "review";
    });
    const unresolved = this.state().orders.filter((o) => o.batchId === batchId && (o.status === "needs_review" || o.status === "not_found")).length;
    return { processed, unresolved };
  }

  async addManualOrder(batchId: string, input: ManualOrderInput, clientKey: string): Promise<Order> {
    const existing = this.state().orders.find((o) => o.batchId === batchId && (o as Order & { clientKey?: string }).clientKey === clientKey);
    if (existing) return existing;
    return this.mutate((s) => {
      this.batch(s, batchId);
      const o: Order = {
        ...emptyOrder(batchId), origin: "manual", ...input, instructions: null,
        reviewReasons: [...(!input.number ? (["missing_number"] as const) : []), ...(!input.city ? (["missing_city"] as const) : [])],
      };
      // a chave do cliente evita duplicar a inclusão em reenvios
      (o as Order & { clientKey?: string }).clientKey = clientKey;
      s.orders.push(o);
      return o;
    });
  }

  async updateOrder(orderId: string, patch: OrderPatch) {
    this.mutate((s) => {
      const o = s.orders.find((x) => x.id === orderId);
      if (!o) throw new BackendError("not_found", "Pedido não encontrado.");
      this.batch(s, o.batchId);
      Object.assign(o, patch);
      if (patch.street !== undefined || patch.number !== undefined || patch.city !== undefined) o.geocodeAttemptedAt = null;
    });
  }

  async plan(batchId: string, opts: PlanOptions) {
    const s = this.state();
    const batch = this.batch(s, batchId);
    const base: LatLng = { lat: s.base.lat, lng: s.base.lng };
    let origin: LatLng = base;
    if (opts.startFrom === "current" || opts.onlyOrderIds) {
      if (opts.origin) origin = opts.origin;
      else if (opts.startFrom === "current") throw new BackendError("origin_required", "Localização atual indisponível. Escolha sair da base.");
    }
    const rows = s.orders.filter((o) => o.batchId === batchId && (!opts.onlyOrderIds || opts.onlyOrderIds.includes(o.id)));
    const unresolved = rows.filter((o) => o.status === "needs_review" || o.status === "not_found");
    if (unresolved.length && !opts.onlyOrderIds) {
      throw new BackendError("unresolved_orders", `${unresolved.length} pedido(s) ainda precisam de revisão ou de ser retirados desta saída.`, 409);
    }
    const ready = rows.filter((o) => o.status === "ready" && o.lat !== null && o.lng !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    await sleep(400);
    let result;
    try {
      result = await planRoute({
        orders: ready.map((o, i) => ({ id: o.id, location: { lat: o.lat!, lng: o.lng! }, readIndex: i })),
        origin, mode: opts.mode, returnTo: opts.mode === "closed" ? base : null, serviceSecondsPerOrder: opts.serviceMinutes * 60,
        manualOrderIds: opts.manualOrderIds, maxOrders: LIMITS.maxOrdersPerBatch,
      }, routing);
    } catch (e) {
      if (e instanceof PlanningError) throw new BackendError(e.code, e.message, 422);
      throw e;
    }
    const etas = etaOffsets(result.legs, result.stops, opts.serviceMinutes * 60);
    this.mutate((st) => {
      const prev = st.routes.filter((r) => r.batchId === batchId);
      const end = opts.mode === "closed" ? result.points[result.points.length - 1] : null;
      const route: Route = {
        id: uuid(), batchId, version: prev.length + 1, mode: opts.mode, travelMode: result.travelMode, provider: routing.name, simulated: true,
        method: result.method, originLat: origin.lat, originLng: origin.lng, endLat: end?.lat ?? null, endLng: end?.lng ?? null,
        distanceM: result.distanceM, travelS: result.travelS, serviceS: result.serviceS, totalS: result.totalS, originalTravelS: null,
        polylines: [], warnings: result.warnings, createdAt: now(),
      };
      st.routes.push(route);
      let position = 0;
      result.stops.forEach((stop, gi) => stop.orderIds.forEach((orderId, k) => {
        st.stops.push({
          id: uuid(), routeId: route.id, orderId, position: position++, stopGroup: gi,
          legDurationS: k === 0 ? result.legs[gi]?.durationS ?? null : 0, legDistanceM: k === 0 ? result.legs[gi]?.distanceM ?? null : 0,
          etaOffsetS: Math.round(etas[gi] + k * opts.serviceMinutes * 60),
        });
      }));
      const b = st.batches.find((x) => x.id === batchId)!;
      if (b.status !== "in_progress" && b.status !== "completed") b.status = "ready";
      b.returnToBase = opts.mode === "closed";
      b.serviceMinutes = opts.serviceMinutes;
      b.startFrom = opts.startFrom;
      b.processingStep = null;
    });
    void batch;
  }

  async recordEvents(events: StopEventRow[]) {
    this.mutate((s) => {
      for (const e of events) {
        if (s.events.some((x) => x.id === e.id)) continue; // idempotente
        const order = s.orders.find((o) => o.id === e.orderId && o.batchId === e.batchId);
        if (!order) throw new BackendError("forbidden", "Pedido de outro lote.");
        s.events.push({ ...e, recordedAt: now() });
        const b = s.batches.find((x) => x.id === e.batchId)!;
        if (b.status === "ready" || b.status === "review") { b.status = "in_progress"; b.startedAt ??= e.occurredAt; }
      }
    });
  }
  async assignDriver(batchId: string, driverId: string | null) {
    this.mutate((s) => {
      if (s.role !== "owner") throw new BackendError("forbidden", "Apenas o restaurante atribui lotes.");
      this.batch(s, batchId).assignedDriverId = driverId;
    });
  }
  async setBatchStatus(batchId: string, status: Batch["status"]) {
    this.mutate((s) => {
      const b = this.batch(s, batchId);
      b.status = status;
      if (status === "completed") b.completedAt = now();
    });
  }
  async deleteImages(batchId: string) {
    for (const img of this.state().images.filter((i) => i.batchId === batchId)) await this.removeImage(img);
  }
  async deleteBatch(batchId: string) {
    await this.deleteImages(batchId);
    this.mutate((s) => {
      const routeIds = new Set(s.routes.filter((r) => r.batchId === batchId).map((r) => r.id));
      s.batches = s.batches.filter((b) => b.id !== batchId);
      s.orders = s.orders.filter((o) => o.batchId !== batchId);
      s.routes = s.routes.filter((r) => r.batchId !== batchId);
      s.stops = s.stops.filter((x) => !routeIds.has(x.routeId));
      s.events = s.events.filter((e) => e.batchId !== batchId);
    });
  }
}
