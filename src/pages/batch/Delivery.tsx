import { ArrowLeft, Check, ChevronDown, CircleSlash, Clock3, Flag, Home, Info, List, MapPinned, Navigation, Phone, RotateCcw, Shuffle, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { formatPhone } from "@core/address.ts";
import { buildMultiStopUrl, buildNavigationUrl, multiStopCapacity } from "@core/mapsUrl.ts";
import { deriveProgress } from "@core/progress.ts";
import { FAILURE_REASON_LABEL, type FailureReason } from "@core/types.ts";
import { RouteMap } from "@/components/map/RouteMap.tsx";
import type { MapStop } from "@/components/map/types.ts";
import { addressLine, orderTitle } from "@/components/orders/OrderBits.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, Banner, Card, ErrorState, LoadingState } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { enqueueEvents, pendingEvents, syncEvents } from "@/data/offlineQueue.ts";
import { toCoreEvent } from "@/data/outcomes.ts";
import { useApp } from "@/data/session.tsx";
import type { Order, StopEventRow } from "@/data/types.ts";
import { fmtTime } from "@/lib/format.ts";
import { getCurrentPosition } from "@/lib/geolocation.ts";
import { useBundle } from "@/lib/useBundle.ts";
import { useOnline } from "@/lib/useOnline.ts";
import { cn, uuid } from "@/lib/utils.ts";

const navKey = (batchId: string) => `rp:nav:${batchId}`;

export function Delivery() {
  const { id = "" } = useParams();
  const { backend, user, ctx } = useApp();
  const nav = useNavigate();
  const online = useOnline();
  const { bundle, error, loading, reload, fromCache } = useBundle(id, { cache: true });
  const [local, setLocal] = useState<StopEventRow[]>([]);
  const [failFor, setFailFor] = useState<Order | null>(null);
  const [showList, setShowList] = useState(false);
  const [returnedFromMaps, setReturnedFromMaps] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Retomada ao voltar do Maps / trocar de app: estado vem dos registros, nunca da navegação
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const raw = sessionStorage.getItem(navKey(id));
      if (raw) setReturnedFromMaps(true);
      void syncEvents(backend, user.id);
    };
    document.addEventListener("visibilitychange", onVis);
    if (sessionStorage.getItem(navKey(id))) setReturnedFromMaps(true);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [backend, id, user.id]);

  const events = useMemo(() => {
    const all = [...(bundle?.events ?? []), ...pendingEvents(user.id).filter((e) => e.batchId === id), ...local];
    const seen = new Set<string>();
    return all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  }, [bundle, local, user.id, id]);

  const ordersById = useMemo(() => new Map((bundle?.orders ?? []).map((o) => [o.id, o])), [bundle]);
  const routeOrderIds = useMemo(() => {
    if (!bundle) return [];
    const inRoute = bundle.stops.map((s) => s.orderId);
    const set = new Set(inRoute);
    // pedidos concluídos que ficaram fora de uma rota reorganizada continuam contando
    const outside = bundle.orders.filter((o) => o.status === "ready" && !set.has(o.id) && events.some((e) => e.orderId === o.id)).map((o) => o.id);
    return [...inRoute, ...outside];
  }, [bundle, events]);
  const progress = useMemo(() => deriveProgress(routeOrderIds, events.map(toCoreEvent)), [routeOrderIds, events]);

  const record = useCallback(async (order: Order, kind: StopEventRow["kind"], reason: string | null = null, undoes: string | null = null) => {
    const ev: StopEventRow = { id: uuid(), batchId: id, orderId: order.id, kind, reason, undoesEventId: undoes, occurredAt: new Date().toISOString() };
    enqueueEvents(user.id, [ev]);
    setLocal((cur) => [...cur, ev]);
    sessionStorage.removeItem(navKey(id));
    setReturnedFromMaps(false);
    const r = await syncEvents(backend, user.id);
    return { ev, synced: !r.failed };
  }, [backend, id, user.id]);

  if (loading && !bundle) return <LoadingState label="Carregando entregas…" />;
  if (error || !bundle) return <ErrorState message={error?.message} onRetry={reload} offline={!online} />;
  if (!bundle.route) {
    return <ErrorState title="Rota ainda não calculada" message="Organize a rota antes de iniciar as entregas." onRetry={() => nav(`/app/lote/${id}/rota`)} />;
  }

  const next = progress.nextOrderId ? ordersById.get(progress.nextOrderId) ?? null : null;
  const stopIndex = (oid: string) => bundle.stops.find((s) => s.orderId === oid)?.stopGroup;
  const sameStop = next ? progress.queue.map((q) => ordersById.get(q)!).filter((o) => o && o.id !== next.id && stopIndex(o.id) === stopIndex(next.id)) : [];
  const concluded = progress.delivered + progress.failed;
  const travelMode = ctx.preferences.mapsTravelMode;
  const r = bundle.route;

  // próximas localizações distintas para o link com várias paradas
  const nextLocations: Array<{ lat: number; lng: number }> = [];
  for (const oid of progress.queue) {
    const o = ordersById.get(oid);
    if (!o || o.lat === null || o.lng === null) continue;
    if (!nextLocations.some((p) => p.lat === o.lat && p.lng === o.lng)) nextLocations.push({ lat: o.lat, lng: o.lng });
    if (nextLocations.length === multiStopCapacity()) break;
  }
  const multiUrl = nextLocations.length >= 2 ? buildMultiStopUrl(nextLocations, { travelMode }) : null;

  async function act(kind: "delivered" | "deferred", order: Order) {
    const { ev, synced } = await record(order, kind);
    toast(kind === "delivered" ? `${orderTitle(order)} entregue` : `${orderTitle(order)} vai para o fim da fila`, {
      description: synced ? undefined : "Salvo no aparelho; será enviado ao reconectar.",
      action: { label: "Desfazer", onClick: () => void record(order, "undo", null, ev.id) },
      duration: 8000,
    });
  }

  async function reorganize() {
    setBusy("reorg");
    try {
      let origin: { lat: number; lng: number } | null = null;
      try { const p = await getCurrentPosition(); origin = { lat: p.lat, lng: p.lng }; }
      catch {
        const lastDone = [...events].reverse().find((e) => e.kind === "delivered" || e.kind === "failed");
        const o = lastDone ? ordersById.get(lastDone.orderId) : null;
        origin = o?.lat != null && o.lng != null ? { lat: o.lat, lng: o.lng } : { lat: r.originLat, lng: r.originLng };
        toast.info("Sem localização atual: a nova ordem parte da última entrega registrada.");
      }
      await backend.plan(id, { mode: r.mode, serviceMinutes: bundle!.batch.serviceMinutes, startFrom: "current", origin, onlyOrderIds: progress.queue });
      await reload();
      toast.success("Paradas restantes reorganizadas.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível reorganizar.");
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    setBusy("finish");
    try {
      await syncEvents(backend, user.id);
      if (pendingEvents(user.id).some((e) => e.batchId === id)) throw new Error("Ainda há registros aguardando envio. Conecte-se para encerrar.");
      await backend.setBatchStatus(id, "completed");
      nav(`/app/lote/${id}/resumo`, { replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível encerrar.");
    } finally {
      setBusy(null);
    }
  }

  const mapStops: MapStop[] = [];
  bundle.stops.forEach((s) => {
    const o = ordersById.get(s.orderId);
    if (!o || o.lat === null || o.lng === null || mapStops.some((m) => m.lat === o.lat && m.lng === o.lng)) return;
    const st = progress.statusByOrder[o.id];
    mapStops.push({ id: o.id, lat: o.lat, lng: o.lng, label: String(s.stopGroup + 1), title: orderTitle(o),
      state: next && (o.id === next.id || stopIndex(o.id) === stopIndex(next.id)) ? "next" : st === "delivered" ? "done" : st === "failed" ? "failed" : st === "deferred" ? "deferred" : "pending" });
  });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3 md:px-8">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar para o início"><Link to="/app"><ArrowLeft aria-hidden /></Link></Button>
        <div className="min-w-0 flex-1">
          <p className="tabular text-[17px] font-extrabold">{concluded} de {progress.total} entregas concluídas</p>
          <p className="text-[13px] text-ink-2">{progress.delivered} entregues{progress.failed ? ` · ${progress.failed} sem sucesso` : ""}{progress.queue.length ? ` · ${progress.queue.length} restantes` : ""}</p>
        </div>
        <Button asChild variant="ghost" size="icon" aria-label="Ver rota completa"><Link to={`/app/lote/${id}/rota`}><MapPinned aria-hidden /></Link></Button>
      </header>
      <div className="mx-4 h-2 overflow-hidden rounded-full bg-sunken md:mx-8" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={concluded} aria-label="Entregas concluídas">
        <div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? (concluded / progress.total) * 100 : 0}%` }} />
      </div>

      <div className="space-y-4 px-4 pb-10 pt-4 md:px-8">
        {fromCache && <Banner tone="info">Sem conexão: mostrando a rota salva no aparelho ({fmtTime(fromCache)}). Registros continuam funcionando.</Banner>}
        {returnedFromMaps && next && (
          <Banner tone="info" icon={Info} title="Voltou do Maps?">Abrir a navegação não conclui a entrega. Registre o resultado abaixo quando terminar.</Banner>
        )}

        {next ? (
          <Card className="overflow-hidden border-graphite">
            <div className="bg-graphite px-4 pb-4 pt-3 text-white">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold uppercase tracking-wide text-lime">Próxima parada · {(stopIndex(next.id) ?? 0) + 1}</p>
                {progress.statusByOrder[next.id] === "deferred" && <Badge tone="warn" icon={Clock3}>Adiada</Badge>}
              </div>
              <p className="mt-1 text-[15px] font-semibold text-white/85">{orderTitle(next)}{next.recipientName && next.orderCode ? ` · ${next.recipientName}` : ""}</p>
              <p className="mt-1 text-[24px] font-extrabold leading-tight">{addressLine(next)}</p>
              {(next.complement || next.city) && <p className="mt-1 text-[16px] text-white/85">{[next.complement, next.city].filter(Boolean).join(" · ")}</p>}
              {next.reference && <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-[15px]"><strong>Referência:</strong> {next.reference}</p>}
              {next.instructions && <p className="mt-2 rounded-lg bg-white/10 px-3 py-2 text-[15px]"><strong>Obs.:</strong> {next.instructions}</p>}
              {sameStop.length > 0 && <p className="mt-2 text-[14px] text-lime">Mesmo endereço: também {sameStop.map(orderTitle).join(", ")} (registre cada um)</p>}
            </div>
            <div className="space-y-2 p-3">
              {next.lat !== null && next.lng !== null && (
                <Button asChild size="xl" block>
                  <a href={buildNavigationUrl({ destination: { lat: next.lat, lng: next.lng }, travelMode })} target="_blank" rel="noopener noreferrer"
                    onClick={() => sessionStorage.setItem(navKey(id), JSON.stringify({ orderId: next.id, at: Date.now() }))}>
                    <Navigation aria-hidden />Navegar no Google Maps
                  </a>
                </Button>
              )}
              {next.phone && (
                <Button asChild variant="secondary" size="lg" block><a href={`tel:+55${next.phone}`}><Phone aria-hidden />Ligar {formatPhone(next.phone)}</a></Button>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button size="xl" variant="dark" className="col-span-2" onClick={() => act("delivered", next)}><Check aria-hidden />Entregue</Button>
                <Button size="lg" variant="warn" className="leading-tight" onClick={() => act("deferred", next)}><Clock3 aria-hidden />Voltar depois</Button>
                <Button size="lg" variant="danger" className="leading-tight" onClick={() => setFailFor(next)}><CircleSlash aria-hidden />Não foi possível entregar</Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="space-y-3 p-5 text-center">
            <Flag className="mx-auto size-10 text-brand" aria-hidden />
            <p className="text-xl font-extrabold">Todas as paradas resolvidas</p>
            <p className="text-ink-2">{progress.delivered} entregues · {progress.failed} sem sucesso</p>
            {r.mode === "closed" && r.endLat !== null && r.endLng !== null && (
              <Button asChild variant="secondary" size="lg" block>
                <a href={buildNavigationUrl({ destination: { lat: r.endLat, lng: r.endLng }, travelMode })} target="_blank" rel="noopener noreferrer"><Home aria-hidden />Voltar para a base no Maps</a>
              </Button>
            )}
            <Button size="xl" block loading={busy === "finish"} onClick={finish} disabled={!online}>{online ? "Encerrar saída" : "Encerrar saída (precisa de internet)"}</Button>
          </Card>
        )}

        {progress.lastUndoable && (
          <Button variant="ghost" block onClick={() => { const e = progress.lastUndoable!; const o = ordersById.get(e.orderId); if (o) void record(o, "undo", null, e.id).then(() => toast.success("Registro desfeito.")); }}>
            <Undo2 aria-hidden />Desfazer último registro ({orderTitle(ordersById.get(progress.lastUndoable.orderId)!)} · {progress.lastUndoable.kind === "delivered" ? "entregue" : progress.lastUndoable.kind === "failed" ? "sem sucesso" : "adiado"})
          </Button>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {multiUrl && next && (
            <Button asChild variant="secondary" block>
              <a href={multiUrl} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden />Abrir as próximas {nextLocations.length} paradas no Maps</a>
            </Button>
          )}
          {progress.queue.length > 1 && (
            <Button variant="secondary" block loading={busy === "reorg"} disabled={!online} onClick={reorganize}>
              <Shuffle aria-hidden />{online ? "Reorganizar paradas restantes" : "Reorganizar (precisa de internet)"}
            </Button>
          )}
        </div>
        <p className="text-[13px] text-ink-3">O Maps faz a navegação guiada e pode escolher outro caminho; a ordem das paradas e as conclusões ficam aqui no app.{multiUrl ? " O link com várias paradas abre no máximo 4 destinos para não perder nenhum." : ""}</p>

        <section className="rounded-2xl border border-line bg-surface">
          <button type="button" onClick={() => setShowList(!showList)} aria-expanded={showList} className="flex min-h-14 w-full items-center justify-between px-4 font-semibold">
            <span className="inline-flex items-center gap-2"><List className="size-5" aria-hidden />Todas as paradas</span>
            <ChevronDown className={cn("size-5 transition-transform", showList && "rotate-180")} aria-hidden />
          </button>
          {showList && (
            <div className="space-y-3 border-t border-line p-3">
              <RouteMap className="h-64" ariaLabel="Mapa das paradas" origin={{ lat: r.originLat, lng: r.originLng }} stops={mapStops}
                path={[{ lat: r.originLat, lng: r.originLng }, ...mapStops]} encodedPolylines={r.polylines} />
              <ol className="divide-y divide-line">
                {routeOrderIds.map((oid) => {
                  const o = ordersById.get(oid);
                  if (!o) return null;
                  const st = progress.statusByOrder[oid];
                  return (
                    <li key={oid} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="font-semibold">{(stopIndex(oid) ?? 0) + 1}. {orderTitle(o)}</p>
                        <p className="truncate text-[14px] text-ink-2">{addressLine(o)}</p>
                      </div>
                      {st === "delivered" ? <Badge tone="success" icon={Check}>Entregue</Badge>
                        : st === "failed" ? <Badge tone="danger" icon={CircleSlash}>Sem sucesso</Badge>
                        : st === "deferred" ? <Badge tone="warn" icon={RotateCcw}>Depois</Badge>
                        : oid === next?.id ? <Badge tone="dark" icon={Navigation}>Agora</Badge>
                        : <Badge>Pendente</Badge>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      </div>

      <Sheet open={!!failFor} onOpenChange={(v) => !v && setFailFor(null)} title="Não foi possível entregar" description={failFor ? orderTitle(failFor) : undefined}>
        <div className="grid gap-2">
          {(Object.keys(FAILURE_REASON_LABEL) as FailureReason[]).map((k) => (
            <Button key={k} variant="secondary" size="lg" className="justify-start" onClick={async () => {
              const o = failFor!;
              setFailFor(null);
              const { ev } = await record(o, "failed", k);
              toast(`${orderTitle(o)}: ${FAILURE_REASON_LABEL[k]}`, { action: { label: "Desfazer", onClick: () => void record(o, "undo", null, ev.id) }, duration: 8000 });
            }}>{FAILURE_REASON_LABEL[k]}</Button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
