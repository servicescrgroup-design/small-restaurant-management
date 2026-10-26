import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { AppState } from './types';
import type { Subscription } from './plans';

/**
 * Cloud accounts (Supabase). Each business has its own private data, readable only by its members
 * (enforced by Row Level Security in supabase/migrations). When the env vars below aren't set, the
 * app runs exactly as before: one business, stored only in this browser.
 */
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudEnabled = !!(URL && KEY);
export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(URL!, KEY!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

const sb = () => {
  if (!supabase) throw new Error('Cloud accounts are not configured');
  return supabase;
};

export interface BusinessSummary { id: string; name: string; role: 'owner' | 'manager'; created_at: string }

// ---------- Auth ----------

export const getSession = async (): Promise<Session | null> => (await sb().auth.getSession()).data.session;
export const onAuthChange = (cb: (s: Session | null) => void) => sb().auth.onAuthStateChange((_e, s) => cb(s)).data.subscription;

export async function signUp(email: string, password: string) {
  const { data, error } = await sb().auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
  if (error) throw error;
  // With email confirmation on, there's no session until the link in the email is clicked.
  return { needsConfirm: !data.session };
}

export async function signIn(email: string, password: string) {
  const { error } = await sb().auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export const signOut = async () => { await sb().auth.signOut(); };

export async function sendPasswordReset(email: string) {
  const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  if (error) throw error;
}

export async function changePassword(password: string) {
  const { error } = await sb().auth.updateUser({ password });
  if (error) throw error;
}

// ---------- Businesses ----------

export async function listBusinesses(): Promise<BusinessSummary[]> {
  const { data, error } = await sb()
    .from('business_members')
    .select('role, businesses(id, name, created_at)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).flatMap((r: { role: 'owner' | 'manager'; businesses: unknown }) => {
    const b = (Array.isArray(r.businesses) ? r.businesses[0] : r.businesses) as { id: string; name: string; created_at: string } | null;
    return b ? [{ id: b.id, name: b.name, created_at: b.created_at, role: r.role }] : [];
  });
}

export async function createBusiness(name: string, state: AppState): Promise<string> {
  const { data, error } = await sb().rpc('create_business', { p_name: name, p_state: state });
  if (error) throw error;
  return data as string;
}

export async function renameBusiness(id: string, name: string) {
  const { error } = await sb().from('businesses').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteBusiness(id: string, confirmName: string) {
  const { error } = await sb().rpc('delete_business', { p_business: id, p_confirm_name: confirmName });
  if (error) throw error;
}

// ---------- Business data ----------

export async function loadBusinessData(id: string): Promise<{ state: AppState; rev: string; updatedAt: string }> {
  const { data, error } = await sb().from('business_data').select('state, rev, updated_at').eq('business_id', id).single();
  if (error) throw error;
  return { state: data.state as AppState, rev: data.rev as string, updatedAt: data.updated_at as string };
}

export async function readBusinessRev(id: string): Promise<string | null> {
  const { data, error } = await sb().from('business_heads').select('rev').eq('business_id', id).single();
  if (error) return null;
  return data.rev as string;
}

/** Save if `baseRev` is still the latest; otherwise returns the newer state so the caller can rebase. */
export async function saveBusinessData(id: string, state: AppState, baseRev: string): Promise<{ ok: true; rev: string } | { ok: false; rev: string; state: AppState }> {
  const { data, error } = await sb().rpc('save_business_data', { p_business: id, p_state: state, p_base_rev: baseRev });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; rev: string; state: AppState | null };
  return row.ok ? { ok: true, rev: row.rev } : { ok: false, rev: row.rev, state: row.state as AppState };
}

/** Calls `onChange` whenever another device saves this business. */
export function watchBusiness(id: string, onChange: (rev: string) => void): () => void {
  const ch = sb()
    .channel(`business-${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'business_heads', filter: `business_id=eq.${id}` },
      (p) => onChange((p.new as { rev: string }).rev))
    .subscribe();
  return () => { void sb().removeChannel(ch); };
}

// ---------- Subscription (trial / plan) ----------

export async function loadSubscription(id: string): Promise<Subscription | null> {
  const { data, error } = await sb()
    .from('business_subscriptions')
    .select('status, plan, trial_ends_at, current_period_end')
    .eq('business_id', id)
    .maybeSingle();
  if (error || !data) return null;
  return { status: data.status, plan: data.plan, trialEndsAt: data.trial_ends_at, currentPeriodEnd: data.current_period_end };
}

/** Calls `onChange` when the business's plan changes (e.g. after paying on another device). */
export function watchSubscription(id: string, onChange: () => void): () => void {
  const ch = sb()
    .channel(`subscription-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_subscriptions', filter: `business_id=eq.${id}` }, () => onChange())
    .subscribe();
  return () => { void sb().removeChannel(ch); };
}

// ---------- Menu photo reader (api/menu-scan.ts) ----------

export interface ScannedVariant { label_th: string; label_en: string; price: number }
/** Where a dish's own photo is on the menu: picture number and a box as fractions of its size */
export interface PhotoBox { image: number; x: number; y: number; w: number; h: number }
export interface ScannedDish { name_th: string; name_en: string; variants: ScannedVariant[]; photo?: PhotoBox[] }
export interface ScannedMenu {
  sections: { category_th: string; category_en: string; dishes: ScannedDish[] }[];
  extras: { name_th: string; name_en: string; price: number }[];
  unsure: string[];
}
export type ScanError =
  | 'sign_in_required' | 'not_configured' | 'busy' | 'declined' | 'too_long' | 'unreadable' | 'too_big' | 'failed'
  | 'yearly_only' | 'trial_used' | 'daily_limit' | 'not_member';

/** Menu photo reading is a yearly-plan feature, with 3 reads during the free trial. */
export interface MenuReadStatus { plan: 'yearly' | 'trial' | 'none'; allowed: boolean; trial_left: number | null; reason: string | null }

export async function menuReadStatus(businessId: string): Promise<MenuReadStatus | null> {
  const { data, error } = await sb().rpc('menu_read_status', { p_business: businessId });
  if (error) return null;
  return ((data as MenuReadStatus[]) ?? [])[0] ?? null;
}

/** Send menu photos (base64 JPEG/PNG/WebP) to be read for this business. */
export async function scanMenu(businessId: string, images: { media_type: string; data: string }[]): Promise<ScannedMenu & { trial_left: number | null }> {
  const session = cloudEnabled ? await getSession() : null;
  if (!session) throw new Error('sign_in_required' satisfies ScanError);
  let r: Response;
  try {
    r = await fetch('/api/menu-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ business_id: businessId, images }),
    });
  } catch {
    throw new Error('failed' satisfies ScanError);
  }
  if (r.status === 413) throw new Error('too_big' satisfies ScanError);
  const body = await r.json().catch(() => null) as (ScannedMenu & { error?: string; trial_left: number | null }) | null;
  if (!r.ok || !body || body.error) {
    const known: ScanError[] = ['sign_in_required', 'not_configured', 'busy', 'declined', 'too_long', 'unreadable', 'yearly_only', 'trial_used', 'daily_limit', 'not_member'];
    throw new Error(known.includes(body?.error as ScanError) ? body!.error : 'failed');
  }
  return body;
}
