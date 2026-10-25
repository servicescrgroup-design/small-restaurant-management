import { useEffect, useState } from 'react';
import { useStore } from './store';
import { canAccess, CreateOwner, LockScreen, useAuth } from './auth';
import { LangSwitch, useI18n } from './i18n';
import { ThemeSwitch } from './theme';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Orders from './pages/Orders';
import Inventory from './pages/Inventory';
import Menu from './pages/Menu';
import Calculators from './pages/Calculators';
import Setup from './pages/Setup';
import Account from './pages/Account';

export type Page = 'dashboard' | 'pos' | 'orders' | 'inventory' | 'menu' | 'calculators' | 'setup' | 'account';

const NAV: { id: Page; icon: string }[] = [
  { id: 'dashboard', icon: '▦' },
  { id: 'pos', icon: '◉' },
  { id: 'orders', icon: '≡' },
  { id: 'inventory', icon: '▤' },
  { id: 'menu', icon: '☰' },
  { id: 'calculators', icon: '±' },
  { id: 'setup', icon: '⚙' },
  { id: 'account', icon: '☺' },
];

const fromHash = (): Page => {
  const h = window.location.hash.replace('#', '') as Page;
  return NAV.some((n) => n.id === h) ? h : 'dashboard';
};

export default function App() {
  const { state } = useStore();
  const { user } = useAuth();
  if (!state.staff.some((s) => s.active && s.role === 'owner')) return <CreateOwner />;
  if (!user) return <LockScreen />;
  return <Shell />;
}

function Shell() {
  const { state } = useStore();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const role = user?.role;
  const [requested, setRequested] = useState<Page>(fromHash);
  // Staff who land on an owner-only page (or the default dashboard) go to the POS.
  const page: Page = canAccess(role, requested) ? requested : 'pos';

  useEffect(() => {
    const onHash = () => setRequested(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (p: Page) => { window.location.hash = p; setRequested(p); };

  return (
    <div className={`app ${page === 'pos' ? 'is-pos' : ''}`}>
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <div className="brand-name">Mise</div>
            <div className="brand-store">{state.settings.storeName}</div>
          </div>
        </div>
        {NAV.filter((n) => canAccess(role, n.id)).map((n) => (
          <button key={n.id} className={`nav-btn ${page === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
            <span className="nav-icon" aria-hidden>{n.icon}</span>
            <span className="nav-label">{t(`common.nav.${n.id}`)}</span>
          </button>
        ))}
        <div className="sidebar-user">
          <div className="user-chip">
            <span className="avatar" aria-hidden>{user?.name.charAt(0).toUpperCase()}</span>
            <div style={{ minWidth: 0 }}>
              <div className="user-name">{user?.name}</div>
              <div className="user-role">{t(`common.role.${role ?? 'staff'}`)}</div>
            </div>
          </div>
          <div className="sidebar-prefs">
            <LangSwitch className="sidebar-lang" />
            <ThemeSwitch className="sidebar-lang" />
          </div>
          <button className="nav-btn" onClick={logout} title={t('common.nav.lockHint')}>
            <span className="nav-icon" aria-hidden>⏻</span>
            <span className="nav-label">{t('common.nav.lock')}</span>
          </button>
        </div>
      </nav>
      <main className="main">
        {state.isDemo && page !== 'pos' && role === 'owner' && (
          <div className="demo-banner">
            {t('common.demo.banner')}
            <button className="btn sm" onClick={() => go('setup')}>{t('common.demo.startFresh')}</button>
          </div>
        )}
        {page === 'dashboard' && <Dashboard go={go} />}
        {page === 'pos' && <POS />}
        {page === 'orders' && <Orders />}
        {page === 'inventory' && <Inventory />}
        {page === 'menu' && <Menu />}
        {page === 'calculators' && <Calculators go={go} />}
        {page === 'setup' && <Setup go={go} />}
        {page === 'account' && <Account go={go} />}
      </main>
    </div>
  );
}
