const TZ = "America/Sao_Paulo";

const dateTime = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const time = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateLong = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

export const fmtDateTime = (iso: string) => dateTime.format(new Date(iso)).replace(",", " ·");
export const fmtTime = (iso: string | Date) => time.format(typeof iso === "string" ? new Date(iso) : iso);
export const fmtDateLong = (iso: string) => dateLong.format(new Date(iso));
export const isToday = (iso: string) => dayKey.format(new Date(iso)) === dayKey.format(new Date());
export const fmtWhen = (iso: string) => (isToday(iso) ? `Hoje, ${fmtTime(iso)}` : fmtDateTime(iso));

export function addSeconds(base: Date, s: number) {
  return new Date(base.getTime() + s * 1000);
}
