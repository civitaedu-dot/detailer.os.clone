import { ArrowDown, ArrowUp, GripVertical, ListOrdered, Navigation, RefreshCw, Settings2, Undo2 } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { formatDistance, formatDuration } from "@core/geo.ts";
import { DRIVE_FALLBACK_NOTICE, TWO_WHEELER_NOTICE } from "@core/notices.ts";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { RouteMap } from "@/components/map/RouteMap.tsx";
import type { MapStop } from "@/components/map/types.ts";
import { addressLine, orderTitle } from "@/components/orders/OrderBits.tsx";
import { OrderEditor } from "@/components/orders/OrderEditor.tsx";
import { OriginSheet, type OriginChoice } from "@/components/orders/OriginSheet.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Card, ErrorState, Field, LoadingState, Select, Stat } from "@/components/ui/primitives.tsx";
import { useApp } from "@/data/session.tsx";
import type { BatchBundle, Member, Order } from "@/data/types.ts";
import { useAsync } from "@/lib/useAsync.ts";
import { useBundle } from "@/lib/useBundle.ts";
import { useOnline } from "@/lib/useOnline.ts";
import { cn, plural } from "@/lib/utils.ts";

export type StopGroup = { group: number; orders: Order[]; legDurationS: number | null; legDistanceM: number | null; etaOffsetS: number | null };

export function groupStops(b: BatchBundle): StopGroup[] {
  const byId = new Map(b.orders.map((o) => [o.id, o]));
  const groups: StopGroup[] = [];
  for (const s of b.stops) {
    const o = byId.get(s.orderId);
    if (!o) continue;
    const last = groups[groups.length - 1];
    if (last && last.group === s.stopGroup) last.orders.push(o);
    else groups.push({ group: s.stopGroup, orders: [o], legDurationS: s.legDurationS, legDistanceM: s.legDistanceM, etaOffsetS: s.etaOffsetS });
  }
  return groups;
}

export function methodLabel(b: BatchBundle) {
  const r = b.route!;
  if (r.method === "manual") return "Ordem definida manualmente";
  if (r.simulated) return "Sequência sugerida · simulação em linha reta";
  return "Rota otimizada pelas ruas · estimativa";
}

export function RoutePlan() {
  const { id = "" } = useParams();
  const { backend, isManager, user } = useApp();
  const nav = useNavigate();
  const online = useOnline();
  const { bundle, error, loading, reload } = useBundle(id, { cache: true });
  const members = useAsync<Member[]>(() => (isManager ? backend.listMembers() : Promise.resolve([])), [backend, isManager]);
  const [reorder, setReorder] = useState<StopGroup[] | null>(null);
  const [origin, setOrigin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const groups = useMemo(() => (bundle?.route ? groupStops(bundle) : []), [bundle]);
  const shown = reorder ?? groups;

  if (loading && !bundle) return <LoadingState label="Carregando rota…" />;
  if (error || !bundle) return <ErrorState message={error?.message} onRetry={reload} offline={!online} />;

  const ready = bundle.orders.filter((o) => o.status === "ready");
  const routeIds = new Set(bundle.stops.map((s) => s.orderId));
  const stale = !!bundle.route && (ready.length !== routeIds.size || ready.some((o) => !routeIds.has(o.id)));
  const blocking = bundle.orders.filter((o) => o.status === "needs_review" || o.status === "not_found");

  async function plan(opts: Partial<OriginChoice> & { manual?: string[] }) {
    setBusy("plan");
    try {
      await backend.plan(id, {
        mode: (opts.returnToBase ?? bundle!.batch.returnToBase) ? "closed" : "open",
        serviceMinutes: opts.serviceMinutes ?? bundle!.batch.serviceMinutes,
        startFrom: opts.startFrom ?? bundle!.batch.startFrom,
        origin: opts.origin ?? (bundle!.route ? { lat: bundle!.route.originLat, lng: bundle!.route.originLng } : null),
        manualOrderIds: opts.manual,
      });
      setReorder(null);
      setOrigin(false);
      await reload();
      toast.success("Rota recalculada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível recalcular.");
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("start");
    try {
      if (online && bundle!.batch.status !== "in_progress") await backend.setBatchStatus(id, "in_progress");
    } catch { /* sem conexão: o primeiro registro coloca o lote em andamento */ }
    setBusy(null);
    nav(`/app/lote/${id}/entrega`);
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= shown.length) return;
    const next = [...shown];
    const [g] = next.splice(from, 1);
    next.splice(to, 0, g);
    setReorder(next);
  };

  if (!bundle.route) {
    return (
      <>
        <PageHeader title="Rota" back="/app" />
        <PageBody className="space-y-4">
          {blocking.length ? (
            <Banner tone="warn" title="Há pedidos para resolver" action={<Button asChild variant="secondary"><Link to={`/app/lote/${id}/enderecos`}>Revisar endereços</Link></Button>}>
              {plural(blocking.length, "pedido precisa", "pedidos precisam")} de decisão antes de organizar a rota.
            </Banner>
          ) : (
            <Card className="space-y-3 p-4">
              <p className="font-semibold">{plural(ready.length, "pedido pronto", "pedidos prontos")} para organizar.</p>
              <Button size="lg" block onClick={() => setOrigin(true)} disabled={!online || !ready.length}>Organizar rota</Button>
            </Card>
          )}
        </PageBody>
        <OriginSheet open={origin} onOpenChange={setOrigin} base={bundle.base} defaults={bundle.batch} busy={busy === "plan"} onConfirm={(c) => plan(c)} />
      </>
    );
  }

  const r = bundle.route;
  const mapStops: MapStop[] = shown.map((g, i) => ({ id: g.orders[0].id, lat: g.orders[0].lat!, lng: g.orders[0].lng!, label: String(i + 1), state: i === 0 ? "next" : "pending", title: g.orders.map(orderTitle).join(", ") }));
  const path = [{ lat: r.originLat, lng: r.originLng }, ...mapStops, ...(r.endLat !== null && r.endLng !== null ? [{ lat: r.endLat, lng: r.endLng }] : [])];
  const warnings = r.warnings.filter((w) => w !== TWO_WHEELER_NOTICE && w !== DRIVE_FALLBACK_NOTICE);
  const editingOrder = bundle.orders.find((o) => o.id === editing) ?? null;

  return (
    <>
      <PageHeader title="Rota pronta" subtitle={methodLabel(bundle)} back="/app"
        actions={<Button variant="secondary" size="icon" aria-label="Ajustar saída" onClick={() => setOrigin(true)} disabled={!online}><Settings2 aria-hidden /></Button>} />
      <PageBody className="space-y-4 pb-40 md:pb-10">
        <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Paradas" value={groups.length} hint={plural(routeIds.size, "pedido", "pedidos")} />
          <Stat label="Distância" value={formatDistance(r.distanceM)} hint={r.mode === "closed" ? "com retorno" : "até a última"} />
          <Stat label="Deslocamento" value={formatDuration(r.travelS)} hint="estimado" />
          <Stat label="Total estimado" value={formatDuration(r.totalS)} hint={`inclui ${Math.round(r.serviceS / 60)} min de atendimento`} />
        </Card>
        <p className="text-[13px] text-ink-3">
          Saída: {bundle.batch.startFrom === "base" && bundle.base ? bundle.base.name : "localização no momento do cálculo"} · {r.mode === "closed" ? "volta à base" : "termina na última entrega"}.
          Valores são estimativas de planejamento{r.travelMode === "TWO_WHEELER" ? " com perfil de moto" : r.travelMode === "DRIVE" ? " com perfil de carro" : ""}.
        </p>
        {r.simulated && <Banner tone="warn" title="Simulação">Distâncias e tempos aproximados em linha reta, sem ruas, sentidos ou trânsito. A sequência é só uma sugestão.</Banner>}
        {r.travelMode === "TWO_WHEELER" && <Banner tone="info">{TWO_WHEELER_NOTICE}</Banner>}
        {r.travelMode === "DRIVE" && <Banner tone="warn">{DRIVE_FALLBACK_NOTICE}</Banner>}
        {warnings.filter((w) => !/^Simulação/.test(w)).map((w) => <Banner key={w} tone="warn">{w}</Banner>)}
        {r.originalTravelS !== null && r.originalTravelS > r.travelS && r.method !== "manual" && (
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-[14px] text-brand-strong">
            Estimativa nas mesmas condições: {formatDuration(r.originalTravelS)} de deslocamento na ordem das notinhas e {formatDuration(r.travelS)} nesta sequência.
          </p>
        )}
        {stale && (
          <Banner tone="warn" title="Pedidos mudaram depois do cálculo" action={<Button variant="secondary" loading={busy === "plan"} disabled={!online || blocking.length > 0} onClick={() => plan({})}><RefreshCw aria-hidden />Recalcular</Button>}>
            {blocking.length ? "Resolva os pedidos pendentes e recalcule." : "Recalcule para incluir as alterações."}
          </Banner>
        )}

        {isManager && (members.data?.length ?? 0) > 1 && (
          <Field label="Entregador">
            {(fid) => (
              <Select id={fid} value={bundle.batch.assignedDriverId ?? ""} onChange={async (e) => {
                try { await backend.assignDriver(id, e.target.value || null); await reload(); toast.success("Entregador atualizado."); }
                catch (err) { toast.error(err instanceof Error ? err.message : "Não foi possível atribuir."); }
              }}>
                <option value="">Sem entregador</option>
                {members.data!.map((m) => <option key={m.userId} value={m.userId}>{m.displayName ?? "Entregador"}{m.userId === user.id ? " (eu)" : ""}</option>)}
              </Select>
            )}
          </Field>
        )}

        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <RouteMap className="h-72 lg:sticky lg:top-16 lg:h-[560px]" ariaLabel="Mapa da rota com paradas numeradas" origin={{ lat: r.originLat, lng: r.originLng }}
            end={r.endLat !== null && r.endLng !== null ? { lat: r.endLat, lng: r.endLng } : null} stops={mapStops} path={path}
            encodedPolylines={reorder ? undefined : r.polylines} onStopClick={(oid) => setEditing(oid)} />

          <section aria-label="Paradas na ordem" className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">Paradas na ordem</h2>
              {reorder ? (
                <Button variant="ghost" onClick={() => setReorder(null)}><Undo2 aria-hidden />Desfazer</Button>
              ) : (
                <Button variant="ghost" onClick={() => setReorder(groups)} disabled={!online}><ListOrdered aria-hidden />Reordenar</Button>
              )}
            </div>
            {reorder && <p className="text-[14px] text-ink-2">Use as setas (ou arraste) e depois toque em “Recalcular com esta ordem”.</p>}
            <ol className="space-y-2">
              {shown.map((g, i) => (
                <li key={g.orders[0].id} draggable={!!reorder}
                  onDragStart={() => setDrag(i)} onDragOver={(e: DragEvent) => { e.preventDefault(); }} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
                  className={cn("flex gap-3 rounded-2xl border border-line bg-surface p-3", reorder && "cursor-grab")}>
                  <div className="flex flex-col items-center gap-1">
                    <span className="grid size-10 place-items-center rounded-full bg-graphite text-[16px] font-extrabold text-white">{i + 1}</span>
                    {reorder && <GripVertical className="size-5 text-ink-3" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {g.orders.map((o) => (
                      <button key={o.id} type="button" onClick={() => setEditing(o.id)} className="block w-full text-left">
                        <p className="font-semibold">{orderTitle(o)}{o.recipientName && o.orderCode ? <span className="font-normal text-ink-2"> · {o.recipientName}</span> : null}</p>
                        <p className="text-[14px] text-ink-2">{addressLine(o)}{o.complement ? ` · ${o.complement}` : ""}</p>
                      </button>
                    ))}
                    {g.orders.length > 1 && <p className="text-[13px] text-info">Mesmo endereço: {g.orders.length} entregas separadas</p>}
                    {!reorder && g.etaOffsetS !== null && <p className="tabular text-[13px] text-ink-3">≈ {formatDuration(g.etaOffsetS)} após a saída{g.legDistanceM ? ` · ${formatDistance(g.legDistanceM)} do ponto anterior` : ""}</p>}
                  </div>
                  {reorder && (
                    <div className="flex flex-col gap-1">
                      <Button variant="secondary" size="icon" aria-label={`Subir parada ${i + 1}`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp aria-hidden /></Button>
                      <Button variant="secondary" size="icon" aria-label={`Descer parada ${i + 1}`} disabled={i === shown.length - 1} onClick={() => move(i, i + 1)}><ArrowDown aria-hidden /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {r.method === "manual" && !reorder && (
              <Button variant="ghost" block loading={busy === "plan"} disabled={!online} onClick={() => plan({})}>Voltar para a sequência sugerida</Button>
            )}
          </section>
        </div>
      </PageBody>

      <div className="safe-bottom fixed inset-x-0 bottom-[64px] z-30 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:static md:mx-8 md:mb-8 md:rounded-2xl md:border">
        {reorder ? (
          <Button size="xl" block variant="dark" loading={busy === "plan"} onClick={() => plan({ manual: reorder.flatMap((g) => g.orders.map((o) => o.id)) })}>
            <RefreshCw aria-hidden />Recalcular com esta ordem
          </Button>
        ) : (
          <Button size="xl" block loading={busy === "start"} disabled={stale} onClick={start}>
            <Navigation aria-hidden />{bundle.batch.status === "in_progress" ? "Continuar entregas" : "Iniciar entregas"}
          </Button>
        )}
      </div>

      <OriginSheet open={origin} onOpenChange={setOrigin} base={bundle.base} defaults={bundle.batch} busy={busy === "plan"} title="Ajustar saída" onConfirm={(c) => plan(c)} />
      <OrderEditor backend={backend} order={editingOrder} image={editingOrder?.sourceImageId ? bundle.images.find((i) => i.id === editingOrder.sourceImageId) ?? null : null}
        base={bundle.base} open={!!editingOrder} onOpenChange={(v) => !v && setEditing(null)} onChanged={reload} />
    </>
  );
}
