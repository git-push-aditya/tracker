// Day numbers = days since the Unix epoch, UTC. Ported as-is from refer.html.
export const DAY = 86400000;
export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const isISO = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
export function toDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
}
export const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export function todayDay() {
  const t = new Date();
  return Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / DAY;
}
export function parts(n: number) {
  const d = new Date(n * DAY);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() };
}
export const monthStart = (n: number) => { const p = parts(n); return Date.UTC(p.y, p.m, 1) / DAY; };
export const addMonths = (n: number, k: number) => { const p = parts(n); return Date.UTC(p.y, p.m + k, 1) / DAY; };
export const quarterStart = (n: number) => { const p = parts(n); return Date.UTC(p.y, p.m - (p.m % 3), 1) / DAY; };
export const fmtShort = (n: number) => { const p = parts(n); return p.d + " " + MON[p.m]; };
export const fmt = (n: number) => { const p = parts(n); return p.d + " " + MON[p.m] + " " + p.y; };
