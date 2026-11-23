import { AlertTriangle, Camera, Crop as CropIcon, FlaskConical, ImagePlus, Images, PencilLine, RefreshCcw, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { LIMITS } from "@core/limits.ts";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { CropSheet } from "@/components/orders/CropSheet.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Card, Field, Select, Spinner } from "@/components/ui/primitives.tsx";
import { DEMO_PHOTOS } from "@/data/demoFixtures.ts";
import { useApp } from "@/data/session.tsx";
import type { Member } from "@/data/types.ts";
import { saveCaptures } from "@/lib/captureStore.ts";
import { fileSha256, ImageError, processImage, QUALITY_LABEL, validateFile, type Crop, type ProcessedImage, type Rotation } from "@/lib/image.ts";
import { cn, uuid } from "@/lib/utils.ts";

type Item = {
  id: string;
  file: Blob;
  originalSha256: string;
  rotation: Rotation;
  crop: Crop | null;
  originalUrl: string;
  processed: ProcessedImage | null;
  previewUrl: string | null;
  error: string | null;
};

export function NewRoute() {
  const { backend, ctx, user, isManager, config } = useApp();
  const nav = useNavigate();
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const replaceId = useRef<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [cropFor, setCropFor] = useState<Item | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [driver, setDriver] = useState<string>(user.id);
  const [busy, setBusy] = useState(false);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => { if (isManager) backend.listMembers().then(setMembers).catch(() => setMembers([])); }, [backend, isManager]);
  useEffect(() => () => itemsRef.current.forEach((i) => { URL.revokeObjectURL(i.originalUrl); if (i.previewUrl) URL.revokeObjectURL(i.previewUrl); }), []);

  const update = (id: string, patch: Partial<Item>) => setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  async function process(id: string, file: Blob, rotation: Rotation, crop: Crop | null) {
    update(id, { processed: null, error: null });
    try {
      const p = await processImage(file, rotation, crop);
      const url = URL.createObjectURL(p.blob);
      setItems((cur) => cur.map((i) => {
        if (i.id !== id) return i;
        if (i.previewUrl) URL.revokeObjectURL(i.previewUrl);
        return { ...i, processed: p, previewUrl: url };
      }));
    } catch (e) {
      update(id, { error: e instanceof ImageError ? e.message : "Não foi possível preparar esta foto." });
    }
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const list = [...files];
    const replacing = replaceId.current;
    replaceId.current = null;
    for (const f of list) {
      try { validateFile(f); } catch (e) { toast.error(e instanceof Error ? e.message : "Arquivo inválido."); continue; }
      const sha = await fileSha256(f);
      if (itemsRef.current.some((i) => i.originalSha256 === sha && i.id !== replacing)) {
        toast.info("Esta foto já está no lote.");
        continue;
      }
      if (!replacing && itemsRef.current.length >= LIMITS.maxImagesPerBatch) {
        toast.error(`Máximo de ${LIMITS.maxImagesPerBatch} fotos por lote.`);
        break;
      }
      const item: Item = { id: replacing ?? uuid(), file: f, originalSha256: sha, rotation: 0, crop: null, originalUrl: URL.createObjectURL(f), processed: null, previewUrl: null, error: null };
      setItems((cur) => (replacing ? cur.map((i) => (i.id === replacing ? item : i)) : [...cur, item]));
      void process(item.id, f, 0, null);
      if (replacing) break;
    }
  }

  async function addDemoPhotos() {
    const files = await Promise.all(DEMO_PHOTOS.map(async (p) => {
      const blob = await (await fetch(p.file)).blob();
      return new File([blob], p.file.split("/").pop()!, { type: "image/jpeg" });
    }));
    await addFiles(files);
  }

  function remove(id: string) {
    setItems((cur) => {
      const it = cur.find((i) => i.id === id);
      if (it) { URL.revokeObjectURL(it.originalUrl); if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); }
      return cur.filter((i) => i.id !== id);
    });
  }

  async function start(manual = false) {
    setBusy(true);
    try {
      const batch = await backend.createBatch({
        assignedDriverId: isManager ? driver || null : user.id,
        startFrom: ctx.preferences.startFrom, returnToBase: ctx.preferences.returnToBase, serviceMinutes: ctx.preferences.serviceMinutes,
      });
      if (manual) { nav(`/app/lote/${batch.id}/enderecos?incluir=1`); return; }
      await saveCaptures(batch.id, items.filter((i) => i.processed).map((i) => ({
        id: i.id, blob: i.processed!.blob, sha256: i.processed!.sha256, originalSha256: i.originalSha256,
        width: i.processed!.width, height: i.processed!.height, mime: i.processed!.mime, uploadedImageId: null,
      })));
      nav(`/app/lote/${batch.id}/processando`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível iniciar o lote.");
    } finally {
      setBusy(false);
    }
  }

  const ready = items.length > 0 && items.every((i) => i.processed || i.error) && items.some((i) => i.processed);
  const processing = items.some((i) => !i.processed && !i.error);

  return (
    <>
      <PageHeader title="Nova rota" subtitle="Fotografe as notinhas do lote" back="/app" />
      <PageBody className="space-y-5 pb-40 md:pb-10">
        <Card className="flex gap-3 p-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-graphite text-lime"><Images className="size-6" aria-hidden /></div>
          <p className="text-[15px]"><strong>Coloque as notinhas lado a lado, com os endereços visíveis.</strong> Uma foto pode ter várias notinhas; se não couberem, tire mais fotos.</p>
        </Card>

        {backend.mode === "demo" && (
          <Banner tone="info" icon={FlaskConical} title="Demonstração" action={<Button variant="secondary" onClick={addDemoPhotos}><ImagePlus aria-hidden />Usar fotos de exemplo</Button>}>
            Só as fotos de exemplo têm leitura simulada. Fotos suas ficarão como “leitura indisponível” e você poderá incluir os pedidos à mão.
          </Banner>
        )}
        {backend.mode === "real" && config && !config.ocr && (
          <Banner tone="warn" title="Leitura automática não configurada">As fotos serão guardadas, mas os pedidos precisarão ser incluídos manualmente.</Banner>
        )}

        {isManager && members.length > 1 && (
          <Field label="Entregador deste lote">
            {(id) => (
              <Select id={id} value={driver} onChange={(e) => setDriver(e.target.value)}>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.userId === user.id ? `${m.displayName ?? "Eu"} (eu)` : m.displayName ?? "Entregador"}</option>)}
                <option value="">Atribuir depois</option>
              </Select>
            )}
          </Field>
        )}

        <input ref={camRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        <input ref={galRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />

        {items.length > 0 && (
          <section aria-label="Fotos do lote" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, idx) => (
              <Card key={it.id} className="overflow-hidden">
                <div className="relative aspect-[4/3] bg-sunken">
                  {it.previewUrl ? <img src={it.previewUrl} alt={`Foto ${idx + 1}`} className="h-full w-full object-contain" />
                    : it.error ? <div className="grid h-full place-items-center p-4 text-center text-[14px] text-danger">{it.error}</div>
                    : <div className="grid h-full place-items-center"><Spinner label="Preparando foto" /></div>}
                  <span className="absolute left-2 top-2 rounded-md bg-graphite px-2 py-1 text-[13px] font-bold text-white">Foto {idx + 1}</span>
                </div>
                {it.processed?.warnings.map((w) => (
                  <p key={w} className="flex gap-2 border-t border-warn-line/50 bg-warn-soft px-3 py-2 text-[13px] text-warn"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{QUALITY_LABEL[w]}</p>
                ))}
                <div className="grid grid-cols-4 border-t border-line">
                  <IconAction label="Girar" icon={RotateCw} onClick={() => { const r = ((it.rotation + 90) % 360) as Rotation; update(it.id, { rotation: r }); void process(it.id, it.file, r, it.crop); }} disabled={!!it.error} />
                  <IconAction label="Recortar" icon={CropIcon} onClick={() => setCropFor(it)} disabled={!!it.error} />
                  <IconAction label="Refazer" icon={RefreshCcw} onClick={() => { replaceId.current = it.id; camRef.current?.click(); }} />
                  <IconAction label="Remover" icon={Trash2} onClick={() => remove(it.id)} danger />
                </div>
              </Card>
            ))}
          </section>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" variant={items.length ? "secondary" : "primary"} onClick={() => { replaceId.current = null; camRef.current?.click(); }}><Camera aria-hidden />{items.length ? "Tirar outra foto" : "Tirar foto"}</Button>
          <Button size="lg" variant="secondary" onClick={() => { replaceId.current = null; galRef.current?.click(); }}><ImagePlus aria-hidden />Escolher da galeria</Button>
        </div>
        <p className="text-[13px] text-ink-3">A câmera traseira abre quando disponível. Se a câmera estiver bloqueada, use a galeria. Até {LIMITS.maxImagesPerBatch} fotos por lote.</p>

        <Button variant="ghost" block onClick={() => start(true)} disabled={busy}><PencilLine aria-hidden />Sem foto: incluir pedidos manualmente</Button>
      </PageBody>

      {items.length > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-[64px] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mx-8 md:mb-8 md:rounded-2xl md:border">
          <Button size="xl" block onClick={() => start(false)} loading={busy} disabled={!ready || processing}>
            {processing ? "Preparando fotos…" : `Ler notinhas (${items.filter((i) => i.processed).length} ${items.filter((i) => i.processed).length === 1 ? "foto" : "fotos"})`}
          </Button>
        </div>
      )}

      <CropSheet open={!!cropFor} onOpenChange={(v) => !v && setCropFor(null)} src={cropFor?.originalUrl ?? null} initial={cropFor?.crop ?? null}
        onApply={(c) => { if (!cropFor) return; update(cropFor.id, { crop: c }); void process(cropFor.id, cropFor.file, cropFor.rotation, c); }} />
    </>
  );
}

function IconAction({ label, icon: Icon, onClick, disabled, danger }: { label: string; icon: typeof Camera; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold hover:bg-sunken disabled:opacity-40", danger ? "text-danger" : "text-ink-2")}>
      <Icon className="size-5" aria-hidden />{label}
    </button>
  );
}
