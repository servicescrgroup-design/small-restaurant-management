import { useEffect, useState } from 'react';
import { useI18n } from './i18n';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'mise-theme';

const read = (): ThemePref => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
};
const media = () => window.matchMedia('(prefers-color-scheme: dark)');
const apply = (pref: ThemePref) => {
  document.documentElement.dataset.theme = pref === 'system' ? (media().matches ? 'dark' : 'light') : pref;
};

// Apply before first paint so there's no flash of the wrong theme.
apply(read());

const listeners = new Set<(p: ThemePref) => void>();
let current = read();
media().addEventListener('change', () => { if (current === 'system') apply('system'); });

export function setTheme(p: ThemePref) {
  current = p;
  try { localStorage.setItem(KEY, p); } catch { /* ignore */ }
  apply(p);
  listeners.forEach((l) => l(p));
}

export function useTheme() {
  const [pref, setPref] = useState(current);
  useEffect(() => { listeners.add(setPref); return () => { listeners.delete(setPref); }; }, []);
  return [pref, setTheme] as const;
}

export function ThemeSwitch({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const [pref, set] = useTheme();
  const opts: { id: ThemePref; icon: string }[] = [{ id: 'light', icon: '☀' }, { id: 'system', icon: '◐' }, { id: 'dark', icon: '☾' }];
  return (
    <div className={`lang-switch theme-switch ${className}`} role="group" aria-label={t('common.theme.label')}>
      {opts.map((o) => (
        <button key={o.id} className={pref === o.id ? 'active' : ''} aria-pressed={pref === o.id} title={t(`common.theme.${o.id}`)} aria-label={t(`common.theme.${o.id}`)} onClick={() => set(o.id)}>{o.icon}</button>
      ))}
    </div>
  );
}
