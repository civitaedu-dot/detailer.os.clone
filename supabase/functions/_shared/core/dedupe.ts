import { foldText, streetKey } from "./address.ts";

export type DedupeCandidate = {
  id: string;
  sourceImageId: string;
  orderCode: string | null;
  recipientName: string | null;
  phone: string | null;
  street: string | null;
  number: string | null;
};

/**
 * Aponta possíveis pedidos repetidos (ex.: a mesma notinha fotografada em duas fotos diferentes).
 * Nunca remove nada: devolve pares "repetido → original" para revisão.
 * Mesmo endereço sozinho NÃO é repetição — pedidos diferentes podem ir ao mesmo lugar.
 */
export function findPossibleDuplicates(orders: DedupeCandidate[]): Array<{ id: string; duplicateOf: string }> {
  const out: Array<{ id: string; duplicateOf: string }> = [];
  for (let i = 0; i < orders.length; i++) {
    const a = orders[i];
    for (let j = 0; j < i; j++) {
      const b = orders[j];
      if (a.sourceImageId === b.sourceImageId) continue; // na mesma foto, são notinhas distintas
      const sameCode = !!a.orderCode && foldText(a.orderCode) === foldText(b.orderCode);
      if (a.orderCode && b.orderCode && !sameCode) continue; // códigos diferentes = pedidos diferentes
      const sameAddress = !!streetKey(a.street) && streetKey(a.street) === streetKey(b.street) && foldText(a.number) === foldText(b.number);
      const sameRecipient = !!a.recipientName && foldText(a.recipientName) === foldText(b.recipientName);
      const samePhone = !!a.phone && a.phone === b.phone;
      if (sameCode && (sameAddress || sameRecipient || samePhone || (!a.street && !b.street))) {
        out.push({ id: a.id, duplicateOf: b.id });
        break;
      }
      if (!a.orderCode && !b.orderCode && sameAddress && (sameRecipient || samePhone)) {
        out.push({ id: a.id, duplicateOf: b.id });
        break;
      }
    }
  }
  return out;
}

/** SHA-256 em hexadecimal (Web Crypto, disponível no navegador, Deno e Node ≥ 20). */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", buf as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
