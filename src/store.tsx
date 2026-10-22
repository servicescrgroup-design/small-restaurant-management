import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultSettings, defaultTables, demoStaff, demoState } from './demo';
import { makeMoney, uid } from './utils';
import { useI18n } from './i18n';

// Data lives in the browser's IndexedDB (much larger than localStorage), with localStorage as a fallback.
//
// Several tabs can have Mise open at once. To keep an old tab from overwriting newer data:
//  - every save stores a revision id next to the data ('rev');
//  - a tab only overwrites if the stored rev is the one its data came from. Otherwise it loads the
//    newer data and re-applies just its own unsaved changes on top ("rebase");
//  - after saving, a tab tells the others over a BroadcastChannel so they reload straight away,
//    and any tab re-checks when it becomes visible again.
const DB_NAME = 'mise-pos';
const STORE = 'kv';
const KEY = 'state';
const REV = 'rev';

type Mutation = (draft: AppState) => void;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDb());

async function readStored(): Promise<{ state: AppState | null; rev: string }> {
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

async function readRev(): Promise<string | null> {
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
}

/**
 * Save `local` if storage still holds `baseRev`; otherwise rebuild from what's stored plus `changes`.
 * Runs in one transaction so two tabs can't interleave. Returns the new rev and, if it had to rebase,
 * the state that was actually written.
 */
async function saveVersioned(local: AppState, baseRev: string, changes: Mutation[]): Promise<{ rev: string; rebased: AppState | null }> {
  const rev = uid();
  try {
    const d = await db();
    return await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let rebased: AppState | null = null;
      const write = (s: AppState) => { store.put(JSON.stringify(s), KEY); store.put(rev, REV); };
      const revReq = store.get(REV);
      revReq.onsuccess = () => {
        if (String(revReq.result ?? '0') === baseRev) return write(local);
        // Someone else saved since we loaded: start from their data, re-apply only our changes.
        const sReq = store.get(KEY);
        sReq.onsuccess = () => {
          const stored = typeof sReq.result === 'string' ? normalize(JSON.parse(sReq.result)) : local;
          rebased = applyAll(stored, changes);
          write(rebased);
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
}

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
  return { ...s, staff, tables, tickets, settings: { ...defaultSettings(), ...s.settings } };
}

interface StoreCtx {
  state: AppState;
  /** Mutate a draft copy of state; the result replaces the current state. */
  update: (fn: Mutation) => void;
  replace: (s: AppState) => void;
  money: (n: number) => string;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  stateRef.current = state;
  const baseRev = useRef('0');
  /** Changes made in this tab that aren't saved yet, kept so they can be replayed on newer data. */
  const pending = useRef<Mutation[]>([]);
  const saving = useRef(false);
  const saveTimer = useRef<number>();
  const channel = useRef<BroadcastChannel | null>(null);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    if (saving.current) { saveTimer.current = window.setTimeout(() => void flush(), 100); return; }
    const local = stateRef.current;
    const n = pending.current.length;
    if (!local || n === 0) return;
    saving.current = true;
    try {
      const { rev, rebased } = await saveVersioned(local, baseRev.current, pending.current.slice(0, n));
      baseRev.current = rev;
      pending.current.splice(0, n);
      // If we had to rebase, show the merged data (plus anything changed while saving).
      if (rebased) setState(applyAll(rebased, pending.current));
      channel.current?.postMessage({ rev });
    } finally {
      saving.current = false;
    }
    if (pending.current.length) saveTimer.current = window.setTimeout(() => void flush(), 250);
  }, []);

  const schedule = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 250);
  }, [flush]);

  /** Another tab (or an outside edit) may have saved: pick it up. */
  const checkRemote = useCallback(async () => {
    const rev = await readRev();
    if (rev === null || rev === baseRev.current) return;
    if (pending.current.length || saving.current) return void flush(); // our save will rebase onto it
    const stored = await readStored();
    if (stored.state && !pending.current.length && !saving.current) {
      baseRev.current = stored.rev;
      setState(normalize(stored.state));
    }
  }, [flush]);

  useEffect(() => {
    readStored().then(({ state: s, rev }) => {
      baseRev.current = rev;
      if (s) return setState(normalize(s));
      const fresh = demoState();
      setState(fresh);
      pending.current.push(replaceWith(fresh));
      schedule();
    });
  }, [schedule]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(DB_NAME);
      channel.current.onmessage = () => void checkRemote();
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void checkRemote(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    // Try to save anything left when the tab is hidden or closed
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      channel.current?.close();
      channel.current = null;
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('focus', onVisible);
    };
  }, [checkRemote, flush]);

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

  const { locale, t } = useI18n();
  const currency = state?.settings.currency ?? 'USD';
  const money = useMemo(() => makeMoney(currency, locale), [currency, locale]);

  if (!state) return <div className="loading">{t('common.loading')}</div>;
  return <Ctx.Provider value={{ state, update, replace, money }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside StoreProvider');
  return c;
}
