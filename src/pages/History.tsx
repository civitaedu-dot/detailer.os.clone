import { History as HistoryIcon } from "lucide-react";
import { useState } from "react";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { BatchCard } from "@/components/orders/BatchCard.tsx";
import { EmptyState, ErrorState, Segmented, Skeleton } from "@/components/ui/primitives.tsx";
import { useApp } from "@/data/session.tsx";
import type { BatchSummary } from "@/data/types.ts";
import { fmtDateLong } from "@/lib/format.ts";
import { useAsync } from "@/lib/useAsync.ts";
import { useOnline } from "@/lib/useOnline.ts";

type Filter = "all" | "done" | "open";

export function History() {
  const { backend, isManager } = useApp();
  const online = useOnline();
  const [filter, setFilter] = useState<Filter>("all");
  const { data, error, loading, reload } = useAsync(() => backend.listBatches({ limit: 100 }), [backend]);
  const list = (data ?? []).filter((b) => filter === "all" || (filter === "done" ? b.status === "completed" : b.status !== "completed"));
  const byDay = new Map<string, BatchSummary[]>();
  for (const b of list) {
    const k = fmtDateLong(b.createdAt);
    byDay.set(k, [...(byDay.get(k) ?? []), b]);
  }
  return (
    <>
      <PageHeader title="Histórico" subtitle="Lotes anteriores, responsáveis e resultados registrados" />
      <PageBody className="space-y-4">
        <Segmented label="Filtrar lotes" value={filter} onChange={setFilter} options={[{ value: "all", label: "Todos" }, { value: "open", label: "Abertos" }, { value: "done", label: "Concluídos" }]} />
        {loading && !data ? <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
          : error && !data ? <ErrorState message={error.message} onRetry={reload} offline={!online} />
          : !list.length ? <EmptyState icon={HistoryIcon} title="Nada por aqui">Os lotes aparecem aqui assim que você fotografar as notinhas.</EmptyState>
          : [...byDay.entries()].map(([day, items]) => (
            <section key={day} className="space-y-2">
              <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">{day}</h2>
              <div className="grid gap-2 lg:grid-cols-2">
                {items.map((b) => (
                  <div key={b.id}>
                    <BatchCard b={b} showDriver={isManager} />
                    <p className="px-1 pt-1 text-[12px] text-ink-3">Criado por {b.creatorName ?? "—"}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
      </PageBody>
    </>
  );
}
