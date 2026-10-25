/** Pricing for business accounts. Keep in sync with supabase/migrations/0002 and (later) the Stripe prices. */
export const TRIAL_DAYS = 30;

/** Prices are shown in baht in Thai and in US dollars in English. */
export type PlanCurrency = 'THB' | 'USD';
export const planCurrency = (lang: string): PlanCurrency => (lang === 'th' ? 'THB' : 'USD');

export const PLANS = {
  monthly: { months: 1, price: { THB: 99, USD: 2.99 } },
  yearly: { months: 12, price: { THB: 999, USD: 29.99 } },
} as const;
export type PlanId = keyof typeof PLANS;

const cents = (n: number) => Math.round(n * 100) / 100;

/** Plan prices in one currency, plus the yearly saving (12 × monthly − yearly) and the yearly price per month. */
export function planPrices(cur: PlanCurrency) {
  const monthly = PLANS.monthly.price[cur];
  const yearly = PLANS.yearly.price[cur];
  return {
    monthly,
    yearly,
    yearlySaving: cents(monthly * 12 - yearly),
    yearlyPerMonth: cur === 'THB' ? Math.round(yearly / 12) : cents(yearly / 12),
  };
}

/** ฿99, ฿1,188 · $2.99, $30 */
export function fmtPlanPrice(n: number, cur: PlanCurrency) {
  const digits = Number.isInteger(n) ? 0 : 2;
  const s = n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return cur === 'THB' ? `฿${s}` : `$${s}`;
}

/** Online payment isn't switched on yet; flip this when Stripe is connected. */
export const PAYMENTS_ENABLED = false;

export interface Subscription {
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  plan: PlanId | null;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
}

export type AccessState = 'trial' | 'active' | 'pastDue' | 'expired';

const DAY = 86_400_000;
const GRACE_DAYS = 3;

/** Same rule the database uses before accepting a save (business_has_access). */
export function accessOf(sub: Subscription | null, now = Date.now()): { state: AccessState; daysLeft: number; canSave: boolean } {
  if (!sub) return { state: 'trial', daysLeft: TRIAL_DAYS, canSave: true };
  if (sub.status === 'trialing') {
    const left = new Date(sub.trialEndsAt).getTime() - now;
    return left > 0
      ? { state: 'trial', daysLeft: Math.ceil(left / DAY), canSave: true }
      : { state: 'expired', daysLeft: 0, canSave: false };
  }
  if (sub.status === 'active' || sub.status === 'past_due') {
    const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : now;
    const canSave = end + GRACE_DAYS * DAY > now;
    const daysLeft = Math.max(0, Math.ceil((end - now) / DAY));
    if (!canSave) return { state: 'expired', daysLeft: 0, canSave };
    return { state: sub.status === 'past_due' || end < now ? 'pastDue' : 'active', daysLeft, canSave };
  }
  return { state: 'expired', daysLeft: 0, canSave: false };
}
