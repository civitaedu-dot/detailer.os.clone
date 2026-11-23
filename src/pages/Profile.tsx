import { Building2, CheckCircle2, CircleDashed, Copy, Download, FlaskConical, KeyRound, LogOut, MapPin, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/layout/PageHeader.tsx";
import { BaseForm } from "@/components/orders/BaseForm.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Badge, Banner, Card, Field, Input, SectionTitle, Segmented, Switch } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import { DemoBackend } from "@/data/demoBackend.ts";
import { useApp } from "@/data/session.tsx";
import type { Member, Preferences } from "@/data/types.ts";
import { env } from "@/lib/env.ts";
import { useAsync } from "@/lib/useAsync.ts";

type InstallEvent = Event & { prompt: () => Promise<void> };
let deferredInstall: InstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e as InstallEvent; });
}

const ROLE_LABEL = { owner: "Responsável", manager: "Gestor", driver: "Entregador" } as const;

export function Profile() {
  const { backend, ctx, user, isManager, config, signOut, refresh, mode } = useApp();
  const [name, setName] = useState(ctx.profile.displayName ?? "");
  const [prefs, setPrefs] = useState<Preferences>(ctx.preferences);
  const [baseOpen, setBaseOpen] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const members = useAsync<Member[]>(() => backend.listMembers(), [backend]);
  const isRestaurant = ctx.org?.kind === "restaurant";

  useEffect(() => { if (location.hash === "#base" && isManager) setBaseOpen(true); }, [isManager]);
  useEffect(() => setPrefs(ctx.preferences), [ctx.preferences]);

  async function savePrefs(next: Preferences) {
    setPrefs(next);
    try {
      const orgScope = isManager;
      const { mapsTravelMode, ...rest } = next;
      await backend.savePreferences(orgScope ? rest : { ...rest, mapsTravelMode }, orgScope ? "org" : "user");
      if (orgScope) await backend.savePreferences({ mapsTravelMode }, "user");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Falhou."); } finally { setBusy(null); }
  }

  return (
    <>
      <PageHeader title="Perfil" subtitle={ctx.profile.email ?? undefined} />
      <PageBody className="space-y-6">
        {mode === "demo" && (
          <Banner tone="warn" icon={FlaskConical} title="Você está na demonstração"
            action={<div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => run("role", async () => { await new DemoBackend().setRole(ctx.role === "owner" ? "driver" : "owner"); await refresh(); })} loading={busy === "role"}>
                Ver como {ctx.role === "owner" ? "entregador" : "restaurante"}
              </Button>
              <Button variant="ghost" onClick={() => signOut()}>Sair da demonstração</Button>
            </div>}>
            Restaurante, entregador e pedidos são fictícios. Nada sai deste aparelho.
          </Banner>
        )}

        <section className="space-y-2">
          <SectionTitle>Conta</SectionTitle>
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Building2 className="size-5 text-ink-2" aria-hidden />
              <p className="font-semibold">{ctx.org?.name}</p>
              {ctx.role && <Badge>{ROLE_LABEL[ctx.role]}</Badge>}
            </div>
            <Field label="Seu nome">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== ctx.profile.displayName && run("name", () => backend.updateDisplayName(name.trim()))} />}</Field>
          </Card>
        </section>

        <section className="space-y-2" id="base">
          <SectionTitle>Base de saída</SectionTitle>
          <Card className="space-y-3 p-4">
            {ctx.base ? (
              <div className="flex gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="font-semibold">{ctx.base.name}</p>
                  <p className="text-[14px] text-ink-2">{ctx.base.addressLine} · {ctx.base.city}/{ctx.base.uf}</p>
                  <p className="text-[12px] text-ink-3">Localização {ctx.base.provenance === "provider" ? "verificada por busca" : ctx.base.provenance === "demo_fixture" ? "fictícia (demonstração)" : "marcada manualmente"}</p>
                </div>
              </div>
            ) : <p className="text-[15px] text-ink-2">Nenhuma base cadastrada.</p>}
            {isManager ? <Button variant="secondary" block onClick={() => setBaseOpen(true)}>{ctx.base ? "Alterar base" : "Cadastrar base"}</Button>
              : isRestaurant && <p className="text-[13px] text-ink-3">Base e cidade definidas pelo restaurante.</p>}
          </Card>
        </section>

        <section className="space-y-2">
          <SectionTitle>Preferências da saída</SectionTitle>
          <Card className="space-y-4 p-4">
            {!isManager && isRestaurant && <p className="text-[13px] text-ink-3">Valem só para você; o padrão vem do restaurante.</p>}
            <div className="space-y-2">
              <p className="text-[14px] font-semibold">Começar a rota em</p>
              <Segmented label="Origem padrão" value={prefs.startFrom} onChange={(v) => savePrefs({ ...prefs, startFrom: v })} options={[{ value: "base", label: "Base" }, { value: "current", label: "Onde estou" }]} />
            </div>
            <Switch label="Voltar à base no fim" checked={prefs.returnToBase} onChange={(v) => savePrefs({ ...prefs, returnToBase: v })} disabled={!ctx.base} />
            <Field label="Tempo médio por entrega (minutos)" hint="Usado apenas nas estimativas.">
              {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" min={0} max={60} value={prefs.serviceMinutes}
                onChange={(e) => setPrefs({ ...prefs, serviceMinutes: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} onBlur={() => savePrefs(prefs)} />}
            </Field>
            <div className="space-y-2">
              <p className="text-[14px] font-semibold">Modo no Google Maps</p>
              <Segmented label="Modo de navegação" value={prefs.mapsTravelMode} onChange={(v) => savePrefs({ ...prefs, mapsTravelMode: v })} options={[{ value: "two-wheeler", label: "Moto" }, { value: "driving", label: "Carro" }]} />
              <p className="text-[13px] text-ink-3">Onde o Maps não oferecer moto, ele pode usar outro modo.</p>
            </div>
          </Card>
        </section>

        {isRestaurant && isManager && (
          <section className="space-y-2">
            <SectionTitle>Equipe</SectionTitle>
            <Card className="space-y-3 p-4">
              <ul className="divide-y divide-line">
                {(members.data ?? []).map((m) => (
                  <li key={m.userId} className="flex items-center justify-between py-2">
                    <span className="flex items-center gap-2"><Users className="size-4 text-ink-3" aria-hidden />{m.displayName ?? "Sem nome"}{m.userId === user.id && " (você)"}</span>
                    <Badge>{ROLE_LABEL[m.role]}</Badge>
                  </li>
                ))}
              </ul>
              {invite ? (
                <div className="rounded-xl bg-sunken p-3">
                  <p className="text-[14px]">Código para o entregador (válido por 7 dias, uso único):</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 rounded-lg bg-surface px-3 py-2 text-center font-mono text-xl font-bold tracking-[0.25em]">{invite}</code>
                    <Button variant="secondary" size="icon" aria-label="Copiar código" onClick={() => navigator.clipboard?.writeText(invite).then(() => toast.success("Código copiado."))}><Copy aria-hidden /></Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" block loading={busy === "invite"} onClick={() => run("invite", async () => setInvite(await backend.createInvite()))}><KeyRound aria-hidden />Gerar código de convite</Button>
              )}
            </Card>
          </section>
        )}

        {ctx.org?.kind === "solo" && mode === "real" && (
          <section className="space-y-2">
            <SectionTitle>Vincular a um restaurante</SectionTitle>
            <Card className="space-y-3 p-4">
              <Field label="Código de convite">{(id) => <Input id={id} value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono tracking-widest" />}</Field>
              <Button block disabled={code.length !== 8} loading={busy === "join"} onClick={() => run("join", async () => { await backend.acceptInvite(code); await refresh(); toast.success("Vinculado ao restaurante."); })}>Entrar na equipe</Button>
            </Card>
          </section>
        )}

        <section className="space-y-2">
          <SectionTitle>Integrações deste ambiente</SectionTitle>
          <Card className="divide-y divide-line">
            <Integration label="Leitura das notinhas" ok={!!config?.ocr} text={config?.ocr ? "Configurada no servidor" : mode === "demo" ? "Simulada só para as fotos de exemplo" : "Não configurada — use inclusão manual"} />
            <Integration label="Localização de endereços" ok={!!config?.geocoding} text={config?.geocoding ? "Google Geocoding" : mode === "demo" ? "Fictícia para os endereços de exemplo" : "Não configurada — ajuste no mapa"} />
            <Integration label="Cálculo de rotas" ok={config?.routing === "google"} text={config?.routing === "google" ? "Google Routes (moto, com trânsito)" : "Simulação em linha reta, identificada"} />
            <Integration label="Mapa" ok={mode === "real" && !!env.mapsBrowserKey} text={mode === "real" && env.mapsBrowserKey ? "Google Maps" : "Mapa ilustrativo (sem ruas)"} />
          </Card>
          <p className="text-[13px] text-ink-3">As fotos ficam em armazenamento privado e podem ser excluídas em cada lote{config?.limits.retentionDays ? `; a retenção automática do servidor é de ${config.limits.retentionDays} dias quando a rotina estiver ativa` : ""}.</p>
        </section>

        <section className="space-y-2 pb-4">
          {deferredInstall && <Button variant="secondary" block onClick={() => { void deferredInstall?.prompt(); deferredInstall = null; }}><Download aria-hidden />Instalar o app neste aparelho</Button>}
          <Button variant="danger" block onClick={() => signOut()}><LogOut aria-hidden />{mode === "demo" ? "Sair da demonstração" : "Sair da conta"}</Button>
          <p className="text-center text-[12px] text-ink-3">Ao sair, os dados guardados neste aparelho são apagados.</p>
        </section>
      </PageBody>

      <Sheet open={baseOpen} onOpenChange={setBaseOpen} title={ctx.base ? "Alterar base" : "Cadastrar base"} wide>
        <BaseForm backend={backend} initial={ctx.base} onSaved={async () => { setBaseOpen(false); await refresh(); toast.success("Base salva."); }} />
      </Sheet>
    </>
  );
}

function Integration({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div><p className="font-semibold">{label}</p><p className="text-[13px] text-ink-2">{text}</p></div>
      {ok ? <Badge tone="success" icon={CheckCircle2}>Ativa</Badge> : <Badge icon={CircleDashed}>Limitada</Badge>}
    </div>
  );
}
