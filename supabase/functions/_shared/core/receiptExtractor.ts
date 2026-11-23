import type { RawExtraction } from "./extraction.ts";

export type ExtractorImage = {
  bytes: Uint8Array;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
};

export type ExtractorContext = {
  baseCity: string | null;
  baseUf: string | null;
  restaurantName: string | null;
};

export type ExtractionErrorCode =
  | "not_configured"
  | "provider_error"
  | "invalid_output"
  | "refused"
  | "rate_limited"
  | "unrecognized_image";

export class ExtractionError extends Error {
  constructor(public code: ExtractionErrorCode, message: string, public retryable = false) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Contrato de leitura das notinhas. Trocar de fornecedor (outra IA de visão, OCR dedicado)
 * significa implementar esta interface; o app e o banco não mudam.
 * A saída é sempre validada por RawExtractionSchema e normalizada antes de persistir.
 */
export interface ReceiptExtractor {
  readonly name: string;
  readonly simulated: boolean;
  extract(image: ExtractorImage, context: ExtractorContext): Promise<RawExtraction>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
