import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Wordmark } from "@/components/layout/Brand.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Banner } from "@/components/ui/primitives.tsx";
import { useSession } from "@/data/session.tsx";

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  const { realAvailable, startDemo } = useSession();
  const nav = useNavigate();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-between bg-graphite p-10 text-white lg:flex">
        <Link to="/"><Wordmark light /></Link>
        <div className="max-w-md">
          <p className="text-3xl font-extrabold leading-tight">Fotografe as notinhas.<br />Saia com a rota pronta.</p>
          <p className="mt-3 text-white/75">Leitura dos endereços, dúvidas destacadas, sequência organizada e navegação no Google Maps com um toque.</p>
        </div>
        <p className="text-sm text-white/50">Feito para restaurantes, deliveries e motoboys.</p>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-col px-5 py-8 lg:justify-center">
        <Link to="/" className="mb-8 lg:hidden"><Wordmark /></Link>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-2">{subtitle}</p>}
        {!realAvailable && (
          <Banner tone="warn" className="mt-5" title="Contas ainda não disponíveis neste ambiente">
            O servidor (Supabase) não está configurado aqui. Você pode explorar tudo na demonstração com dados fictícios.
          </Banner>
        )}
        <div className="mt-6">{children}</div>
        <div className="mt-6 border-t border-line pt-6">
          <Button variant="secondary" block size="lg" onClick={async () => { await startDemo(); nav("/app"); }}>
            <FlaskConical aria-hidden /> Experimentar a demonstração
          </Button>
        </div>
        {footer && <div className="mt-6 text-center text-[15px] text-ink-2">{footer}</div>}
      </div>
    </div>
  );
}
