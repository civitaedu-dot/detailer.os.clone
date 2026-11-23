import { Crosshair, MapPin, Search } from "lucide-react";
import { useState } from "react";
import { BR_UFS } from "@core/address.ts";
import type { GeocodeCandidate, LatLng } from "@core/types.ts";
import { RouteMap } from "@/components/map/RouteMap.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input, Select } from "@/components/ui/primitives.tsx";
import type { Backend } from "@/data/backend.ts";
import { BackendError, type Base } from "@/data/types.ts";
import { getCurrentPosition, GeolocationError } from "@/lib/geolocation.ts";
import { cn } from "@/lib/utils.ts";

type Draft = { name: string; address: string; city: string; uf: string };

/** Cadastro da base com localização verificada (busca, GPS no local ou ajuste no mapa). */
export function BaseForm({ backend, initial, onSaved, submitLabel = "Salvar base", allowSkip, onSkip }: {
  backend: Backend; initial?: Base | null; onSaved: (b: Base) => void; submitLabel?: string; allowSkip?: boolean; onSkip?: () => void;
}) {
  const [d, setD] = useState<Draft>({ name: initial?.name ?? "", address: initial?.addressLine ?? "", city: initial?.city ?? "", uf: initial?.uf ?? "SP" });
  const [loc, setLoc] = useState<(LatLng & { provenance: Base["provenance"]; label?: string }) | null>(
    initial ? { lat: initial.lat, lng: initial.lng, provenance: initial.provenance } : null,
  );
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null);
  const [busy, setBusy] = useState<"search" | "gps" | "save" | null>(null);
  const [msg, setMsg] = useState<{ tone: "danger" | "warn" | "info"; text: string } | null>(null);
  const [adjust, setAdjust] = useState(false);

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => { setD({ ...d, [k]: e.target.value }); setCandidates(null); };

  async function search() {
    setBusy("search"); setMsg(null);
    try {
      const list = await backend.geocodeText(`${d.address}, ${d.city} - ${d.uf}, Brasil`, null);
      setCandidates(list);
      if (!list.length) setMsg({ tone: "warn", text: "Endereço não encontrado. Confira o texto, use sua localização atual no local ou marque no mapa." });
      else if (list.length === 1 && (list[0].precision === "rooftop" || list[0].precision === "interpolated")) {
        setLoc({ lat: list[0].lat, lng: list[0].lng, provenance: "provider", label: list[0].formattedAddress });
      }
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof BackendError ? e.message : "Não foi possível buscar agora." });
    } finally {
      setBusy(null);
    }
  }

  async function gps() {
    setBusy("gps"); setMsg(null);
    try {
      const p = await getCurrentPosition();
      setLoc({ lat: p.lat, lng: p.lng, provenance: "manual_pin", label: `Localização do aparelho (precisão ~${Math.round(p.accuracy)} m)` });
      if (p.accuracy > 80) setMsg({ tone: "warn", text: "A precisão está baixa. Se puder, ajuste o ponto no mapa." });
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof GeolocationError ? e.message : "Localização indisponível." });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!loc) return;
    setBusy("save"); setMsg(null);
    try {
      const b = await backend.saveBase({ id: initial?.id, name: d.name.trim(), addressLine: d.address.trim(), city: d.city.trim(), uf: d.uf, lat: loc.lat, lng: loc.lng, provenance: loc.provenance });
      onSaved(b);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Não foi possível salvar." });
    } finally {
      setBusy(null);
    }
  }

  const filled = d.name.trim() && d.address.trim().length > 4 && d.city.trim();

  return (
    <div className="space-y-4">
      <Field label="Nome da base">{(id) => <Input id={id} placeholder="Ex.: Cantina da Rua 7" value={d.name} onChange={set("name")} />}</Field>
      <Field label="Endereço (rua, número e bairro)">{(id) => <Input id={id} autoComplete="street-address" placeholder="Rua Exemplo, 123 - Centro" value={d.address} onChange={set("address")} />}</Field>
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <Field label="Cidade">{(id) => <Input id={id} autoComplete="address-level2" value={d.city} onChange={set("city")} />}</Field>
        <Field label="UF">{(id) => <Select id={id} value={d.uf} onChange={set("uf")}>{BR_UFS.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={search} loading={busy === "search"} disabled={!filled}><Search aria-hidden />Verificar endereço</Button>
        <Button variant="secondary" onClick={gps} loading={busy === "gps"}><Crosshair aria-hidden />Estou na base agora</Button>
      </div>
      <p className="text-[13px] text-ink-3">“Estou na base agora” pede a localização do aparelho uma única vez, só para marcar o ponto de saída.</p>

      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      {candidates && candidates.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[14px] font-semibold">Qual destes é o local certo?</legend>
          {candidates.map((c, i) => {
            const selected = loc?.lat === c.lat && loc?.lng === c.lng;
            const approx = c.precision !== "rooftop" && c.precision !== "interpolated";
            return (
              <button key={i} type="button" onClick={() => setLoc({ lat: c.lat, lng: c.lng, provenance: "candidate_choice", label: c.formattedAddress })}
                className={cn("flex w-full items-start gap-3 rounded-xl border p-3 text-left", selected ? "border-brand bg-brand-soft" : "border-line bg-surface")}
                aria-pressed={selected}>
                <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span className="text-[15px]">{c.formattedAddress}{approx && <span className="block text-[13px] text-warn">Aproximado — ajuste o ponto no mapa</span>}</span>
              </button>
            );
          })}
        </fieldset>
      )}

      {loc && (
        <div className="space-y-2">
          <RouteMap className="h-56" ariaLabel="Localização da base" stops={[]} origin={adjust ? null : loc} pin={adjust ? loc : null}
            onPinChange={adjust ? (p) => setLoc({ ...p, provenance: "manual_pin", label: "Ponto ajustado no mapa" }) : undefined} />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-ink-2">{loc.label ?? "Localização verificada"}</p>
            <Button variant="ghost" onClick={() => setAdjust(!adjust)}>{adjust ? "Concluir ajuste" : "Ajustar no mapa"}</Button>
          </div>
        </div>
      )}

      <Button size="lg" block onClick={save} loading={busy === "save"} disabled={!filled || !loc}>{submitLabel}</Button>
      {!loc && filled && <p className="text-center text-[13px] text-ink-3">Verifique a localização para salvar.</p>}
      {allowSkip && <Button variant="ghost" block onClick={onSkip}>Pular por enquanto</Button>}
    </div>
  );
}
