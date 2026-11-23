import { del, get, set } from "idb-keyval";

/** Fotos aguardando envio ficam no aparelho até o servidor confirmar (retomada após falha/recarga). */
export type StoredCapture = {
  id: string;
  blob: Blob;
  sha256: string;
  originalSha256: string;
  width: number;
  height: number;
  mime: string;
  uploadedImageId: string | null;
};

const key = (batchId: string) => `rp-capture:${batchId}`;

export async function saveCaptures(batchId: string, items: StoredCapture[]) {
  await set(key(batchId), items);
}
export async function loadCaptures(batchId: string): Promise<StoredCapture[]> {
  return (await get<StoredCapture[]>(key(batchId))) ?? [];
}
export async function markUploaded(batchId: string, captureId: string, imageId: string) {
  const items = await loadCaptures(batchId);
  await set(key(batchId), items.map((i) => (i.id === captureId ? { ...i, uploadedImageId: imageId } : i)));
}
export async function clearCaptures(batchId: string) {
  await del(key(batchId));
}
