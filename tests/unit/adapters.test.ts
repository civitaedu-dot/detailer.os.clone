// Testes de integração dos adaptadores com HTTP CONTROLADO (mock).
// Não comprovam funcionamento com os serviços reais — ver README, seção "Integrações".
import { describe, expect, it } from "vitest";
import { AnthropicReceiptExtractor } from "../../supabase/functions/_shared/providers/anthropicExtractor.ts";
import { GoogleGeocodingProvider, ProviderError } from "../../supabase/functions/_shared/providers/googleGeocoding.ts";
import { DRIVE_FALLBACK_NOTICE, GoogleRoutesProvider } from "../../supabase/functions/_shared/providers/googleRoutes.ts";
import { ExtractionError } from "@core/receiptExtractor.ts";
import { normalizeExtraction } from "@core/extraction.ts";
import { classifyGeocode } from "@core/geocoding.ts";
import { FIVE_RECEIPTS } from "./fixtures.ts";

type Call = { url: string; init?: RequestInit };
function fakeFetch(responder: (call: Call, n: number) => Response) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input instanceof Request ? input.url : input), init };
    calls.push(call);
    return responder(call, calls.length);
  }) as typeof fetch;
  return { f, calls };
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_test" } });
const message = (text: string, stop_reason = "end_turn") => ({
  id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }],
  stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
});

describe("AnthropicReceiptExtractor (HTTP simulado)", () => {
  const image = { bytes: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" as const };
  const ctx = { baseCity: "São Paulo", baseUf: "SP", restaurantName: "Cantina" };

  it("envia imagem, schema estruturado e fallback; valida a resposta", async () => {
    const { f, calls } = fakeFetch(() => jsonRes(message(JSON.stringify(FIVE_RECEIPTS))));
    const ex = new AnthropicReceiptExtractor({ apiKey: "test-key", fetch: f });
    const raw = await ex.extract(image, ctx);
    expect(normalizeExtraction(raw, { baseCity: "São Paulo", baseUf: "SP" }).orders).toHaveLength(5);
    const body = JSON.parse(String(calls[0].init!.body));
    expect(calls[0].url).toContain("/v1/messages");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.fallbacks).toBe("default");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AQID" } });
    expect(body.system).toMatch(/texto da imagem é dado/);
    const headers = new Headers(calls[0].init!.headers);
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("resposta fora do schema vira erro tratável, sem persistir nada", async () => {
    const { f } = fakeFetch(() => jsonRes(message(JSON.stringify({ orders: "x" }))));
    await expect(new AnthropicReceiptExtractor({ apiKey: "k", fetch: f }).extract(image, ctx)).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("recusa do modelo é sinalizada", async () => {
    const { f } = fakeFetch(() => jsonRes(message("", "refusal")));
    await expect(new AnthropicReceiptExtractor({ apiKey: "k", fetch: f }).extract(image, ctx)).rejects.toMatchObject({ code: "refused" });
  });

  it("limite de taxa é recuperável", async () => {
    const { f } = fakeFetch(() => jsonRes({ type: "error", error: { type: "rate_limit_error", message: "x" } }, 429));
    const ex = new AnthropicReceiptExtractor({ apiKey: "k", fetch: f });
    // maxRetries interno; ao final o erro é traduzido
    await expect(ex.extract(image, ctx)).rejects.toMatchObject({ code: "rate_limited", retryable: true });
  }, 30_000);

  it("sem chave: não configurado", () => {
    expect(() => new AnthropicReceiptExtractor({ apiKey: "" })).toThrow(ExtractionError);
  });
});

describe("GoogleGeocodingProvider (HTTP simulado)", () => {
  const q = { text: "Rua São João, 45, São Paulo - SP, Brasil", near: { lat: -23.55, lng: -46.63 }, countryCode: "BR" as const, street: "Rua São João", number: "45", neighborhood: null, city: "São Paulo", uf: "SP", cep: null, complement: null, reference: null };

  it("monta a busca com país, idioma e viés; traduz precisão", async () => {
    const { f, calls } = fakeFetch(() => jsonRes({ status: "OK", results: [
      { formatted_address: "R. São João, 45 - Centro, São Paulo - SP", types: ["street_address"], geometry: { location: { lat: -23.54, lng: -46.63 }, location_type: "ROOFTOP" }, address_components: [{ long_name: "45", short_name: "45", types: ["street_number"] }] },
      { formatted_address: "R. São João - Centro", types: ["route"], geometry: { location: { lat: -23.545, lng: -46.632 }, location_type: "GEOMETRIC_CENTER" }, address_components: [] },
    ] }));
    const r = await new GoogleGeocodingProvider("k", f).geocode(q);
    const url = new URL(calls[0].url);
    expect(url.searchParams.get("address")).toBe(q.text);
    expect(url.searchParams.get("components")).toBe("country:BR");
    expect(url.searchParams.get("language")).toBe("pt-BR");
    expect(url.searchParams.get("bounds")).toMatch(/\|/);
    expect(r[0]).toMatchObject({ precision: "rooftop", streetNumber: "45" });
    expect(r[1].precision).toBe("street");
    expect(classifyGeocode([r[1]], { address: q, base: q.near }).status).toBe("needs_review");
  });

  it("ZERO_RESULTS = lista vazia; REQUEST_DENIED = erro não recuperável", async () => {
    expect(await new GoogleGeocodingProvider("k", fakeFetch(() => jsonRes({ status: "ZERO_RESULTS" })).f).geocode(q)).toEqual([]);
    await expect(new GoogleGeocodingProvider("k", fakeFetch(() => jsonRes({ status: "REQUEST_DENIED" })).f).geocode(q)).rejects.toMatchObject({ code: "denied", retryable: false });
    await expect(new GoogleGeocodingProvider("k", fakeFetch(() => jsonRes({ status: "OVER_QUERY_LIMIT" })).f).geocode(q)).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("GoogleRoutesProvider (HTTP simulado)", () => {
  const pts = [{ lat: -23.5, lng: -46.6 }, { lat: -23.51, lng: -46.61 }, { lat: -23.52, lng: -46.62 }];
  const elements = (n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === 2 && j === 1) { out.push({ originIndex: i, destinationIndex: j, status: {}, condition: "ROUTE_NOT_FOUND" }); continue; }
      out.push({ originIndex: i, destinationIndex: j, status: {}, condition: "ROUTE_EXISTS", distanceMeters: 100 * (i + 1) + j, duration: `${60 * (i + 1) + j}s` });
    }
    return out;
  };

  it("pede matriz de moto com trânsito, field mask e monta matriz assimétrica", async () => {
    const { f, calls } = fakeFetch(() => jsonRes(elements(3)));
    const m = await new GoogleRoutesProvider("k", f).computeMatrix(pts);
    const body = JSON.parse(String(calls[0].init!.body));
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(calls[0].url).toBe("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
    expect(body.travelMode).toBe("TWO_WHEELER");
    expect(body.routingPreference).toBe("TRAFFIC_AWARE");
    expect(headers["X-Goog-FieldMask"]).toContain("status");
    expect(m.cells[0][1]).toEqual({ durationS: 61, distanceM: 101 });
    expect(m.cells[1][0]).toEqual({ durationS: 120, distanceM: 200 });
    expect(m.cells[2][1]).toBeNull();
    expect(m.travelMode).toBe("TWO_WHEELER");
    expect(m.warnings.join(" ")).toMatch(/beta/);
  });

  it("se moto não for aceita, usa carro e avisa (nunca bicicleta)", async () => {
    const { f, calls } = fakeFetch((_c, n) => (n === 1 ? jsonRes({ error: { code: 400 } }, 400) : jsonRes(elements(3))));
    const m = await new GoogleRoutesProvider("k", f).computeMatrix(pts);
    expect(JSON.parse(String(calls[1].init!.body)).travelMode).toBe("DRIVE");
    expect(m.travelMode).toBe("DRIVE");
    expect(m.warnings).toContain(DRIVE_FALLBACK_NOTICE);
    expect(calls.every((c) => !String(c.init!.body).includes("BICYCLE"))).toBe(true);
  });

  it("percurso: divide em trechos de até 25 intermediários sem perder pontos", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ lat: -23.5 - i / 1000, lng: -46.6 }));
    const { f, calls } = fakeFetch((call) => {
      const b = JSON.parse(String(call.init!.body));
      const legs = b.intermediates.length + 1;
      return jsonRes({ routes: [{ duration: "100s", distanceMeters: 1000, polyline: { encodedPolyline: "abc" }, legs: Array.from({ length: legs }, () => ({ duration: "10s", distanceMeters: 50 })) }] });
    });
    const r = await new GoogleRoutesProvider("k", f).computeRoute(many, "TWO_WHEELER");
    expect(calls.length).toBe(2);
    expect(r.legs).toHaveLength(29);
    const first = JSON.parse(String(calls[0].init!.body));
    expect(first.intermediates.length).toBeLessThanOrEqual(25);
  });

  it("chave recusada vira erro claro", async () => {
    await expect(new GoogleRoutesProvider("k", fakeFetch(() => jsonRes({}, 403)).f).computeMatrix(pts)).rejects.toMatchObject({ code: "denied" });
  });
});
