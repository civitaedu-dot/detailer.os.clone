import { Crosshair, Home } from "lucide-react";
import { useEffect, useState } from "react";
import type { LatLng } from "@core/types.ts";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input, Segmented, Switch } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { Base, StartFrom } from "@/data/types.ts";
import { getCurrentPosition, GeolocationError } from "@/lib/geolocation.ts";

export type OriginChoice = { startFrom: StartFrom; origin: LatLng | null; returnToBase: boolean; serviceMinutes: number };

/** Escolha da origem, retorno e tempo por parada antes de calcular a rota. */
export function OriginSheet({ open, onOpenChange, base, defaults, onConfirm, busy, title = "Como será a saída?" }: {
  open: boolean; onOpenChange: (v: boolean) => void; base: Base | null;
  defaults: { startFrom: StartFrom; returnToBase: boolean; serviceMinutes: number };
  onConfirm: (c: OriginChoice) => void; busy?: boolean; title?: string;
}) {
  const [startFrom, setStartFrom] = useState<StartFrom>(defaults.startFrom);
  const [ret, setRet] = useState(defaults.returnToBase);
  const [svc, setSvc] = useState(defaults.serviceMinutes);
  const [loc, setLoc] = useState<LatLng | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStartFrom(base ? defaults.startFrom : "current");
    setRet(!!base && defaults.returnToBase);
    setSvc(defaults.serviceMinutes);
    setErr(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function locate() {
    setLocBusy(true); setErr(null);
    try {
      const p = await getCurrentPosition();
      setLoc({ lat: p.lat, lng: p.lng });
    } catch (e) {
      setErr(e instanceof GeolocationError ? e.message : "Localização indisponível.");
      if (base) setStartFrom("base");
    } finally {
      setLocBusy(false);
    }
  }

  const canGo = startFrom === "base" ? !!base : !!loc;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title}
      footer={<Button size="lg" block disabled={!canGo} loading={busy} onClick={() => onConfirm({ startFrom, origin: startFrom === "current" ? loc : null, returnToBase: ret, serviceMinutes: svc })}>Calcular rota</Button>}>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[14px] font-semibold">Começar em</p>
          <Segmented label="Origem" value={startFrom} onChange={(v) => { setStartFrom(v); setErr(null); }}
            options={[{ value: "base", label: "Base", icon: Home }, { value: "current", label: "Onde estou", icon: Crosshair }]} />
          {startFrom === "base" && (base ? <p className="text-[14px] text-ink-2">{base.name} · {base.addressLine}</p> : <Banner tone="warn">Nenhuma base cadastrada. Use sua localização atual ou cadastre a base no Perfil.</Banner>)}
          {startFrom === "current" && (
            loc ? <Banner tone="success">Localização atual obtida.</Banner> : (
              <div className="space-y-2 rounded-xl bg-sunken p-3">
                <p className="text-[14px]">Para começar de onde você está, o app precisa da sua localização agora. Ela é usada só para calcular esta rota — não acompanhamos você em tempo real.</p>
                <Button variant="dark" block loading={locBusy} onClick={locate}><Crosshair aria-hidden />Usar minha localização</Button>
              </div>
            )
          )}
          {err && <Banner tone="danger">{err}{base ? " Vamos sair da base." : ""}</Banner>}
        </div>
        <Switch label="Voltar à base no fim" description={base ? "A rota termina na base. Desligado: termina na última entrega." : "Cadastre a base para usar o retorno."} checked={ret} onChange={setRet} disabled={!base} />
        <Field label="Tempo médio em cada entrega (minutos)" hint="Entra só nas estimativas de duração.">
          {(id, d) => <Input id={id} aria-describedby={d} type="number" inputMode="numeric" min={0} max={60} value={svc} onChange={(e) => setSvc(Math.max(0, Math.min(60, Number(e.target.value) || 0)))} />}
        </Field>
      </div>
    </Sheet>
  );
}
