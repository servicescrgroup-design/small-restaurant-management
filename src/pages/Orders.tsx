import { useState } from 'react';
import { useStore } from '../store';
import { OwnerApproval, useAuth } from '../auth';
import { netSales, orderCogs } from '../inventory';
import { Empty, Field, Modal, Pill, Stat } from '../components/ui';
import { Receipt } from '../components/Receipt';
import type { Order, Staff } from '../types';
import { addDays, fmtDateTime, localDate, orderDay } from '../utils';
import { useI18n } from '../i18n';
import { methodLabel } from '../payments';
import SalesImport from '../components/SalesImport';

export default function Orders() {
  const { state, update, money } = useStore();
  const { t, lang } = useI18n();
  const today = localDate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Order | null>(null);
  const [approving, setApproving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(0);
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const list = state.orders
    .filter((o) => { const d = orderDay(o.createdAt); return d >= from && d <= to; })
    .filter((o) => !q || String(o.number).includes(q) || o.lines.some((l) => l.name.toLowerCase().includes(q.toLowerCase())))
    .slice()
    .reverse();
  const paid = list.filter((o) => o.status === 'paid');
  const net = paid.reduce((a, o) => a + netSales(o), 0);
  const appFees = paid.reduce((a, o) => a + (o.appFee ?? 0), 0);
  const appPayout = paid.filter((o) => o.source).reduce((a, o) => a + (o.payout ?? 0), 0);
  // Grouped by method, so "Cash" and "เงินสด" sales add up together
  const byMethod = paid.reduce<Record<string, number>>((a, o) => {
    const k = methodLabel(o.payment, lang);
    return { ...a, [k]: (a[k] ?? 0) + o.total };
  }, {});

  const setRange = (days: number) => { setFrom(addDays(today, -(days - 1))); setTo(today); };

  const voidOrder = (o: Order, approver: Staff) => {
    if (!confirm(t('orders.voidConfirm', { n: o.number }))) return;
    const voidedBy = approver.id === user?.id ? approver.name : t('orders.voidedFor', { approver: approver.name, user: user?.name ?? '' });
    update((d) => { const x = d.orders.find((y) => y.id === o.id); if (x) { x.status = 'voided'; x.voidedBy = voidedBy; } });
    setOpen({ ...o, status: 'voided', voidedBy });
  };
  const requestVoid = (o: Order) => { if (isOwner && user) voidOrder(o, user); else setApproving(true); };

  return (
    <>
      <div className="page-head">
        <div><h1>{t('common.nav.orders')}</h1><p>{t('orders.subtitle')}</p></div>
        <div className="row">
          <button className="btn sm" onClick={() => setRange(1)}>{t('orders.today')}</button>
          <button className="btn sm" onClick={() => { setFrom(addDays(today, -1)); setTo(addDays(today, -1)); }}>{t('orders.yesterday')}</button>
          <button className="btn sm" onClick={() => setRange(7)}>{t('orders.days7')}</button>
          <button className="btn sm" onClick={() => setRange(30)}>{t('orders.days30')}</button>
          <Field label={t('orders.from')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('orders.to')}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {isOwner && <button className="btn primary sm" onClick={() => setImporting(true)}>⇩ {t('orders.import.button')}</button>}
        </div>
      </div>
      {imported > 0 && <div className="callout ok" style={{ marginBottom: 14 }}>{t('orders.import.done', { n: imported })}</div>}
      {importing && <SalesImport onClose={() => setImporting(false)} onDone={(n) => { setImported(n); setRange(30); }} />}

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <Stat label={t('orders.netSales')} value={money(net)} sub={t('orders.netSalesSub')} />
        <Stat label={t('orders.orders')} value={paid.length} sub={t('orders.voidedCount', { n: list.length - paid.length })} />
        <Stat label={t('orders.taxCollected')} value={money(paid.reduce((a, o) => a + o.tax, 0))} />
        <Stat label={t('orders.tips')} value={money(paid.reduce((a, o) => a + o.tip, 0))} />
        {appFees > 0 && <Stat label={t('orders.appFees')} value={money(appFees)} sub={t('orders.appPayout', { amount: money(appPayout) })} />}
        <Stat label={t('orders.byMethod')} value={<span style={{ fontSize: 14, fontWeight: 600 }}>{Object.entries(byMethod).map(([k, v]) => <div key={k}>{k}: {money(v)}</div>)}{!paid.length && '—'}</span>} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{list.length === 1 ? t('orders.countOne') : t('orders.count', { n: list.length })}</h2>
          <input style={{ width: 240 }} placeholder={t('orders.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {list.length === 0 ? <Empty title={t('orders.emptyRange')} /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>#</th><th>{t('orders.col.time')}</th><th>{t('orders.col.type')}</th><th>{t('orders.col.items')}</th><th>{t('orders.col.staff')}</th><th>{t('orders.col.payment')}</th><th className="num">{t('orders.col.total')}</th><th className="num">{t('orders.col.foodCost')}</th><th /></tr></thead>
              <tbody>
                {list.slice(0, 500).map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => setOpen(o)}>
                    <td><strong>{o.number}</strong></td>
                    <td className="muted">{fmtDateTime(o.createdAt)}</td>
                    <td>{t(`common.orderType.${o.type}`)}</td>
                    <td>{o.lines.map((l) => `${l.qty}× ${l.name}${l.options ? ` (${l.options})` : ''}`).join(', ')}</td>
                    <td className="muted">{o.staffName ?? '—'}</td>
                    <td>{methodLabel(o.payment, lang)}</td>
                    <td className="num">{o.status === 'voided' ? <Pill tone="bad">{t('orders.void')}</Pill> : money(o.total)}</td>
                    <td className="num muted">{money(orderCogs(o))}</td>
                    <td className="actions"><button className="btn sm">{t('common.view')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {approving && open && (
        <OwnerApproval
          title={t('common.auth.ownerApproval')}
          reason={t('orders.voidReason', { n: open.number })}
          onClose={() => setApproving(false)}
          onApprove={(owner) => { setApproving(false); voidOrder(open, owner); }}
        />
      )}
      {open && (
        <Modal
          title={t('orders.orderTitle', { n: open.number })}
          onClose={() => setOpen(null)}
          footer={<>
            {open.status === 'paid' && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => requestVoid(open)}>{isOwner ? t('orders.voidOrder') : t('orders.voidOrderPin')}</button>}
            <button className="btn" onClick={() => window.print()}>{t('common.print')}</button>
            <button className="btn primary" onClick={() => setOpen(null)}>{t('common.close')}</button>
          </>}
        >
          <Receipt order={open} />
          <p className="muted" style={{ fontSize: 13, textAlign: 'center', margin: 0 }}>
            {t('orders.costLine', { cost: money(orderCogs(open)), profit: money(netSales(open) - orderCogs(open)) })}
          </p>
        </Modal>
      )}
    </>
  );
}
