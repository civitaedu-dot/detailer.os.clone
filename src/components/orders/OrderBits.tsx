import { AlertTriangle, CheckCircle2, MapPinOff, MinusCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAddressLine } from "@core/address.ts";
import { REVIEW_REASON_LABEL } from "@core/types.ts";
import { Badge, Banner, Spinner } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { Backend } from "@/data/backend.ts";
import type { BatchImage, Order } from "@/data/types.ts";

export function OrderStatusBadge({ order }: { order: Order }) {
  switch (order.status) {
    case "ready": return <Badge tone="success" icon={CheckCircle2}>Pronto</Badge>;
    case "needs_review": return <Badge tone="warn" icon={AlertTriangle}>Precisa revisar</Badge>;
    case "not_found": return <Badge tone="danger" icon={MapPinOff}>Não localizado</Badge>;
    case "excluded": return <Badge tone="neutral" icon={MinusCircle}>Fora desta saída</Badge>;
  }
}

export function orderTitle(o: Order) {
  return o.orderCode ? `Pedido ${o.orderCode}` : o.recipientName ?? "Pedido sem número";
}

export function addressLine(o: Order) {
  return formatAddressLine(o) || o.rawAddressText || "Endereço não lido";
}

export function ReasonList({ order, showInfo = false }: { order: Order; showInfo?: boolean }) {
  const reasons = order.reviewReasons.filter((r) => (r === "city_inferred" ? showInfo : order.status !== "ready" && order.status !== "excluded"));
  if (!reasons.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <li key={r} className={r === "city_inferred" ? "rounded-md bg-sunken px-2 py-1 text-[12px] text-ink-2" : "rounded-md bg-warn-soft px-2 py-1 text-[12px] font-semibold text-warn"}>
          {REVIEW_REASON_LABEL[r]}
        </li>
      ))}
    </ul>
  );
}

/** Mostra a foto original com o trecho da notinha destacado (quando a posição é confiável). */
export function SourcePhotoSheet({ backend, image, order, open, onOpenChange }: {
  backend: Backend; image: BatchImage | null; order: Order | null; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !image) return;
    let revoke: string | null = null;
    setUrl(null); setErr(null);
    backend.imageUrl(image).then((u) => { setUrl(u); if (u.startsWith("blob:")) revoke = u; }).catch((e) => setErr(e instanceof Error ? e.message : "Foto indisponível."));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [open, image, backend]);
  const r = order?.region;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Foto da notinha" description={order?.rawAddressText ? `Lido: “${order.rawAddressText}”` : undefined} wide>
      {!image ? <Banner tone="info">Este pedido não tem foto (incluído manualmente ou foto excluída).</Banner>
        : err ? <Banner tone="danger">{err}</Banner>
        : !url ? <div className="grid h-48 place-items-center"><Spinner /></div>
        : (
          <div className="space-y-3">
          {r && image.width && image.height && (
            <figure>
              <figcaption className="mb-1 text-[13px] font-semibold text-ink-2">Trecho desta notinha</figcaption>
              <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-lg border-2 border-lime bg-sunken"
                style={{ aspectRatio: `${r.width * image.width} / ${r.height * image.height}` }}>
                <img src={url} alt="Trecho ampliado da notinha" className="absolute max-w-none"
                  style={{ width: `${100 / r.width}%`, left: `${(-r.x / r.width) * 100}%`, top: `${(-r.y / r.height) * 100}%` }} />
              </div>
            </figure>
          )}
          <div className="relative mx-auto w-fit">
            <img src={url} alt="Foto das notinhas" className="max-h-[65dvh] w-auto rounded-lg" />
            {r && <div className="pointer-events-none absolute rounded border-[3px] border-lime shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` }} aria-label="Trecho da notinha" />}
          </div>
          </div>
        )}
      {image && url && !r && <p className="mt-2 text-[13px] text-ink-3">A posição exata da notinha na foto não foi identificada com segurança.</p>}
    </Sheet>
  );
}
