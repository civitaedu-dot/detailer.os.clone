import { Check, CircleSlash, Clock3, ImageOff, Navigation, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { formatDistance, formatDuration } from "@core/geo.ts";
import { deriveProgress } from "@core/progress.ts";
import { FAILURE_REASON_LABEL, type FailureReason } from "@core/types.ts";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { BATCH_STATUS } from "@/components/orders/BatchCard.tsx";
import { addressLine, orderTitle } from "@/components/orders/OrderBits.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, Banner, Card, ErrorState, LoadingState, SectionTitle, Stat } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { toCoreEvent } from "@/data/outcomes.ts";
import { useApp } from "@/data/session.tsx";
import { fmtDateLong, fmtTime } from "@/lib/format.ts";
import { useBundle } from "@/lib/useBundle.ts";
import { useOnline } from "@/lib/useOnline.ts";

export function Summary() {
  const { id = "" } = useParams();
  const { backend, isManager, user } = useApp();
  const nav = useNavigate();
  const online = useOnline();
  const { bundle, error, loading, reload } = useBundle(id);
  const [confirm, setConfirm] = useState<"photos" | "batch" | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useMemo(() => {
    if (!bundle) return null;
    const active = bundle.orders.filter((o) => o.status !== "excluded");
    const ids = active.map((o) => o.id);
    const p = deriveProgress(ids, bundle.events.map(toCoreEvent));
    const times = bundle.events.filter((e) => e.kind !== "undo").map((e) => e.occurredAt).sort();
    return { active, p, first: times[0] ?? null, last: times[times.length - 1] ?? null };
  }, [bundle]);

  if (loading && !bundle) return <LoadingState />;
  if (error || !bundle || !data) return <ErrorState message={error?.message} onRetry={reload} offline={!online} />;
  const { p, active } = data;
  const r = bundle.route;
  const st = BATCH_STATUS[bundle.batch.status];
  const canDelete = isManager || bundle.batch.createdBy === user.id;
  const pending = p.queue.length;

  async function doDelete() {
    setBusy(true);
    try {
      if (confirm === "photos") { await backend.deleteImages(id); toast.success("Fotos excluídas. Os pedidos e registros foram mantidos."); await reload(); }
      else { await backend.deleteBatch(id); toast.success("Lote excluído."); nav("/app/historico", { replace: true }); }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  return (
    <>
      <PageHeader title="Resumo do lote" subtitle={fmtDateLong(bundle.batch.createdAt)} back="/app/historico" actions={<Badge tone={st.tone} icon={st.icon}>{st.label}</Badge>} />
      <PageBody className="space-y-5">
        <Card className="grid grid-cols-3 gap-3 p-4">
          <Stat label="Entregues" value={p.delivered} />
          <Stat label="Pendentes" value={pending} />
          <Stat label="Sem sucesso" value={p.failed} />
        </Card>

        {pending > 0 && bundle.batch.status !== "completed" && r && (
          <Button asChild size="lg" block><Link to={`/app/lote/${id}/entrega`}><Navigation aria-hidden />Continuar entregas</Link></Button>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-1 p-4">
            <SectionTitle>Planejamento (estimativa)</SectionTitle>
            {r ? (<>
              <p className="text-[15px]">Total previsto: <strong>{formatDuration(r.totalS)}</strong> · {formatDistance(r.distanceM)}</p>
              <p className="text-[13px] text-ink-3">{r.simulated ? "Simulação em linha reta" : r.travelMode === "TWO_WHEELER" ? "Perfil de moto" : "Perfil de carro"} · versão {r.version} da rota · calculada às {fmtTime(r.createdAt)}</p>
            </>) : <p className="text-[15px] text-ink-2">Rota não calculada.</p>}
          </Card>
          <Card className="space-y-1 p-4">
            <SectionTitle>Registrado no app</SectionTitle>
            {data.first ? (<>
              <p className="text-[15px]">Primeiro registro às <strong>{fmtTime(data.first)}</strong>{data.last && data.last !== data.first && <> · último às <strong>{fmtTime(data.last)}</strong></>}</p>
              {bundle.batch.completedAt && <p className="text-[15px]">Saída encerrada às <strong>{fmtTime(bundle.batch.completedAt)}</strong></p>}
              <p className="text-[13px] text-ink-3">Horários marcados pelo entregador no app; não há rastreamento de localização.</p>
            </>) : <p className="text-[15px] text-ink-2">Nenhuma entrega registrada ainda.</p>}
          </Card>
        </div>

        <section className="space-y-2">
          <SectionTitle>Pedidos</SectionTitle>
          <Card className="divide-y divide-line">
            {active.map((o) => {
              const s = p.statusByOrder[o.id];
              const reason = p.reasonByOrder[o.id];
              return (
                <div key={o.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{orderTitle(o)}{o.recipientName && o.orderCode ? <span className="font-normal text-ink-2"> · {o.recipientName}</span> : null}</p>
                    <p className="text-[14px] text-ink-2">{addressLine(o)}</p>
                    {s === "failed" && reason && <p className="text-[13px] text-danger">{FAILURE_REASON_LABEL[reason as FailureReason] ?? reason}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {s === "delivered" ? <Badge tone="success" icon={Check}>Entregue</Badge> : s === "failed" ? <Badge tone="danger" icon={CircleSlash}>Sem sucesso</Badge> : <Badge tone="warn" icon={Clock3}>Pendente</Badge>}
                    {p.completedAtByOrder[o.id] && <p className="tabular mt-1 text-[12px] text-ink-3">{fmtTime(p.completedAtByOrder[o.id])}</p>}
                  </div>
                </div>
              );
            })}
          </Card>
          {bundle.orders.length > active.length && <p className="text-[13px] text-ink-3">{bundle.orders.length - active.length} pedido(s) ficaram fora desta saída.</p>}
        </section>

        {canDelete && (
          <section className="space-y-2">
            <SectionTitle>Privacidade</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" disabled={!bundle.images.length || !online} onClick={() => setConfirm("photos")}><ImageOff aria-hidden />Excluir fotos ({bundle.images.length})</Button>
              <Button variant="danger" disabled={!online} onClick={() => setConfirm("batch")}><Trash2 aria-hidden />Excluir lote e dados</Button>
            </div>
          </section>
        )}
      </PageBody>

      <Sheet open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)} title={confirm === "photos" ? "Excluir as fotos?" : "Excluir o lote?"}
        footer={<div className="grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button><Button variant="danger" loading={busy} onClick={doDelete}>Excluir</Button></div>}>
        <Banner tone="warn">
          {confirm === "photos"
            ? "As fotos das notinhas serão apagadas definitivamente. Pedidos, rota e registros de entrega continuam."
            : "Fotos, pedidos, rota e registros deste lote serão apagados definitivamente. Não é possível desfazer."}
        </Banner>
      </Sheet>
    </>
  );
}
