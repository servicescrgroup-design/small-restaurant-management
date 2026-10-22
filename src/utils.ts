import { getLocale, translate } from './i18n';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

export function daysUntil(dateStr: string, from: string = localDate()): number {
  return Math.round((parseDate(dateStr).getTime() - parseDate(from).getTime()) / 86400000);
}

export const orderDay = (iso: string) => localDate(new Date(iso));

export const round = (n: number, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function makeMoney(currency: string, locale: string = getLocale()) {
  let f: Intl.NumberFormat;
  try {
    // narrowSymbol shows ฿ / $ instead of THB / US$
    f = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' });
  } catch {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
  }
  return (n: number) => f.format(Number.isFinite(n) ? n : 0);
}

/** Format a fraction (0.284) as a percent string (28.4%). */
export const pct = (fraction: number, digits = 1) =>
  Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : '—';

export function fmtDate(s: string): string {
  return parseDate(s).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(getLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function expiryLabel(expiresAt?: string): { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted'; days: number } {
  if (!expiresAt) return { text: translate('common.expiry.none'), tone: 'muted', days: Infinity };
  const d = daysUntil(expiresAt);
  if (d < 0) return { text: translate('common.expiry.expiredAgo', { n: -d }), tone: 'bad', days: d };
  if (d === 0) return { text: translate('common.expiry.today'), tone: 'bad', days: d };
  if (d === 1) return { text: translate('common.expiry.tomorrow'), tone: 'warn', days: d };
  return { text: translate('common.expiry.daysLeft', { n: d }), tone: d <= 3 ? 'warn' : 'ok', days: d };
}

/** Format a whole number with the current language's digit grouping. */
export const fmtInt = (n: number) => Math.round(n).toLocaleString(getLocale());

/** Day/month label in the current language, e.g. "Thursday, October 22" / "วันพฤหัสบดีที่ 22 ตุลาคม". */
export const fmtLongDate = (s: string) =>
  parseDate(s).toLocaleDateString(getLocale(), { weekday: 'long', month: 'long', day: 'numeric' });

/** Short time like "11:04 PM" / "23:04". */
export const fmtTime = (d: Date) => d.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' });
