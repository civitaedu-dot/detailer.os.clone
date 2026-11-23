import type { RawExtraction, RawExtractedOrder } from "@core/extraction.ts";
import type { GeocodeCandidate, LatLng } from "@core/types.ts";

/**
 * DADOS FICTÍCIOS da demonstração. Restaurante, clientes, telefones e pedidos são inventados.
 * As ruas existem em São Paulo, mas números e pessoas são fictícios; as coordenadas são
 * aproximadas e servem apenas ao mapa ilustrativo.
 */

export const DEMO_RESTAURANT = {
  name: "Cantina Bela Vista (fictícia)",
  base: { name: "Cantina Bela Vista", addressLine: "Rua Afonso Celso, 77 - Vila Mariana", city: "São Paulo", uf: "SP", lat: -23.5878, lng: -46.6345 },
};

export const DEMO_DRIVER = { userId: "00000000-0000-4000-8000-00000000c4a1", displayName: "Carlos (entregador fictício)" };

const o = (p: Partial<RawExtractedOrder>): RawExtractedOrder => ({
  order_code: null, recipient_name: null, phone: null, street: null, number: null, neighborhood: null, city: null, uf: null,
  cep: null, complement: null, reference: null, instructions: null, raw_address_text: "", address_role: "customer_delivery",
  reading: "clear", uncertain_fields: [], region: null, ...p,
});

const header = o({ street: "Rua Afonso Celso", number: "77", address_role: "restaurant_or_store", raw_address_text: "CANTINA BELA VISTA - R. Afonso Celso, 77" });

/** Conteúdo impresso de cada notinha (usado pelo gerador das imagens e pelas respostas simuladas). */
export type DemoReceipt = {
  code: string; name: string; phone: string | null; street: string; number: string | null; neighborhood: string;
  complement: string | null; reference: string | null; items: string[]; total: string; illegibleNumber?: boolean; note?: string | null;
};

export const DEMO_PHOTOS: Array<{ file: string; title: string; receipts: DemoReceipt[] }> = [
  {
    file: "/demo/notinhas-foto-1.jpg",
    title: "Cinco notinhas lado a lado",
    receipts: [
      { code: "2041", name: "Ana Paula S.", phone: "(11) 98765-4321", street: "Rua Domingos de Morais", number: "1450", neighborhood: "Vila Mariana", complement: "Casa 2", reference: "Portão cinza", items: ["1 Lasanha bolonhesa", "1 Refri lata"], total: "R$ 58,90" },
      { code: "2042", name: "Bruno M.", phone: null, street: "Rua Joaquim Távora", number: "820", neighborhood: "Vila Mariana", complement: "Ap 31", reference: null, items: ["2 Nhoque ao sugo"], total: "R$ 76,00" },
      { code: "2043", name: "Carla R.", phone: "(11) 97654-1200", street: "Rua Joaquim Távora", number: "820", neighborhood: "Vila Mariana", complement: "Ap 74", reference: null, items: ["1 Talharim ao pesto"], total: "R$ 42,50" },
      { code: "2044", name: "Diego F.", phone: null, street: "Rua Cubatão", number: "1100", neighborhood: "Paraíso", complement: null, reference: "Em frente à padaria", items: ["1 Pizza média margherita"], total: "R$ 61,00" },
      { code: "2045", name: "Elisa T.", phone: "(11) 91234-0099", street: "Rua Áurea", number: null, neighborhood: "Vila Mariana", complement: null, reference: null, items: ["1 Risoto de funghi"], total: "R$ 54,00", illegibleNumber: true },
    ],
  },
  {
    file: "/demo/notinhas-foto-2.jpg",
    title: "Mais três notinhas (uma repetida)",
    receipts: [
      { code: "2046", name: "Fábio L.", phone: "(11) 99876-5500", street: "Rua Vergueiro", number: "2045", neighborhood: "Vila Mariana", complement: "Bloco B", reference: null, items: ["1 Parmegiana", "1 Suco"], total: "R$ 67,40", note: "Interfone quebrado, ligar ao chegar" },
      { code: "2047", name: "Gabriela N.", phone: null, street: "Rua França Pinto", number: "610", neighborhood: "Vila Mariana", complement: null, reference: null, items: ["2 Lasanha 4 queijos"], total: "R$ 98,00" },
      { code: "2044", name: "Diego F.", phone: null, street: "Rua Cubatão", number: "1100", neighborhood: "Paraíso", complement: null, reference: "Em frente à padaria", items: ["1 Pizza média margherita"], total: "R$ 61,00" },
    ],
  },
];

function toRaw(receipts: DemoReceipt[]): RawExtraction {
  const n = receipts.length;
  return {
    receipts_detected: n,
    image_quality: "good",
    quality_notes: null,
    orders: [
      header,
      ...receipts.map((r, i) =>
        o({
          order_code: `#${r.code}`, recipient_name: r.name, phone: r.phone, street: r.street, number: r.illegibleNumber ? null : r.number,
          neighborhood: r.neighborhood, complement: r.complement, reference: r.reference, instructions: r.note ?? null,
          raw_address_text: `${r.street}, ${r.illegibleNumber ? "(número ilegível)" : r.number}${r.complement ? ` ${r.complement}` : ""} - ${r.neighborhood}`,
          reading: r.illegibleNumber ? "partial" : "clear",
          uncertain_fields: r.illegibleNumber ? ["number"] : [],
          region: { x: i / n + 0.005, y: 0.03, width: 1 / n - 0.01, height: 0.9 },
        }),
      ),
    ],
  };
}

/** Resposta simulada do leitor, vinculada à imagem de exemplo correspondente. */
export const DEMO_EXTRACTIONS: Record<string, RawExtraction> = Object.fromEntries(DEMO_PHOTOS.map((p) => [p.file, toRaw(p.receipts)]));

/** Localização fictícia dos endereços de exemplo (chave: rua|número). */
export const DEMO_LOCATIONS: Record<string, { at: LatLng; formatted: string }> = {
  "rua domingos de morais|1450": { at: { lat: -23.5916, lng: -46.6368 }, formatted: "Rua Domingos de Morais, 1450 - Vila Mariana, São Paulo - SP" },
  "rua joaquim tavora|820": { at: { lat: -23.5939, lng: -46.6331 }, formatted: "Rua Joaquim Távora, 820 - Vila Mariana, São Paulo - SP" },
  "rua cubatao|1100": { at: { lat: -23.5789, lng: -46.6452 }, formatted: "Rua Cubatão, 1100 - Paraíso, São Paulo - SP" },
  "rua vergueiro|2045": { at: { lat: -23.5823, lng: -46.6389 }, formatted: "Rua Vergueiro, 2045 - Vila Mariana, São Paulo - SP" },
  "rua franca pinto|610": { at: { lat: -23.5861, lng: -46.6431 }, formatted: "Rua França Pinto, 610 - Vila Mariana, São Paulo - SP" },
  "rua aurea|36": { at: { lat: -23.5968, lng: -46.6392 }, formatted: "Rua Áurea, 36 - Vila Mariana, São Paulo - SP" },
  "rua aurea|112": { at: { lat: -23.5975, lng: -46.6401 }, formatted: "Rua Áurea, 112 - Vila Mariana, São Paulo - SP" },
};

/** Ruas conhecidas da demonstração, para devolver apenas o "centro da rua" quando falta o número. */
export const DEMO_STREET_CENTERS: Record<string, GeocodeCandidate> = {
  "rua aurea": { lat: -23.5971, lng: -46.6396, formattedAddress: "Rua Áurea - Vila Mariana, São Paulo - SP", precision: "street", partialMatch: true, streetNumber: null },
};
