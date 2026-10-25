import type { Page } from '../App';
import { useAccount } from '../account';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { fmtPlanPrice, PAYMENTS_ENABLED, PLANS, planCurrency, planPrices, TRIAL_DAYS, type PlanId } from '../plans';
import { useStore } from '../store';
import { fmtDate, localDate } from '../utils';
import { Pill } from './ui';

/** Save a copy of everything, so a business can always take its data with it. */
export function downloadBackup(state: unknown, name: string) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mise-${name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${localDate()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Slim banner on every page during the trial, or when a renewal is overdue. */
export function TrialBanner({ go }: { go: (p: Page) => void }) {
  const account = useAccount();
  const { user } = useAuth();
  const { t } = useI18n();
  if (!account) return null;
  const { state, daysLeft } = account.access;
  if (state !== 'trial' && state !== 'pastDue') return null;
  const urgent = state === 'pastDue' || daysLeft <= 7;
  return (
    <div className={`trial-banner ${urgent ? 'urgent' : ''}`}>
      <span>{state === 'trial' ? t('account.banner.trial', { n: daysLeft }) : t('account.banner.pastDue')}</span>
      {user?.role === 'owner' && <button className="btn sm" onClick={() => go('account')}>{t('account.choosePlan')}</button>}
    </div>
  );
}

/** Plan & billing card on the Account page. */
export function PlanCard() {
  const account = useAccount()!;
  const { t } = useI18n();
  const { subscription: sub, access } = account;
  const tone = access.state === 'active' ? 'ok' : access.state === 'trial' ? 'info' : 'warn';
  return (
    <div className="card span-all">
      <div className="card-head">
        <div>
          <h2>💳 {t('account.billingTitle')}</h2>
          <p>{t('account.billingIntro', { days: TRIAL_DAYS })}</p>
        </div>
        <Pill tone={tone}>{t(`account.state.${access.state}`)}</Pill>
      </div>
      {sub && (
        <div className="kv-list" style={{ marginTop: 0, marginBottom: 14 }}>
          {access.state === 'trial' && <div className="kv"><span>{t('account.trialEnds')}</span><strong>{fmtDate(localDate(new Date(sub.trialEndsAt)))} · {t('account.daysLeft', { n: access.daysLeft })}</strong></div>}
          {sub.plan && <div className="kv"><span>{t('account.currentPlan')}</span><strong>{t(`account.plan.${sub.plan}`)}</strong></div>}
          {sub.currentPeriodEnd && <div className="kv"><span>{t('account.renews')}</span><strong>{fmtDate(localDate(new Date(sub.currentPeriodEnd)))}</strong></div>}
        </div>
      )}
      <PlanChoices current={sub?.status === 'active' ? sub.plan : null} />
    </div>
  );
}

function PlanChoices({ current }: { current: PlanId | null }) {
  const { t, lang } = useI18n();
  const cur = planCurrency(lang);
  const p = planPrices(cur);
  const money = (n: number) => fmtPlanPrice(n, cur);
  return (
    <>
      <div className="plan-cards">
        {(Object.keys(PLANS) as PlanId[]).map((id) => (
          <div key={id} className={`plan-card ${id === 'yearly' ? 'best' : ''} ${current === id ? 'current' : ''}`}>
            {id === 'yearly' && <span className="plan-tag">{t('account.save', { amount: money(p.yearlySaving) })}</span>}
            <span className="plan-name">{t(`account.plan.${id}`)}</span>
            <span className="plan-price">{money(p[id])}<small>/{t(id === 'monthly' ? 'account.perMonth' : 'account.perYear')}</small></span>
            {id === 'yearly' && <span className="muted" style={{ fontSize: 12.5 }}>{t('account.perMonthEquiv', { amount: money(p.yearlyPerMonth) })}</span>}
            <button className="btn primary" disabled={!PAYMENTS_ENABLED || current === id}>
              {current === id ? t('account.currentPlan') : t('account.subscribe')}
            </button>
          </div>
        ))}
      </div>
      {!PAYMENTS_ENABLED && <p className="callout info" style={{ marginTop: 12, marginBottom: 0 }}>{t('account.paymentsSoon')}</p>}
    </>
  );
}

/** Shown instead of the app when the trial is over and no plan is active. Data stays readable/exportable. */
export function TrialEnded() {
  const account = useAccount()!;
  const { state } = useStore();
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const isOwner = user?.role === 'owner';
  return (
    <div className="main">
      <div className="card trial-ended">
        <span className="trial-ended-icon" aria-hidden>⏳</span>
        <h1>{t('account.endedTitle')}</h1>
        <p className="muted">{isOwner ? t('account.endedOwner', { name: account.business.name }) : t('account.endedStaff')}</p>
        {isOwner && <PlanChoices current={null} />}
        <div className="row" style={{ justifyContent: 'center', marginTop: 16 }}>
          {isOwner && <button className="btn" onClick={() => downloadBackup(state, account.business.name)}>{t('account.exportData')}</button>}
          <button className="btn ghost" onClick={logout}>{t('common.nav.lock')}</button>
          {isOwner && <button className="btn ghost" onClick={() => void account.signOut()}>{t('account.signOut')}</button>}
        </div>
      </div>
    </div>
  );
}
