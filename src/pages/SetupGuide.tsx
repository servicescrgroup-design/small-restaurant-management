import { useState } from 'react';
import type { Page } from '../App';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { Field, NumInput } from '../components/ui';
import ImportTab, { SOURCES, SourceButton, type Source } from './ImportTab';
import { CurrencySelect } from './Setup';
import type { Settings } from '../types';

type Step = 'store' | 'menu' | 'pay' | 'done';
const STEPS: Step[] = ['store', 'menu', 'pay', 'done'];

/** Delivery apps and wallets most Thai shops take, offered as one-tap payment methods. */
const APPS = ['GrabFood', 'LINE MAN', 'ShopeeFood', 'Robinhood'];

/**
 * Shown to the owner right after a new (blank) business is created: store details, bring the menu in
 * from Wongnai / Grab / FoodStory / a file, payment methods, then where to go next.
 */
export default function SetupGuide({ go }: { go: (p: Page) => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('store');
  const [from, setFrom] = useState<Source | null>(null);
  const [imported, setImported] = useState<{ n: number; from: Source } | null>(null);
  const at = STEPS.indexOf(step);

  const finish = (page: Page = 'dashboard') => {
    update((d) => { delete d.setupGuide; });
    go(page);
  };

  return (
    <div className="guide">
      <div className="page-head">
        <div>
          <h1>{t('guide.title', { name: state.settings.storeName })}</h1>
          <p>{t('guide.intro')}</p>
        </div>
        <button className="btn ghost" onClick={() => finish()}>{t('guide.skipAll')}</button>
      </div>

      <ol className="guide-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < at ? 'done' : i === at ? 'current' : ''}>
            <span className="dot">{i < at ? '✓' : i + 1}</span>
            <span>{t(`guide.step.${s}`)}</span>
          </li>
        ))}
      </ol>

      {step === 'store' && <StoreStep onNext={() => setStep('menu')} />}

      {step === 'menu' && (
        <div className="grid">
          <div className="card">
            <h2>{t('guide.menu.title')}</h2>
            <p className="muted" style={{ marginTop: 4 }}>{t('guide.menu.intro')}</p>
            <div className="import-sources">
              {SOURCES.map((src) => <SourceButton key={src} src={src} active={from === src} onClick={() => { setFrom(src); setImported(null); }} />)}
            </div>
          </div>
          {from && !imported && <ImportTab key={from} source={from} onImported={(n, src) => setImported({ n, from: src })} />}
          {imported && <div className="callout ok">{t('guide.menu.done', { n: imported.n, source: t(`importer.src.${imported.from}`) })}</div>}
          <div className="row">
            <button className="btn" onClick={() => setStep('store')}>← {t('common.back')}</button>
            <span className="spacer" />
            {!imported && <button className="btn ghost" onClick={() => setStep('pay')}>{t('guide.menu.skip')}</button>}
            {imported && (
              <button className="btn" onClick={() => setImported(null)}>{t('guide.menu.more')}</button>
            )}
            {imported && <button className="btn primary" onClick={() => setStep('pay')}>{t('guide.next')} →</button>}
          </div>
        </div>
      )}

      {step === 'pay' && <PayStep suggestGrab={from === 'grab'} onBack={() => setStep('menu')} onNext={() => setStep('done')} />}

      {step === 'done' && (
        <div className="card guide-done">
          <span className="guide-done-icon" aria-hidden>🎉</span>
          <h2>{t('guide.done.title')}</h2>
          <p className="muted">{t('guide.done.summary', { dishes: state.menu.length, methods: state.settings.paymentMethods.length })}</p>
          <div className="guide-next">
            <button className="start-option" onClick={() => finish('pos')}>
              <strong>◉ {t('guide.done.pos')}</strong><span>{t('guide.done.posHint')}</span>
            </button>
            <button className="start-option" onClick={() => finish('menu')}>
              <strong>☰ {t('guide.done.menu')}</strong><span>{t('guide.done.menuHint')}</span>
            </button>
            <button className="start-option" onClick={() => finish('inventory')}>
              <strong>▤ {t('guide.done.stock')}</strong><span>{t('guide.done.stockHint')}</span>
            </button>
            <button className="start-option" onClick={() => finish('setup')}>
              <strong>⚙ {t('guide.done.staff')}</strong><span>{t('guide.done.staffHint')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StoreStep({ onNext }: { onNext: () => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const [form, setForm] = useState<Settings>(state.settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    update((d) => {
      d.settings = { ...d.settings, storeName: form.storeName.trim() || d.settings.storeName, address: form.address, phone: form.phone, currency: form.currency, taxRate: form.taxRate };
    });
    onNext();
  };
  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <h2>{t('guide.store.title')}</h2>
      <p className="muted" style={{ marginTop: 4 }}>{t('guide.store.intro')}</p>
      <div className="form-grid">
        <Field label={t('setup.store.name')} className="span-all"><input value={form.storeName} onChange={(e) => set('storeName', e.target.value)} /></Field>
        <Field label={t('setup.store.address')} className="span-all"><input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={t('setup.store.phone')}><input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('setup.store.currency')}><CurrencySelect value={form.currency} onChange={(c) => set('currency', c)} /></Field>
        <Field label={t('setup.store.taxRate')} hint={t('guide.store.taxHint')}>
          <div className="input-unit"><NumInput value={form.taxRate} onChange={(n) => set('taxRate', n)} /><span>%</span></div>
        </Field>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{t('guide.store.later')}</p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn primary" onClick={save}>{t('guide.next')} →</button>
      </div>
    </div>
  );
}

function PayStep({ suggestGrab, onBack, onNext }: { suggestGrab: boolean; onBack: () => void; onNext: () => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const current = state.settings.paymentMethods;
  const common = [t('guide.pay.cash'), t('guide.pay.promptpay'), t('guide.pay.card')];
  const options = [...new Set([...current, ...common, ...APPS])];
  const [picked, setPicked] = useState<Set<string>>(() => new Set([...current, ...(suggestGrab ? ['GrabFood'] : [])]));
  const [extra, setExtra] = useState('');
  const toggle = (m: string) => setPicked((p) => { const n = new Set(p); if (n.has(m)) n.delete(m); else n.add(m); return n; });
  const addExtra = () => { const m = extra.trim(); if (!m) return; setPicked((p) => new Set(p).add(m)); setExtra(''); };
  const all = [...options, ...[...picked].filter((m) => !options.includes(m))];

  const save = () => {
    update((d) => { d.settings.paymentMethods = all.filter((m) => picked.has(m)); });
    onNext();
  };
  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <h2>{t('guide.pay.title')}</h2>
      <p className="muted" style={{ marginTop: 4 }}>{t('guide.pay.intro')}</p>
      <div className="guide-chips">
        {all.map((m) => (
          <button key={m} type="button" className={`guide-chip ${picked.has(m) ? 'on' : ''}`} aria-pressed={picked.has(m)} onClick={() => toggle(m)}>
            {picked.has(m) ? '✓ ' : '+ '}{m}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12, flexWrap: 'nowrap', maxWidth: 420 }}>
        <input value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addExtra(); }} placeholder={t('guide.pay.other')} />
        <button className="btn" disabled={!extra.trim()} onClick={addExtra}>{t('guide.pay.add')}</button>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{t('guide.pay.feesLater')}</p>
      <div className="row">
        <button className="btn" onClick={onBack}>← {t('common.back')}</button>
        <span className="spacer" />
        <button className="btn primary" disabled={!picked.size} onClick={save}>{t('guide.next')} →</button>
      </div>
    </div>
  );
}
