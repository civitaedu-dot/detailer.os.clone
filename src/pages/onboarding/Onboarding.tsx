import { Bike, KeyRound, Store, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/layout/Brand.tsx";
import { BaseForm } from "@/components/orders/BaseForm.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Card, Field, Input, Segmented, Switch } from "@/components/ui/primitives.tsx";
import { useSession } from "@/data/session.tsx";
import { DEFAULT_PREFERENCES, type Preferences } from "@/data/types.ts";

type Step = "role" | "restaurant-name" | "driver" | "base" | "prefs";

export function Onboarding() {
  const { backend, status, ctx, refresh, signOut } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>("role");
  const [kind, setKind] = useState<"restaurant" | "solo">("restaurant");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);

  if (status === "signed_out") return <Navigate to="/entrar" replace />;
  if (status === "ready" && step === "role") return <Navigate to="/app" replace />;
  if (!backend) return null;

  async function createOrg(k: "restaurant" | "solo", n: string) {
    setBusy(true); setError(null);
    try {
      await backend!.createOrganization(n, k);
      setKind(k);
      setStep("base");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await backend!.acceptInvite(code);
      await refresh();
      nav("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código inválido.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      await backend!.savePreferences(prefs, "org");
      await refresh();
      nav("/app", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg px-5 py-6">
      <div className="mb-8 flex items-center justify-between"><Wordmark /><Button variant="ghost" onClick={() => signOut()}>Sair</Button></div>
      {error && <Banner tone="danger" className="mb-4">{error}</Banner>}

      {step === "role" && (
        <section aria-labelledby="t-role">
          <h1 id="t-role" className="text-2xl font-extrabold">Como você vai usar?</h1>
          <p className="mt-1 text-ink-2">Dá para mudar depois no Perfil.</p>
          <div className="mt-6 grid gap-3">
            <RoleButton icon={Store} title="Sou restaurante ou delivery" text="Configuro a base, preparo lotes e acompanho os entregadores." onClick={() => setStep("restaurant-name")} />
            <RoleButton icon={Bike} title="Sou entregador" text="Fotografo as notinhas e sigo a rota. Com ou sem restaurante vinculado." onClick={() => setStep("driver")} />
          </div>
        </section>
      )}

      {step === "restaurant-name" && (
        <form onSubmit={(e) => { e.preventDefault(); void createOrg("restaurant", name.trim()); }} className="space-y-4">
          <h1 className="text-2xl font-extrabold">Nome do restaurante</h1>
          <Field label="Como aparece para os entregadores">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
          <Button type="submit" size="lg" block loading={busy} disabled={name.trim().length < 2}>Continuar</Button>
          <Button variant="ghost" block onClick={() => setStep("role")}>Voltar</Button>
        </form>
      )}

      {step === "driver" && (
        <div className="space-y-6">
          <h1 className="text-2xl font-extrabold">Entregador</h1>
          <Card className="p-4">
            <form onSubmit={join} className="space-y-3">
              <h2 className="flex items-center gap-2 font-bold"><KeyRound className="size-5" aria-hidden />Tenho código do restaurante</h2>
              <p className="text-[14px] text-ink-2">Você passa a usar a base e a cidade configuradas pelo restaurante.</p>
              <Field label="Código de convite">{(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={8} autoCapitalize="characters" placeholder="Ex.: K7M2Q9XA" className="font-mono tracking-widest" />}</Field>
              <Button type="submit" block loading={busy} disabled={code.length !== 8}>Entrar na equipe</Button>
            </form>
          </Card>
          <Card className="p-4">
            <h2 className="flex items-center gap-2 font-bold"><UserRound className="size-5" aria-hidden />Trabalho por conta própria</h2>
            <p className="mt-1 text-[14px] text-ink-2">Você cria seus próprios lotes. A base é opcional — dá para sair da localização atual.</p>
            <Button variant="dark" block className="mt-3" loading={busy} onClick={() => { setPrefs({ ...prefs, startFrom: "current" }); void createOrg("solo", ctx?.profile.displayName?.trim() || "Minhas entregas"); }}>Continuar sem restaurante</Button>
          </Card>
          <Button variant="ghost" block onClick={() => setStep("role")}>Voltar</Button>
        </div>
      )}

      {step === "base" && (
        <section>
          <h1 className="text-2xl font-extrabold">{kind === "restaurant" ? "Endereço de saída" : "Ponto de saída habitual"}</h1>
          <p className="mb-5 mt-1 text-ink-2">Usamos para começar as rotas e como cidade padrão quando a notinha não traz a cidade.</p>
          <BaseForm backend={backend} onSaved={() => setStep("prefs")} submitLabel="Salvar e continuar" allowSkip={kind === "solo"} onSkip={() => setStep("prefs")} />
        </section>
      )}

      {step === "prefs" && (
        <section className="space-y-5">
          <h1 className="text-2xl font-extrabold">Preferências da saída</h1>
          <div>
            <p className="mb-2 text-[14px] font-semibold">Começar a rota a partir de</p>
            <Segmented label="Origem da rota" value={prefs.startFrom} onChange={(v) => setPrefs({ ...prefs, startFrom: v })}
              options={[{ value: "base", label: "Base" }, { value: "current", label: "Onde estou" }]} />
          </div>
          <Switch label="Voltar à base no fim" description="Inclui o retorno no cálculo." checked={prefs.returnToBase} onChange={(v) => setPrefs({ ...prefs, returnToBase: v })} />
          <Field label="Tempo médio em cada entrega (minutos)" hint="Usado só nas estimativas de duração.">
            {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" min={0} max={60} value={prefs.serviceMinutes} onChange={(e) => setPrefs({ ...prefs, serviceMinutes: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} />}
          </Field>
          <Button size="lg" block onClick={finish} loading={busy}>Concluir</Button>
        </section>
      )}
    </div>
  );
}

function RoleButton({ icon: Icon, title, text, onClick }: { icon: typeof Store; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-24 items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left shadow-[var(--shadow-card)] hover:border-ink-3">
      <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-graphite text-lime"><Icon className="size-7" aria-hidden /></span>
      <span><span className="block text-[17px] font-bold">{title}</span><span className="block text-[14px] text-ink-2">{text}</span></span>
    </button>
  );
}
