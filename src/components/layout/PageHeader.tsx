import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string | true; actions?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="flex items-start gap-2 px-4 pb-3 pt-4 md:px-8 md:pt-7">
      {back && (
        <button type="button" onClick={() => (back === true ? nav(-1) : nav(back))} aria-label="Voltar"
          className="-ml-2 grid size-12 shrink-0 place-items-center rounded-xl text-ink hover:bg-sunken">
          <ArrowLeft className="size-6" />
        </button>
      )}
      <div className="min-w-0 flex-1 pt-1">
        <h1 className="text-[22px] font-extrabold leading-tight tracking-tight md:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[14px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 md:px-8 ${className}`}>{children}</div>;
}
