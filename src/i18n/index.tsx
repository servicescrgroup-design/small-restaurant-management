import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import common from './common';
import dashboard from './dashboard';
import pos from './pos';
import orders from './orders';
import inventory from './inventory';
import menu from './menu';
import calc from './calc';
import setup from './setup';
import importer from './importer';
import account from './account';
import guide from './guide';

/**
 * Translations. English is the main language; every English string must also have a Thai version.
 *
 * Each namespace file calls `defineMessages(en, th)`. TypeScript refuses to compile if the Thai
 * object is missing a key that English has, so nothing ships untranslated.
 *
 * Usage: `const { t } = useI18n(); t('pos.charge', { amount: money(due) })` — `{amount}` in the
 * string is replaced with the value.
 */

export type Lang = 'en' | 'th';
export const LANGS: { id: Lang; label: string; locale: string }[] = [
  { id: 'en', label: 'English', locale: 'en-US' },
  { id: 'th', label: 'ไทย', locale: 'th-TH' },
];

type Messages = Record<string, string>;
export function defineMessages<E extends Messages>(en: E, th: { [K in keyof E]: string }) {
  return { en, th: th as Messages };
}

const NAMESPACES: Record<string, { en: Messages; th: Messages }> = { common, dashboard, pos, orders, inventory, menu, calc, setup, importer, account, guide };

export type Vars = Record<string, string | number>;
export type TFunc = (key: string, vars?: Vars) => string;

function lookup(lang: Lang, key: string): string | undefined {
  const dot = key.indexOf('.');
  const ns = NAMESPACES[key.slice(0, dot)];
  const k = key.slice(dot + 1);
  return ns?.[lang][k] ?? ns?.en[k];
}

function format(lang: Lang, key: string, vars?: Vars) {
  let s = lookup(lang, key);
  if (s === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m));
  return s;
}

// The current language is also kept at module level so plain helpers (date formatting,
// expiry labels) can translate without being passed `t`.
const STORAGE_KEY = 'mise-lang';
let current: Lang = (() => {
  try { return localStorage.getItem(STORAGE_KEY) === 'th' ? 'th' : 'en'; } catch { return 'en'; }
})();

export const getLang = () => current;
export const getLocale = () => LANGS.find((l) => l.id === current)!.locale;
/** Translate outside React components. Components should use `useI18n().t` so they re-render on switch. */
export const translate: TFunc = (key, vars) => format(current, key, vars);

interface I18nCtx { lang: Lang; locale: string; setLang: (l: Lang) => void; t: TFunc }
const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    document.documentElement.lang = l;
    setLangState(l);
  }, []);
  current = lang;
  document.documentElement.lang = lang;
  const t = useCallback<TFunc>((key, vars) => format(lang, key, vars), [lang]);
  return <Ctx.Provider value={{ lang, locale: getLocale(), setLang, t }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}

export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Language / ภาษา">
      {LANGS.map((l) => (
        <button key={l.id} className={lang === l.id ? 'active' : ''} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>{l.label}</button>
      ))}
    </div>
  );
}
