import type { RawExtraction, RawExtractedOrder } from "@core/extraction.ts";

export function rawOrder(p: Partial<RawExtractedOrder>): RawExtractedOrder {
  return {
    order_code: null, recipient_name: null, phone: null, street: null, number: null, neighborhood: null,
    city: null, uf: null, cep: null, complement: null, reference: null, instructions: null,
    raw_address_text: "", address_role: "customer_delivery", reading: "clear", uncertain_fields: [], region: null,
    ...p,
  };
}

/** Foto com cinco notinhas lado a lado + o cabeçalho do restaurante em uma delas. */
export const FIVE_RECEIPTS: RawExtraction = {
  receipts_detected: 5,
  image_quality: "good",
  quality_notes: null,
  orders: [
    rawOrder({ order_code: "#1041", recipient_name: "Ana Souza", phone: "(11) 98877-1122", street: "Rua Domingos de Morais", number: "1200", neighborhood: "Vila Mariana", city: "São Paulo", uf: "SP", cep: "04010-100", raw_address_text: "R. Domingos de Morais, 1200 - Vila Mariana", region: { x: 0, y: 0, width: 0.2, height: 1 } }),
    rawOrder({ order_code: "#1042", recipient_name: "Bruno Lima", street: "Rua Vergueiro", number: "3185", neighborhood: "Vila Mariana", raw_address_text: "Rua Vergueiro 3185 ap 42", complement: "ap 42", region: { x: 0.2, y: 0, width: 0.2, height: 1 } }),
    rawOrder({ order_code: "#1043", recipient_name: "Carla Dias", street: "Rua Joaquim Távora", number: "540", neighborhood: "Vila Mariana", city: "São Paulo", uf: "SP", raw_address_text: "Rua Joaquim Távora, 540", region: { x: 0.4, y: 0, width: 0.2, height: 1 } }),
    rawOrder({ order_code: "#1044", recipient_name: "Diego Alves", street: "Rua Vergueiro", number: "3185", neighborhood: "Vila Mariana", raw_address_text: "Rua Vergueiro 3185 ap 11", complement: "ap 11", region: { x: 0.6, y: 0, width: 0.2, height: 1 } }),
    rawOrder({ order_code: "#1045", recipient_name: "Eva Rocha", street: "Rua Áurea", number: null, neighborhood: "Vila Mariana", raw_address_text: "Rua Áurea, (número ilegível)", reading: "partial", uncertain_fields: ["number"], region: { x: 0.8, y: 0, width: 0.2, height: 1 } }),
    rawOrder({ street: "Rua Afonso Celso", number: "77", address_role: "restaurant_or_store", raw_address_text: "Cantina Exemplo - R. Afonso Celso, 77" }),
  ],
};
