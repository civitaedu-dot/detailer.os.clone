import { useEffect, useRef, useState } from "react";
import { BR_UFS, normalizeCep, normalizePhone } from "@core/address.ts";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input, Select } from "@/components/ui/primitives.tsx";
import { Sheet } from "@/components/ui/sheet.tsx";
import type { Backend } from "@/data/backend.ts";
import type { Base } from "@/data/types.ts";
import { uuid } from "@/lib/utils.ts";

/** Inclusão manual: alternativa de recuperação quando a foto não pôde ser lida. */
export function ManualOrderSheet({ backend, batchId, base, open, onOpenChange, onAdded }: {
  backend: Backend; batchId: string; base: Base | null; open: boolean; onOpenChange: (v: boolean) => void; onAdded: () => Promise<void>;
}) {
  const empty = { orderCode: "", recipientName: "", phone: "", street: "", number: "", neighborhood: "", city: base?.city ?? "", uf: base?.uf ?? "", cep: "", complement: "", reference: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(uuid());
  useEffect(() => { if (open) { setF(empty); setErr(null); key.current = uuid(); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save() {
    setErr(null);
    const cep = normalizeCep(f.cep);
    if (cep.invalid) return setErr("CEP deve ter 8 dígitos.");
    const phone = f.phone.trim() ? normalizePhone(f.phone) : null;
    if (f.phone.trim() && !phone) return setErr("Telefone inválido. Use DDD + número.");
    setBusy(true);
    try {
      const o = await backend.addManualOrder(batchId, {
        orderCode: f.orderCode.trim() || null, recipientName: f.recipientName.trim() || null, phone, street: f.street.trim(), number: f.number.trim() || null,
        neighborhood: f.neighborhood.trim() || null, city: f.city.trim() || null, uf: f.uf || null, cep: cep.cep, complement: f.complement.trim() || null, reference: f.reference.trim() || null,
      }, key.current);
      await backend.geocode(batchId, { orderIds: [o.id], force: true }).catch(() => undefined);
      await onAdded();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Não foi possível incluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Incluir pedido" description="Preencha o endereço de entrega. A localização é buscada em seguida."
      footer={<Button size="lg" block loading={busy} disabled={f.street.trim().length < 3} onClick={save}>Incluir e localizar</Button>}>
      <div className="space-y-3">
        {err && <Banner tone="danger">{err}</Banner>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nº do pedido" optional>{(id) => <Input id={id} value={f.orderCode} onChange={set("orderCode")} />}</Field>
          <Field label="Destinatário" optional>{(id) => <Input id={id} value={f.recipientName} onChange={set("recipientName")} />}</Field>
        </div>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Rua">{(id) => <Input id={id} value={f.street} onChange={set("street")} autoFocus />}</Field>
          <Field label="Número">{(id) => <Input id={id} value={f.number} onChange={set("number")} />}</Field>
        </div>
        <Field label="Bairro" optional>{(id) => <Input id={id} value={f.neighborhood} onChange={set("neighborhood")} />}</Field>
        <div className="grid grid-cols-[1fr_96px] gap-3">
          <Field label="Cidade">{(id) => <Input id={id} value={f.city} onChange={set("city")} />}</Field>
          <Field label="UF">{(id) => <Select id={id} value={f.uf} onChange={set("uf")}><option value="">—</option>{BR_UFS.map((u) => <option key={u}>{u}</option>)}</Select>}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Complemento" optional>{(id) => <Input id={id} value={f.complement} onChange={set("complement")} />}</Field>
          <Field label="CEP" optional>{(id) => <Input id={id} inputMode="numeric" value={f.cep} onChange={set("cep")} />}</Field>
        </div>
        <Field label="Referência" optional>{(id) => <Input id={id} value={f.reference} onChange={set("reference")} />}</Field>
        <Field label="Telefone" optional>{(id) => <Input id={id} type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} />}</Field>
      </div>
    </Sheet>
  );
}
