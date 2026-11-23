import { Check, Image as ImageIcon, MapPin, MinusCircle, PlusCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { BR_UFS, normalizeCep, normalizePhone } from "@core/address.ts";
import type { LatLng } from "@core/types.ts";
import { RouteMap } from "@/components/map/RouteMap.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input, Select } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { Backend } from "@/data/backend.ts";
import { applyLocation, confirmOrder, editAddress, excludeOrder, includeOrder } from "@/data/orderRules.ts";
import type { Base, BatchImage, Order } from "@/data/types.ts";
import { cn } from "@/lib/utils.ts";
import { addressLine, OrderStatusBadge, orderTitle, ReasonList, SourcePhotoSheet } from "./OrderBits.tsx";

const EXCLUDE_REASONS = ["Endereço incompleto", "Pedido repetido", "Vai em outra saída", "Cliente vai retirar", "Outro motivo"];

type Form = { street: string; number: string; neighborhood: string; city: string; uf: string; cep: string; complement: string; reference: string; phone: string; recipientName: string };
const toForm = (o: Order): Form => ({
  street: o.street ?? "", number: o.number ?? "", neighborhood: o.neighborhood ?? "", city: o.city ?? "", uf: o.uf ?? "", cep: o.cep ?? "",
  complement: o.complement ?? "", reference: o.reference ?? "", phone: o.phone ?? "", recipientName: o.recipientName ?? "",
});

/** Resolução de um pedido: editar endereço, escolher candidato, ajustar pino, confirmar ou retirar da saída. */
export function OrderEditor({ backend, order, image, base, open, onOpenChange, onChanged }: {
  backend: Backend; order: Order | null; image: BatchImage | null; base: Base | null; open: boolean; onOpenChange: (v: boolean) => void; onChanged: () => Promise<void>;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "pin" | "exclude">("view");
  const [pin, setPin] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "danger" | "warn" | "success"; text: string } | null>(null);
  const [photo, setPhoto] = useState(false);
  const [reason, setReason] = useState(EXCLUDE_REASONS[0]);

  useEffect(() => {
    if (open && order) {
      setForm(toForm(order));
      setMode(order.status === "not_found" || !order.street ? "edit" : "view");
      setPin(order.lat !== null && order.lng !== null ? { lat: order.lat, lng: order.lng } : base ? { lat: base.lat, lng: base.lng } : null);
      setMsg(null);
    }
  }, [open, order, base]);

  if (!order || !form) return null;

  async function act(label: string, fn: () => Promise<void>, close = false) {
    setBusy(label); setMsg(null);
    try {
      await fn();
      await onChanged();
      if (close) onOpenChange(false);
    } catch (e) {
      setMsg({ tone: "danger", text: e instanceof Error ? e.message : "Não foi possível salvar." });
    } finally {
      setBusy(null);
    }
  }

  const saveAddress = () => act("save", async () => {
    const cep = normalizeCep(form.cep);
    if (cep.invalid) throw new Error("CEP deve ter 8 dígitos.");
    if (!form.street.trim()) throw new Error("Informe a rua.");
    const phone = form.phone.trim() ? normalizePhone(form.phone) : null;
    if (form.phone.trim() && !phone) throw new Error("Telefone inválido. Use DDD + número.");
    const patch = editAddress(order, {
      street: form.street.trim(), number: form.number.trim() || null, neighborhood: form.neighborhood.trim() || null, city: form.city.trim() || null,
      uf: form.uf || null, cep: cep.cep, complement: form.complement.trim() || null, reference: form.reference.trim() || null,
      phone, recipientName: form.recipientName.trim() || null,
    });
    await backend.updateOrder(order.id, patch);
    try {
      await backend.geocode(order.batchId, { orderIds: [order.id], force: true });
      setMode("view");
    } catch (e) {
      setMode("pin");
      setMsg({ tone: "warn", text: `${e instanceof Error ? e.message : "Localização indisponível."} Marque o ponto no mapa.` });
    }
  });

  const candidates = order.candidates ?? [];
  const hasLocation = order.lat !== null && order.lng !== null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange} title={orderTitle(order)} description={order.recipientName ?? undefined} wide>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2"><OrderStatusBadge order={order} />{order.cityInferred && <span className="text-[13px] text-ink-3">Cidade assumida pela base</span>}</div>
          <div className="rounded-xl bg-sunken p-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Lido na notinha</p>
            <p className="mt-0.5 text-[15px]">{order.rawAddressText || "—"}</p>
            {image && <Button variant="ghost" className="-ml-3 mt-1" onClick={() => setPhoto(true)}><ImageIcon aria-hidden />Ver na foto</Button>}
          </div>
          <ReasonList order={order} showInfo />
          {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
          {order.duplicateOf && order.reviewReasons.includes("possible_duplicate") && (
            <Banner tone="warn" title="Pode ser o mesmo pedido de outra foto"
              action={<div className="flex flex-wrap gap-2">
                <Button variant="secondary" loading={busy === "dup-ex"} onClick={() => act("dup-ex", () => backend.updateOrder(order.id, excludeOrder("Pedido repetido")), true)}>Retirar repetido</Button>
                <Button variant="ghost" loading={busy === "dup-keep"} onClick={() => act("dup-keep", async () => {
                  const reasons = order.reviewReasons.filter((r) => r !== "possible_duplicate");
                  await backend.updateOrder(order.id, { reviewReasons: reasons, status: hasLocation && !reasons.some((r) => r !== "city_inferred") ? "ready" : order.status });
                })}>São pedidos diferentes</Button>
              </div>}>
              Mesmo número ou mesmo destinatário e endereço em fotos diferentes.
            </Banner>
          )}

          {order.status === "excluded" ? (
            <div className="space-y-2">
              <p className="text-[15px]">Retirado desta saída{order.excludedReason ? `: ${order.excludedReason}` : ""}.</p>
              <Button block loading={busy === "include"} onClick={() => act("include", () => backend.updateOrder(order.id, includeOrder(order)))}><PlusCircle aria-hidden />Incluir de novo</Button>
            </div>
          ) : mode === "edit" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Rua">{(id) => <Input id={id} value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />}</Field>
                <Field label="Número">{(id) => <Input id={id} value={form.number} inputMode="text" onChange={(e) => setForm({ ...form, number: e.target.value })} />}</Field>
              </div>
              <Field label="Bairro" optional>{(id) => <Input id={id} value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} />}</Field>
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <Field label="Cidade">{(id) => <Input id={id} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />}</Field>
                <Field label="UF">{(id) => <Select id={id} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value })}><option value="">—</option>{BR_UFS.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="CEP" optional>{(id) => <Input id={id} inputMode="numeric" value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />}</Field>
                <Field label="Complemento" optional>{(id) => <Input id={id} value={form.complement} onChange={(e) => setForm({ ...form, complement: e.target.value })} />}</Field>
              </div>
              <Field label="Referência" optional>{(id) => <Input id={id} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />}</Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Destinatário" optional>{(id) => <Input id={id} value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />}</Field>
                <Field label="Telefone" optional>{(id) => <Input id={id} type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />}</Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button loading={busy === "save"} onClick={saveAddress}><Search aria-hidden />Salvar e localizar</Button>
                <Button variant="secondary" onClick={() => setMode("view")}>Cancelar</Button>
              </div>
            </div>
          ) : mode === "pin" ? (
            <div className="space-y-3">
              <p className="text-[14px] text-ink-2">Toque no mapa ou arraste o marcador até a porta do cliente.</p>
              <RouteMap className="h-72" ariaLabel="Ajuste do local de entrega" stops={[]} origin={base ? { lat: base.lat, lng: base.lng } : null} pin={pin} onPinChange={setPin} />
              <div className="grid gap-2 sm:grid-cols-2">
                <Button disabled={!pin} loading={busy === "pin"} onClick={() => pin && act("pin", async () => { await backend.updateOrder(order.id, applyLocation(order, pin, "manual_pin")); setMode("view"); })}><MapPin aria-hidden />Usar este ponto</Button>
                <Button variant="secondary" onClick={() => setMode("view")}>Cancelar</Button>
              </div>
            </div>
          ) : mode === "exclude" ? (
            <div className="space-y-3">
              <Field label="Motivo">{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>{EXCLUDE_REASONS.map((r) => <option key={r}>{r}</option>)}</Select>}</Field>
              <p className="text-[14px] text-ink-2">O pedido continua no lote, marcado como fora desta saída. Nada é apagado.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="danger" loading={busy === "exclude"} onClick={() => act("exclude", () => backend.updateOrder(order.id, excludeOrder(reason)), true)}>Retirar desta saída</Button>
                <Button variant="secondary" onClick={() => setMode("view")}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">Endereço atual</p>
                <p className="text-[16px] font-semibold">{addressLine(order)}</p>
                <p className="text-[14px] text-ink-2">{[order.complement, order.city && `${order.city}${order.uf ? `/${order.uf}` : ""}`, order.cep].filter(Boolean).join(" · ")}</p>
              </div>
              {candidates.length > 1 && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-[14px] font-semibold">Locais possíveis — escolha o certo</legend>
                  {candidates.map((c, i) => {
                    const sel = order.lat === c.lat && order.lng === c.lng && order.provenance === "candidate_choice";
                    return (
                      <button key={i} type="button" aria-pressed={sel} onClick={() => act(`cand-${i}`, () => backend.updateOrder(order.id, applyLocation(order, c, "candidate_choice", c)))}
                        className={cn("flex w-full items-start gap-3 rounded-xl border p-3 text-left", sel ? "border-brand bg-brand-soft" : "border-line")}>
                        <MapPin className="mt-0.5 size-5 shrink-0" aria-hidden />
                        <span className="text-[15px]">{c.formattedAddress}{c.precision !== "rooftop" && c.precision !== "interpolated" && <span className="block text-[13px] text-warn">Aproximado</span>}</span>
                      </button>
                    );
                  })}
                </fieldset>
              )}
              {hasLocation && (
                <RouteMap className="h-48" ariaLabel="Local do pedido" stops={[{ id: order.id, lat: order.lat!, lng: order.lng!, label: "•", state: order.status === "ready" ? "next" : "review" }]} origin={base ? { lat: base.lat, lng: base.lng } : null} />
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {order.status !== "ready" && hasLocation && (
                  <Button loading={busy === "confirm"} onClick={() => act("confirm", () => backend.updateOrder(order.id, confirmOrder(order)), true)}><Check aria-hidden />Está certo, incluir</Button>
                )}
                <Button variant="secondary" onClick={() => setMode("edit")}>Editar endereço</Button>
                <Button variant="secondary" onClick={() => setMode("pin")}><MapPin aria-hidden />Ajustar no mapa</Button>
                <Button variant="ghost" className="text-danger" onClick={() => setMode("exclude")}><MinusCircle aria-hidden />Retirar desta saída</Button>
              </div>
            </div>
          )}
        </div>
      </Sheet>
      <SourcePhotoSheet backend={backend} image={image} order={order} open={photo} onOpenChange={setPhoto} />
    </>
  );
}
