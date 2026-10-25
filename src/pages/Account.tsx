import { useState } from 'react';
import type { Page } from '../App';
import { useStore } from '../store';
import { useAccount } from '../account';
import { useI18n } from '../i18n';
import { changePassword, cloudEnabled, deleteBusiness, renameBusiness } from '../cloud';
import { Field, Pill } from '../components/ui';
import { PlanCard } from '../components/Billing';
import { fmtDate, localDate } from '../utils';

/** The signed-in business: who owns it, sync status, password, switching, and deleting. */
export default function Account({ go }: { go: (p: Page) => void }) {
  const account = useAccount();
  const { t } = useI18n();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('account.pageTitle')}</h1>
          <p>{account ? t('account.pageIntro') : t('account.localIntro')}</p>
        </div>
      </div>
      {account ? <CloudAccount /> : <LocalOnly go={go} />}
    </>
  );
}

function SyncPill() {
  const { sync } = useStore();
  const { t } = useI18n();
  return <Pill tone={sync === 'saved' ? 'ok' : sync === 'saving' ? 'info' : 'warn'}>{t(`account.sync.${sync}`)}</Pill>;
}

function CloudAccount() {
  const account = useAccount()!;
  const { state, update, flushNow } = useStore();
  const { t } = useI18n();
  const { business, businesses, session } = account;
  const isOwner = business.role === 'owner';
  const [name, setName] = useState(business.name);
  const [nameMsg, setNameMsg] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [del, setDel] = useState('');
  const [busy, setBusy] = useState(false);
  const sizeKB = Math.round(JSON.stringify(state).length / 1024);

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === business.name) return;
    try {
      await renameBusiness(business.id, n);
      update((d) => { d.settings.storeName = n; });
      await account.refresh();
      setNameMsg(t('common.saved'));
    } catch (e) { setNameMsg(String((e as Error).message)); }
  };

  const savePw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return setPwMsg({ tone: 'bad', text: t('account.err.weak') });
    if (pw !== pw2) return setPwMsg({ tone: 'bad', text: t('account.err.mismatch') });
    try { await changePassword(pw); setPw(''); setPw2(''); setPwMsg({ tone: 'ok', text: t('account.pwChanged') }); }
    catch (err) { setPwMsg({ tone: 'bad', text: String((err as Error).message) }); }
  };

  const leave = async (then: () => void | Promise<void>) => {
    setBusy(true);
    await flushNow(); // don't lose the last few taps
    await then();
  };

  const remove = async () => {
    if (del !== business.name) return;
    if (!confirm(t('account.deleteConfirm', { name: business.name }))) return;
    setBusy(true);
    try {
      await deleteBusiness(business.id, del);
      account.switchBusiness(null);
      await account.refresh();
    } catch (e) { alert(String((e as Error).message)); setBusy(false); }
  };

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <PlanCard />
      <div className="card">
        <div className="card-head"><h2>🏪 {t('account.business')}</h2><Pill tone="info">{t(`account.role.${business.role}`)}</Pill></div>
        <div className="form-grid">
          <Field label={t('account.bizName')} className="span-all">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={name} disabled={!isOwner} onChange={(e) => { setName(e.target.value); setNameMsg(''); }} />
              {isOwner && <button className="btn" disabled={!name.trim() || name.trim() === business.name} onClick={() => void saveName()}>{t('common.save')}</button>}
            </div>
            {nameMsg && <span className="field-hint">{nameMsg}</span>}
          </Field>
        </div>
        <div className="kv-list">
          <div className="kv"><span>{t('account.created')}</span><strong>{fmtDate(localDate(new Date(business.created_at)))}</strong></div>
          <div className="kv"><span>{t('account.accountId')}</span><code>{business.id.slice(0, 8)}</code></div>
          <div className="kv"><span>{t('account.dataSize')}</span><span>{t('account.dataSizeValue', { kb: sizeKB, dishes: state.menu.length, orders: state.orders.length })}</span></div>
          <div className="kv"><span>{t('account.syncLabel')}</span><SyncPill /></div>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{t('account.syncHint')}</p>
      </div>

      <div className="card">
        <div className="card-head"><h2>👤 {t('account.signedInAs')}</h2></div>
        <div className="kv"><span>{t('account.email')}</span><strong>{session.user.email}</strong></div>
        <form onSubmit={savePw} className="account-form" style={{ marginTop: 14 }}>
          <span className="field-label">{t('account.changePassword')}</span>
          <input type="password" autoComplete="new-password" placeholder={t('account.newPassword')} value={pw} onChange={(e) => setPw(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder={t('account.password2')} value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {pwMsg && <div className={`callout ${pwMsg.tone}`}>{pwMsg.text}</div>}
          <button className="btn" disabled={!pw}>{t('account.changePassword')}</button>
        </form>
        <div className="row" style={{ marginTop: 16 }}>
          {businesses.length > 1 && <button className="btn" disabled={busy} onClick={() => void leave(() => account.switchBusiness(null))}>{t('account.switchBusiness')}</button>}
          <button className="btn" disabled={busy} onClick={() => void leave(() => account.switchBusiness(null))}>{t('account.addBusiness')}</button>
          <span className="spacer" />
          <button className="btn danger" disabled={busy} onClick={() => void leave(account.signOut)}>{t('account.signOut')}</button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>{t('account.staffHint')}</p>
      </div>

      {isOwner && (
        <div className="card span-all danger-zone">
          <h2>{t('account.dangerTitle')}</h2>
          <p className="muted">{t('account.dangerHint')}</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input placeholder={business.name} value={del} onChange={(e) => setDel(e.target.value)} aria-label={t('account.typeName')} />
            <button className="btn danger solid" disabled={busy || del !== business.name} onClick={() => void remove()}>{t('account.deleteBusiness')}</button>
          </div>
          <span className="field-hint">{t('account.typeName')}</span>
        </div>
      )}
    </div>
  );
}

function LocalOnly({ go }: { go: (p: Page) => void }) {
  const { state } = useStore();
  const { t } = useI18n();
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h2>📱 {t('account.localTitle')}</h2>
        <p className="muted">{t('account.localBody', { name: state.settings.storeName })}</p>
        <div className="kv"><span>{t('account.syncLabel')}</span><SyncPill /></div>
        <button className="btn" style={{ marginTop: 14 }} onClick={() => go('setup')}>{t('account.goBackup')}</button>
      </div>
      <div className="card">
        <h2>☁️ {t('account.cloudTitle')}</h2>
        <p className="muted">{cloudEnabled ? t('account.cloudOn') : t('account.cloudOff')}</p>
      </div>
    </div>
  );
}
