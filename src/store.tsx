import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultSettings, defaultTables, demoStaff, demoState } from './demo';
import { makeMoney, uid } from './utils';
import { useI18n } from './i18n';
import { loadBusinessData, readBusinessRev, saveBusinessData, watchBusiness } from './cloud';
import { dedupeMethods } from './payments';

// Where a business's data lives:
//  - local: this browser's IndexedDB (localStorage fallback) — used when cloud accounts aren't set up;
//  - cloud: the business's private row in Supabase, shared by all its devices.
//
// Several tabs or devices can have the same business open. To keep a stale copy from overwriting
// newer data, every save carries a revision id: a save only lands if storage still holds the rev the
// data came from. Otherwise the app loads the newer data and re-applies just its own unsaved changes
// ("rebase"). Tabs tell each other about saves over a BroadcastChannel; devices hear about them through
// Realtime; and everyone re-checks when the tab becomes visible again.

type Mutation = (draft: AppState) => void;

export interface Backend {
  /** Distinguishes stores (and their BroadcastChannel) — 'local' or the business id */
  key: string;
  load(): Promise<{ state: AppState | null; rev: string }>;
  readRev(): Promise<string | null>;
  /** Save `local` if storage still holds `baseRev`; otherwise save `rebase(stored)` and return it. */
  write(local: AppState, baseRev: string, rebase: (stored: AppState) => AppState): Promise<{ rev: string; rebased: AppState | null }>;
  /** Hear about saves from other devices */
  watch?(onRemote: () => void): () => void;
}

// ---------- Local (this browser) ----------

const DB_NAME = 'mise-pos';
const STORE = 'kv';
const KEY = 'state';
const REV = 'rev';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      // Let go if another tab needs to upgrade or reset the database, instead of blocking it.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDb());

/** Read whatever this browser has stored (used by local mode, and to offer moving it into a cloud account). */
export async function readLocalData(): Promise<{ state: AppState | null; rev: string }> {
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const store = d.transaction(STORE).objectStore(STORE);
      const s = store.get(KEY);
      const r = store.get(REV);
      r.onsuccess = () => resolve({ state: typeof s.result === 'string' ? JSON.parse(s.result) : null, rev: String(r.result ?? '0') });
      r.onerror = () => reject(r.error);
    });
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(DB_NAME);
    if (raw) return { state: JSON.parse(raw), rev: '0' };
  } catch { /* ignore */ }
  return { state: null, rev: '0' };
}

export const localBackend: Backend = {
  key: 'local',
  load: readLocalData,
  async readRev() {
    try {
      const d = await db();
      return await new Promise((resolve, reject) => {
        const r = d.transaction(STORE).objectStore(STORE).get(REV);
        r.onsuccess = () => resolve(String(r.result ?? '0'));
        r.onerror = () => reject(r.error);
      });
    } catch {
      return null;
    }
  },
  async write(local, baseRev, rebase) {
    const rev = uid();
    try {
      const d = await db();
      // One transaction, so two tabs can't interleave their check-and-write.
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let rebased: AppState | null = null;
        const put = (s: AppState) => { store.put(JSON.stringify(s), KEY); store.put(rev, REV); };
        const revReq = store.get(REV);
        revReq.onsuccess = () => {
          if (String(revReq.result ?? '0') === baseRev) return put(local);
          const sReq = store.get(KEY);
          sReq.onsuccess = () => {
            rebased = typeof sReq.result === 'string' ? rebase(normalize(JSON.parse(sReq.result))) : local;
            put(rebased);
          };
        };
        tx.oncomplete = () => resolve({ rev, rebased });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      try { localStorage.setItem(DB_NAME, JSON.stringify(local)); } catch { /* storage full or blocked */ }
      return { rev: baseRev, rebased: null };
    }
  },
};

// ---------- Cloud (one business) ----------

export function cloudBackend(businessId: string): Backend {
  return {
    key: businessId,
    async load() {
      const d = await loadBusinessData(businessId);
      return { state: d.state, rev: d.rev };
    },
    readRev: () => readBusinessRev(businessId),
    async write(local, baseRev, rebase) {
      let attempt = local;
      let base = baseRev;
      let rebased: AppState | null = null;
      // A few tries in case several devices are saving at the same moment
      for (let i = 0; i < 4; i++) {
        const r = await saveBusinessData(businessId, attempt, base);
        if (r.ok) return { rev: r.rev, rebased };
        rebased = rebase(normalize(r.state));
        attempt = rebased;
        base = r.rev;
      }
      throw new Error('Could not save: the data keeps changing on another device');
    },
    watch: (onRemote) => watchBusiness(businessId, () => onRemote()),
  };
}

// ---------- Shared ----------

function applyAll(base: AppState, changes: Mutation[]): AppState {
  const d = structuredClone(base);
  for (const fn of changes) fn(d);
  return d;
}

const replaceWith = (s: AppState): Mutation => (d) => {
  for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k];
  Object.assign(d, structuredClone(s));
};

/** Fill in any settings added in later versions so old saves keep working. */
export function normalize(s: AppState): AppState {
  const staff = Array.isArray(s.staff) ? s.staff : s.isDemo ? demoStaff() : [];
  const tables = Array.isArray(s.tables) ? s.tables : defaultTables();
  // Older saves had ticket lines without ids.
  const tickets = (Array.isArray(s.tickets) ? s.tickets : []).map((tk) => ({ ...tk, lines: tk.lines.map((l) => (l.id ? l : { ...l, id: uid() })) }));
  const settings = { ...defaultSettings(), ...s.settings };
  // "Cash" and "เงินสด" are the same method: keep one
  settings.paymentMethods = dedupeMethods(settings.paymentMethods);
  return { ...s, staff, tables, tickets, settings };
}

/** locked = the trial ended / plan lapsed, so the server won't accept saves */
export type SyncStatus = 'saved' | 'saving' | 'offline' | 'locked';

interface StoreCtx {
  state: AppState;
  /** Mutate a draft copy of state; the result replaces the current state. */
  update: (fn: Mutation) => void;
  replace: (s: AppState) => void;
  money: (n: number) => string;
  sync: SyncStatus;
  /** Save anything pending right now (e.g. before signing out) */
  flushNow: () => Promise<void>;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children, backend = localBackend }: { children: ReactNode; backend?: Backend }) {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sync, setSync] = useState<SyncStatus>('saved');
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;
  const baseRev = useRef('0');
  /** Changes made here that aren't saved yet, kept so they can be replayed on newer data. */
  const pending = useRef<Mutation[]>([]);
  const saving = useRef(false);
  const saveTimer = useRef<number>();
  const channel = useRef<BroadcastChannel | null>(null);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    if (saving.current) { saveTimer.current = window.setTimeout(() => void flush(), 100); return; }
    const local = stateRef.current;
    const n = pending.current.length;
    if (!local || n === 0) { setSync('saved'); return; }
    saving.current = true;
    setSync('saving');
    let retry = 250;
    try {
      const changes = pending.current.slice(0, n);
      const { rev, rebased } = await backend.write(local, baseRev.current, (stored) => applyAll(stored, changes));
      baseRev.current = rev;
      pending.current.splice(0, n);
      // If we had to rebase, show the merged data (plus anything changed while saving).
      if (rebased) setState(applyAll(rebased, pending.current));
      channel.current?.postMessage({ rev });
      setSync(pending.current.length ? 'saving' : 'saved');
    } catch (err) {
      if (/subscription_required/.test(String((err as { message?: string })?.message ?? err))) {
        // Trial over / plan lapsed: keep the changes on screen, retry slowly in case they subscribe.
        setSync('locked');
        retry = 60_000;
      } else {
        // Offline or server trouble: keep the changes and try again shortly.
        setSync('offline');
        retry = 5000;
      }
    } finally {
      saving.current = false;
    }
    if (pending.current.length) saveTimer.current = window.setTimeout(() => void flush(), retry);
  }, [backend]);

  const schedule = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    setSync('saving');
    saveTimer.current = window.setTimeout(() => void flush(), 250);
  }, [flush]);

  /** Another tab/device (or an outside edit) may have saved: pick it up. */
  const checkRemote = useCallback(async () => {
    const rev = await backend.readRev();
    if (rev === null || rev === baseRev.current) return;
    if (pending.current.length || saving.current) return void flush(); // our save will rebase onto it
    try {
      const stored = await backend.load();
      if (stored.state && !pending.current.length && !saving.current) {
        baseRev.current = stored.rev;
        setState(normalize(stored.state));
      }
    } catch { /* offline: try again next time */ }
  }, [backend, flush]);

  useEffect(() => {
    let alive = true;
    backend.load().then(({ state: s, rev }) => {
      if (!alive) return;
      baseRev.current = rev;
      if (s) return setState(normalize(s));
      const fresh = demoState();
      setState(fresh);
      pending.current.push(replaceWith(fresh));
      schedule();
    }).catch(() => alive && setLoadError(true));
    return () => { alive = false; };
  }, [backend, schedule]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(`mise-${backend.key}`);
      channel.current.onmessage = () => void checkRemote();
    }
    const stopWatch = backend.watch?.(() => void checkRemote());
    const onVisible = () => { if (document.visibilityState === 'visible') void checkRemote(); };
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onOnline = () => void flush();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      channel.current?.close();
      channel.current = null;
      stopWatch?.();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [backend, checkRemote, flush]);

  const update = useCallback((fn: Mutation) => {
    pending.current.push(fn);
    setState((s) => (s ? applyAll(s, [fn]) : s));
    schedule();
  }, [schedule]);

  const replace = useCallback((s: AppState) => {
    const next = normalize(s);
    pending.current.push(replaceWith(next));
    setState(next);
    schedule();
  }, [schedule]);

  const flushNow = useCallback(async () => { await flush(); }, [flush]);

  const { locale, t } = useI18n();
  const currency = state?.settings.currency ?? 'USD';
  const money = useMemo(() => makeMoney(currency, locale), [currency, locale]);

  if (loadError) return <div className="loading">{t('common.loadFailed')}<button className="btn" style={{ marginLeft: 12 }} onClick={() => window.location.reload()}>{t('common.retry')}</button></div>;
  if (!state) return <div className="loading">{t('common.loading')}</div>;
  return <Ctx.Provider value={{ state, update, replace, money, sync, flushNow }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside StoreProvider');
  return c;
}
