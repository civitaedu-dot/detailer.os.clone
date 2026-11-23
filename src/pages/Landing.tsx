import { ArrowRight, Camera, ClipboardCheck, FlaskConical, Navigation } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/layout/Brand.tsx";
import { SchematicMap } from "@/components/map/SchematicMap.tsx";
import { Button } from "@/components/ui/button.tsx";
import { DEMO_LOCATIONS, DEMO_RESTAURANT } from "@/data/demoFixtures.ts";
import { useSession } from "@/data/session.tsx";

const PREVIEW = ["rua cubatao|1100", "rua vergueiro|2045", "rua domingos de morais|1450", "rua joaquim tavora|820"].map((k, i) => ({
  id: k, ...DEMO_LOCATIONS[k].at, label: String(i + 1), state: i === 0 ? ("next" as const) : ("pending" as const),
}));

export function Landing() {
  const { startDemo, status } = useSession();
  const nav = useNavigate();
  const tryDemo = async () => { await startDemo(); nav("/app"); };
  return (
    <div className="min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Wordmark />
        <Button asChild variant="ghost"><Link to={status === "ready" ? "/app" : "/entrar"}>{status === "ready" ? "Abrir o app" : "Entrar"}</Link></Button>
      </header>

      <section className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-10 px-5 pb-14 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 rounded-full bg-graphite px-3 py-1 text-[13px] font-semibold text-lime">Para restaurantes, deliveries e motoboys</p>
          <h1 className="mt-4 text-[38px] font-extrabold leading-[1.05] tracking-tight md:text-[54px]">
            Fotografe as notinhas.<br /><span className="text-brand">Saia com a rota pronta.</span>
          </h1>
          <p className="mt-4 max-w-xl text-[17px] text-ink-2">
            Uma foto com várias notinhas vira uma lista de entregas numerada, com mapa, distância e tempo estimados.
            Você só resolve os endereços duvidosos — e abre a próxima parada no Google Maps com um toque.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button size="xl" onClick={tryDemo}><FlaskConical aria-hidden />Experimentar com dados fictícios</Button>
            <Button asChild size="xl" variant="secondary"><Link to="/cadastro">Criar conta<ArrowRight aria-hidden /></Link></Button>
          </div>
          <p className="mt-3 text-[13px] text-ink-3">A demonstração roda no seu navegador, com notinhas de exemplo e cálculos simulados identificados.</p>
        </div>

        <div className="relative min-w-0">
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-float)]">
            <img src="/demo/notinhas-foto-1.jpg" alt="Exemplo: cinco notinhas fictícias fotografadas lado a lado" className="aspect-[2.6/1] w-full object-cover object-top" />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <SchematicMap className="h-48" ariaLabel="Exemplo de rota com quatro paradas numeradas" origin={{ lat: DEMO_RESTAURANT.base.lat, lng: DEMO_RESTAURANT.base.lng }} stops={PREVIEW}
                path={[{ lat: DEMO_RESTAURANT.base.lat, lng: DEMO_RESTAURANT.base.lng }, ...PREVIEW]} />
              <ol className="space-y-1.5 text-[14px]">
                {["Pedido #2044 · Rua Cubatão, 1100", "Pedido #2046 · Rua Vergueiro, 2045", "Pedido #2041 · R. Domingos de Morais, 1450", "Pedidos #2042 e #2043 · R. Joaquim Távora, 820"].map((t, i) => (
                  <li key={t} className="flex items-center gap-2 rounded-lg bg-sunken px-2 py-1.5">
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${i === 0 ? "bg-brand text-white" : "bg-graphite text-white"}`}>{i + 1}</span>
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <p className="mt-2 text-center text-[12px] text-ink-3">Ilustração com dados fictícios.</p>
        </div>
      </section>

      <section className="bg-graphite py-14 text-white">
        <div className="mx-auto max-w-6xl px-5">
          <h2 className="text-2xl font-extrabold md:text-3xl">Três passos antes de sair</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { icon: Camera, t: "Fotografe", d: "Coloque as notinhas lado a lado e tire uma ou mais fotos. Cada pedido é identificado separadamente." },
              { icon: ClipboardCheck, t: "Resolva só as dúvidas", d: "Endereços lidos com segurança seguem direto. Os duvidosos aparecem destacados com a foto ao lado." },
              { icon: Navigation, t: "Siga a sequência", d: "Paradas numeradas no mapa. Um toque abre o Google Maps na próxima entrega; registre e continue." },
            ].map((s, i) => (
              <li key={s.t} className="rounded-2xl bg-graphite-2 p-5">
                <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-lime text-graphite"><s.icon className="size-6" aria-hidden /></span><span className="text-[13px] font-bold text-white/60">PASSO {i + 1}</span></div>
                <p className="mt-4 text-xl font-bold">{s.t}</p>
                <p className="mt-1 text-white/75">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-extrabold">Para o restaurante</h2>
            <p className="mt-2 text-ink-2">Cadastre o endereço de saída, prepare lotes, atribua ao entregador e acompanhe o que foi registrado no app — entregues, pendentes e tentativas sem sucesso.</p>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold">Para o motoboy</h2>
            <p className="mt-2 text-ink-2">Comece seu próprio lote sem depender de ninguém. Funciona no celular como app instalado e guarda seus registros mesmo sem sinal.</p>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={tryDemo}><FlaskConical aria-hidden />Ver a demonstração</Button>
          <Button asChild size="lg" variant="secondary"><Link to="/entrar">Entrar</Link></Button>
        </div>
      </section>
      <footer className="border-t border-line py-6 text-center text-[13px] text-ink-3">RotaPronta · tempos e distâncias são estimativas de planejamento · navegação guiada pelo Google Maps</footer>
    </div>
  );
}
