import { sha256Hex } from "@core/dedupe.ts";
import { LIMITS } from "@core/limits.ts";

export type Crop = { x: number; y: number; width: number; height: number }; // frações 0..1
export type Rotation = 0 | 90 | 180 | 270;

export type QualityWarning = "blurry" | "low_resolution";

export type ProcessedImage = {
  blob: Blob;
  sha256: string;
  width: number;
  height: number;
  mime: "image/jpeg";
  warnings: QualityWarning[];
};

export class ImageError extends Error {
  constructor(public code: "unsupported" | "too_large" | "decode_failed", message: string) {
    super(message);
  }
}

export function validateFile(file: File) {
  const okType = (LIMITS.acceptedMimeTypes as readonly string[]).includes(file.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  if (!okType) throw new ImageError("unsupported", "Formato não aceito. Use foto JPG, PNG ou WEBP.");
  if (file.size > LIMITS.maxInputImageBytes) throw new ImageError("too_large", "Arquivo grande demais (máx. 25 MB).");
}

export async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("decode_failed", "Não foi possível abrir esta imagem. Se for HEIC, exporte como JPG ou fotografe pelo app.");
  }
}

/**
 * Aplica rotação/recorte e reduz o tamanho preservando a legibilidade:
 * lado maior até 2.800 px, JPEG de alta qualidade, reduzindo aos poucos só se passar de 4 MB.
 */
export async function processImage(file: Blob, rotation: Rotation = 0, crop: Crop | null = null): Promise<ProcessedImage> {
  const bmp = await decode(file);
  const sx = crop ? Math.round(crop.x * bmp.width) : 0;
  const sy = crop ? Math.round(crop.y * bmp.height) : 0;
  const sw = crop ? Math.max(1, Math.round(crop.width * bmp.width)) : bmp.width;
  const sh = crop ? Math.max(1, Math.round(crop.height * bmp.height)) : bmp.height;
  let scale = Math.min(1, LIMITS.maxImageSide / Math.max(sw, sh));
  let quality = 0.9;
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const rotated = rotation === 90 || rotation === 270;
    const canvas = document.createElement("canvas");
    canvas.width = rotated ? h : w;
    canvas.height = rotated ? w : h;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bmp, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", quality));
    if (blob.size <= LIMITS.maxUploadBytes || attempt === 5) {
      const warnings = assessQuality(canvas);
      bmp.close();
      return { blob, sha256: await sha256Hex(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, mime: "image/jpeg", warnings };
    }
    if (quality > 0.75) quality -= 0.07;
    else scale *= 0.85;
  }
  throw new Error("unreachable");
}

/**
 * Detecção simples: variância do Laplaciano (desfoque) e resolução mínima.
 * É um alerta, nunca um bloqueio — a pessoa sempre pode refazer ou seguir.
 */
export function assessQuality(source: HTMLCanvasElement): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (Math.min(source.width, source.height) < 900) warnings.push("low_resolution");
  const w = 640;
  const h = Math.max(1, Math.round((source.height / source.width) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
      sum += lap; sumSq += lap * lap; n++;
    }
  }
  const variance = sumSq / n - (sum / n) ** 2;
  if (variance < 60) warnings.push("blurry");
  return warnings;
}

export const QUALITY_LABEL: Record<QualityWarning, string> = {
  blurry: "A foto parece desfocada. Se os endereços não estiverem nítidos, fotografe de novo.",
  low_resolution: "A foto tem pouca resolução; o texto pode ficar pequeno demais. Aproxime-se ou fotografe menos notinhas por vez.",
};

export async function fileSha256(file: Blob) {
  return sha256Hex(await file.arrayBuffer());
}
