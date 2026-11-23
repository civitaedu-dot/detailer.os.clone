import { describe, expect, it } from "vitest";
import { classifyGeocode } from "@core/geocoding.ts";
import { findPossibleDuplicates } from "@core/dedupe.ts";
import type { GeocodeCandidate } from "@core/types.ts";

const base = { lat: -23.588, lng: -46.634 };
const cand = (p: Partial<GeocodeCandidate>): GeocodeCandidate => ({
  lat: -23.59, lng: -46.636, formattedAddress: "Rua Vergueiro, 3185 - Vila Mariana, São Paulo - SP", precision: "rooftop", partialMatch: false, streetNumber: "3185", ...p,
});
const addr = { street: "Rua Vergueiro", number: "3185" };

describe("classificação da localização", () => {
  it("porta confirmada fica pronta", () => {
    expect(classifyGeocode([cand({})], { address: addr, base }).status).toBe("ready");
  });
  it("centro da rua ou do bairro nunca vale como porta", () => {
    const r = classifyGeocode([cand({ precision: "street", streetNumber: null })], { address: addr, base });
    expect(r.status).toBe("needs_review");
    expect(r.reasons).toEqual(expect.arrayContaining(["approximate_location", "number_not_confirmed"]));
    expect(classifyGeocode([cand({ precision: "neighborhood" })], { address: addr, base }).reasons).toContain("approximate_location");
  });
  it("múltiplos candidatos distintos pedem escolha", () => {
    const r = classifyGeocode([cand({}), cand({ lat: -23.62, lng: -46.70 })], { address: addr, base });
    expect(r.reasons).toContain("multiple_candidates");
    expect(r.candidates).toHaveLength(2);
  });
  it("fora da área esperada é sinalizado", () => {
    const r = classifyGeocode([cand({ lat: -22.9, lng: -43.2 })], { address: addr, base });
    expect(r.reasons).toContain("outside_service_area");
  });
  it("nenhum resultado = não localizado", () => {
    expect(classifyGeocode([], { address: addr, base }).status).toBe("not_found");
  });
  it("correspondência parcial com outra rua é sinalizada", () => {
    const r = classifyGeocode([cand({ partialMatch: true, formattedAddress: "Rua Domingos de Morais, 3185" })], { address: addr, base });
    expect(r.reasons).toContain("partial_match");
  });
});

describe("pedidos repetidos", () => {
  const o = (id: string, img: string, p: object = {}) => ({ id, sourceImageId: img, orderCode: null, recipientName: null, phone: null, street: "Rua A", number: "10", ...p });
  it("mesmo código em fotos diferentes é possível repetição", () => {
    expect(findPossibleDuplicates([o("1", "i1", { orderCode: "#9" }), o("2", "i2", { orderCode: "#9" })])).toEqual([{ id: "2", duplicateOf: "1" }]);
  });
  it("mesmo endereço com pedidos diferentes NÃO é repetição", () => {
    expect(findPossibleDuplicates([o("1", "i1", { orderCode: "#1" }), o("2", "i2", { orderCode: "#2" })])).toEqual([]);
    expect(findPossibleDuplicates([o("1", "i1", { recipientName: "Ana" }), o("2", "i2", { recipientName: "Bia" })])).toEqual([]);
  });
  it("na mesma foto, notinhas iguais em endereço são pedidos distintos", () => {
    expect(findPossibleDuplicates([o("1", "i1", { recipientName: "Ana" }), o("2", "i1", { recipientName: "Ana" })])).toEqual([]);
  });
});
