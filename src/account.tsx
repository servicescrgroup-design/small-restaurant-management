import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  cloudEnabled, createBusiness, getSession, listBusinesses, onAuthChange, sendPasswordReset, signIn, signOut, signUp, type BusinessSummary,
} from './cloud';
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
}

const Ctx = createContext<AccountCtx | null>(null);
/** Null when running in this-browser-only mode. */
export const useAccount = () => useContext(Ctx);

const BIZ_KEY = 'mise-business';
const rememberBiz = (id: string | null) => { try { if (id) localStorage.setItem(BIZ_KEY, id); else localStorage.removeItem(BIZ_KEY); } catch { /* ignore */ } };
const rememberedBiz = () => { try { return localStorage.getItem(BIZ_KEY); } catch { return null; } };

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

  useEffect(() => {
    getSession().then(setSession).catch(() => setSession(null));
    const sub = onAuthChange((s) => setSession(s));
    return () => sub.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    try { setBusinesses(await listBusinesses()); setError(''); } catch { setError(t('account.loadError')); }
  }, [t]);

  useEffect(() => { if (session) void refresh(); else setBusinesses(null); }, [session, refresh]);

  // null = go to the business picker ('' keeps the picker open even when there's only one business)
  const switchBusiness = useCallback((id: string | null) => { rememberBiz(id); setBizId(id ?? ''); }, []);
  const doSignOut = useCallback(async () => { await signOut(); switchBusiness(null); setBusinesses(null); }, [switchBusiness]);

  const business = bizId === '' ? undefined : businesses?.find((b) => b.id === bizId) ?? (businesses?.length === 1 ? businesses[0] : undefined);
  const backend = useMemo(() => (business ? cloudBackend(business.id) : null), [business?.id]);

  if (session === undefined) return <div className="loading">{t('common.loading')}</div>;
  if (!session) return <AuthScreen />;
  if (error) return <Screen><div className="callout bad">{error}</div><button className="btn" onClick={() => void refresh()}>{t('common.retry')}</button></Screen>;
  if (!businesses) return <div className="loading">{t('common.loading')}</div>;
  if (!businesses.length) return <CreateBusiness email={session.user.email ?? ''} onCreated={async (id) => { await refresh(); switchBusiness(id); }} onSignOut={doSignOut} />;
  if (!business || !backend) return <PickBusiness businesses={businesses} onPick={switchBusiness} onSignOut={doSignOut} onCreated={async (id) => { await refresh(); switchBusiness(id); }} email={session.user.email ?? ''} />;

  return (
    <Ctx.Provider value={{ session, business, businesses, switchBusiness, refresh, signOut: doSignOut }}>
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

function AuthScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok' | 'info'; text: string } | null>(null);

  const errorText = (e: unknown) => {
    const m = String((e as { message?: string })?.message ?? e);
    if (/invalid login/i.test(m)) return t('account.err.badLogin');
    if (/not confirmed/i.test(m)) return t('account.err.notConfirmed');
    if (/already registered|already exists/i.test(m)) return t('account.err.exists');
    if (/password/i.test(m) && /least|short|weak/i.test(m)) return t('account.err.weak');
    if (/rate|too many/i.test(m)) return t('account.err.rate');
    if (/fetch|network/i.test(m)) return t('account.err.network');
    return m;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (mode === 'up' && password !== password2) return setMsg({ tone: 'bad', text: t('account.err.mismatch') });
    setBusy(true);
    try {
      if (mode === 'in') await signIn(email.trim(), password);
      else if (mode === 'up') {
        const { needsConfirm } = await signUp(email.trim(), password);
        if (needsConfirm) setMsg({ tone: 'ok', text: t('account.checkEmail', { email: email.trim() }) });
      } else {
        await sendPasswordReset(email.trim());
        setMsg({ tone: 'ok', text: t('account.resetSent', { email: email.trim() }) });
      }
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <h1>{mode === 'in' ? t('account.signInTitle') : mode === 'up' ? t('account.signUpTitle') : t('account.resetTitle')}</h1>
      <p className="muted">{mode === 'up' ? t('account.signUpIntro') : mode === 'in' ? t('account.signInIntro') : t('account.resetIntro')}</p>
      {mode !== 'reset' && (
        <div className="seg" style={{ width: '100%' }}>
          <button type="button" style={{ flex: 1 }} className={mode === 'in' ? 'active' : ''} onClick={() => { setMode('in'); setMsg(null); }}>{t('account.signIn')}</button>
          <button type="button" style={{ flex: 1 }} className={mode === 'up' ? 'active' : ''} onClick={() => { setMode('up'); setMsg(null); }}>{t('account.signUp')}</button>
        </div>
      )}
      <form onSubmit={submit} className="account-form">
        <label className="field"><span className="field-label">{t('account.email')}</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        {mode !== 'reset' && (
          <label className="field"><span className="field-label">{t('account.password')}</span>
            <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'up' && <span className="field-hint">{t('account.passwordHint')}</span>}
          </label>
        )}
        {mode === 'up' && (
          <label className="field"><span className="field-label">{t('account.password2')}</span>
            <input type="password" autoComplete="new-password" required minLength={8} value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </label>
        )}
        {msg && <div className={`callout ${msg.tone}`}>{msg.text}</div>}
        <button className="btn primary lg" disabled={busy}>
          {busy ? t('common.loading') : mode === 'in' ? t('account.signIn') : mode === 'up' ? t('account.createAccount') : t('account.sendReset')}
        </button>
      </form>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        {mode === 'in' && <button className="btn ghost sm" onClick={() => { setMode('reset'); setMsg(null); }}>{t('account.forgot')}</button>}
        {mode === 'reset' && <button className="btn ghost sm" onClick={() => { setMode('in'); setMsg(null); }}>← {t('account.signIn')}</button>}
      </div>
    </Screen>
  );
}

type StartWith = 'device' | 'demo' | 'empty';

function CreateBusiness({ email, onCreated, onSignOut, onCancel }: { email: string; onCreated: (id: string) => void; onSignOut: () => void; onCancel?: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [local, setLocal] = useState<AppState | null>(null);
  const [start, setStart] = useState<StartWith>('empty');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    readLocalData().then(({ state }) => {
      if (state && (state.menu?.length || state.orders?.length)) {
        const s = normalize(state);
        setLocal(s);
        setStart('device');
        if (!s.isDemo) setName(s.settings.storeName);
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
            <button type="button" className={`start-option ${start === 'empty' ? 'active' : ''}`} onClick={() => setStart('empty')}>
              <strong>✨ {t('account.start.empty')}</strong>
              <span>{t('account.start.emptyHint')}</span>
            </button>
            <button type="button" className={`start-option ${start === 'demo' ? 'active' : ''}`} onClick={() => setStart('demo')}>
              <strong>🍜 {t('account.start.demo')}</strong>
              <span>{t('account.start.demoHint')}</span>
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
