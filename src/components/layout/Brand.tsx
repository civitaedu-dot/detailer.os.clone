import { cn } from "@/lib/utils.ts";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-9", className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#1F2421" />
      <path d="M17 46c0-9 9-9 14-14s5-14 15-14" fill="none" stroke="#3DDC84" strokeWidth="5" strokeLinecap="round" />
      <circle cx="17" cy="46" r="6" fill="#fff" /><circle cx="46" cy="18" r="6" fill="#3DDC84" /><circle cx="31" cy="32" r="4" fill="#fff" />
    </svg>
  );
}

export function Wordmark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[19px] font-extrabold tracking-tight", light ? "text-white" : "text-ink", className)}>
      <Logo className="size-8" />Rota<span className={light ? "text-lime" : "text-brand"}>Pronta</span>
    </span>
  );
}
