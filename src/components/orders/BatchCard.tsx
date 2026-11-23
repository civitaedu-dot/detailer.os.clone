import { CheckCircle2, ChevronRight, ClipboardList, Hourglass, MapPinned, Navigation, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/primitives.tsx";
import type { BatchStatus, BatchSummary } from "@/data/types.ts";
import { fmtWhen } from "@/lib/format.ts";
import { plural } from "@/lib/utils.ts";

export const BATCH_STATUS: Record<BatchStatus, { label: string; tone: "neutral" | "warn" | "info" | "success" | "dark"; icon: typeof Hourglass }> = {
  draft: { label: "Preparando", tone: "neutral", icon: Hourglass },
  processing: { label: "Preparando", tone: "neutral", icon: Hourglass },
  review: { label: "Revisar endereços", tone: "warn", icon: ClipboardList },
  ready: { label: "Rota pronta", tone: "info", icon: MapPinned },
  in_progress: { label: "Em rota", tone: "dark", icon: Navigation },
  completed: { label: "Concluído", tone: "success", icon: CheckCircle2 },
  canceled: { label: "Cancelado", tone: "neutral", icon: XCircle },
};

export function batchHref(b: { id: string; status: BatchStatus }) {
  switch (b.status) {
    case "draft": case "processing": return `/app/lote/${b.id}/processando`;
    case "review": return `/app/lote/${b.id}/enderecos`;
    case "ready": return `/app/lote/${b.id}/rota`;
    case "in_progress": return `/app/lote/${b.id}/entrega`;
    default: return `/app/lote/${b.id}/resumo`;
  }
}

export function BatchCard({ b, showDriver }: { b: BatchSummary; showDriver?: boolean }) {
  const s = BATCH_STATUS[b.status];
  const done = b.delivered + b.failed;
  const pct = b.orderCount ? Math.round((done / b.orderCount) * 100) : 0;
  return (
    <Link to={batchHref(b)} className="block rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow-card)] hover:border-ink-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">Lote · {fmtWhen(b.createdAt)}</p>
          <p className="text-[14px] text-ink-2">
            {plural(b.orderCount, "pedido", "pedidos")}
            {showDriver && <> · {b.driverName ?? (b.assignedDriverId ? "Entregador" : "Sem entregador")}</>}
          </p>
        </div>
        <div className="flex items-center gap-1"><Badge tone={s.tone} icon={s.icon}>{s.label}</Badge><ChevronRight className="size-5 text-ink-3" aria-hidden /></div>
      </div>
      {(b.status === "in_progress" || b.status === "completed") && b.orderCount > 0 && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={b.orderCount} aria-valuenow={done} aria-label="Entregas concluídas">
            <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
          <p className="tabular mt-1.5 text-[13px] text-ink-2">
            {done} de {b.orderCount} concluídas · {b.delivered} entregues{b.failed ? ` · ${b.failed} sem sucesso` : ""}
          </p>
        </div>
      )}
    </Link>
  );
}
