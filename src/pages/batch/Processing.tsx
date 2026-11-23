import { Check, CircleDashed, Loader2, PencilLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Card } from "@/components/ui/primitives.tsx";
import { useApp } from "@/data/session.tsx";
import { BackendError, type BatchBundle } from "@/data/types.ts";
import { clearCaptures, loadCaptures, markUploaded } from "@/lib/captureStore.ts";
import { useOnline } from "@/lib/useOnline.ts";
import { cn, plural } from "@/lib/utils.ts";

type StepState = "waiting" | "running" | "done" | "error" | "skipped";
type Step = { key: "upload" | "extract" | "geocode" | "plan"; label: string; state: StepState; detail?: string };

const INITIAL: Step[] = [
  { key: "upload", label: "Enviando imagens", state: "waiting" },
  { key: "extract", label: "Identificando pedidos", state: "waiting" },
  { key: "geocode", label: "Localizando endereços", state: "waiting" },
  { key: "plan", label: "Organizando a rota", state: "waiting" },
];

const running = new Set<string>(); // evita execução duplicada do mesmo lote

/**
 * Etapas reais do processamento. Cada etapa é idempotente no servidor:
 * repetir não duplica fotos nem pedidos e não refaz chamadas externas concluídas.
 */
export function Processing() {
  const { id = "" } = useParams();
  const { backend } = useApp();
  const nav = useNavigate();
  const online = useOnline();
  const [steps, setSteps] = useState<Step[]>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [empty, setEmpty] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const setStep = (key: Step["key"], state: StepState, detail?: string) =>
    alive.current && setSteps((cur) => cur.map((s) => (s.key === key ? { ...s, state, detail } : s)));

  const run = useCallback(async () => {
    if (running.has(id)) return;
    running.add(id);
    setError(null); setNotes([]); setEmpty(false);
    const extraNotes: string[] = [];
    let failedStep: Step["key"] | null = null;
    try {
      // 1. envio
      failedStep = "upload";
      const captures = await loadCaptures(id);
      const pending = captures.filter((c) => !c.uploadedImageId);
      if (captures.length) {
        setStep("upload", "running", `${captures.length - pending.length} de ${captures.length} enviadas`);
        let sent = captures.length - pending.length;
        for (const c of pending) {
          const img = await backend.uploadImage(id, { blob: c.blob, sha256: c.sha256, originalSha256: c.originalSha256, width: c.width, height: c.height, mime: c.mime });
          await markUploaded(id, c.id, img.id);
          sent++;
          setStep("upload", "running", `${sent} de ${captures.length} enviadas`);
        }
        await clearCaptures(id);
      }
      let bundle: BatchBundle = await backend.getBundle(id);
      setStep("upload", bundle.images.length ? "done" : "skipped", bundle.images.length ? plural(bundle.images.length, "foto enviada", "fotos enviadas") : "Nenhuma foto");

      // 2. leitura
      failedStep = "extract";
      const toRead = bundle.images.filter((i) => i.status !== "extracted");
      if (toRead.length) {
        setStep("extract", "running", `Lendo ${plural(toRead.length, "foto", "fotos")}`);
        try {
          const r = await backend.extract(id);
          for (const img of r.images.filter((x) => x.status === "failed")) {
            extraNotes.push(img.message ?? "Uma foto não pôde ser lida.");
          }
          for (const img of r.images) for (const w of img.warnings ?? []) extraNotes.push(w);
        } catch (e) {
          if (e instanceof BackendError && e.code === "ocr_not_configured") extraNotes.push(e.message);
          else throw e;
        }
        bundle = await backend.getBundle(id);
      }
      const orders = bundle.orders.filter((o) => o.status !== "excluded");
      setStep("extract", bundle.images.length ? "done" : "skipped", plural(orders.length, "pedido encontrado", "pedidos encontrados"));
      if (!orders.length) { setEmpty(true); setNotes(extraNotes); setStep("geocode", "skipped"); setStep("plan", "skipped"); return; }

      // 3. localização
      failedStep = "geocode";
      if (orders.some((o) => !o.geocodeAttemptedAt && !o.provenance && o.street)) {
        setStep("geocode", "running", `Buscando ${plural(orders.length, "endereço", "endereços")}`);
        try {
          await backend.geocode(id);
        } catch (e) {
          if (e instanceof BackendError && e.code === "geocoding_not_configured") extraNotes.push(e.message);
          else throw e;
        }
        bundle = await backend.getBundle(id);
      }
      const active = bundle.orders.filter((o) => o.status !== "excluded");
      const unresolved = active.filter((o) => o.status === "needs_review" || o.status === "not_found");
      setStep("geocode", "done", unresolved.length ? `${active.length - unresolved.length} prontos · ${unresolved.length} para revisar` : `${active.length} prontos`);
      setNotes(extraNotes);

      // 4. rota (automática só quando não há dúvidas e a saída é da base)
      failedStep = "plan";
      if (unresolved.length || bundle.batch.startFrom !== "base" || !bundle.base) {
        setStep("plan", "skipped", unresolved.length ? "Aguardando revisão" : "Escolha a origem na próxima tela");
        await new Promise((r) => setTimeout(r, 900));
        if (alive.current) nav(`/app/lote/${id}/${unresolved.length ? "enderecos" : "rota"}`, { replace: true });
        return;
      }
      if (!bundle.route) {
        setStep("plan", "running");
        await backend.plan(id, { mode: bundle.batch.returnToBase ? "closed" : "open", serviceMinutes: bundle.batch.serviceMinutes, startFrom: "base" });
      }
      setStep("plan", "done");
      await new Promise((r) => setTimeout(r, 700));
      if (alive.current) nav(`/app/lote/${id}/rota`, { replace: true });
    } catch (e) {
      if (failedStep) setStep(failedStep, "error");
      setError(e instanceof Error ? e.message : "Falha no processamento.");
      setNotes(extraNotes);
    } finally {
      running.delete(id);
    }
  }, [backend, id, nav]);

  useEffect(() => { void run(); }, [run]);

  return (
    <>
      <PageHeader title="Preparando o lote" subtitle="Você pode sair desta tela; o progresso fica salvo." back="/app" />
      <PageBody className="space-y-4">
        <Card className="divide-y divide-line">
          {steps.map((s) => (
            <div key={s.key} className="flex items-center gap-3 p-4" aria-live="polite">
              <StepIcon state={s.state} />
              <div className="min-w-0">
                <p className={cn("font-semibold", s.state === "waiting" && "text-ink-3")}>{s.label}</p>
                {s.detail && <p className="text-[14px] text-ink-2">{s.detail}</p>}
              </div>
            </div>
          ))}
        </Card>

        {notes.map((n, i) => <Banner key={i} tone="warn">{n}</Banner>)}

        {error && (
          <Banner tone="danger" title={online ? "Não foi possível concluir" : "Sem conexão"} action={<Button variant="secondary" onClick={() => void run()}>Tentar novamente</Button>}>
            {online ? error : "As fotos estão guardadas no aparelho. Reconecte e toque em tentar novamente — nada será duplicado."}
          </Banner>
        )}

        {empty && (
          <Card className="space-y-3 p-4">
            <p className="font-semibold">Nenhum pedido identificado nas fotos.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button asChild><Link to={`/app/lote/${id}/enderecos?incluir=1`}><PencilLine aria-hidden />Incluir manualmente</Link></Button>
              <Button asChild variant="secondary"><Link to="/app/nova">Fotografar de novo</Link></Button>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}

function StepIcon({ state }: { state: StepState }) {
  const base = "grid size-9 shrink-0 place-items-center rounded-full";
  if (state === "done") return <span className={cn(base, "bg-brand text-white")} aria-label="Concluído"><Check className="size-5" /></span>;
  if (state === "running") return <span className={cn(base, "bg-graphite text-lime")} aria-label="Em andamento"><Loader2 className="size-5 animate-spin" /></span>;
  if (state === "error") return <span className={cn(base, "bg-danger text-white")} aria-label="Falhou"><X className="size-5" /></span>;
  if (state === "skipped") return <span className={cn(base, "bg-sunken text-ink-3")} aria-label="Não necessário"><CircleDashed className="size-5" /></span>;
  return <span className={cn(base, "border-2 border-dashed border-line")} aria-label="Aguardando" />;
}
