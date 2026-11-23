import type { AddressFields } from "./types.ts";

export const BR_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR",
  "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

/** Remove caracteres de controle e espaços repetidos; limita tamanho. */
export function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

/** Forma comparável: minúsculas, sem acentos e sem pontuação. */
export function foldText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STREET_PREFIXES: Record<string, string> = {
  r: "rua", "r.": "rua", av: "avenida", "av.": "avenida", al: "alameda", "al.": "alameda",
  tv: "travessa", "tv.": "travessa", trav: "travessa", pc: "praca", "pç": "praca", "pca": "praca",
  est: "estrada", rod: "rodovia", lgo: "largo",
};

/** Normaliza o nome da rua para comparação (ex.: "R. das Flores" ≈ "Rua das Flores"). */
export function streetKey(street: string | null | undefined): string {
  const folded = foldText(street);
  if (!folded) return "";
  const parts = folded.split(" ");
  const first = STREET_PREFIXES[parts[0]] ?? parts[0];
  return [first, ...parts.slice(1)].join(" ");
}

export function normalizeCep(value: unknown): { cep: string | null; invalid: boolean } {
  const text = cleanText(value, 20);
  if (!text) return { cep: null, invalid: false };
  const digits = text.replace(/\D/g, "");
  if (digits.length !== 8) return { cep: null, invalid: true };
  return { cep: `${digits.slice(0, 5)}-${digits.slice(5)}`, invalid: false };
}

/**
 * Mantém apenas telefones brasileiros plausíveis exatamente como lidos.
 * Nunca completa dígitos ausentes.
 */
export function normalizePhone(value: unknown): string | null {
  const text = cleanText(value, 40);
  if (!text) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (digits.startsWith("0")) return null;
  return digits;
}

export function formatPhone(digits: string): string {
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return digits;
}

export function normalizeUf(value: unknown): string | null {
  const text = cleanText(value, 30);
  if (!text) return null;
  const up = foldText(text).toUpperCase().replace(/\s/g, "");
  return (BR_UFS as readonly string[]).includes(up) ? up : null;
}

/** Número da porta como lido; "s/n" vira null (sem número). */
export function normalizeNumber(value: unknown): string | null {
  const text = cleanText(value, 20);
  if (!text) return null;
  if (/^s\.?\s*\/?\s*n\.?$/i.test(text) || /^sem n(u|ú)mero$/i.test(text)) return null;
  return text;
}

/** Linha principal: "Rua X, 123 - Bairro". */
export function formatAddressLine(a: Pick<AddressFields, "street" | "number" | "neighborhood">): string {
  const main = [a.street, a.number].filter(Boolean).join(", ");
  return [main, a.neighborhood].filter(Boolean).join(" - ");
}

/** Endereço completo usado na busca de localização. */
export function formatAddressQuery(a: AddressFields): string {
  const cityUf = [a.city, a.uf].filter(Boolean).join(" - ");
  return [formatAddressLine(a), cityUf, a.cep, "Brasil"].filter(Boolean).join(", ");
}

export function sameStreetAddress(
  a: Pick<AddressFields, "street" | "number">,
  b: Pick<AddressFields, "street" | "number">,
): boolean {
  const sa = streetKey(a.street);
  if (!sa || sa !== streetKey(b.street)) return false;
  return foldText(a.number) === foldText(b.number);
}
