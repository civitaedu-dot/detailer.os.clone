import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input } from "@/components/ui/primitives.tsx";
import { getRealBackend, useSession } from "@/data/session.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function Login() {
  const { backend, realAvailable, status, mode, chooseReal } = useSession();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "ready" && mode === "real") return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (backend?.mode !== "real") chooseReal();
    setBusy(true); setError(null);
    try {
      const b = getRealBackend();
      if (!b) throw new Error("Servidor não configurado.");
      await b.signIn(email.trim(), password);
      nav("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Entrar" subtitle="Acesse sua conta de restaurante ou de entregador." footer={<>Não tem conta? <Link className="font-semibold text-brand-strong underline" to="/cadastro">Criar conta</Link></>}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Banner tone="danger">{error}</Banner>}
        <Field label="E-mail">{(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!realAvailable} />}</Field>
        <Field label="Senha">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={!realAvailable} />}</Field>
        <Button type="submit" size="lg" block loading={busy} disabled={!realAvailable || !email || !password}>Entrar</Button>
        <p className="text-center"><Link to="/recuperar" className="inline-flex min-h-12 items-center text-[15px] font-semibold text-ink-2 underline">Esqueci minha senha</Link></p>
      </form>
    </AuthLayout>
  );
}
