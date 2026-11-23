/** Limites do produto (configuráveis por variável de ambiente no servidor). */
export const LIMITS = {
  /** pedidos por saída — limite do produto, não do fornecedor */
  maxOrdersPerBatch: 15,
  maxImagesPerBatch: 8,
  /** tamanho máximo do arquivo original escolhido pelo usuário */
  maxInputImageBytes: 25 * 1024 * 1024,
  /** tamanho máximo após compressão, enviado ao servidor */
  maxUploadBytes: 4 * 1024 * 1024,
  /** maior lado da imagem após compressão: preserva legibilidade de notinhas lado a lado */
  maxImageSide: 2800,
  acceptedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  uploadMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  defaultServiceMinutes: 3,
  serviceRadiusKm: 30,
  maxManualOrdersPerBatch: 15,
} as const;
