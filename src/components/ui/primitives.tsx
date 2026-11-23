import { AlertTriangle, CheckCircle2, Info, Loader2, WifiOff, XCircle, type LucideIcon } from "lucide-react";
import { forwardRef, useId, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "./button.tsx";

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...p} />;
}

type Tone = "neutral" | "success" | "warn" | "danger" | "info" | "dark";
const toneClass: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 border-line",
  success: "bg-brand-soft text-brand-strong border-brand/25",
  warn: "bg-warn-soft text-warn border-warn-line/60",
  danger: "bg-danger-soft text-danger border-danger/25",
  info: "bg-info-soft text-info border-info/25",
  dark: "bg-graphite text-white border-graphite",
};

/** Etiqueta de estado: sempre ícone + texto (não depende só da cor). */
export function Badge({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-semibold leading-none", toneClass[tone], className)}>
      {Icon && <Icon className="size-3.5" aria-hidden />}
      {children}
    </span>
  );
}

const bannerIcon: Record<Exclude<Tone, "neutral" | "dark">, LucideIcon> = { success: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info };

export function Banner({ tone = "info", title, children, action, className, icon }: {
  tone?: Exclude<Tone, "neutral" | "dark">; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; icon?: LucideIcon;
}) {
  const Icon = icon ?? bannerIcon[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border p-3.5 text-[15px]", toneClass[tone], className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-snug opacity-95">{children}</div>}
        {action && <div className="pt-1.5">{action}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className, label = "Carregando" }: { className?: string; label?: string }) {
  return <Loader2 className={cn("size-6 animate-spin text-ink-3", className)} aria-label={label} role="status" />;
}

export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-ink-2" role="status" aria-live="polite">
      <Spinner />
      <p className="text-[15px]">{label}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-sunken", className)} aria-hidden />;
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-sunken text-ink-2"><Icon className="size-7" aria-hidden /></div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <p className="mt-1 max-w-sm text-[15px] text-ink-2">{children}</p>}
      {action && <div className="mt-5 w-full max-w-xs">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Algo deu errado", message, onRetry, offline }: { title?: string; message?: string | null; onRetry?: () => void; offline?: boolean }) {
  const Icon = offline ? WifiOff : AlertTriangle;
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-danger-soft text-danger"><Icon className="size-7" aria-hidden /></div>
      <h2 className="text-lg font-semibold">{offline ? "Sem conexão" : title}</h2>
      <p className="mt-1 max-w-sm text-[15px] text-ink-2">{offline ? "Conecte-se à internet para carregar esta tela." : message}</p>
      {onRetry && <Button variant="secondary" className="mt-5" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}

type FieldProps = { label: string; hint?: ReactNode; error?: string | null; children: (id: string, describedBy: string | undefined) => ReactNode; optional?: boolean };
export function Field({ label, hint, error, children, optional }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[14px] font-semibold text-ink">
        {label} {optional && <span className="font-normal text-ink-3">(opcional)</span>}
      </label>
      {children(id, [hintId, errId].filter(Boolean).join(" ") || undefined)}
      {hint && !error && <p id={hintId} className="text-[13px] text-ink-3">{hint}</p>}
      {error && <p id={errId} className="text-[13px] font-medium text-danger">{error}</p>}
    </div>
  );
}

const inputClass = "block w-full min-h-12 rounded-xl border border-line bg-surface px-3.5 text-[16px] text-ink placeholder:text-ink-3 focus:border-info focus:outline-none focus:ring-2 focus:ring-info/30 disabled:bg-sunken aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(inputClass, className)} {...p} />
));
Input.displayName = "Input";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn(inputClass, "appearance-none bg-[length:20px] bg-[right_12px_center] bg-no-repeat pr-10", className)}
    style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2348514b' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p} />
));
Select.displayName = "Select";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(inputClass, "py-3", className)} {...p} />
));
Textarea.displayName = "Textarea";

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="min-w-0">
        <p id={id} className="text-[15px] font-semibold">{label}</p>
        {description && <p className="text-[13px] text-ink-3">{description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} disabled={disabled} onClick={() => onChange(!checked)}
        className={cn("relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors disabled:opacity-50", checked ? "border-brand bg-brand" : "border-line bg-sunken")}>
        <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[26px]" : "translate-x-0.5")} />
        <span className="sr-only">{checked ? "Ligado" : "Desligado"}</span>
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; icon?: LucideIcon }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-xl bg-sunken p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[14px] font-semibold transition-colors [&_svg]:size-4",
            value === o.value ? "bg-surface text-ink shadow-[var(--shadow-card)]" : "text-ink-2 hover:text-ink")}>
          {o.icon && <o.icon aria-hidden />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-3">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <p className="tabular truncate text-xl font-bold">{value}</p>
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}
