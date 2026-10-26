import { useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { readAllSheets } from '../importer';
import { APPS, SALES_COLS, findSalesTable, parseSalesRows, type ParsedOrder, type SalesCol } from '../salesImport';
import { appCut, deliveryOf } from '../delivery';
import { defaultChoices, recordSale, resolveDish } from '../inventory';
import type { DeliveryApp, Order, OrderLine } from '../types';
import { fmtDateTime, uid } from '../utils';
import { Modal, Pill } from './ui';

/**
 * Bring in a delivery app's sales report (downloaded by the owner from GrabMerchant, LINE MAN
 * Merchant or the ShopeeFood partner portal) as orders: sales, the app's GP and the payout, and the
 * dishes sold when the report lists them. Orders already imported are skipped.
 */
export default function SalesImport({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const [app, setApp] = useState<DeliveryApp | null>(null);
  const [table, setTable] = useState<string[][] | null>(null);
  const [columns, setColumns] = useState<SalesCol[]>([]);
  const [error, setError] = useState('');
  const [deduct, setDeduct] = useState(true);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cut = appCut(deliveryOf(state.settings));
  const appInfo = APPS.find((a) => a.id === app);

  const read = async (file: File) => {
    setError('');
    try {
      const found = findSalesTable(await readAllSheets(file));
      if (!found) { setError(t('orders.import.err.noTable')); return; }
      setTable(found.rows);
      setColumns(found.columns);
    } catch {
      setError(t('orders.import.err.file'));
    }
  };

  const parsed: ParsedOrder[] = table ? parseSalesRows(table.slice(1), columns, state.menu, cut) : [];
  const seen = new Set(state.orders.filter((o) => o.source === app && o.externalId).map((o) => o.externalId!));
  const inFile = new Set<string>();
  const rows = parsed.map((p) => {
    const dup = !!p.externalId && (seen.has(p.externalId) || inFile.has(p.externalId));
    if (p.externalId) inFile.add(p.externalId);
    return { ...p, state: p.cancelled ? 'cancelled' as const : dup ? 'duplicate' as const : 'new' as const };
  });
  const fresh = rows.filter((r) => r.state === 'new' && (r.gross || r.net));
  const sum = (k: 'gross' | 'fee' | 'net') => fresh.reduce((a, r) => a + r[k], 0);
  const anyEstimated = fresh.some((r) => r.feeEstimated);
  const items = fresh.flatMap((r) => r.items);
  const matched = items.filter((i) => i.menuItemId).length;

  const remap = (i: number, col: SalesCol) =>
    setColumns((cs) => cs.map((c, j) => (j === i ? col : c === col && col !== 'ignore' ? 'ignore' : c)));

  const doImport = () => {
    if (!app || !appInfo || !fresh.length) return;
    update((d) => {
      const menuById = new Map(d.menu.map((m) => [m.id, m]));
      for (const r of fresh) {
        // Split the order's sales across its dishes by their prices
        const weighed = r.items.map((it) => {
          const m = it.menuItemId ? menuById.get(it.menuItemId) : undefined;
          return { it, m, w: (m?.deliveryPrice || m?.price || 1) * it.qty };
        });
        const totalW = weighed.reduce((a, x) => a + x.w, 0) || 1;
        const lines: OrderLine[] = weighed.length
          ? weighed.map(({ it, m, w }) => ({
            menuItemId: m?.id ?? `app:${app}`,
            name: m?.name ?? it.name,
            price: Math.round(((r.gross * w) / totalW / it.qty) * 100) / 100,
            qty: it.qty,
            unitCost: 0,
            ...(deduct && m ? { recipe: resolveDish(m, defaultChoices(m)).recipe } : { recipe: [] }),
          }))
          : [{ menuItemId: `app:${app}`, name: t('orders.import.orderLine', { app: appInfo.name }), price: r.gross, qty: 1, unitCost: 0, recipe: [] }];
        const order: Order = {
          id: uid(),
          number: d.settings.nextOrderNumber,
          createdAt: (r.createdAt ?? new Date()).toISOString(),
          type: 'Delivery',
          lines,
          subtotal: r.gross, discount: 0, tax: 0, tip: 0, total: r.gross,
          payment: appInfo.name,
          status: 'paid',
          note: t('orders.import.note', { app: appInfo.name, id: r.externalId || '—' }),
          source: app,
          ...(r.externalId ? { externalId: r.externalId } : {}),
          appFee: r.fee,
          payout: r.net,
          ...(r.feeEstimated ? { appFeeEstimated: true } : {}),
        };
        recordSale(d, order);
      }
    });
    onDone(fresh.length);
    onClose();
  };

  return (
    <Modal
      wide
      title={t('orders.import.title')}
      onClose={onClose}
      footer={
        table ? (
          <>
            <button className="btn" onClick={() => { setTable(null); setColumns([]); }}>← {t('orders.import.otherFile')}</button>
            <span className="spacer" />
            <button className="btn primary" disabled={!fresh.length} onClick={doImport}>{t('orders.import.go', { n: fresh.length })}</button>
          </>
        ) : undefined
      }
    >
      {!table && (
        <>
          <p className="muted" style={{ margin: 0 }}>{t('orders.import.intro')}</p>
          <div className="import-sources">
            {APPS.map((a) => (
              <button key={a.id} type="button" className={`import-source app-${a.id} ${app === a.id ? 'active' : ''}`} onClick={() => { setApp(a.id); setError(''); }}>
                <span className="import-logo" aria-hidden>{a.name.charAt(0)}</span>
                <strong>{a.name}</strong>
                <span>{t(`orders.import.hint.${a.id}`)}</span>
              </button>
            ))}
          </div>
          {appInfo && (
            <>
              <ol className="import-steps">
                <li>
                  {t(`orders.import.step1.${appInfo.id}`)}
                  <div className="row" style={{ marginTop: 8 }}>
                    <a className="btn sm" href={appInfo.portal} target="_blank" rel="noopener noreferrer">{t('orders.import.openPortal', { app: appInfo.name })}</a>
                  </div>
                </li>
                <li>{t(`orders.import.step2.${appInfo.id}`)}</li>
                <li>{t('orders.import.step3')}</li>
              </ol>
              <div
                className={`file-drop ${over ? 'over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
              >
                <span className="file-drop-icon" aria-hidden>📊</span>
                <strong>{t('orders.import.drop', { app: appInfo.name })}</strong>
                <span className="muted">.xlsx, .xls, .csv, .zip</span>
                <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv,.tsv,.txt,.zip" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f); }} />
              </div>
            </>
          )}
          {error && <div className="callout bad">{error}</div>}
        </>
      )}

      {table && appInfo && (
        <>
          <div className="sales-summary">
            <div><span>{t('orders.import.found')}</span><strong>{fresh.length}</strong></div>
            <div><span>{t('orders.import.sales')}</span><strong>{money(sum('gross'))}</strong></div>
            <div><span>{t('orders.import.fees', { app: appInfo.name })}</span><strong>−{money(sum('fee'))}</strong></div>
            <div><span>{t('orders.import.payout')}</span><strong>{money(sum('net'))}</strong></div>
          </div>
          {rows.length - fresh.length > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {t('orders.import.skipped', { cancelled: rows.filter((r) => r.state === 'cancelled').length, dup: rows.filter((r) => r.state === 'duplicate').length })}
            </p>
          )}
          {anyEstimated && <div className="callout info">{t('orders.import.estimated', { pct: (cut * 100).toFixed(1) })}</div>}
          {items.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('orders.import.matched', { n: matched, total: items.length })}</p>}

          <div className="import-columns">
            <span className="field-label">{t('orders.import.columns')}</span>
            <div className="row">
              {table[0].map((h, i) => (
                <label key={i} className="import-col">
                  <span>{h || `#${i + 1}`}</span>
                  <select value={columns[i] ?? 'ignore'} onChange={(e) => remap(i, e.target.value as SalesCol)}>
                    {SALES_COLS.map((c) => <option key={c} value={c}>{t(`orders.import.col.${c}`)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('orders.import.col.date')}</th><th>{t('orders.import.col.orderId')}</th><th>{t('orders.import.col.items')}</th>
                  <th className="num">{t('orders.import.col.gross')}</th><th className="num">{t('orders.import.col.fee')}</th><th className="num">{t('orders.import.col.net')}</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map((r, i) => (
                  <tr key={i} style={r.state === 'new' ? undefined : { opacity: 0.5 }}>
                    <td>{r.createdAt ? fmtDateTime(r.createdAt.toISOString()) : <span className="muted">{t('orders.import.noDate')}</span>}</td>
                    <td>{r.externalId || '—'}</td>
                    <td>{r.items.length ? r.items.map((it, j) => <span key={j} className={it.menuItemId ? '' : 'muted'}>{j ? ', ' : ''}{it.qty}× {it.name}</span>) : <span className="muted">—</span>}</td>
                    <td className="num">{money(r.gross)}</td>
                    <td className="num">−{money(r.fee)}{r.feeEstimated && '*'}</td>
                    <td className="num">{money(r.net)}</td>
                    <td>{r.state === 'new' ? <Pill tone="ok">{t('orders.import.new')}</Pill> : r.state === 'duplicate' ? <Pill>{t('orders.import.dup')}</Pill> : <Pill tone="warn">{t('orders.import.cancelled')}</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 60 && <p className="muted" style={{ fontSize: 13 }}>{t('orders.import.more', { n: rows.length - 60 })}</p>}
          </div>

          <label className="check">
            <input type="checkbox" checked={deduct} onChange={(e) => setDeduct(e.target.checked)} />
            {t('orders.import.deduct')}
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{t('orders.import.deductHint')}</p>
        </>
      )}
    </Modal>
  );
}
