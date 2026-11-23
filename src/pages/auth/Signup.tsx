import { MailCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input } from "@/components/ui/primitives.tsx";
import { getRealBackend, useSession } from "@/data/session.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function Signup() {
  const { realAvailable, chooseReal, refresh } = useSession();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Use uma senha com pelo menos 8 caracteres."); return; }
    chooseReal();
    setBusy(true); setError(null);
    try {
      const b = getRealBackend();
      if (!b) throw new Error("Servidor não configurado.");
      const r = await b.signUp(email.trim(), password, name.trim());
      if (r.needsConfirmation) setSent(true);
      else { await refresh(); nav("/configurar", { replace: true }); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Confirme seu e-mail">
        <Banner tone="success" icon={MailCheck} title="Enviamos um link de confirmação">
          Abra o e-mail enviado para <strong>{email}</strong> e toque no link. Depois, entre com sua senha.
        </Banner>
        <Button asChild variant="dark" size="lg" block className="mt-5"><Link to="/entrar">Ir para o login</Link></Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Criar conta" subtitle="Leva menos de um minuto. Você escolhe depois se é restaurante ou entregador." footer={<>Já tem conta? <Link className="font-semibold text-brand-strong underline" to="/entrar">Entrar</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Banner tone="danger">{error}</Banner>}
        <Field label="Seu nome">{(id) => <Input id={id} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} disabled={!realAvailable} />}</Field>
        <Field label="E-mail">{(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!realAvailable} />}</Field>
        <Field label="Senha" hint="Mínimo de 8 caracteres.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={!realAvailable} />}</Field>
        <Button type="submit" size="lg" block loading={busy} disabled={!realAvailable || !email || !password || !name}>Criar conta</Button>
      </form>
    </AuthLayout>
  );
}
