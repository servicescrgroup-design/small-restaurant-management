import { useEffect, useState } from 'react';
import { useStore } from './store';
import { canAccess, CreateOwner, LockScreen, useAuth } from './auth';
import { clearJustJoined, justJoined } from './account';
import { LangSwitch, useI18n } from './i18n';
import { ThemeSwitch } from './theme';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Orders from './pages/Orders';
import Inventory from './pages/Inventory';
import Menu from './pages/Menu';
import Purchases from './pages/Purchases';
import Calculators from './pages/Calculators';
import Setup from './pages/Setup';
import Account from './pages/Account';
import SetupGuide from './pages/SetupGuide';
import Tour, { useStartOwnShop } from './components/Tour';
import { TrialBanner, TrialEnded } from './components/Billing';
import { useAccount } from './account';

export type Page = 'dashboard' | 'pos' | 'orders' | 'inventory' | 'purchases' | 'menu' | 'calculators' | 'setup' | 'account';

const NAV: { id: Page; icon: string }[] = [
  { id: 'dashboard', icon: '▦' },
  { id: 'pos', icon: '◉' },
  { id: 'orders', icon: '≡' },
  { id: 'inventory', icon: '▤' },
  { id: 'purchases', icon: '¤' },
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
  const account = useAccount();
  const [, rerender] = useState(0);
  const doneJoining = () => { clearJustJoined(); rerender((n) => n + 1); };
  if (!state.staff.some((s) => s.active && s.role === 'owner')) return <CreateOwner />;
  // Someone who just joined as a co-owner sets up their own name and PIN for this shop
  if (!user && account && justJoined() === account.business.id) return <CreateOwner joined={account.business.name} onSkip={doneJoining} onDone={doneJoining} />;
  if (!user) return <LockScreen />;
  return <Shell />;
}

function Shell() {
  const { state } = useStore();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const account = useAccount();
  const startOwnShop = useStartOwnShop();
  const role = user?.role;
  const touring = state.isDemo && state.tour !== undefined && role === 'owner' && !state.setupGuide;
  const [requested, setRequested] = useState<Page>(fromHash);
  // Phones: the nav is a drawer opened from the top bar
  const [navOpen, setNavOpen] = useState(false);
  // Computers: the sidebar can shrink to icons, remembered on this device
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('mise.navCollapsed') === '1'; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem('mise.navCollapsed', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  // Staff who land on an owner-only page (or the default dashboard) go to the POS.
  const page: Page = canAccess(role, requested) ? requested : 'pos';

  useEffect(() => {
    const onHash = () => setRequested(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (p: Page) => { window.location.hash = p; setRequested(p); setNavOpen(false); };

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return (
    <div className={`app ${page === 'pos' ? 'is-pos' : ''} ${collapsed ? 'nav-collapsed' : ''}`}>
      <header className="mobile-bar">
        <span className="brand-mark" aria-hidden>M</span>
        <div className="mobile-bar-title">
          <strong>{t(`common.nav.${page}`)}</strong>
          <span>{state.settings.storeName}</span>
        </div>
        <button className="mobile-menu-btn" aria-label={t('common.nav.open')} aria-expanded={navOpen} onClick={() => setNavOpen(true)}>☰</button>
      </header>
      {navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} />}
      <nav className={`sidebar ${navOpen ? 'open' : ''}`}>
        <button className="nav-close" aria-label={t('common.close')} onClick={() => setNavOpen(false)}>✕</button>
        <div className="brand">
          <span className="brand-mark">M</span>
          <div className="brand-text">
            <div className="brand-name">Mise</div>
            <div className="brand-store">{state.settings.storeName}</div>
          </div>
        </div>
        <button className="nav-collapse" onClick={toggleCollapsed} aria-expanded={!collapsed} title={t(collapsed ? 'common.nav.expand' : 'common.nav.collapse')} aria-label={t(collapsed ? 'common.nav.expand' : 'common.nav.collapse')}>
          {collapsed ? '»' : '«'}
        </button>
        {NAV.filter((n) => canAccess(role, n.id)).map((n) => (
          <button key={n.id} className={`nav-btn ${page === n.id ? 'active' : ''}`} onClick={() => go(n.id)} title={collapsed ? t(`common.nav.${n.id}`) : undefined}>
            <span className="nav-icon" aria-hidden>{n.icon}</span>
            <span className="nav-label">{t(`common.nav.${n.id}`)}</span>
          </button>
        ))}
        <div className="sidebar-user">
          <div className="user-chip" title={collapsed ? user?.name : undefined}>
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
          <button className="nav-btn" onClick={logout} title={collapsed ? t('common.nav.lock') : t('common.nav.lockHint')}>
            <span className="nav-icon" aria-hidden>⏻</span>
            <span className="nav-label">{t('common.nav.lock')}</span>
          </button>
        </div>
      </nav>
      {account && !account.access.canSave && account.subscription ? <TrialEnded /> : (
      <main className="main">
        <TrialBanner go={go} />
        {state.setupGuide && role === 'owner' ? <SetupGuide go={go} /> : <>
        {state.isDemo && !touring && page !== 'pos' && role === 'owner' && (
          <div className="demo-banner">
            {t('common.demo.banner')}
            <button className="btn sm" onClick={startOwnShop}>{t('common.demo.startFresh')}</button>
          </div>
        )}
        {page === 'dashboard' && <Dashboard go={go} />}
        {page === 'pos' && <POS />}
        {page === 'orders' && <Orders />}
        {page === 'inventory' && <Inventory />}
        {page === 'purchases' && <Purchases />}
        {page === 'menu' && <Menu />}
        {page === 'calculators' && <Calculators go={go} />}
        {page === 'setup' && <Setup go={go} />}
        {page === 'account' && <Account go={go} />}
        </>}
        {touring && <Tour go={go} />}
      </main>
      )}
    </div>
  );
}
