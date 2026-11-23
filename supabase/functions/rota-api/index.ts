// RotaPronta — função de servidor (Supabase Edge Function, Deno).
// Ações: config, extract, geocode, geocode_text, plan, delete_batch, delete_images, retention.
// Todas as leituras/escritas de dados do lote usam o cliente com o JWT do usuário (RLS aplicada).
// A chave de serviço só é usada para cache de matrizes, contadores de uso, log operacional e retenção.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatAddressQuery } from "../_shared/core/address.ts";
import { sha256Hex, findPossibleDuplicates } from "../_shared/core/dedupe.ts";
import { normalizeExtraction } from "../_shared/core/extraction.ts";
import { isValidLatLng, locationKey } from "../_shared/core/geo.ts";
import { classifyGeocode, computeOrderStatus, mergeReasons, type GeocodingProvider } from "../_shared/core/geocoding.ts";
import { LIMITS } from "../_shared/core/limits.ts";
import { etaOffsets, planRoute, PlanningError, type RoutingProvider } from "../_shared/core/planning.ts";
import { ExtractionError, type ReceiptExtractor } from "../_shared/core/receiptExtractor.ts";
import { SimulatedRoutingProvider } from "../_shared/core/simulatedRouting.ts";
import type { LatLng, ReviewReason, TravelMatrix } from "../_shared/core/types.ts";
import { AnthropicReceiptExtractor } from "../_shared/providers/anthropicExtractor.ts";
import { GoogleGeocodingProvider, ProviderError } from "../_shared/providers/googleGeocoding.ts";
import { GoogleRoutesProvider } from "../_shared/providers/googleRoutes.ts";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY");
const GOOGLE_KEY = env("GOOGLE_MAPS_SERVER_KEY");
const MAX_ORDERS = Number(env("MAX_ORDERS_PER_ROUTE")) || LIMITS.maxOrdersPerBatch;
const DAILY_OCR_LIMIT = Number(env("DAILY_OCR_IMAGES_PER_USER")) || 300;
const RETENTION_DAYS = Number(env("IMAGE_RETENTION_DAYS")) || 7;
const ALLOWED_ORIGINS = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin || "*" : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}

/** Log operacional: apenas identificadores e contagens — nunca endereços, telefones ou imagens. */
function log(event: string, detail: Record<string, string | number | boolean | null>) {
  console.log(JSON.stringify({ event, ...detail, at: new Date().toISOString() }));
}

const admin = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function extractor(): ReceiptExtractor | null {
  return ANTHROPIC_API_KEY
    ? new AnthropicReceiptExtractor({
        apiKey: ANTHROPIC_API_KEY,
        model: env("ANTHROPIC_MODEL") || undefined,
        effort: (env("OCR_EFFORT") || "medium") as "medium",
      })
    : null;
}
const geocoder = (): GeocodingProvider | null => (GOOGLE_KEY ? new GoogleGeocodingProvider(GOOGLE_KEY) : null);
const router = (): RoutingProvider => (GOOGLE_KEY ? new GoogleRoutesProvider(GOOGLE_KEY) : new SimulatedRoutingProvider());

type Ctx = { req: Request; user: { id: string }; db: SupabaseClient; body: Record<string, unknown> };

function uuidParam(v: unknown, name: string): string {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, "bad_request", `Parâmetro ${name} inválido.`);
  return v;
}

async function loadBatch(ctx: Ctx, batchId: string) {
  const { data, error } = await ctx.db
    .from("batches")
    .select("id, org_id, status, base_id, start_from, return_to_base, service_minutes, origin_lat, origin_lng, organizations(name, kind), bases(name, address_line, city, uf, lat, lng)")
    .eq("id", batchId)
    .maybeSingle();
  if (error || !data) throw new HttpError(404, "not_found", "Lote não encontrado ou acesso negado.");
  return data as unknown as {
    id: string; org_id: string; status: string; base_id: string | null; start_from: "base" | "current";
    return_to_base: boolean; service_minutes: number; origin_lat: number | null; origin_lng: number | null;
    organizations: { name: string; kind: string } | null;
    bases: { name: string; address_line: string; city: string; uf: string; lat: number; lng: number } | null;
  };
}

async function setStep(ctx: Ctx, batchId: string, step: string | null, status?: string, lastError?: string | null) {
  const patch: Record<string, unknown> = { processing_step: step };
  if (status) patch.status = status;
  if (lastError !== undefined) patch.last_error = lastError;
  await ctx.db.from("batches").update(patch).eq("id", batchId);
}

async function bumpUsage(userId: string, kind: string, by: number, limit: number) {
  const a = admin();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const { data } = await a.from("usage_counters").select("count").eq("user_id", userId).eq("day", day).eq("kind", kind).maybeSingle();
  const next = (data?.count ?? 0) + by;
  if (next > limit) throw new HttpError(429, "daily_limit", "Limite diário de leituras atingido. Tente amanhã ou inclua os pedidos manualmente.");
  await a.from("usage_counters").upsert({ user_id: userId, day, kind, count: next });
}

// ───────────────────────── leitura das notinhas ─────────────────────────
async function extract(ctx: Ctx) {
  const batchId = uuidParam(ctx.body.batch_id, "batch_id");
  const batch = await loadBatch(ctx, batchId);
  const ex = extractor();
  if (!ex) throw new HttpError(503, "ocr_not_configured", "A leitura automática de notinhas não está configurada neste ambiente. Inclua os pedidos manualmente.");

  const staleIso = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: images } = await ctx.db
    .from("batch_images")
    .select("id, storage_path, mime, status, attempts")
    .eq("batch_id", batchId)
    .order("created_at");
  const pending = (images ?? []).filter((i) => i.status !== "extracted");
  await setStep(ctx, batchId, "extracting", "processing", null);
  const results: Array<Record<string, unknown>> = [];
  const started = Date.now();

  for (const img of pending) {
    if (img.attempts >= 4) { results.push({ id: img.id, status: "failed", error_code: "too_many_attempts" }); continue; }
    // Reserva a imagem: evita leitura duplicada em chamadas simultâneas ou repetidas.
    const { data: claimed } = await ctx.db
      .from("batch_images")
      .update({ status: "extracting", attempts: img.attempts + 1, claimed_at: new Date().toISOString() })
      .eq("id", img.id)
      .or(`status.in.(uploaded,failed),and(status.eq.extracting,claimed_at.lt."${staleIso}")`)
      .select("id")
      .maybeSingle();
    if (!claimed) { results.push({ id: img.id, status: "in_progress" }); continue; }

    try {
      await bumpUsage(ctx.user.id, "ocr_image", 1, DAILY_OCR_LIMIT);
      const { data: file, error: dlErr } = await ctx.db.storage.from("receipts").download(img.storage_path);
      if (dlErr || !file) throw new HttpError(404, "image_missing", "Imagem não encontrada no armazenamento.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const raw = await ex.extract({ bytes, mediaType: img.mime }, {
        baseCity: batch.bases?.city ?? null, baseUf: batch.bases?.uf ?? null, restaurantName: batch.organizations?.name ?? null,
      });
      const baseParts = batch.bases?.address_line.split(",") ?? [];
      const norm = normalizeExtraction(raw, {
        baseCity: batch.bases?.city ?? null,
        baseUf: batch.bases?.uf ?? null,
        baseStreet: baseParts[0]?.trim() ?? null,
        baseNumber: baseParts[1]?.trim().split(/\s|-/)[0] ?? null,
      });
      if (norm.orders.length) {
        const rows = norm.orders.map((o) => ({
          batch_id: batchId, source_image_id: img.id, source_index: o.sourceIndex, origin: "ocr",
          order_code: o.orderCode, recipient_name: o.recipientName, phone: o.phone, street: o.street, number: o.number,
          neighborhood: o.neighborhood, city: o.city, uf: o.uf, cep: o.cep, complement: o.complement, reference: o.reference,
          instructions: o.instructions, raw_address_text: o.rawAddressText, region: o.region, city_inferred: o.cityInferred,
          reading_confidence: o.readingConfidence, review_reasons: o.reviewReasons, status: "needs_review",
        }));
        const { error: insErr } = await ctx.db.from("orders").upsert(rows, { onConflict: "source_image_id,source_index", ignoreDuplicates: true });
        if (insErr) throw new HttpError(500, "persist_failed", "Não foi possível salvar os pedidos lidos.");
      }
      const meta = {
        quality: norm.quality, quality_notes: norm.qualityNotes, receipts_detected: norm.receiptsDetected,
        orders: norm.orders.length, discarded_non_delivery: norm.discardedNonDelivery, warnings: norm.warnings,
      };
      await ctx.db.from("batch_images").update({ status: "extracted", extraction: meta, provider: ex.name, extracted_at: new Date().toISOString(), error_code: null }).eq("id", img.id);
      results.push({ id: img.id, status: "extracted", ...meta });
    } catch (e) {
      const code = e instanceof ExtractionError || e instanceof HttpError ? e.code : "unexpected";
      await ctx.db.from("batch_images").update({ status: "failed", error_code: String(code) }).eq("id", img.id);
      results.push({ id: img.id, status: "failed", error_code: code, message: e instanceof Error ? e.message : null });
      if (e instanceof HttpError && e.code === "daily_limit") break;
      if (e instanceof ExtractionError && e.code === "not_configured") break;
    }
  }

  await markDuplicates(ctx, batchId);
  const failed = results.filter((r) => r.status === "failed").length;
  await setStep(ctx, batchId, null, "processing", failed ? "Algumas fotos não puderam ser lidas." : null);
  log("extract", { batch: batchId, images: pending.length, failed, ms: Date.now() - started, provider: ex.name });
  return { images: results };
}

async function markDuplicates(ctx: Ctx, batchId: string) {
  const { data } = await ctx.db
    .from("orders")
    .select("id, source_image_id, order_code, recipient_name, phone, street, number, review_reasons, duplicate_of, status")
    .eq("batch_id", batchId)
    .order("created_at");
  const rows = data ?? [];
  const dups = findPossibleDuplicates(rows.map((r) => ({
    id: r.id, sourceImageId: r.source_image_id ?? r.id, orderCode: r.order_code, recipientName: r.recipient_name,
    phone: r.phone, street: r.street, number: r.number,
  })));
  for (const d of dups) {
    const row = rows.find((r) => r.id === d.id)!;
    if (row.duplicate_of || row.status === "excluded") continue;
    const reasons = [...new Set([...(row.review_reasons as string[]), "possible_duplicate"])];
    await ctx.db.from("orders").update({ duplicate_of: d.duplicateOf, review_reasons: reasons, status: row.status === "ready" ? "needs_review" : row.status }).eq("id", d.id);
  }
}

// ───────────────────────── localização ─────────────────────────
async function geocode(ctx: Ctx) {
  const batchId = uuidParam(ctx.body.batch_id, "batch_id");
  const only = Array.isArray(ctx.body.order_ids) ? (ctx.body.order_ids as unknown[]).map((v) => uuidParam(v, "order_ids")) : null;
  const force = ctx.body.force === true;
  const batch = await loadBatch(ctx, batchId);
  const g = geocoder();
  if (!g) throw new HttpError(503, "geocoding_not_configured", "A localização automática de endereços não está configurada. Ajuste o pino no mapa ou configure a chave do Google Maps.");
  const base: LatLng | null = batch.bases ? { lat: batch.bases.lat, lng: batch.bases.lng } : null;

  let q = ctx.db.from("orders").select("*").eq("batch_id", batchId).neq("status", "excluded");
  if (only) q = q.in("id", only);
  const { data: orders } = await q;
  await setStep(ctx, batchId, "geocoding");
  let processed = 0, skipped = 0;
  for (const o of orders ?? []) {
    const manualLocation = o.location_provenance === "manual_pin" || o.location_provenance === "candidate_choice";
    if (manualLocation && !force) { skipped++; continue; }
    const text = formatAddressQuery(o);
    const hash = await sha256Hex(new TextEncoder().encode(text));
    if (!force && o.geocode_query_hash === hash && o.geocode_attempted_at) { skipped++; continue; }
    const readingReasons = (o.review_reasons ?? []) as ReviewReason[];
    if (!o.street) {
      await ctx.db.from("orders").update({
        status: "needs_review", review_reasons: mergeReasons(readingReasons, []), geocode_query_hash: hash,
      }).eq("id", o.id);
      skipped++;
      continue;
    }
    try {
      const candidates = await g.geocode({ ...o, text, near: base, countryCode: "BR" });
      const outcome = classifyGeocode(candidates, { address: o, base, serviceRadiusM: LIMITS.serviceRadiusKm * 1000 });
      const reasons = mergeReasons(readingReasons, outcome.reasons);
      const status = computeOrderStatus({ excluded: false, hasLocation: !!outcome.chosen, geocodeAttempted: true, reasons });
      await ctx.db.from("orders").update({
        lat: outcome.chosen?.lat ?? null, lng: outcome.chosen?.lng ?? null, geocode_precision: outcome.chosen?.precision ?? null,
        location_provenance: outcome.chosen ? "provider" : null, geocode_candidates: outcome.candidates,
        geocode_query_hash: hash, geocode_attempted_at: new Date().toISOString(), review_reasons: reasons, status,
      }).eq("id", o.id);
      processed++;
    } catch (e) {
      await setStep(ctx, batchId, null, undefined, "Falha ao localizar endereços. Tente novamente.");
      if (e instanceof ProviderError) throw new HttpError(e.retryable ? 503 : 502, `geocoding_${e.code}`, e.message, { processed });
      throw e;
    }
  }
  const { data: counts } = await ctx.db.from("orders").select("status").eq("batch_id", batchId);
  const unresolved = (counts ?? []).filter((r) => r.status === "needs_review" || r.status === "not_found").length;
  await setStep(ctx, batchId, null, batch.status === "in_progress" ? undefined : "review", null);
  log("geocode", { batch: batchId, processed, skipped, unresolved, provider: g.name });
  return { processed, skipped, unresolved };
}

/** Busca livre (cadastro de base, correção de endereço): devolve candidatos para escolha. */
async function geocodeText(ctx: Ctx) {
  const text = typeof ctx.body.text === "string" ? ctx.body.text.trim().slice(0, 300) : "";
  if (text.length < 5) throw new HttpError(400, "bad_request", "Informe o endereço completo.");
  const g = geocoder();
  if (!g) throw new HttpError(503, "geocoding_not_configured", "A localização automática não está configurada. Marque o ponto no mapa.");
  const near = isValidLatLng(ctx.body.near as LatLng) ? (ctx.body.near as LatLng) : null;
  const candidates = await g.geocode({ text, near, countryCode: "BR", street: null, number: null, neighborhood: null, city: null, uf: null, cep: null, complement: null, reference: null });
  log("geocode_text", { candidates: candidates.length });
  return { candidates };
}

// ───────────────────────── rota ─────────────────────────
class CachedRouting implements RoutingProvider {
  constructor(private inner: RoutingProvider, private batchId: string) {}
  get name() { return this.inner.name; }
  get simulated() { return this.inner.simulated; }
  get maxMatrixPoints() { return this.inner.maxMatrixPoints; }
  async computeMatrix(points: LatLng[]): Promise<TravelMatrix> {
    const hash = await sha256Hex(new TextEncoder().encode(`${this.inner.name}|${points.map(locationKey).join(";")}`));
    const a = admin();
    const { data } = await a.from("matrix_cache").select("*").eq("batch_id", this.batchId).eq("points_hash", hash).maybeSingle();
    // Reaproveita a matriz por 30 min (trânsito muda); evita repetir chamadas externas em recálculos.
    if (data && Date.now() - new Date(data.created_at).getTime() < 30 * 60_000) {
      return { cells: data.cells, travelMode: data.travel_mode, provider: data.provider, simulated: data.simulated, warnings: data.warnings };
    }
    const m = await this.inner.computeMatrix(points);
    await a.from("matrix_cache").upsert({
      batch_id: this.batchId, points_hash: hash, travel_mode: m.travelMode, provider: m.provider, simulated: m.simulated,
      cells: m.cells, warnings: m.warnings, created_at: new Date().toISOString(),
    });
    return m;
  }
  computeRoute(points: LatLng[], mode: TravelMatrix["travelMode"]) { return this.inner.computeRoute(points, mode); }
}

async function plan(ctx: Ctx) {
  const batchId = uuidParam(ctx.body.batch_id, "batch_id");
  const batch = await loadBatch(ctx, batchId);
  const mode = ctx.body.mode === "closed" ? "closed" : "open";
  const serviceMinutes = Math.min(60, Math.max(0, Number(ctx.body.service_minutes ?? batch.service_minutes) || 0));
  const startFrom = ctx.body.start_from === "current" ? "current" : "base";
  const manual = Array.isArray(ctx.body.manual_order_ids) ? (ctx.body.manual_order_ids as unknown[]).map((v) => uuidParam(v, "manual_order_ids")) : undefined;
  const only = Array.isArray(ctx.body.only_order_ids) ? (ctx.body.only_order_ids as unknown[]).map((v) => uuidParam(v, "only_order_ids")) : null;

  const base = batch.bases ? { lat: batch.bases.lat, lng: batch.bases.lng } : null;
  let origin: LatLng | null = startFrom === "base" ? base : null;
  if (startFrom === "current" || only) {
    const o = ctx.body.origin as LatLng;
    if (isValidLatLng(o)) origin = { lat: o.lat, lng: o.lng };
    else if (startFrom === "current") throw new HttpError(400, "origin_required", "Localização atual indisponível. Escolha sair da base ou informe a origem.");
  }
  if (!origin) throw new HttpError(400, "origin_required", "Cadastre a base ou informe a origem da saída.");
  if (mode === "closed" && !base) throw new HttpError(400, "base_required", "Cadastre a base para planejar o retorno.");

  const { data: all } = await ctx.db.from("orders").select("id, status, lat, lng, source_image_id, source_index, created_at").eq("batch_id", batchId);
  const rows = (all ?? []).filter((o) => !only || only.includes(o.id));
  const unresolved = rows.filter((o) => o.status === "needs_review" || o.status === "not_found");
  if (unresolved.length && !only) {
    throw new HttpError(409, "unresolved_orders", `${unresolved.length} pedido(s) ainda precisam de revisão ou de ser retirados desta saída.`, { count: unresolved.length });
  }
  const ready = rows.filter((o) => o.status === "ready" && o.lat !== null && o.lng !== null);
  // ordem original de leitura: imagem (criação) e posição na imagem
  ready.sort((a, b) => a.created_at.localeCompare(b.created_at) || (a.source_index ?? 0) - (b.source_index ?? 0));

  await setStep(ctx, batchId, "planning");
  const routing = new CachedRouting(router(), batchId);
  let result;
  try {
    result = await planRoute({
      orders: ready.map((o, i) => ({ id: o.id, location: { lat: o.lat, lng: o.lng }, readIndex: i })),
      origin, mode, returnTo: mode === "closed" ? base : null,
      serviceSecondsPerOrder: serviceMinutes * 60, manualOrderIds: manual, maxOrders: MAX_ORDERS,
    }, routing);
  } catch (e) {
    await setStep(ctx, batchId, null, undefined, "Não foi possível calcular a rota.");
    if (e instanceof PlanningError) throw new HttpError(422, e.code, e.message);
    if (e instanceof ProviderError) throw new HttpError(e.retryable ? 503 : 502, `routing_${e.code}`, e.message);
    throw e;
  }

  // Percurso real na ordem resultante (desenho e totais)
  let polylines: string[] = [];
  let legs = result.legs;
  let distanceM = result.distanceM, travelS = result.travelS;
  const warnings = [...result.warnings];
  if (!routing.simulated) {
    try {
      const geo = await routing.computeRoute(result.points, result.travelMode);
      polylines = geo.encodedPolylines;
      if (geo.legs.length === legs.length && geo.legs.every(Boolean)) {
        legs = geo.legs;
        distanceM = geo.distanceM;
        travelS = geo.durationS;
      }
      warnings.push(...geo.warnings);
    } catch {
      warnings.push("O desenho do percurso não pôde ser obtido; a sequência e as estimativas foram mantidas.");
    }
  }

  const { data: prev } = await ctx.db.from("routes").select("version").eq("batch_id", batchId).order("version", { ascending: false }).limit(1);
  const version = (prev?.[0]?.version ?? 0) + 1;
  await ctx.db.from("routes").update({ status: "superseded" }).eq("batch_id", batchId).eq("status", "active");
  const end = mode === "closed" ? result.points[result.points.length - 1] : null;
  const { data: route, error: rErr } = await ctx.db.from("routes").insert({
    batch_id: batchId, version, status: "active", mode, travel_mode: result.travelMode, provider: routing.name,
    simulated: result.simulated, method: result.method, origin_lat: origin.lat, origin_lng: origin.lng,
    end_lat: end?.lat ?? null, end_lng: end?.lng ?? null, distance_m: Math.round(distanceM), travel_s: Math.round(travelS),
    service_s: result.serviceS, total_s: Math.round(travelS + result.serviceS),
    original_travel_s: result.comparison ? Math.round(result.comparison.originalTravelS) : null,
    polylines, warnings: [...new Set(warnings)],
  }).select("*").single();
  if (rErr || !route) throw new HttpError(500, "persist_failed", "Não foi possível salvar a rota.");

  const etas = etaOffsets(legs, result.stops, serviceMinutes * 60);
  const stopRows = result.stops.flatMap((s, gi) => s.orderIds.map((orderId, k) => ({
    route_id: route.id, batch_id: batchId, order_id: orderId, stop_group: gi,
    leg_duration_s: k === 0 ? legs[gi]?.durationS ?? null : 0, leg_distance_m: k === 0 ? legs[gi]?.distanceM ?? null : 0,
    eta_offset_s: Math.round(etas[gi] + k * serviceMinutes * 60),
  }))).map((r, position) => ({ ...r, position }));
  const { error: sErr } = await ctx.db.from("route_stops").insert(stopRows);
  if (sErr) throw new HttpError(500, "persist_failed", "Não foi possível salvar as paradas.");

  await ctx.db.from("batches").update({
    processing_step: null, last_error: null, status: batch.status === "in_progress" ? "in_progress" : "ready",
    return_to_base: mode === "closed", service_minutes: serviceMinutes, start_from: startFrom,
    origin_lat: origin.lat, origin_lng: origin.lng,
  }).eq("id", batchId);
  log("plan", { batch: batchId, orders: ready.length, stops: result.stops.length, method: result.method, provider: routing.name, simulated: result.simulated });
  return { route_id: route.id, version };
}

// ───────────────────────── exclusão e retenção ─────────────────────────
async function deleteImages(ctx: Ctx, alsoBatch: boolean) {
  const batchId = uuidParam(ctx.body.batch_id, "batch_id");
  await loadBatch(ctx, batchId);
  const { data: imgs } = await ctx.db.from("batch_images").select("id, storage_path").eq("batch_id", batchId);
  const paths = (imgs ?? []).map((i) => i.storage_path);
  if (paths.length) {
    const { error } = await ctx.db.storage.from("receipts").remove(paths);
    if (error) throw new HttpError(500, "storage_delete_failed", "Não foi possível excluir as fotos.");
  }
  if (alsoBatch) {
    const { error } = await ctx.db.from("batches").delete().eq("id", batchId);
    if (error) throw new HttpError(403, "forbidden", "Sem permissão para excluir este lote.");
  } else if (paths.length) {
    await ctx.db.from("batch_images").delete().eq("batch_id", batchId);
  }
  log(alsoBatch ? "delete_batch" : "delete_images", { batch: batchId, images: paths.length });
  return { deleted_images: paths.length };
}

async function retention(req: Request) {
  const secret = env("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) throw new HttpError(401, "unauthorized", "Não autorizado.");
  const a = admin();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  const { data } = await a.from("batch_images").select("id, storage_path").lt("created_at", cutoff).limit(500);
  const paths = (data ?? []).map((r) => r.storage_path);
  if (paths.length) {
    await a.storage.from("receipts").remove(paths);
    await a.from("batch_images").delete().in("id", (data ?? []).map((r) => r.id));
  }
  log("retention", { images: paths.length, days: RETENTION_DAYS });
  return { deleted_images: paths.length };
}

// ───────────────────────── entrada ─────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { code: "method_not_allowed" });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (action === "retention") return json(req, 200, await retention(req));

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) throw new HttpError(401, "unauthorized", "Sessão expirada. Entre novamente.");
    const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: userData, error } = await db.auth.getUser(auth.slice(7));
    if (error || !userData.user) throw new HttpError(401, "unauthorized", "Sessão expirada. Entre novamente.");
    const ctx: Ctx = { req, user: { id: userData.user.id }, db, body };

    switch (action) {
      case "config":
        return json(req, 200, {
          ocr: !!ANTHROPIC_API_KEY, geocoding: !!GOOGLE_KEY, routing: GOOGLE_KEY ? "google" : "simulated",
          limits: { maxOrdersPerRoute: MAX_ORDERS, maxImagesPerBatch: LIMITS.maxImagesPerBatch, retentionDays: RETENTION_DAYS },
        });
      case "extract": return json(req, 200, await extract(ctx));
      case "geocode": return json(req, 200, await geocode(ctx));
      case "geocode_text": return json(req, 200, await geocodeText(ctx));
      case "plan": return json(req, 200, await plan(ctx));
      case "delete_images": return json(req, 200, await deleteImages(ctx, false));
      case "delete_batch": return json(req, 200, await deleteImages(ctx, true));
      default: throw new HttpError(400, "unknown_action", "Ação desconhecida.");
    }
  } catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { code: e.code, message: e.message, ...e.extra });
    log("error", { name: e instanceof Error ? e.name : "unknown" });
    return json(req, 500, { code: "internal", message: "Erro inesperado no servidor. Tente novamente." });
  }
});
