import { z } from "zod";
import {
  cleanText,
  foldText,
  normalizeCep,
  normalizeNumber,
  normalizePhone,
  normalizeUf,
  sameStreetAddress,
} from "./address.ts";
import type { ImageRegion, OrderDraft, ReviewReason } from "./types.ts";

/**
 * Contrato de saída de qualquer ReceiptExtractor. O fornecedor (IA de visão, OCR, simulação)
 * devolve este formato bruto; o app nunca confia nele sem passar por `normalizeExtraction`.
 */
const nullableText = z.string().nullable();

export const RawExtractedOrderSchema = z.object({
  order_code: nullableText,
  recipient_name: nullableText,
  phone: nullableText,
  street: nullableText,
  number: nullableText,
  neighborhood: nullableText,
  city: nullableText,
  uf: nullableText,
  cep: nullableText,
  complement: nullableText,
  reference: nullableText,
  instructions: nullableText,
  raw_address_text: z.string(),
  address_role: z.enum(["customer_delivery", "restaurant_or_store", "unclear"]),
  reading: z.enum(["clear", "partial", "unclear"]),
  uncertain_fields: z.array(z.string()),
  region: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .nullable(),
});

export const RawExtractionSchema = z.object({
  receipts_detected: z.number().int().min(0),
  image_quality: z.enum(["good", "blurry", "too_small", "not_a_receipt", "other_problem"]),
  quality_notes: nullableText,
  orders: z.array(RawExtractedOrderSchema),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;
export type RawExtractedOrder = z.infer<typeof RawExtractedOrderSchema>;

/** JSON Schema equivalente, usado como formato de saída estruturada no fornecedor de visão. */
export const RAW_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["receipts_detected", "image_quality", "quality_notes", "orders"],
  properties: {
    receipts_detected: { type: "integer", description: "Quantidade de notinhas/comprovantes de pedido distintos visíveis na imagem." },
    image_quality: { type: "string", enum: ["good", "blurry", "too_small", "not_a_receipt", "other_problem"] },
    quality_notes: { type: ["string", "null"] },
    orders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "order_code", "recipient_name", "phone", "street", "number", "neighborhood", "city", "uf", "cep",
          "complement", "reference", "instructions", "raw_address_text", "address_role", "reading",
          "uncertain_fields", "region",
        ],
        properties: {
          order_code: { type: ["string", "null"] },
          recipient_name: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          street: { type: ["string", "null"] },
          number: { type: ["string", "null"] },
          neighborhood: { type: ["string", "null"] },
          city: { type: ["string", "null"] },
          uf: { type: ["string", "null"] },
          cep: { type: ["string", "null"] },
          complement: { type: ["string", "null"] },
          reference: { type: ["string", "null"] },
          instructions: { type: ["string", "null"] },
          raw_address_text: { type: "string" },
          address_role: { type: "string", enum: ["customer_delivery", "restaurant_or_store", "unclear"] },
          reading: { type: "string", enum: ["clear", "partial", "unclear"] },
          uncertain_fields: { type: "array", items: { type: "string" } },
          region: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: false,
                required: ["x", "y", "width", "height"],
                properties: {
                  x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const;

export type ExtractionContext = {
  baseCity: string | null;
  baseUf: string | null;
  baseStreet?: string | null;
  baseNumber?: string | null;
  /** Limite de pedidos por imagem, como proteção contra respostas absurdas. */
  maxOrdersPerImage?: number;
};

export type NormalizedExtraction = {
  orders: OrderDraft[];
  quality: RawExtraction["image_quality"];
  qualityNotes: string | null;
  receiptsDetected: number;
  /** pedidos descartados por não serem endereço de entrega (ex.: cabeçalho do restaurante) */
  discardedNonDelivery: number;
  warnings: string[];
};

const ADDRESS_FIELDS = new Set(["street", "number", "neighborhood", "city", "uf", "cep"]);

function normalizeRegion(region: RawExtractedOrder["region"]): ImageRegion | null {
  if (!region) return null;
  const { x, y, width, height } = region;
  const ok = [x, y, width, height].every((v) => Number.isFinite(v));
  if (!ok || width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > 1.0001 || y + height > 1.0001) return null;
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

/**
 * Converte a saída bruta (já validada pelo schema) em pedidos normalizados.
 * Regras: não inventa dados, preserva o texto lido, marca a cidade inferida e separa
 * claramente incerteza de leitura das futuras dúvidas de localização.
 */
export function normalizeExtraction(raw: unknown, ctx: ExtractionContext): NormalizedExtraction {
  const parsed = RawExtractionSchema.parse(raw);
  const max = ctx.maxOrdersPerImage ?? 30;
  const warnings: string[] = [];
  if (parsed.orders.length > max) {
    warnings.push(`A leitura devolveu ${parsed.orders.length} pedidos; apenas ${max} foram aceitos desta imagem.`);
  }
  const orders: OrderDraft[] = [];
  let discarded = 0;

  parsed.orders.slice(0, max).forEach((o) => {
    const reasons = new Set<ReviewReason>();
    const street = cleanText(o.street);
    const number = normalizeNumber(o.number);
    const neighborhood = cleanText(o.neighborhood);
    let city = cleanText(o.city, 80);
    let uf = normalizeUf(o.uf);
    const cepResult = normalizeCep(o.cep);
    const rawAddressText = cleanText(o.raw_address_text, 400) ?? "";

    // Cabeçalho/endereço do restaurante não é entrega. Só descartamos quando o próprio leitor
    // classificou como loja E não há indícios de destinatário; caso contrário, vira revisão.
    const looksLikeBase =
      !!ctx.baseStreet && sameStreetAddress({ street, number }, { street: ctx.baseStreet, number: ctx.baseNumber ?? null });
    const hasRecipientSignals = !!cleanText(o.recipient_name) || !!cleanText(o.order_code) || !!normalizePhone(o.phone);
    if (o.address_role === "restaurant_or_store" && !hasRecipientSignals) {
      discarded++;
      return;
    }
    if (o.address_role !== "customer_delivery" || looksLikeBase) reasons.add("possible_restaurant_address");

    let cityInferred = false;
    if (!city && ctx.baseCity) {
      city = ctx.baseCity;
      uf = uf ?? normalizeUf(ctx.baseUf);
      cityInferred = true;
      reasons.add("city_inferred");
    } else if (!city) {
      reasons.add("missing_city");
    }
    if (!uf && cityInferred === false && city && ctx.baseCity && foldText(city) === foldText(ctx.baseCity)) {
      uf = normalizeUf(ctx.baseUf);
    }

    if (!street) reasons.add("missing_street");
    if (!number) reasons.add("missing_number");
    if (cepResult.invalid) reasons.add("cep_invalid");
    if (o.reading === "unclear") reasons.add("illegible");
    else if (o.reading === "partial") reasons.add("ambiguous_reading");
    if (o.uncertain_fields.some((f) => ADDRESS_FIELDS.has(f))) reasons.add("ambiguous_reading");

    const readingConfidence: OrderDraft["readingConfidence"] =
      o.reading === "clear" && !reasons.has("ambiguous_reading") ? "high" : o.reading === "unclear" ? "low" : "medium";

    orders.push({
      sourceIndex: orders.length,
      orderCode: cleanText(o.order_code, 40),
      recipientName: cleanText(o.recipient_name, 120),
      phone: normalizePhone(o.phone),
      street,
      number,
      neighborhood,
      city,
      uf,
      cep: cepResult.cep,
      complement: cleanText(o.complement, 160),
      reference: cleanText(o.reference, 200),
      instructions: cleanText(o.instructions, 300),
      rawAddressText,
      region: normalizeRegion(o.region),
      cityInferred,
      readingConfidence,
      reviewReasons: [...reasons],
    });
  });

  if (parsed.receipts_detected > 0 && orders.length + discarded < parsed.receipts_detected) {
    warnings.push(
      `Foram vistas ${parsed.receipts_detected} notinhas, mas só ${orders.length} endereços de entrega foram lidos. Confira a foto ou inclua manualmente.`,
    );
  }

  return {
    orders,
    quality: parsed.image_quality,
    qualityNotes: cleanText(parsed.quality_notes, 300),
    receiptsDetected: parsed.receipts_detected,
    discardedNonDelivery: discarded,
    warnings,
  };
}

/** Reasons that block inclusion on the route until resolved. */
export function blockingReasons(reasons: readonly ReviewReason[]): ReviewReason[] {
  return reasons.filter((r) => r !== "city_inferred");
}
