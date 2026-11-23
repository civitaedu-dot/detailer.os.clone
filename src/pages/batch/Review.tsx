import { AlertTriangle, ChevronRight, Copy, ListChecks, Plus, Route as RouteIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { locationKey } from "@core/geo.ts";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { ManualOrderSheet } from "@/components/orders/ManualOrderSheet.tsx";
import { addressLine, OrderStatusBadge, orderTitle, ReasonList } from "@/components/orders/OrderBits.tsx";
import { OrderEditor } from "@/components/orders/OrderEditor.tsx";
import { OriginSheet, type OriginChoice } from "@/components/orders/OriginSheet.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, EmptyState, ErrorState, LoadingState, SectionTitle } from "@/components/ui/primitives.tsx";
import { isBlocking } from "@/data/orderRules.ts";
import { useApp } from "@/data/session.tsx";
import type { Order } from "@/data/types.ts";
import { useBundle } from "@/lib/useBundle.ts";
import { useOnline } from "@/lib/useOnline.ts";
import { cn, plural } from "@/lib/utils.ts";

export function Review() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { backend, ctx } = useApp();
  const nav = useNavigate();
  const online = useOnline();
  const { bundle, error, loading, reload } = useBundle(id);
  const [editing, setEditing] = useState<string | null>(null);
  const [manual, setManual] = useState(params.get("incluir") === "1");
  const [origin, setOrigin] = useState(false);
  const [planning, setPlanning] = useState(false);

  useEffect(() => { if (params.get("incluir")) { params.delete("incluir"); setParams(params, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const orders = useMemo(() => bundle?.orders ?? [], [bundle]);
  const attention = orders.filter(isBlocking);
  const ready = orders.filter((o) => o.status === "ready");
  const excluded = orders.filter((o) => o.status === "excluded");
  const sameAddr = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of ready) if (o.lat !== null && o.lng !== null) {
      const k = locationKey({ lat: o.lat, lng: o.lng });
      m.set(k, [...(m.get(k) ?? []), o]);
    }
    return m;
  }, [ready]);

  if (loading && !bundle) return <LoadingState label="Carregando pedidos…" />;
  if (error || !bundle) return <ErrorState message={error?.message} onRetry={reload} offline={!online} />;

  const editingOrder = orders.find((o) => o.id === editing) ?? null;
  const image = editingOrder?.sourceImageId ? bundle.images.find((i) => i.id === editingOrder.sourceImageId) ?? null : null;
  const failedImages = bundle.images.filter((i) => i.status === "failed");
  const limit = 15;

  async function plan(choice: OriginChoice) {
    setPlanning(true);
    try {
      await backend.plan(id, { mode: choice.returnToBase ? "closed" : "open", serviceMinutes: choice.serviceMinutes, startFrom: choice.startFrom, origin: choice.origin });
      nav(`/app/lote/${id}/rota`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível organizar a rota.");
    } finally {
      setPlanning(false);
      setOrigin(false);
    }
  }

  const card = (o: Order) => {
    const group = o.lat !== null && o.lng !== null ? sameAddr.get(locationKey({ lat: o.lat, lng: o.lng })) : undefined;
    const others = group && group.length > 1 ? group.filter((x) => x.id !== o.id) : [];
    return (
      <li key={o.id}>
        <button type="button" onClick={() => setEditing(o.id)}
          className={cn("w-full rounded-2xl border bg-surface p-4 text-left shadow-[var(--shadow-card)] hover:border-ink-3", isBlocking(o) ? "border-warn-line" : "border-line", o.status === "excluded" && "opacity-75")}>
          <div className="flex items-center justify-between gap-2">
            <OrderStatusBadge order={o} />
            <span className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-ink-2">{isBlocking(o) ? "Resolver" : "Detalhes"}<ChevronRight className="size-5" aria-hidden /></span>
          </div>
          <p className="mt-2 font-bold">{orderTitle(o)}{o.recipientName && o.orderCode && <span className="font-normal text-ink-2"> · {o.recipientName}</span>}</p>
          <p className="text-[15px]">{addressLine(o)}</p>
          {(o.complement || o.reference) && <p className="text-[14px] text-ink-2">{[o.complement, o.reference && `Ref.: ${o.reference}`].filter(Boolean).join(" · ")}</p>}
          <ReasonList order={o} />
          {others.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-[13px] text-info"><Copy className="size-4" aria-hidden />Mesmo endereço de {others.map(orderTitle).join(", ")} — mesma parada, entregas separadas</p>}
        </button>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Endereços" back="/app" subtitle={`${plural(orders.length - excluded.length, "pedido", "pedidos")} · ${ready.length} prontos${attention.length ? ` · ${attention.length} para resolver` : ""}`}
        actions={<Button variant="secondary" onClick={() => setManual(true)} aria-label="Incluir pedido"><Plus aria-hidden /><span className="hidden sm:inline">Incluir pedido</span></Button>} />
      <PageBody className="space-y-5 pb-40 md:pb-10">
        {failedImages.length > 0 && (
          <Banner tone="warn" title={`${plural(failedImages.length, "foto não foi lida", "fotos não foram lidas")}`} action={<Button variant="secondary" onClick={() => setManual(true)}><Plus aria-hidden />Incluir manualmente</Button>}>
            {backend.mode === "demo" ? "Na demonstração, só as fotos de exemplo têm leitura simulada." : "Tente fotografar de novo ou inclua os pedidos dessa foto à mão."}
          </Banner>
        )}
        {!orders.length && <EmptyState icon={ListChecks} title="Nenhum pedido neste lote" action={<Button block onClick={() => setManual(true)}><Plus aria-hidden />Incluir pedido</Button>}>Inclua os pedidos manualmente ou fotografe as notinhas.</EmptyState>}

        {attention.length > 0 && (
          <section className="space-y-2" aria-labelledby="t-att">
            <SectionTitle><span id="t-att" className="inline-flex items-center gap-1.5 text-warn"><AlertTriangle className="size-4" aria-hidden />Resolver antes de sair ({attention.length})</span></SectionTitle>
            <p className="text-[14px] text-ink-2">Corrija o endereço, escolha o local, ajuste o pino ou retire o pedido desta saída. Nenhum pedido some sem sua decisão.</p>
            <ul className="space-y-2">{attention.map(card)}</ul>
          </section>
        )}
        {ready.length > 0 && (
          <section className="space-y-2"><SectionTitle>Prontos ({ready.length})</SectionTitle><ul className="space-y-2">{ready.map(card)}</ul></section>
        )}
        {excluded.length > 0 && (
          <section className="space-y-2"><SectionTitle>Fora desta saída ({excluded.length})</SectionTitle><ul className="space-y-2">{excluded.map(card)}</ul></section>
        )}
        {ready.length > limit && <Banner tone="warn">Esta saída tem {ready.length} pedidos; o limite por rota é {limit}. Retire pedidos para outra saída.</Banner>}
      </PageBody>

      <div className="safe-bottom fixed inset-x-0 bottom-[64px] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mx-8 md:mb-8 md:rounded-2xl md:border">
        {attention.length > 0 && <p className="mb-2 text-center text-[14px] font-semibold text-warn">{plural(attention.length, "pedido precisa", "pedidos precisam")} de decisão</p>}
        <Button size="xl" block disabled={attention.length > 0 || ready.length === 0 || ready.length > limit || !online} loading={planning} onClick={() => setOrigin(true)}>
          <RouteIcon aria-hidden />{online ? "Organizar rota" : "Organizar rota (precisa de internet)"}
        </Button>
      </div>

      <OrderEditor backend={backend} order={editingOrder} image={image} base={bundle.base} open={!!editingOrder} onOpenChange={(v) => !v && setEditing(null)} onChanged={reload} />
      <ManualOrderSheet backend={backend} batchId={id} base={bundle.base ?? ctx.base} open={manual} onOpenChange={setManual} onAdded={reload} />
      <OriginSheet open={origin} onOpenChange={setOrigin} base={bundle.base} defaults={{ startFrom: bundle.batch.startFrom, returnToBase: bundle.batch.returnToBase, serviceMinutes: bundle.batch.serviceMinutes }} onConfirm={plan} busy={planning} />
    </>
  );
}
