import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Page } from './App';
import { useStore } from './store';
import type { Staff, StaffRole } from './types';
import { findByPin, isValidPin, newStaff } from './pin';
import { LangSwitch, translate, useI18n } from './i18n';
import { ThemeSwitch } from './theme';
import { fmtTime } from './utils';

export { findByPin, isValidPin, makePinCreds, newStaff } from './pin';

// ---------- Permissions ----------

export const OWNER_ONLY: Page[] = ['dashboard', 'menu', 'setup'];
export const canAccess = (role: StaffRole | undefined, page: Page) => role === 'owner' || !OWNER_ONLY.includes(page);

// ---------- Session ----------

const SESSION_KEY = 'mise-user';
const MAX_TRIES = 5;
const LOCKOUT_MS = 30_000;

interface AuthCtx {
  user: Staff | null;
  login: (pin: string) => { ok: true; user: Staff } | { ok: false; error: string };
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

function readSession() {
  try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}
function writeSession(id: string | null) {
  try { if (id) sessionStorage.setItem(SESSION_KEY, id); else sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/** Shared wrong-PIN throttle, used by the lock screen and owner-approval prompts. */
const throttle = { fails: 0, until: 0 };
export function checkPin(staff: Staff[], pin: string, needOwner = false): { ok: true; user: Staff } | { ok: false; error: string } {
  const now = Date.now();
  if (now < throttle.until) return { ok: false, error: translate('common.auth.tooManyWait', { s: Math.ceil((throttle.until - now) / 1000) }) };
  const user = findByPin(staff, pin);
  if (!user || (needOwner && user.role !== 'owner')) {
    throttle.fails += 1;
    if (throttle.fails >= MAX_TRIES) { throttle.fails = 0; throttle.until = now + LOCKOUT_MS; return { ok: false, error: translate('common.auth.tooManyLocked') }; }
    return { ok: false, error: translate(user ? 'common.auth.notOwner' : 'common.auth.wrongPin') };
  }
  throttle.fails = 0;
  return { ok: true, user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const [userId, setUserId] = useState<string | null>(readSession);
  const user = state.staff.find((s) => s.id === userId && s.active) ?? null;

  const logout = useCallback(() => { setUserId(null); writeSession(null); }, []);
  const login = useCallback((pin: string) => {
    const r = checkPin(state.staff, pin);
    if (r.ok) { setUserId(r.user.id); writeSession(r.user.id); }
    return r;
  }, [state.staff]);

  // Auto-lock after inactivity
  const timer = useRef<number>();
  const minutes = state.settings.autoLockMinutes;
  useEffect(() => {
    if (!user || !minutes) return;
    const reset = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(logout, minutes * 60_000); };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => { window.clearTimeout(timer.current); events.forEach((e) => window.removeEventListener(e, reset)); };
  }, [user, minutes, logout]);

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

// ---------- UI ----------

export function PinPad({ onSubmit, error, busyLabel }: { onSubmit: (pin: string) => void; error?: string; busyLabel?: string }) {
  const { t } = useI18n();
  const [pin, setPinState] = useState('');
  // Mirror in a ref so fast typing + Enter never submits a stale value.
  const pinRef = useRef('');
  const setPin = useCallback((next: string | ((p: string) => string)) => {
    pinRef.current = typeof next === 'function' ? next(pinRef.current) : next;
    setPinState(pinRef.current);
  }, []);
  const submit = useCallback(() => {
    const p = pinRef.current;
    if (p.length >= 4) { setPin(''); onSubmit(p); }
  }, [onSubmit, setPin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, setPin]);

  return (
    <div className="pinpad">
      <div className="pin-dots" aria-label={t('common.auth.digitsEntered', { n: pin.length })}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
      </div>
      <div className="pin-error" role="alert">{error}</div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button key={k} onClick={() => setPin((p) => (p.length < 6 ? p + k : p))}>{k}</button>
        ))}
        <button className="muted-key" onClick={() => setPin('')}>{t('common.auth.clear')}</button>
        <button onClick={() => setPin((p) => (p.length < 6 ? p + '0' : p))}>0</button>
        <button className="muted-key" onClick={() => setPin((p) => p.slice(0, -1))} aria-label={t('common.auth.backspace')}>⌫</button>
      </div>
      <button className="btn primary lg" style={{ width: '100%' }} disabled={pin.length < 4} onClick={submit}>{busyLabel ?? t('common.auth.enter')}</button>
    </div>
  );
}

export function LockScreen() {
  const { state } = useStore();
  const { login } = useAuth();
  const { t } = useI18n();
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setClock(new Date()), 15_000); return () => window.clearInterval(t); }, []);

  return (
    <div className="lock-screen">
      <div className="lock-prefs"><ThemeSwitch /><LangSwitch /></div>
      <div className="lock-card">
        <span className="brand-mark" style={{ margin: '0 auto' }}>M</span>
        <h1>{state.settings.storeName}</h1>
        <p className="muted">{fmtTime(clock)} · {t('common.auth.clockIn')}</p>
        <PinPad onSubmit={(pin) => { const r = login(pin); setError(r.ok ? '' : r.error); }} />
        {state.isDemo && <div className="callout info" style={{ marginTop: 14 }}>{t('common.auth.demoPins', { owner: '1234', staff: '1111', name: state.staff.find((x) => x.id === 'demo-sam')?.name ?? '' })}</div>}
      </div>
    </div>
  );
}

export function CreateOwner() {
  const { state, update } = useStore();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const err = pin && !isValidPin(pin) ? t('common.auth.pinLength') : pin2 && pin !== pin2 ? t('common.auth.pinMismatch') : '';
  const ok = name.trim() && isValidPin(pin) && pin === pin2;
  return (
    <div className="lock-screen">
      <div className="lock-prefs"><ThemeSwitch /><LangSwitch /></div>
      <form
        className="lock-card"
        style={{ textAlign: 'left' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          update((d) => { d.staff.push(newStaff(name.trim(), 'owner', pin)); });
        }}
      >
        <span className="brand-mark">M</span>
        <h1>{t('common.auth.createOwnerTitle')}</h1>
        <p className="muted">{t('common.auth.createOwnerIntro')}</p>
        <label className="field"><span className="field-label">{t('common.auth.yourName')}</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="field-label">{t('common.auth.ownerPin')}</span><input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        <label className="field"><span className="field-label">{t('common.auth.confirmPin')}</span><input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        {err && <div className="callout bad">{err}</div>}
        <button className="btn primary lg" type="submit" disabled={!ok}>{t('common.auth.createOwnerBtn')}</button>
        {state.staff.length > 0 && <p className="muted" style={{ fontSize: 13 }}>{t('common.auth.noOwnerFound')}</p>}
      </form>
    </div>
  );
}

/** Ask for an owner PIN before a sensitive action (e.g. a staff member voiding an order). */
export function OwnerApproval({ title, reason, onApprove, onClose }: { title: string; reason: string; onApprove: (owner: Staff) => void; onClose: () => void }) {
  const { state } = useStore();
  const { t } = useI18n();
  const [error, setError] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" style={{ zIndex: 60 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(360px, 100%)' }} role="dialog" aria-label={title}>
        <header className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>✕</button></header>
        <div className="modal-body">
          <p className="muted" style={{ margin: 0 }}>{reason}</p>
          <PinPad busyLabel={t('common.auth.approve')} error={error} onSubmit={(pin) => {
            const r = checkPin(state.staff, pin, true);
            if (r.ok) onApprove(r.user); else setError(r.error);
          }} />
        </div>
      </div>
    </div>
  );
}
