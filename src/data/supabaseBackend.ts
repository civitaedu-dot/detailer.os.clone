import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GeocodeCandidate, LatLng } from "@core/types.ts";
import { env } from "@/lib/env.ts";
import { uuid } from "@/lib/utils.ts";
import type { Backend, ExtractResult, SessionUser } from "./backend.ts";
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

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const mapBase = (r: Row): Base => ({
  id: r.id, orgId: r.org_id, name: r.name, addressLine: r.address_line, city: r.city, uf: r.uf, lat: r.lat, lng: r.lng, provenance: r.location_provenance,
});
const mapBatch = (r: Row): Batch => ({
  id: r.id, orgId: r.org_id, createdBy: r.created_by, assignedDriverId: r.assigned_driver_id, baseId: r.base_id, title: r.title,
  status: r.status, processingStep: r.processing_step, lastError: r.last_error, startFrom: r.start_from, returnToBase: r.return_to_base,
  serviceMinutes: r.service_minutes, createdAt: r.created_at, startedAt: r.started_at, completedAt: r.completed_at,
});
const mapImage = (r: Row): BatchImage => ({
  id: r.id, batchId: r.batch_id, storagePath: r.storage_path, sha256: r.sha256, bytes: r.bytes, width: r.width, height: r.height,
  mime: r.mime, status: r.status, errorCode: r.error_code, extraction: r.extraction, createdAt: r.created_at,
});
export const mapOrder = (r: Row): Order => ({
  id: r.id, batchId: r.batch_id, sourceImageId: r.source_image_id, sourceIndex: r.source_index, origin: r.origin, orderCode: r.order_code,
  recipientName: r.recipient_name, phone: r.phone, street: r.street, number: r.number, neighborhood: r.neighborhood, city: r.city,
  uf: r.uf, cep: r.cep, complement: r.complement, reference: r.reference, instructions: r.instructions, rawAddressText: r.raw_address_text,
  region: r.region, cityInferred: r.city_inferred, readingConfidence: r.reading_confidence, reviewReasons: r.review_reasons ?? [],
  status: r.status, excludedReason: r.excluded_reason, duplicateOf: r.duplicate_of, lat: r.lat, lng: r.lng,
  geocodePrecision: r.geocode_precision, provenance: r.location_provenance, candidates: r.geocode_candidates,
  geocodeAttemptedAt: r.geocode_attempted_at, createdAt: r.created_at,
});
const mapRoute = (r: Row): Route => ({
  id: r.id, batchId: r.batch_id, version: r.version, mode: r.mode, travelMode: r.travel_mode, provider: r.provider, simulated: r.simulated,
  method: r.method, originLat: r.origin_lat, originLng: r.origin_lng, endLat: r.end_lat, endLng: r.end_lng, distanceM: r.distance_m,
  travelS: r.travel_s, serviceS: r.service_s, totalS: r.total_s, originalTravelS: r.original_travel_s, polylines: r.polylines ?? [],
  warnings: r.warnings ?? [], createdAt: r.created_at,
});
const mapStop = (r: Row): RouteStop => ({
  id: r.id, routeId: r.route_id, orderId: r.order_id, position: r.position, stopGroup: r.stop_group,
  legDurationS: r.leg_duration_s, legDistanceM: r.leg_distance_m, etaOffsetS: r.eta_offset_s,
});
export const mapEvent = (r: Row): StopEventRow => ({
  id: r.id, batchId: r.batch_id, orderId: r.order_id, kind: r.kind, reason: r.reason, undoesEventId: r.undoes_event_id,
  occurredAt: r.occurred_at, recordedAt: r.recorded_at,
});

const PATCH_COLUMNS: Record<keyof OrderPatch, string> = {
  orderCode: "order_code", recipientName: "recipient_name", phone: "phone", street: "street", number: "number",
  neighborhood: "neighborhood", city: "city", uf: "uf", cep: "cep", complement: "complement", reference: "reference",
  instructions: "instructions", status: "status", excludedReason: "excluded_reason", reviewReasons: "review_reasons", lat: "lat",
  lng: "lng", geocodePrecision: "geocode_precision", provenance: "location_provenance", cityInferred: "city_inferred",
};

function dbError(error: { message: string; code?: string; hint?: string } | null, fallback: string): never {
  if (!error) throw new BackendError("unknown", fallback);
  if (error.code === "42501") throw new BackendError("forbidden", "Acesso negado a este recurso.", 403);
  if (error.hint === "batch_image_limit") throw new BackendError("image_limit", "Este lote já tem o máximo de 8 fotos.");
  if (error.code === "PGRST301" || /JWT/.test(error.message)) throw new BackendError("unauthorized", "Sessão expirada. Entre novamente.", 401);
  throw new BackendError(error.code ?? "db_error", fallback);
}

function authError(message: string): BackendError {
  if (/Invalid login credentials/i.test(message)) return new BackendError("invalid_credentials", "E-mail ou senha incorretos.");
  if (/Email not confirmed/i.test(message)) return new BackendError("email_not_confirmed", "Confirme seu e-mail pelo link que enviamos antes de entrar.");
  if (/already registered/i.test(message)) return new BackendError("already_registered", "Este e-mail já tem conta. Entre ou recupere o acesso.");
  if (/Password should be/i.test(message)) return new BackendError("weak_password", "Use uma senha com pelo menos 8 caracteres.");
  if (/rate limit/i.test(message)) return new BackendError("rate_limited", "Muitas tentativas. Aguarde alguns minutos.");
  return new BackendError("auth_error", "Não foi possível concluir. Verifique a conexão e tente novamente.");
}

export class SupabaseBackend implements Backend {
  readonly mode = "real" as const;
  readonly sb: SupabaseClient;
  private ctxCache: AppContextData | null = null;

  constructor() {
    this.sb = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  private async call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new BackendError("offline", "Sem conexão. Esta ação precisa de internet.");
    const { data } = await this.sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new BackendError("unauthorized", "Sessão expirada. Entre novamente.", 401);
    const base = env.functionsUrl || `${env.supabaseUrl}/functions/v1`;
    let res: Response;
    try {
      res = await fetch(`${base}/rota-api`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: env.supabaseAnonKey },
        body: JSON.stringify({ action, ...body }),
      });
    } catch {
      throw new BackendError("network", "Não foi possível falar com o servidor. Verifique a conexão.");
    }
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new BackendError(payload.code ?? "server_error", payload.message ?? "Falha no servidor.", res.status, payload);
    return payload as T;
  }

  // ── autenticação
  async getUser(): Promise<SessionUser | null> {
    const { data } = await this.sb.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email ?? null } : null;
  }
  onAuthChange(cb: (user: SessionUser | null, event: string) => void) {
    const { data } = this.sb.auth.onAuthStateChange((event, session) => {
      this.ctxCache = null;
      cb(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null, event);
    });
    return () => data.subscription.unsubscribe();
  }
  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw authError(error.message);
  }
  async signUp(email: string, password: string, displayName: string) {
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { data: { display_name: displayName }, emailRedirectTo: `${location.origin}/app` },
    });
    if (error) throw authError(error.message);
    return { needsConfirmation: !data.session };
  }
  async requestPasswordReset(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/redefinir-senha` });
    if (error) throw authError(error.message);
  }
  async updatePassword(password: string) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw authError(error.message);
  }
  async signOut() {
    this.ctxCache = null;
    await this.sb.auth.signOut();
  }

  // ── contexto
  private async uid(): Promise<string> {
    const u = await this.getUser();
    if (!u) throw new BackendError("unauthorized", "Sessão expirada. Entre novamente.", 401);
    return u.id;
  }

  async loadContext(): Promise<AppContextData> {
    const user = await this.getUser();
    if (!user) throw new BackendError("unauthorized", "Sessão expirada. Entre novamente.", 401);
    let { data: p } = await this.sb.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    if (!p) {
      const ins = await this.sb.from("profiles").insert({ user_id: user.id }).select("*").single();
      p = ins.data;
    }
    const profile = {
      userId: user.id, email: user.email, displayName: p?.display_name ?? null, accountType: p?.account_type ?? null,
      activeOrgId: p?.active_org_id ?? null, preferences: p?.preferences ?? {},
    };
    let org = null, role = null, base = null;
    if (profile.activeOrgId) {
      const [{ data: o }, { data: m }] = await Promise.all([
        this.sb.from("organizations").select("*").eq("id", profile.activeOrgId).maybeSingle(),
        this.sb.from("memberships").select("role").eq("org_id", profile.activeOrgId).eq("user_id", user.id).maybeSingle(),
      ]);
      if (o && m) {
        org = { id: o.id, name: o.name, kind: o.kind, defaultBaseId: o.default_base_id, settings: o.settings ?? {} };
        role = m.role;
        const { data: bases } = await this.sb.from("bases").select("*").eq("org_id", o.id).order("created_at");
        const b = (bases ?? []).find((x) => x.id === o.default_base_id) ?? bases?.[0];
        base = b ? mapBase(b) : null;
      }
    }
    const preferences: Preferences = { ...DEFAULT_PREFERENCES, ...(org?.settings ?? {}), ...profile.preferences };
    this.ctxCache = { profile, org, role, base, preferences };
    return this.ctxCache;
  }

  private async ctx() {
    return this.ctxCache ?? (await this.loadContext());
  }

  config() {
    return this.call<BackendConfig>("config");
  }

  async createOrganization(name: string, kind: "restaurant" | "solo") {
    const { data, error } = await this.sb.rpc("create_organization", { p_name: name, p_kind: kind });
    if (error) dbError(error, "Não foi possível criar a conta.");
    this.ctxCache = null;
    return data as string;
  }
  async acceptInvite(code: string) {
    const { data, error } = await this.sb.rpc("accept_invite", { p_code: code });
    if (error) throw new BackendError("invite_invalid", "Código inválido ou expirado. Peça um novo ao restaurante.");
    this.ctxCache = null;
    return data as string;
  }
  async createInvite() {
    const { org } = await this.ctx();
    if (!org) throw new BackendError("no_org", "Conta sem organização.");
    const { data, error } = await this.sb.rpc("create_invite", { p_org: org.id });
    if (error) dbError(error, "Não foi possível gerar o convite.");
    return data as string;
  }
  async listMembers(): Promise<Member[]> {
    const { org } = await this.ctx();
    if (!org) return [];
    const { data, error } = await this.sb.rpc("org_members", { p_org: org.id });
    if (error) dbError(error, "Não foi possível carregar a equipe.");
    return (data ?? []).map((r: Row) => ({ userId: r.user_id, role: r.role, displayName: r.display_name }));
  }
  async saveBase(input: Omit<Base, "id" | "orgId"> & { id?: string }) {
    const { org } = await this.ctx();
    if (!org) throw new BackendError("no_org", "Conta sem organização.");
    const row = {
      org_id: org.id, name: input.name, address_line: input.addressLine, city: input.city, uf: input.uf, lat: input.lat, lng: input.lng,
      location_provenance: input.provenance, verified_at: new Date().toISOString(),
    };
    const q = input.id ? this.sb.from("bases").update(row).eq("id", input.id) : this.sb.from("bases").insert(row);
    const { data, error } = await q.select("*").single();
    if (error) dbError(error, "Não foi possível salvar a base.");
    if (!org.defaultBaseId || org.defaultBaseId !== data.id) await this.sb.from("organizations").update({ default_base_id: data.id }).eq("id", org.id);
    this.ctxCache = null;
    return mapBase(data);
  }
  async savePreferences(prefs: Partial<Preferences>, scope: "org" | "user") {
    const c = await this.ctx();
    if (scope === "org" && c.org) {
      const { error } = await this.sb.from("organizations").update({ settings: { ...c.org.settings, ...prefs } }).eq("id", c.org.id);
      if (error) dbError(error, "Não foi possível salvar as preferências.");
    } else {
      const { error } = await this.sb.from("profiles").update({ preferences: { ...c.profile.preferences, ...prefs } }).eq("user_id", c.profile.userId);
      if (error) dbError(error, "Não foi possível salvar as preferências.");
    }
    this.ctxCache = null;
  }
  async updateDisplayName(name: string) {
    const uid = await this.uid();
    const { error } = await this.sb.from("profiles").update({ display_name: name.slice(0, 80) }).eq("user_id", uid);
    if (error) dbError(error, "Não foi possível salvar o nome.");
    this.ctxCache = null;
  }
  async geocodeText(text: string, near: LatLng | null): Promise<GeocodeCandidate[]> {
    const r = await this.call<{ candidates: GeocodeCandidate[] }>("geocode_text", { text, near });
    return r.candidates;
  }

  // ── lotes
  async listBatches(opts: { limit?: number; statuses?: Batch["status"][] } = {}): Promise<BatchSummary[]> {
    const { org } = await this.ctx();
    if (!org) return [];
    let q = this.sb.from("batches").select("*, orders(id, status)").eq("org_id", org.id).order("created_at", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.statuses?.length) q = q.in("status", opts.statuses);
    const { data, error } = await q;
    if (error) dbError(error, "Não foi possível carregar os lotes.");
    const ids = (data ?? []).map((b) => b.id);
    const [{ data: events }, members] = await Promise.all([
      ids.length ? this.sb.from("stop_events").select("*").in("batch_id", ids) : Promise.resolve({ data: [] as Row[] }),
      this.listMembers().catch(() => [] as Member[]),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.displayName]));
    return (data ?? []).map((b) => {
      const evs = (events ?? []).filter((e) => e.batch_id === b.id).map(mapEvent);
      const counted = countOutcomes(evs);
      const activeOrders = (b.orders as Row[]).filter((o) => o.status !== "excluded");
      return {
        ...mapBatch(b), orderCount: activeOrders.length, delivered: counted.delivered, failed: counted.failed,
        creatorName: names.get(b.created_by) ?? null, driverName: b.assigned_driver_id ? names.get(b.assigned_driver_id) ?? null : null,
      };
    });
  }

  async createBatch(input: { assignedDriverId?: string | null; startFrom: Batch["startFrom"]; returnToBase: boolean; serviceMinutes: number }) {
    const c = await this.ctx();
    if (!c.org) throw new BackendError("no_org", "Conclua a configuração da conta.");
    const { data, error } = await this.sb.from("batches").insert({
      org_id: c.org.id, created_by: c.profile.userId, base_id: c.base?.id ?? null, assigned_driver_id: input.assignedDriverId ?? null,
      start_from: input.startFrom, return_to_base: input.returnToBase, service_minutes: input.serviceMinutes,
    }).select("*").single();
    if (error) dbError(error, "Não foi possível criar o lote.");
    return mapBatch(data);
  }

  async getBundle(batchId: string): Promise<BatchBundle> {
    const { data: b, error } = await this.sb.from("batches").select("*, bases(*)").eq("id", batchId).maybeSingle();
    if (error) dbError(error, "Não foi possível carregar o lote.");
    if (!b) throw new BackendError("not_found", "Lote não encontrado ou sem permissão de acesso.", 404);
    const [imgs, orders, route, events] = await Promise.all([
      this.sb.from("batch_images").select("*").eq("batch_id", batchId).order("created_at"),
      this.sb.from("orders").select("*").eq("batch_id", batchId).order("created_at").order("source_index"),
      this.sb.from("routes").select("*").eq("batch_id", batchId).eq("status", "active").maybeSingle(),
      this.sb.from("stop_events").select("*").eq("batch_id", batchId).order("occurred_at"),
    ]);
    let stops: RouteStop[] = [];
    if (route.data) {
      const { data } = await this.sb.from("route_stops").select("*").eq("route_id", route.data.id).order("position");
      stops = (data ?? []).map(mapStop);
    }
    return {
      batch: mapBatch(b), base: b.bases ? mapBase(b.bases) : null, images: (imgs.data ?? []).map(mapImage), orders: (orders.data ?? []).map(mapOrder),
      route: route.data ? mapRoute(route.data) : null, stops, events: (events.data ?? []).map(mapEvent),
    };
  }

  async uploadImage(batchId: string, input: UploadInput): Promise<BatchImage> {
    const existing = await this.sb.from("batch_images").select("*").eq("batch_id", batchId).eq("sha256", input.sha256).maybeSingle();
    if (existing.data) return mapImage(existing.data);
    const { data: batch } = await this.sb.from("batches").select("org_id").eq("id", batchId).single();
    if (!batch) throw new BackendError("not_found", "Lote não encontrado.");
    const id = uuid();
    const ext = input.mime === "image/png" ? "png" : input.mime === "image/webp" ? "webp" : "jpg";
    const path = `${batch.org_id}/${batchId}/${id}.${ext}`;
    const up = await this.sb.storage.from("receipts").upload(path, input.blob, { contentType: input.mime, upsert: false });
    if (up.error) throw new BackendError("upload_failed", "Falha ao enviar a foto. Verifique a conexão e tente de novo.");
    const { data, error } = await this.sb.from("batch_images").insert({
      id, batch_id: batchId, storage_path: path, sha256: input.sha256, bytes: input.blob.size, width: input.width, height: input.height, mime: input.mime,
    }).select("*").single();
    if (error) {
      await this.sb.storage.from("receipts").remove([path]);
      if (error.code === "23505") {
        const again = await this.sb.from("batch_images").select("*").eq("batch_id", batchId).eq("sha256", input.sha256).single();
        if (again.data) return mapImage(again.data);
      }
      dbError(error, "Não foi possível registrar a foto.");
    }
    return mapImage(data);
  }
  async removeImage(image: BatchImage) {
    await this.sb.storage.from("receipts").remove([image.storagePath]);
    const { error } = await this.sb.from("batch_images").delete().eq("id", image.id);
    if (error) dbError(error, "Não foi possível remover a foto.");
  }
  async imageUrl(image: BatchImage) {
    const { data, error } = await this.sb.storage.from("receipts").createSignedUrl(image.storagePath, 300);
    if (error || !data) throw new BackendError("image_unavailable", "Foto indisponível.");
    return data.signedUrl;
  }

  extract(batchId: string) {
    return this.call<ExtractResult>("extract", { batch_id: batchId });
  }
  geocode(batchId: string, opts: { orderIds?: string[]; force?: boolean } = {}) {
    return this.call<{ processed: number; unresolved: number }>("geocode", { batch_id: batchId, order_ids: opts.orderIds, force: opts.force });
  }
  async addManualOrder(batchId: string, input: ManualOrderInput, clientKey: string) {
    const row = {
      batch_id: batchId, origin: "manual", client_key: clientKey, order_code: input.orderCode, recipient_name: input.recipientName,
      phone: input.phone, street: input.street, number: input.number, neighborhood: input.neighborhood, city: input.city, uf: input.uf,
      cep: input.cep, complement: input.complement, reference: input.reference, status: "needs_review",
      review_reasons: [...(!input.number ? ["missing_number"] : []), ...(!input.city ? ["missing_city"] : [])],
    };
    const { data, error } = await this.sb.from("orders").upsert(row, { onConflict: "batch_id,client_key", ignoreDuplicates: false }).select("*").single();
    if (error) dbError(error, "Não foi possível incluir o pedido.");
    return mapOrder(data);
  }
  async updateOrder(orderId: string, patch: OrderPatch) {
    const row: Row = {};
    for (const [k, v] of Object.entries(patch)) row[PATCH_COLUMNS[k as keyof OrderPatch]] = v;
    const { error } = await this.sb.from("orders").update(row).eq("id", orderId);
    if (error) dbError(error, "Não foi possível salvar o pedido.");
  }
  async plan(batchId: string, opts: PlanOptions) {
    await this.call("plan", {
      batch_id: batchId, mode: opts.mode, service_minutes: opts.serviceMinutes, start_from: opts.startFrom, origin: opts.origin ?? null,
      manual_order_ids: opts.manualOrderIds, only_order_ids: opts.onlyOrderIds,
    });
  }
  async recordEvents(events: StopEventRow[]) {
    if (!events.length) return;
    const uid = await this.uid();
    const rows = events.map((e) => ({
      id: e.id, batch_id: e.batchId, order_id: e.orderId, kind: e.kind, reason: e.reason, undoes_event_id: e.undoesEventId,
      occurred_at: e.occurredAt, recorded_by: uid,
    }));
    // id gerado no aparelho: reenvios são ignorados pelo banco (sem duplicar conclusões)
    const { error } = await this.sb.from("stop_events").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) dbError(error, "Não foi possível sincronizar os registros.");
  }
  async assignDriver(batchId: string, driverId: string | null) {
    const { error } = await this.sb.from("batches").update({ assigned_driver_id: driverId }).eq("id", batchId);
    if (error) dbError(error, "Não foi possível atribuir o entregador.");
  }
  async setBatchStatus(batchId: string, status: Batch["status"]) {
    const patch: Row = { status };
    if (status === "completed") patch.completed_at = new Date().toISOString();
    const { error } = await this.sb.from("batches").update(patch).eq("id", batchId);
    if (error) dbError(error, "Não foi possível atualizar o lote.");
  }
  async deleteImages(batchId: string) {
    await this.call("delete_images", { batch_id: batchId });
  }
  async deleteBatch(batchId: string) {
    await this.call("delete_batch", { batch_id: batchId });
  }
}
