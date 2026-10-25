import { useEffect, useState } from 'react';
import type { Page } from '../App';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { freshStart } from '../demo';

/** The pages a new owner is walked through in the demo shop, ending with clearing it. */
const STEPS: { page: Page; key: string; icon: string }[] = [
  { page: 'dashboard', key: 'welcome', icon: '👋' },
  { page: 'pos', key: 'pos', icon: '◉' },
  { page: 'orders', key: 'orders', icon: '≡' },
  { page: 'inventory', key: 'stock', icon: '▤' },
  { page: 'menu', key: 'menu', icon: '☰' },
  { page: 'calculators', key: 'calc', icon: '±' },
  { page: 'setup', key: 'clear', icon: '✨' },
];

/** Leave the demo for a blank store: owner PIN next, then the setup guide (first dishes). */
export function useStartOwnShop() {
  const { state, replace } = useStore();
  const { t } = useI18n();
  return () => {
    if (!confirm(t('guide.tour.confirmClear'))) return false;
    replace(freshStart(state));
    return true;
  };
}

/** Floating coach card for new sign-ups exploring the demo shop. */
export default function Tour({ go }: { go: (p: Page) => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const startOwnShop = useStartOwnShop();
  const [small, setSmall] = useState(false);
  const step = Math.min(Math.max(0, state.tour ?? 0), STEPS.length - 1);
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  // Open the page this step talks about
  useEffect(() => { go(s.page); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const to = (n: number) => { setSmall(false); update((d) => { d.tour = n; }); };
  const end = () => update((d) => { delete d.tour; });

  if (small) {
    return (
      <button className="tour-pill" onClick={() => setSmall(false)}>
        {s.icon} {t('guide.tour.pill', { n: step + 1, total: STEPS.length })}
      </button>
    );
  }

  return (
    <aside className="tour-card" role="dialog" aria-label={t('guide.tour.label')}>
      <div className="tour-head">
        <span className="tour-count">{t('guide.tour.pill', { n: step + 1, total: STEPS.length })}</span>
        <span className="spacer" />
        <button className="tour-x" onClick={() => setSmall(true)} aria-label={t('guide.tour.minimise')} title={t('guide.tour.minimise')}>–</button>
      </div>
      <h3>{s.icon} {t(`guide.tour.${s.key}.title`)}</h3>
      <p>{t(`guide.tour.${s.key}.text`)}</p>
      {last && <div className="callout info tour-where">{t('guide.tour.clear.where')}</div>}
      <div className="tour-dots" aria-hidden>{STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : i < step ? 'done' : ''} />)}</div>
      {last ? (
        <div className="tour-actions">
          <button className="btn primary" onClick={startOwnShop}>{t('guide.tour.clearBtn')}</button>
          <button className="btn ghost" onClick={end}>{t('guide.tour.keepExploring')}</button>
        </div>
      ) : (
        <div className="tour-actions">
          {step > 0 && <button className="btn" onClick={() => to(step - 1)}>← {t('common.back')}</button>}
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => to(STEPS.length - 1)}>{t('guide.tour.skip')}</button>
          <button className="btn primary" onClick={() => to(step + 1)}>{t('guide.next')} →</button>
        </div>
      )}
    </aside>
  );
}
