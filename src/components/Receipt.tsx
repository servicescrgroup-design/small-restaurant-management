import { useStore } from '../store';
import type { Order } from '../types';
import { fmtDateTime } from '../utils';
import { useI18n } from '../i18n';

export function Receipt({ order }: { order: Order }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  return (
    <div className="receipt">
      <h3>{s.storeName}</h3>
      {s.address && <div className="center">{s.address}</div>}
      {s.phone && <div className="center">{s.phone}</div>}
      <hr />
      <div className="r-row"><span>{t('common.receipt.order', { n: order.number })}</span><span>{t(`common.orderType.${order.type}`)}</span></div>
      <div>{fmtDateTime(order.createdAt)}</div>
      {order.tableName && <div>{t('common.receipt.table', { name: order.tableName, n: order.guests ?? 1 })}</div>}
      {order.staffName && <div>{t('common.receipt.servedBy', { name: order.staffName })}</div>}
      {order.status === 'voided' && <div className="void">{t('common.receipt.void')}{order.voidedBy ? <div style={{ fontSize: 11, letterSpacing: 0 }}>{t('common.receipt.voidBy', { name: order.voidedBy })}</div> : null}</div>}
      <hr />
      {order.lines.map((l, i) => (
        <div key={i}>
          <div className="r-row"><span>{l.qty} × {l.name}</span><span>{money(l.price * l.qty)}</span></div>
          {l.options && <div className="r-sub">{l.options}</div>}
          {l.note && <div className="r-sub">↳ {l.note}</div>}
        </div>
      ))}
      {order.note && <div style={{ marginTop: 4 }}>{t('common.receipt.note', { note: order.note })}</div>}
      <hr />
      <div className="r-row"><span>{t('common.receipt.subtotal')}</span><span>{money(order.subtotal)}</span></div>
      {order.discount > 0 && <div className="r-row"><span>{t('common.receipt.discount')}</span><span>−{money(order.discount)}</span></div>}
      <div className="r-row"><span>{t('common.receipt.tax', { rate: s.taxRate })}</span><span>{money(order.tax)}</span></div>
      {order.tip > 0 && <div className="r-row"><span>{t('common.receipt.tip')}</span><span>{money(order.tip)}</span></div>}
      {!!order.surcharge && <div className="r-row"><span>{t('common.receipt.fee', { label: order.surchargeLabel ?? '' })}</span><span>{money(order.surcharge)}</span></div>}
      <div className="r-row" style={{ fontWeight: 800, fontSize: 15 }}><span>{t('common.receipt.total')}</span><span>{money(order.total)}</span></div>
      <div className="r-row"><span>{t('common.receipt.paid', { method: order.payment })}</span><span>{money(order.tendered ?? order.total)}</span></div>
      {order.tendered != null && order.tendered > order.total && (
        <div className="r-row"><span>{t('common.receipt.change')}</span><span>{money(order.tendered - order.total)}</span></div>
      )}
      <hr />
      {s.receiptFooter && <div className="center">{s.receiptFooter}</div>}
    </div>
  );
}
