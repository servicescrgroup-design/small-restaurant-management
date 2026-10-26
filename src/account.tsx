import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  acceptInvite, cloudEnabled, createBusiness, getSession, listBusinesses, loadSubscription, onAuthChange, sendPasswordReset, signIn, signOut, signUp,
  watchSubscription, type BusinessSummary,
} from './cloud';
import { accessOf, fmtPlanPrice, planCurrency, planPrices, TRIAL_DAYS, type Subscription } from './plans';
import { cloudBackend, localBackend, normalize, readLocalData, StoreProvider } from './store';
import { LangSwitch, useI18n } from './i18n';
import { ThemeSwitch } from './theme';
import { demoState, emptyState } from './demo';
import type { AppState } from './types';

/**
 * Business accounts. Signs the owner in (email + password), picks which business this device runs,
 * and gives that business's private cloud data to the app. Staff then use their PINs as before.
 * Without cloud settings the app runs on this browser's data, exactly as before.
 */

interface AccountCtx {
  session: Session;
  business: BusinessSummary;
  businesses: BusinessSummary[];
  switchBusiness: (id: string | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Trial / plan for this business (null while loading or if it couldn't be read) */
  subscription: Subscription | null;
  access: ReturnType<typeof accessOf>;
}

const Ctx = createContext<AccountCtx | null>(null);
/** Null when running in this-browser-only mode. */
export const useAccount = () => useContext(Ctx);

const BIZ_KEY = 'mise-business';
const rememberBiz = (id: string | null) => { try { if (id) localStorage.setItem(BIZ_KEY, id); else localStorage.removeItem(BIZ_KEY); } catch { /* ignore */ } };
const rememberedBiz = () => { try { return localStorage.getItem(BIZ_KEY); } catch { return null; } };

// An invite link (…/#join=CODE) is kept until the person has signed in, then used once
const JOIN_KEY = 'mise-join';
const JOINED_KEY = 'mise-joined';
const takeJoinFromHash = () => {
  const m = window.location.hash.match(/join=([a-f0-9]{16,64})/i);
  if (!m) return false;
  try { localStorage.setItem(JOIN_KEY, m[1].toLowerCase()); } catch { /* ignore */ }
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return true;
};
export const pendingJoin = () => { try { return localStorage.getItem(JOIN_KEY); } catch { return null; } };
const clearJoin = () => { try { localStorage.removeItem(JOIN_KEY); } catch { /* ignore */ } };
/** The business this login just joined as an owner, until they've set up their own PIN there */
export const justJoined = () => { try { return localStorage.getItem(JOINED_KEY); } catch { return null; } };
export const clearJustJoined = () => { try { localStorage.removeItem(JOINED_KEY); } catch { /* ignore */ } };

export function AccountGate({ children }: { children: ReactNode }) {
  if (!cloudEnabled) return <StoreProvider backend={localBackend}>{children}</StoreProvider>;
  return <CloudGate>{children}</CloudGate>;
}

function CloudGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [businesses, setBusinesses] = useState<BusinessSummary[] | null>(null);
  const [bizId, setBizId] = useState<string | null>(rememberedBiz);
  const [error, setError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinTick, setJoinTick] = useState(0);

  useEffect(() => {
    takeJoinFromHash();
    // Opening an invite link while already signed in joins right away
    const onHash = () => { if (takeJoinFromHash()) setJoinTick((n) => n + 1); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    getSession().then(setSession).catch(() => setSession(null));
    const sub = onAuthChange((s) => setSession(s));
    return () => sub.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    // Use a waiting invite first, so the new owner lands straight in that business
    const code = pendingJoin();
    if (code) {
      try {
        const joined = await acceptInvite(code);
        rememberBiz(joined.business_id);
        setBizId(joined.business_id);
        try { localStorage.setItem(JOINED_KEY, joined.business_id); } catch { /* ignore */ }
        setJoinError('');
      } catch (e) {
        const m = String((e as { message?: string })?.message ?? e);
        setJoinError(/different email/.test(m) ? t('account.join.wrongEmail') : /expired/.test(m) ? t('account.join.expired') : /used|not found/.test(m) ? t('account.join.used') : m);
      }
      clearJoin();
    }
    try { setBusinesses(await listBusinesses()); setError(''); } catch { setError(t('account.loadError')); }
  }, [t]);

  useEffect(() => { if (session) void refresh(); else setBusinesses(null); }, [session, refresh, joinTick]);

  // null = go to the business picker ('' keeps the picker open even when there's only one business)
  const switchBusiness = useCallback((id: string | null) => { rememberBiz(id); setBizId(id ?? ''); }, []);
  const doSignOut = useCallback(async () => { await signOut(); switchBusiness(null); setBusinesses(null); }, [switchBusiness]);

  const business = bizId === '' ? undefined : businesses?.find((b) => b.id === bizId) ?? (businesses?.length === 1 ? businesses[0] : undefined);
  const backend = useMemo(() => (business ? cloudBackend(business.id) : null), [business?.id]);

  // Trial / plan, kept live so paying on one device unlocks the others
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!business) return;
    let alive = true;
    const load = () => loadSubscription(business.id).then((s) => alive && setSubscription(s));
    void load();
    const stop = watchSubscription(business.id, () => void load());
    const timer = window.setInterval(() => setTick((n) => n + 1), 60 * 60_000); // re-check days left hourly
    return () => { alive = false; stop(); window.clearInterval(timer); };
  }, [business?.id]);

  if (session === undefined) return <div className="loading">{t('common.loading')}</div>;
  if (!session) return <AuthScreen />;
  if (joinError) return <Screen><h1>{t('account.join.failTitle')}</h1><div className="callout bad">{joinError}</div><p className="muted" style={{ fontSize: 13 }}>{t('account.join.signedInAs', { email: session.user.email ?? '' })}</p><div className="row"><button className="btn primary" onClick={() => setJoinError('')}>{t('common.continue')}</button><button className="btn" onClick={() => void doSignOut()}>{t('account.signOut')}</button></div></Screen>;
  if (error) return <Screen><div className="callout bad">{error}</div><button className="btn" onClick={() => void refresh()}>{t('common.retry')}</button></Screen>;
  if (!businesses) return <div className="loading">{t('common.loading')}</div>;
  if (!businesses.length) return <CreateBusiness email={session.user.email ?? ''} onCreated={async (id) => { await refresh(); switchBusiness(id); }} onSignOut={doSignOut} />;
  if (!business || !backend) return <PickBusiness businesses={businesses} onPick={switchBusiness} onSignOut={doSignOut} onCreated={async (id) => { await refresh(); switchBusiness(id); }} email={session.user.email ?? ''} />;

  return (
    <Ctx.Provider value={{ session, business, businesses, switchBusiness, refresh, signOut: doSignOut, subscription, access: accessOf(subscription) }}>
      <StoreProvider key={business.id} backend={backend}>{children}</StoreProvider>
    </Ctx.Provider>
  );
}

// ---------- Screens ----------

function Screen({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="lock-screen">
      <div className="lock-prefs"><ThemeSwitch /><LangSwitch /></div>
      <div className="lock-card account-card" style={{ textAlign: 'left', width: wide ? 'min(520px, 100%)' : undefined }}>
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="brand-mark">M</span>
          <strong style={{ fontSize: '1.15rem' }}>Mise</strong>
        </div>
        {children}
      </div>
    </div>
  );
}

type AuthPage = 'login' | 'signup' | 'reset';
const pageFromHash = (): AuthPage => (/signup|register/.test(window.location.hash) ? 'signup' : /reset|forgot/.test(window.location.hash) ? 'reset' : 'login');

/** Separate pages with their own links: …/#login (existing customers) and …/#signup (new businesses). */
function AuthScreen() {
  const [page, setPage] = useState<AuthPage>(pageFromHash);
  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (p: AuthPage) => { window.location.hash = p; setPage(p); };
  if (page === 'signup') return <SignUpPage go={go} />;
  return <SignInPage go={go} reset={page === 'reset'} />;
}

function useAuthErrors() {
  const { t } = useI18n();
  return (e: unknown) => {
    const m = String((e as { message?: string })?.message ?? e);
    if (/invalid login/i.test(m)) return t('account.err.badLogin');
    if (/not confirmed/i.test(m)) return t('account.err.notConfirmed');
    if (/already registered|already exists/i.test(m)) return t('account.err.exists');
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return t('account.err.weak');
    if (/rate|too many/i.test(m)) return t('account.err.rate');
    if (/fetch|network/i.test(m)) return t('account.err.network');
    return m;
  };
}

function SignInPage({ go, reset }: { go: (p: AuthPage) => void; reset: boolean }) {
  const { t } = useI18n();
  const errorText = useAuthErrors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok'; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (reset) {
        await sendPasswordReset(email.trim());
        setMsg({ tone: 'ok', text: t('account.resetSent', { email: email.trim() }) });
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {pendingJoin() && <div className="callout info">{t('account.join.notice')}</div>}
      <h1>{reset ? t('account.resetTitle') : t('account.signInTitle')}</h1>
      <p className="muted">{reset ? t('account.resetIntro') : t('account.signInIntro')}</p>
      <form onSubmit={submit} className="account-form">
        <label className="field"><span className="field-label">{t('account.email')}</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        {!reset && (
          <label className="field">
            <span className="row" style={{ justifyContent: 'space-between' }}>
              <span className="field-label">{t('account.password')}</span>
              <a href="#reset" className="link-sm" onClick={(e) => { e.preventDefault(); go('reset'); }}>{t('account.forgot')}</a>
            </span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        {msg && <div className={`callout ${msg.tone}`}>{msg.text}</div>}
        <button className="btn primary lg" disabled={busy}>{busy ? t('common.loading') : reset ? t('account.sendReset') : t('account.signIn')}</button>
      </form>
      {reset ? (
        <p className="auth-switch"><a href="#login" onClick={(e) => { e.preventDefault(); go('login'); }}>← {t('account.backToSignIn')}</a></p>
      ) : (
        <p className="auth-switch">{t('account.noAccount')} <a href="#signup" onClick={(e) => { e.preventDefault(); go('signup'); }}>{t('account.startTrial')}</a></p>
      )}
    </Screen>
  );
}

function SignUpPage({ go }: { go: (p: AuthPage) => void }) {
  const { t, lang } = useI18n();
  const errorText = useAuthErrors();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok'; text: string } | null>(null);
  const cur = planCurrency(lang);
  const prices = planPrices(cur);
  const money = (n: number) => fmtPlanPrice(n, cur);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (password !== password2) return setMsg({ tone: 'bad', text: t('account.err.mismatch') });
    setBusy(true);
    try {
      const { needsConfirm } = await signUp(email.trim(), password);
      if (needsConfirm) setMsg({ tone: 'ok', text: t('account.checkEmail', { email: email.trim() }) });
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-prefs"><ThemeSwitch /><LangSwitch /></div>
      <div className="signup-layout">
        <section className="lock-card account-card pricing-panel" style={{ textAlign: 'left' }}>
          <div className="row"><span className="brand-mark">M</span><strong style={{ fontSize: '1.15rem' }}>Mise</strong></div>
          <h1>{t('account.pricingTitle')}</h1>
          <div className="trial-badge">🎁 {t('account.trialBadge', { days: TRIAL_DAYS })}</div>
          <p className="muted" style={{ margin: 0 }}>{t('account.trialNoCard')}</p>
          <div className="plan-cards">
            <div className="plan-card">
              <span className="plan-name">{t('account.plan.monthly')}</span>
              <span className="plan-price">{money(prices.monthly)}<small>/{t('account.perMonth')}</small></span>
            </div>
            <div className="plan-card best">
              <span className="plan-tag">{t('account.save', { amount: money(prices.yearlySaving) })}</span>
              <span className="plan-name">{t('account.plan.yearly')}</span>
              <span className="plan-price">{money(prices.yearly)}<small>/{t('account.perYear')}</small></span>
              <span className="plan-perk">📷 {t('account.perk.menuPhoto')}</span>
            </div>
          </div>
          <ul className="feature-list">
            {(['pos', 'stock', 'menu', 'staff', 'sync', 'thai'] as const).map((f) => <li key={f}>✓ {t(`account.feature.${f}`)}</li>)}
          </ul>
        </section>

        <section className="lock-card account-card" style={{ textAlign: 'left' }}>
          {pendingJoin() && <div className="callout info">{t('account.join.notice')}</div>}
          <h1>{t('account.signUpTitle')}</h1>
          <p className="muted">{t('account.signUpIntro')}</p>
          <form onSubmit={submit} className="account-form">
            <label className="field"><span className="field-label">{t('account.email')}</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            <label className="field"><span className="field-label">{t('account.password')}</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="field-hint">{t('account.passwordHint')}</span>
            </label>
            <label className="field"><span className="field-label">{t('account.password2')}</span>
              <input type="password" autoComplete="new-password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </label>
            {msg && <div className={`callout ${msg.tone}`}>{msg.text}</div>}
            <button className="btn primary lg" disabled={busy}>{busy ? t('common.loading') : t('account.startTrialBtn', { days: TRIAL_DAYS })}</button>
          </form>
          <p className="auth-switch">{t('account.haveAccount')} <a href="#login" onClick={(e) => { e.preventDefault(); go('login'); }}>{t('account.signIn')}</a></p>
        </section>
      </div>
    </div>
  );
}

type StartWith = 'device' | 'demo' | 'empty';

function CreateBusiness({ email, onCreated, onSignOut, onCancel }: { email: string; onCreated: (id: string) => void; onSignOut: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [local, setLocal] = useState<AppState | null>(null);
  // New owners tour the demo shop first, then clear it and set up their own
  const [start, setStart] = useState<StartWith>('demo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    readLocalData().then(({ state }) => {
      // Offer this browser's own shop (not a leftover demo, which the tour already covers)
      if (state && !state.isDemo && (state.menu?.length || state.orders?.length)) {
        const s = normalize(state);
        setLocal(s);
        setStart('device');
        setName(s.settings.storeName);
      }
    });
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const base = start === 'device' && local ? structuredClone(local) : start === 'demo' ? demoState() : emptyState();
      base.settings.storeName = name.trim();
      if (start !== 'demo') base.isDemo = false;
      if (start === 'empty') base.setupGuide = true;
      if (start === 'demo') base.tour = 0;
      onCreated(await createBusiness(name.trim(), base));
    } catch (err) {
      setError(String((err as { message?: string })?.message ?? err));
      setBusy(false);
    }
  };

  return (
    <Screen wide>
      <h1>{t('account.createBizTitle')}</h1>
      <p className="muted">{t('account.createBizIntro', { email })}</p>
      <form onSubmit={create} className="account-form">
        <label className="field"><span className="field-label">{t('account.bizName')}</span>
          <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('account.bizNamePh')} autoFocus />
        </label>
        <div className="field">
          <span className="field-label">{t('account.startWith')}</span>
          <div className="start-options">
            {local && (
              <button type="button" className={`start-option ${start === 'device' ? 'active' : ''}`} onClick={() => setStart('device')}>
                <strong>📲 {t('account.start.device')}</strong>
                <span>{t('account.start.deviceHint', { name: local.settings.storeName, dishes: local.menu.length, orders: local.orders.length })}</span>
              </button>
            )}
            <button type="button" className={`start-option ${start === 'demo' ? 'active' : ''}`} onClick={() => setStart('demo')}>
              <strong>🍜 {t('account.start.demo')}</strong>
              <span>{t('account.start.demoHint')}</span>
            </button>
            <button type="button" className={`start-option ${start === 'empty' ? 'active' : ''}`} onClick={() => setStart('empty')}>
              <strong>✨ {t('account.start.empty')}</strong>
              <span>{t('account.start.emptyHint')}</span>
            </button>
          </div>
        </div>
        {error && <div className="callout bad">{error}</div>}
        <button className="btn primary lg" disabled={busy || !name.trim()}>{busy ? t('common.loading') : t('account.createBiz')}</button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {onCancel ? <button className="btn ghost sm" onClick={onCancel}>← {t('common.back')}</button> : <span />}
        <button className="btn ghost sm" onClick={onSignOut}>{t('account.signOut')}</button>
      </div>
    </Screen>
  );
}

function PickBusiness({ businesses, onPick, onSignOut, onCreated, email }: { businesses: BusinessSummary[]; onPick: (id: string) => void; onSignOut: () => void; onCreated: (id: string) => void; email: string }) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  if (creating) return <CreateBusiness email={email} onCreated={onCreated} onSignOut={onSignOut} onCancel={() => setCreating(false)} />;
  return (
    <Screen>
      <h1>{t('account.pickTitle')}</h1>
      <p className="muted">{t('account.pickIntro')}</p>
      <div className="biz-list">
        {businesses.map((b) => (
          <button key={b.id} className="biz-item" onClick={() => onPick(b.id)}>
            <span className="avatar" aria-hidden>{b.name.charAt(0).toUpperCase()}</span>
            <span><strong>{b.name}</strong><span className="muted">{t(`account.role.${b.role}`)}</span></span>
          </button>
        ))}
      </div>
      <button className="btn" onClick={() => setCreating(true)}>{t('account.addBusiness')}</button>
      <button className="btn ghost sm" onClick={onSignOut}>{t('account.signOut')}</button>
    </Screen>
  );
}

export { CreateBusiness };
