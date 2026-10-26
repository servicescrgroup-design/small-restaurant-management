import type { PaymentFee } from './types';

/**
 * Payment methods are saved as the text the shop chose, in whatever language the app was in at the
 * time ("เงินสด" or "Cash"). The common ones are recognised in either language so they show once,
 * in the current language. Anything else (a delivery app, a wallet the owner typed) shows as typed.
 */
const KNOWN: Record<string, { en: string; th: string; aliases: string[] }> = {
  cash: { en: 'Cash', th: 'เงินสด', aliases: ['cash', 'เงินสด'] },
  card: { en: 'Card', th: 'บัตร', aliases: ['card', 'credit card', 'debit card', 'บัตร', 'บัตรเครดิต', 'บัตรเดบิต'] },
  promptpay: { en: 'PromptPay QR', th: 'พร้อมเพย์ / QR', aliases: ['promptpay qr', 'promptpay', 'promptpay / qr', 'qr', 'พร้อมเพย์', 'พร้อมเพย์ qr', 'พร้อมเพย์ / qr'] },
  mobile: { en: 'Mobile pay', th: 'จ่ายผ่านมือถือ', aliases: ['mobile pay', 'จ่ายผ่านมือถือ'] },
  gift: { en: 'Gift card', th: 'บัตรของขวัญ', aliases: ['gift card', 'บัตรของขวัญ'] },
};

const squash = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Which known method this is ("cash", "card", …), or null for the shop's own ones. */
export function methodKey(name: string): string | null {
  const n = squash(name);
  for (const [key, m] of Object.entries(KNOWN)) if (m.aliases.includes(n)) return key;
  return null;
}

/** The method's name in the current language. */
export function methodLabel(name: string, lang: string): string {
  const key = methodKey(name);
  return key ? KNOWN[key][lang === 'th' ? 'th' : 'en'] : name;
}

/** The name to save for a known method, in the current language. */
export const knownMethod = (key: keyof typeof KNOWN | string, lang: string) => KNOWN[key][lang === 'th' ? 'th' : 'en'];

/** Same method, even if one was saved in Thai and the other in English. */
export function sameMethod(a: string, b: string) {
  const ka = methodKey(a);
  return ka ? ka === methodKey(b) : squash(a) === squash(b);
}

/** Drop repeats ("Cash" and "เงินสด"), keeping the first. */
export function dedupeMethods(list: string[]): string[] {
  const out: string[] = [];
  for (const m of list) if (m.trim() && !out.some((x) => sameMethod(x, m))) out.push(m);
  return out;
}

/** The automatic charge set for a method, wherever it was saved under the other language's name. */
export function feeFor(fees: Record<string, PaymentFee> | undefined, method: string): PaymentFee | undefined {
  if (!fees) return undefined;
  if (fees[method]) return fees[method];
  const k = Object.keys(fees).find((x) => sameMethod(x, method));
  return k ? fees[k] : undefined;
}
