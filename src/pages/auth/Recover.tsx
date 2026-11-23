import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.tsx";
import { Banner, Field, Input } from "@/components/ui/primitives.tsx";
import { getRealBackend, useSession } from "@/data/session.tsx";
import { AuthLayout } from "./AuthLayout.tsx";

export function ForgotPassword() {
  const { realAvailable } = useSession();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("busy"); setError(null);
    try {
      const b = getRealBackend();
      if (!b) throw new Error("Servidor não configurado.");
      await b.requestPasswordReset(email.trim());
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar.");
      setState("idle");
    }
  }
  return (
    <AuthLayout title="Recuperar acesso" subtitle="Enviaremos um link para você criar uma nova senha." footer={<Link className="font-semibold underline" to="/entrar">Voltar ao login</Link>}>
      {state === "sent" ? (
        <Banner tone="success" title="Verifique seu e-mail">Se existir uma conta com {email}, você receberá o link em instantes.</Banner>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Banner tone="danger">{error}</Banner>}
          <Field label="E-mail">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!realAvailable} />}</Field>
          <Button type="submit" size="lg" block loading={state === "busy"} disabled={!realAvailable || !email}>Enviar link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPassword() {
  const { backend, user } = useSession();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { if (user) setReady(true); }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setError("Use pelo menos 8 caracteres."); return; }
    setBusy(true); setError(null);
    try {
      await backend!.updatePassword(pw);
      nav("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível alterar a senha.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthLayout title="Nova senha">
      {!ready ? (
        <Banner tone="info">Abra esta página pelo link recebido por e-mail. Se o link expirou, <Link className="underline" to="/recuperar">peça outro</Link>.</Banner>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Banner tone="danger">{error}</Banner>}
          <Field label="Nova senha" hint="Mínimo de 8 caracteres.">{(id, d) => <Input id={id} aria-describedby={d} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          <Button type="submit" size="lg" block loading={busy}>Salvar nova senha</Button>
        </form>
      )}
    </AuthLayout>
  );
}
