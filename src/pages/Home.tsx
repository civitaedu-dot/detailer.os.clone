import { Camera, Inbox, Navigation, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { BatchCard, batchHref } from "@/components/orders/BatchCard.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Card, EmptyState, ErrorState, SectionTitle, Skeleton, Stat } from "@/components/ui/primitives.tsx";
import { useApp } from "@/data/session.tsx";
import type { BatchSummary } from "@/data/types.ts";
import { isToday } from "@/lib/format.ts";
import { useAsync } from "@/lib/useAsync.ts";
import { useOnline } from "@/lib/useOnline.ts";

export function Home() {
  const { backend, ctx, user, isManager, config, configError } = useApp();
  const online = useOnline();
  const { data, error, loading, reload } = useAsync(() => backend.listBatches({ limit: 60 }), [backend]);
  const mine = (data ?? []).filter((b) => b.createdBy === user.id || b.assignedDriverId === user.id);
  const active = mine.find((b) => b.status === "in_progress" && (b.assignedDriverId ?? b.createdBy) === user.id)
    ?? mine.find((b) => b.status === "ready" && (b.assignedDriverId ?? b.createdBy) === user.id);
  const preparing = mine.filter((b) => ["draft", "processing", "review"].includes(b.status) && b.createdBy === user.id);
  const today = (data ?? []).filter((b) => isToday(b.createdAt));
  const first = ctx.profile.displayName?.split(" ")[0];

  return (
    <>
      <PageHeader title={first ? `Olá, ${first}` : "Início"} subtitle={ctx.org?.name} actions={<>
        <Button asChild size="lg" className="hidden md:inline-flex"><Link to="/app/nova"><Camera aria-hidden />Fotografar notinhas</Link></Button>
        <Button variant="ghost" size="icon" aria-label="Atualizar" onClick={reload}><RefreshCw aria-hidden /></Button>
      </>} />
      <PageBody className="space-y-6">
        {!ctx.base && isManager && (
          <Banner tone="warn" title="Cadastre o endereço de saída" action={<Button asChild variant="secondary"><Link to="/app/perfil#base">Cadastrar base</Link></Button>}>
            Sem a base, as rotas precisam partir da sua localização atual.
          </Banner>
        )}
        {configError && <Banner tone="warn" title="Processamento no servidor indisponível">{configError} A demonstração continua disponível.</Banner>}

        {loading && !data ? (
          <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-20" /></div>
        ) : error && !data ? (
          <ErrorState message={error.message} onRetry={reload} offline={!online} />
        ) : (
          <>
            {active && (
              <Card className="overflow-hidden border-graphite">
                <div className="bg-graphite p-4 text-white">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-lime">{active.status === "in_progress" ? "Rota em andamento" : "Rota pronta para sair"}</p>
                  <p className="mt-1 text-xl font-bold">{active.delivered + active.failed} de {active.orderCount} entregas concluídas</p>
                </div>
                <div className="p-3">
                  <Button asChild size="lg" block><Link to={batchHref(active)}><Navigation aria-hidden />{active.status === "in_progress" ? "Continuar entregas" : "Ver rota e iniciar"}</Link></Button>
                </div>
              </Card>
            )}

            {preparing.length > 0 && (
              <section className="space-y-2">
                <SectionTitle>Em preparação</SectionTitle>
                {preparing.slice(0, 3).map((b) => <BatchCard key={b.id} b={b} />)}
              </section>
            )}

            {isManager ? <RestaurantBoard batches={data ?? []} /> : (
              <>
                <section className="space-y-2">
                  <SectionTitle>Hoje</SectionTitle>
                  <Card className="grid grid-cols-3 gap-3 p-4">
                    <Stat label="Lotes" value={today.filter((b) => b.createdBy === user.id || b.assignedDriverId === user.id).length} />
                    <Stat label="Entregues" value={today.reduce((s, b) => s + b.delivered, 0)} />
                    <Stat label="Sem sucesso" value={today.reduce((s, b) => s + b.failed, 0)} />
                  </Card>
                </section>
                <section className="space-y-2">
                  <SectionTitle action={<Link to="/app/historico" className="inline-flex min-h-12 items-center text-[14px] font-semibold text-brand-strong">Ver tudo</Link>}>Últimos lotes</SectionTitle>
                  {mine.length ? mine.filter((b) => b.id !== active?.id).slice(0, 4).map((b) => <BatchCard key={b.id} b={b} />)
                    : <EmptyState icon={Inbox} title="Nenhum lote ainda">Fotografe as notinhas para montar sua primeira rota.</EmptyState>}
                </section>
              </>
            )}
          </>
        )}
        {config && !config.ocr && (
          <p className="text-[13px] text-ink-3">Leitura automática das notinhas {backend.mode === "demo" ? "simulada apenas para as fotos de exemplo" : "não configurada — inclua pedidos manualmente"}.</p>
        )}
      </PageBody>

      {/* Ação principal perto do polegar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-30 px-4 md:hidden">
        <Button asChild size="xl" block className="pointer-events-auto shadow-[var(--shadow-float)]">
          <Link to="/app/nova"><Camera aria-hidden />Fotografar notinhas</Link>
        </Button>
      </div>
      <div className="h-20 md:hidden" />
    </>
  );
}

function RestaurantBoard({ batches }: { batches: BatchSummary[] }) {
  const groups: Array<{ title: string; items: BatchSummary[] }> = [
    { title: "Preparando e revisando", items: batches.filter((b) => ["draft", "processing", "review"].includes(b.status)) },
    { title: "Prontos e em rota", items: batches.filter((b) => b.status === "ready" || b.status === "in_progress") },
    { title: "Concluídos hoje", items: batches.filter((b) => b.status === "completed" && isToday(b.completedAt ?? b.createdAt)) },
  ];
  const delivered = groups[1].items.concat(groups[2].items).reduce((s, b) => s + b.delivered, 0);
  return (
    <section className="space-y-3">
      <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Stat label="Preparando" value={groups[0].items.length} />
        <Stat label="Em rota" value={batches.filter((b) => b.status === "in_progress").length} />
        <Stat label="Concluídos hoje" value={groups[2].items.length} />
        <Stat label="Entregas registradas" value={delivered} hint="pelos entregadores no app" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.title} className="space-y-2">
            <SectionTitle>{g.title} ({g.items.length})</SectionTitle>
            {g.items.length ? g.items.map((b) => <BatchCard key={b.id} b={b} showDriver />) : <p className="rounded-xl border border-dashed border-line p-4 text-[14px] text-ink-3">Nada aqui.</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
