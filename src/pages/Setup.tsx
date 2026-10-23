import { useEffect, useRef, useState } from 'react';
import ImportTab from './ImportTab';
import type { Page } from '../App';
import { useStore } from '../store';
import { demoState, emptyState } from '../demo';
import { ChipEditor, Empty, Field, Modal, NumInput, Pill, Tabs } from '../components/ui';
import { findByPin, isValidPin, makePinCreds, useAuth } from '../auth';
import type { AppState, Settings, Staff, StaffRole } from '../types';
import { localDate, uid } from '../utils';
import { getLocale, useI18n } from '../i18n';

type Tab = 'start' | 'store' | 'import' | 'staff' | 'lists' | 'data';

export default function Setup({ go }: { go: (p: Page) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('start');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('common.nav.setup')}</h1>
          <p>{t('setup.subtitle')}</p>
        </div>
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'start', label: t('setup.tab.start') },
            { id: 'store', label: t('setup.tab.store') },
            { id: 'import', label: `⇪ ${t('importer.tab')}` },
            { id: 'staff', label: t('setup.tab.staff') },
            { id: 'lists', label: t('setup.tab.lists') },
            { id: 'data', label: t('setup.tab.data') },
          ]}
        />
      </div>
      {tab === 'start' && <GettingStarted go={go} setTab={setTab} />}
      {tab === 'store' && <StoreInfo />}
      {tab === 'import' && <ImportTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'lists' && <Lists />}
      {tab === 'data' && <DataTab />}
    </>
  );
}

function GettingStarted({ go, setTab }: { go: (p: Page) => void; setTab: (t: Tab) => void }) {
  const { state } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  const steps = [
    { title: t('setup.step.store.title'), desc: t('setup.step.store.desc'), done: !['My Restaurant', 'ร้านของฉัน'].includes(s.storeName) || !!s.address, action: () => setTab('store'), cta: t('setup.step.store.cta') },
    { title: t('setup.step.staff.title'), desc: t('setup.step.staff.desc'), done: state.staff.some((x) => x.role === 'staff'), action: () => setTab('staff'), cta: t('setup.step.staff.cta') },
    { title: t('setup.step.items.title'), desc: t('setup.step.items.desc'), done: state.items.some((i) => i.kind === 'raw'), action: () => go('inventory'), cta: t('setup.step.items.cta') },
    { title: t('setup.step.receive.title'), desc: t('setup.step.receive.desc'), done: state.batches.length > 0, action: () => go('inventory'), cta: t('setup.step.receive.cta') },
    { title: t('setup.step.prep.title'), desc: t('setup.step.prep.desc'), done: state.items.some((i) => i.kind === 'prep'), action: () => go('inventory'), cta: t('setup.step.prep.cta') },
    { title: t('setup.step.cost.title'), desc: t('setup.step.cost.desc'), done: state.menu.length > 0, action: () => go('calculators'), cta: t('setup.step.cost.cta') },
    { title: t('setup.step.menu.title'), desc: t('setup.step.menu.desc'), done: state.menu.length > 0, action: () => go('menu'), cta: t('setup.step.menu.cta') },
    { title: t('setup.step.sale.title'), desc: t('setup.step.sale.desc'), done: state.orders.length > 0, action: () => go('pos'), cta: t('setup.step.sale.cta') },
  ];
  const doneCount = steps.filter((x) => x.done).length;
  return (
    <div className="grid cols-2">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{t('setup.checklist')}</h2>
            <p>{t('setup.checklistDone', { done: doneCount, total: steps.length })}</p>
          </div>
        </div>
        <div className="meter" style={{ marginBottom: 14 }}><div style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
        <div className="checklist">
          {steps.map((st, i) => (
            <div key={i} className={`check-step ${st.done ? 'done' : ''}`}>
              <span className="dot">{st.done ? '✓' : i + 1}</span>
              <div className="grow">
                <strong>{st.title}</strong>
                <div className="muted" style={{ fontSize: 13 }}>{st.desc}</div>
              </div>
              <button className="btn sm" onClick={st.action}>{st.cta}</button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>{t('setup.howTitle')}</h2>
        <ol className="muted" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          {['items', 'batches', 'prep', 'menu'].map((k) => <li key={k}><strong>{t(`setup.how.${k}.term`)}</strong>{t(`setup.how.${k}.text`)}</li>)}
          <li>{t('setup.how.dash.pre')}<strong>{t('setup.how.dash.term')}</strong>{t('setup.how.dash.text')}</li>
        </ol>
        <div className="callout info">{t('setup.how.info.pre')}<em>{t('setup.tab.data')}</em>{t('setup.how.info.post')}</div>
      </div>
    </div>
  );
}

function StoreInfo() {
  const { state, update } = useStore();
  const { t } = useI18n();
  const [form, setForm] = useState<Settings>(state.settings);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const save = () => { update((d) => { d.settings = { ...d.settings, ...form }; }); setSaved(true); };

  return (
    <div className="card" style={{ maxWidth: 860 }}>
      <div className="form-grid">
        <Field label={t('setup.store.name')} className="span-all"><input value={form.storeName} onChange={(e) => set('storeName', e.target.value)} /></Field>
        <Field label={t('setup.store.address')} className="span-all"><input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={t('setup.store.phone')}><input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label={t('setup.store.currency')} hint={t('setup.store.currencyHint')}>
          <CurrencySelect value={form.currency} onChange={(c) => set('currency', c)} />
        </Field>
        <Field label={t('setup.store.taxRate')}>
          <div className="input-unit"><NumInput value={form.taxRate} onChange={(n) => set('taxRate', n)} /><span>%</span></div>
        </Field>
        <Field label={t('setup.store.targetFoodCost')} hint={t('setup.store.targetFoodCostHint')}>
          <div className="input-unit"><NumInput value={form.targetFoodCost} onChange={(n) => set('targetFoodCost', n)} /><span>%</span></div>
        </Field>
        <Field label={t('setup.store.expiryWarn')} hint={t('setup.store.expiryWarnHint')}>
          <div className="input-unit"><NumInput value={form.expiryWarnDays} onChange={(n) => set('expiryWarnDays', Math.max(0, Math.round(n)))} /><span>{t('common.days')}</span></div>
        </Field>
        <Field label={t('setup.store.autoLock')} hint={t('setup.store.autoLockHint')}>
          <div className="input-unit"><NumInput value={form.autoLockMinutes} onChange={(n) => set('autoLockMinutes', Math.max(0, Math.round(n)))} /><span>{t('setup.store.minutesIdle')}</span></div>
        </Field>
        <Field label={t('setup.store.nextOrder')}>
          <NumInput value={form.nextOrderNumber} onChange={(n) => set('nextOrderNumber', Math.max(1, Math.round(n)))} />
        </Field>
        <Field label={t('setup.store.receiptFooter')} className="span-all"><textarea value={form.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} /></Field>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={save}>{t('common.saveChanges')}</button>
        {saved && <span className="pill ok">{t('common.saved')}</span>}
      </div>
    </div>
  );
}

function Lists() {
  const { state, update } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  const setList = (k: 'menuTabs' | 'menuCategories' | 'inventoryCategories' | 'storageLocations' | 'paymentMethods') => (v: string[]) =>
    update((d) => { d.settings[k] = v; });
  return (
    <div className="grid cols-2">
      <div className="card"><h3>{t('setup.lists.menuTabs')}</h3><p className="muted">{t('setup.lists.menuTabsHint')}</p><ChipEditor values={s.menuTabs} onChange={setList('menuTabs')} placeholder={t('setup.lists.addTab')} /></div>
      <div className="card"><h3>{t('setup.lists.menuCategories')}</h3><p className="muted">{t('setup.lists.menuCategoriesHint')}</p><ChipEditor values={s.menuCategories} onChange={setList('menuCategories')} placeholder={t('setup.lists.addCategory')} /></div>
      <div className="card"><h3>{t('setup.lists.paymentMethods')}</h3><p className="muted">{t('setup.lists.paymentMethodsHint')}</p><ChipEditor values={s.paymentMethods} onChange={setList('paymentMethods')} placeholder={t('setup.lists.addMethod')} /></div>
      <FeesCard />
      <div className="card"><h3>{t('setup.lists.storage')}</h3><p className="muted">{t('setup.lists.storageHint')}</p><ChipEditor values={s.storageLocations} onChange={setList('storageLocations')} placeholder={t('setup.lists.addLocation')} /></div>
      <div className="card"><h3>{t('setup.lists.invCategories')}</h3><p className="muted">{t('setup.lists.invCategoriesHint')}</p><ChipEditor values={s.inventoryCategories} onChange={setList('inventoryCategories')} placeholder={t('setup.lists.addCategory')} /></div>
    </div>
  );
}

function DataTab() {
  const { state, replace } = useStore();
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mise-backup-${localDate()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      if (!parsed.settings || !Array.isArray(parsed.items) || !Array.isArray(parsed.orders)) throw new Error(t('setup.data.notBackup'));
      replace(parsed);
      setMsg({ tone: 'ok', text: t('setup.data.restored', { items: parsed.items.length, menu: parsed.menu.length, orders: parsed.orders.length }) });
    } catch (e) {
      setMsg({ tone: 'bad', text: t('setup.data.importFailed', { error: (e as Error).message }) });
    }
  };

  const startFresh = () => {
    if (!confirm(t(state.isDemo ? 'setup.data.confirmFreshDemo' : 'setup.data.confirmFresh'))) return;
    const fresh = emptyState();
    if (!state.isDemo) {
      fresh.settings = { ...fresh.settings, ...state.settings, nextOrderNumber: 1001 };
      fresh.staff = state.staff;
    }
    replace(fresh);
    setMsg({ tone: 'ok', text: t('setup.data.freshReady') });
  };

  const loadDemo = () => {
    if (!confirm(t('setup.data.confirmDemo'))) return;
    replace(demoState());
    setMsg({ tone: 'ok', text: t('setup.data.demoLoaded') });
  };

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>{t('setup.data.backup')}</h2>
        <p className="muted">{t('setup.data.backupIntro')}</p>
        <div className="row">
          <button className="btn primary" onClick={exportData}>{t('setup.data.export')}</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>{t('setup.data.restore')}</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importData(f); e.target.value = ''; }} />
        </div>
        {msg && <div className={`callout ${msg.tone}`} style={{ marginTop: 12 }}>{msg.text}</div>}
        <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
          {t('setup.data.stored', { items: state.items.length, batches: state.batches.length, menu: state.menu.length, orders: state.orders.length })}
        </p>
      </div>
      <div className="card">
        <h2>{t('setup.data.reset')}</h2>
        <p className="muted">{t(state.isDemo ? 'setup.data.resetDemo' : 'setup.data.resetReal')}</p>
        <div className="row">
          <button className="btn danger" onClick={startFresh}>{t('setup.data.startFresh')}</button>
          <button className="btn" onClick={loadDemo}>{t('setup.data.loadDemo')}</button>
        </div>
      </div>
    </div>
  );
}

function StaffTab() {
  const { state, money } = useStore();
  const { user } = useAuth();
  const { t } = useI18n();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [adding, setAdding] = useState(false);
  const sales = new Map<string, { count: number; net: number }>();
  for (const o of state.orders) {
    if (o.status !== 'paid' || !o.staffId) continue;
    const x = sales.get(o.staffId) ?? { count: 0, net: 0 };
    x.count += 1; x.net += o.subtotal - o.discount;
    sales.set(o.staffId, x);
  }
  const list = [...state.staff].sort((a, b) => Number(b.active) - Number(a.active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', alignItems: 'start' }}>
      <div className="card">
        <div className="card-head">
          <div><h2>{t('setup.staff.title')}</h2><p>{t('setup.staff.intro')}</p></div>
          <button className="btn primary" onClick={() => setAdding(true)}>{t('setup.staff.add')}</button>
        </div>
        {list.length === 0 ? <Empty title={t('setup.staff.empty')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('setup.staff.col.name')}</th><th>{t('setup.staff.col.role')}</th><th>{t('setup.staff.col.status')}</th><th className="num">{t('setup.staff.col.orders')}</th><th className="num">{t('setup.staff.col.sales')}</th><th /></tr></thead>
              <tbody>
                {list.map((x) => (
                  <tr key={x.id} className="clickable" onClick={() => setEditing(x)}>
                    <td><strong>{x.name}</strong>{x.id === user?.id && <span className="muted"> {t('common.you')}</span>}</td>
                    <td>{x.role === 'owner' ? <Pill tone="info">{t('common.role.owner')}</Pill> : <Pill>{t('common.role.staff')}</Pill>}</td>
                    <td>{x.active ? <Pill tone="ok">{t('setup.staff.active')}</Pill> : <Pill tone="muted">{t('setup.staff.deactivated')}</Pill>}</td>
                    <td className="num">{sales.get(x.id)?.count ?? 0}</td>
                    <td className="num">{money(sales.get(x.id)?.net ?? 0)}</td>
                    <td className="actions"><button className="btn sm">{t('common.edit')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="card">
        <h3>{t('setup.perm.title')}</h3>
        <table className="table compact" style={{ marginTop: 8 }}>
          <thead><tr><th /><th>{t('common.role.staff')}</th><th>{t('common.role.owner')}</th></tr></thead>
          <tbody>
            {[
              ['pos', true], ['orders', true], ['inventory', true], ['calculators', true],
              ['void', t('setup.perm.ownerPin')], ['dashboard', false], ['menu', false], ['setup', false],
            ].map(([label, staff]) => (
              <tr key={String(label)}>
                <td>{t(`setup.perm.${label}`)}</td>
                <td>{staff === true ? '✓' : staff === false ? <span className="muted">—</span> : <span className="muted" style={{ fontSize: 12 }}>{staff}</span>}</td>
                <td>✓</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 13 }}>{t('setup.perm.deactivateHint')}</p>
      </div>
      {(adding || editing) && <StaffModal existing={editing} onClose={() => { setAdding(false); setEditing(null); }} />}
    </div>
  );
}

function StaffModal({ existing, onClose }: { existing: Staff | null; onClose: () => void }) {
  const { state, update } = useStore();
  const { user } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState<StaffRole>(existing?.role ?? 'staff');
  const [active, setActive] = useState(existing?.active ?? true);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const isSelf = existing?.id === user?.id;
  const otherOwners = state.staff.filter((x) => x.active && x.role === 'owner' && x.id !== existing?.id);
  const hasOrders = !!existing && state.orders.some((o) => o.staffId === existing.id);

  const error = (() => {
    if (!name.trim()) return '';
    if (!existing && !pin) return '';
    if (pin && !isValidPin(pin)) return t('common.auth.pinLength');
    if (pin && pin2 && pin !== pin2) return t('common.auth.pinMismatch');
    if (pin && findByPin(state.staff.filter((x) => x.id !== existing?.id), pin)) return t('setup.modal.pinTaken');
    if ((role !== 'owner' || !active) && otherOwners.length === 0) return t('setup.modal.needOwner');
    if (isSelf && !active) return t('setup.modal.noSelfDeactivate');
    return '';
  })();
  const canSave = !!name.trim() && !error && (existing ? !pin || pin === pin2 : isValidPin(pin) && pin === pin2);

  const save = () => {
    update((d) => {
      const creds = pin ? makePinCreds(pin) : null;
      if (existing) {
        const x = d.staff.find((y) => y.id === existing.id);
        if (x) Object.assign(x, { name: name.trim(), role, active }, creds ?? {});
      } else {
        d.staff.push({ id: uid(), name: name.trim(), role, active, ...creds! });
      }
    });
    onClose();
  };
  const remove = () => {
    if (!existing) return;
    if (!confirm(t(hasOrders ? 'setup.modal.confirmDeleteOrders' : 'setup.modal.confirmDelete', { name: existing.name }))) return;
    update((d) => { d.staff = d.staff.filter((x) => x.id !== existing.id); });
    onClose();
  };
  const canDelete = existing && !isSelf && (existing.role !== 'owner' || otherOwners.length > 0);

  return (
    <Modal
      title={existing ? t('setup.modal.edit', { name: existing.name }) : t('setup.modal.add')}
      onClose={onClose}
      footer={<>
        {canDelete && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>{t('common.delete')}</button>}
        <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn primary" disabled={!canSave} onClick={save}>{t('common.save')}</button>
      </>}
    >
      <div className="form-grid">
        <Field label={t('setup.modal.name')} className="span-all"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('setup.modal.role')}>
          <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            <option value="staff">{t('setup.modal.roleStaff')}</option>
            <option value="owner">{t('setup.modal.roleOwner')}</option>
          </select>
        </Field>
        <Field label={t('setup.modal.status')}>
          <select value={active ? 'yes' : 'no'} onChange={(e) => setActive(e.target.value === 'yes')}>
            <option value="yes">{t('setup.modal.statusActive')}</option>
            <option value="no">{t('setup.modal.statusInactive')}</option>
          </select>
        </Field>
        <Field label={existing ? t('setup.modal.newPin') : t('setup.modal.pin')}>
          <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
        <Field label={t('common.auth.confirmPin')}>
          <input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} disabled={!pin} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </Field>
      </div>
      {error && <div className="callout bad">{error}</div>}
      {role === 'owner' && !error && <div className="callout warn">{t('setup.modal.ownerWarn')}</div>}
    </Modal>
  );
}

const CURRENCIES = [
  { code: 'THB', symbol: '฿', flag: '🇹🇭' },
  { code: 'USD', symbol: '$', flag: '🇺🇸' },
  { code: 'AUD', symbol: 'A$', flag: '🇦🇺' },
  { code: 'JPY', symbol: '¥', flag: '🇯🇵' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺' },
];

/** Currency dropdown with a symbol badge, flag and a sample price for each option. */
function CurrencySelect({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Keep an older/custom code selectable if the store already uses one
  const list = CURRENCIES.some((c) => c.code === value) ? CURRENCIES : [...CURRENCIES, { code: value, symbol: value, flag: '💱' }];
  const current = list.find((c) => c.code === value)!;
  const sample = (code: string) => {
    try { return new Intl.NumberFormat(getLocale(), { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).format(1234.5); } catch { return ''; }
  };
  const name = (code: string) => (CURRENCIES.some((c) => c.code === code) ? t(`setup.currency.${code}`) : code);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="cur-select" ref={ref}>
      <button type="button" className="cur-button" aria-haspopup="listbox" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}>
        <span className="cur-badge" aria-hidden>{current.symbol}</span>
        <span className="cur-code">{current.code}</span>
        <span className="cur-name">{name(current.code)}</span>
        <span className="ip-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="cur-panel" role="listbox" aria-label={t('setup.store.currency')}>
          {list.map((c) => (
            <button
              key={c.code}
              type="button"
              role="option"
              aria-selected={c.code === value}
              className={`cur-row ${c.code === value ? 'sel' : ''}`}
              onClick={(e) => { e.preventDefault(); onChange(c.code); setOpen(false); }}
            >
              <span className="cur-badge" aria-hidden>{c.symbol}</span>
              <span className="cur-row-main">
                <strong>{c.flag} {c.code}</strong>
                <span>{name(c.code)}</span>
              </span>
              <span className="cur-sample">{sample(c.code)}</span>
              {c.code === value && <span className="ip-check" aria-hidden>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Automatic transaction charge for each payment method. */
function FeesCard() {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  const set = (m: string, p: Partial<{ pct: number; fixed: number }>) => update((d) => {
    const cur = d.settings.paymentFees?.[m] ?? { pct: 0, fixed: 0 };
    const next = { ...cur, ...p };
    d.settings.paymentFees = { ...(d.settings.paymentFees ?? {}) };
    if (!next.pct && !next.fixed) delete d.settings.paymentFees[m]; else d.settings.paymentFees[m] = next;
  });
  return (
    <div className="card">
      <h3>{t('setup.fees.title')}</h3>
      <p className="muted">{t('setup.fees.hint')}</p>
      <div className="table-wrap"><table className="table compact">
        <thead><tr><th>{t('setup.fees.method')}</th><th style={{ width: 96 }}>{t('setup.fees.pct')}</th><th style={{ width: 92 }}>{t('setup.fees.fixed')}</th><th className="num">{t('setup.fees.example', { amount: money(100) })}</th></tr></thead>
        <tbody>
          {s.paymentMethods.map((m) => {
            const f = s.paymentFees?.[m] ?? { pct: 0, fixed: 0 };
            return (
              <tr key={m}>
                <td><strong>{m}</strong></td>
                <td><div className="input-unit"><NumInput value={f.pct} onChange={(pct) => set(m, { pct: Math.max(0, pct) })} /><span>%</span></div></td>
                <td><NumInput value={f.fixed} onChange={(fixed) => set(m, { fixed: Math.max(0, fixed) })} /></td>
                <td className="num muted">{f.pct || f.fixed ? `+${money((100 * f.pct) / 100 + f.fixed)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>{t('setup.fees.exampleHint', { amount: money(100) })}</p>
    </div>
  );
}
