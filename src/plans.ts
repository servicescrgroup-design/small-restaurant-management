/** Pricing for business accounts. Keep in sync with supabase/migrations/0002 and (later) the Stripe prices. */
export const TRIAL_DAYS = 30;

export const PLANS = {
  monthly: { price: 99, months: 1 },
  yearly: { price: 999, months: 12 },
} as const;
export type PlanId = keyof typeof PLANS;

/** ฿99 × 12 − ฿999 */
export const YEARLY_SAVING = PLANS.monthly.price * 12 - PLANS.yearly.price;

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
