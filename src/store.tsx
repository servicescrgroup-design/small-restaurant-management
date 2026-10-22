import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppState } from './types';
import { defaultSettings, defaultTables, demoStaff, demoState } from './demo';
import { makeMoney, uid } from './utils';
import { useI18n } from './i18n';

// Data lives in the browser's IndexedDB (much larger than localStorage), with localStorage as a fallback.
const DB_NAME = 'mise-pos';
const STORE = 'kv';
const KEY = 'state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadState(): Promise<AppState | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (typeof value === 'string') return JSON.parse(value);
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(DB_NAME);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

async function saveState(s: AppState) {
  const json = JSON.stringify(s);
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(json, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(DB_NAME, json); } catch { /* storage full or blocked */ }
  }
}

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
  update: (fn: (draft: AppState) => void) => void;
  replace: (s: AppState) => void;
  money: (n: number) => string;
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const saveTimer = useRef<number>();

  useEffect(() => {
    loadState().then((s) => setState(s ? normalize(s) : demoState()));
  }, []);

  useEffect(() => {
    if (!state) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveState(state), 250);
  }, [state]);

  const update = useCallback((fn: (d: AppState) => void) => {
    setState((s) => {
      if (!s) return s;
      const d = structuredClone(s);
      fn(d);
      return d;
    });
  }, []);

  const replace = useCallback((s: AppState) => setState(normalize(s)), []);
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
