import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import { Empty, Field, Modal, NumInput, Stat, Tabs } from '../components/ui';
import { PURCHASE_TYPES, dishToLink, isStockType, savePurchase, typeInfo } from '../purchases';
import { methodLabel } from '../payments';
import type { MenuItem, Purchase, PurchaseLine, PurchaseType } from '../types';
import { addDays, fmtDate, localDate, uid } from '../utils';

type Range = 'month' | 'lastMonth' | '30' | 'all';

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/** Everything the shop spends: stock bought (goes into Inventory) and running costs. */
export default function Purchases() {
  const { state, update, money } = useStore();
  const { t, lang } = useI18n();
  const [range, setRange] = useState<Range>('month');
  const [type, setType] = useState<PurchaseType | 'all'>('all');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Purchase | null>(null);
  const today = localDate();
  const [from, to] = range === 'month' ? [monthStart(today), today]
    : range === 'lastMonth' ? [monthStart(addDays(monthStart(today), -1)), addDays(monthStart(today), -1)]
    : range === '30' ? [addDays(today, -29), today] : ['0000-01-01', '9999-12-31'];

  const all = state.purchases ?? [];
  const inRange = all.filter((p) => p.date >= from && p.date <= to);
  const list = inRange.filter((p) => type === 'all' || p.type === type).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const sum = (ps: Purchase[]) => ps.reduce((a, p) => a + p.total, 0);
  const stock = sum(inRange.filter((p) => isStockType(p.type)));
  const byType = PURCHASE_TYPES.map((pt) => ({ ...pt, total: sum(inRange.filter((p) => p.type === pt.id)) })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...byType.map((x) => x.total));

  const remove = (p: Purchase) => {
    if (!confirm(t(isStockType(p.type) ? 'purchases.confirmDeleteStock' : 'purchases.confirmDelete'))) return;
    update((d) => { d.purchases = (d.purchases ?? []).filter((x) => x.id !== p.id); });
    setOpen(null);
  };

  return (
    <>
      <div className="page-head">
        <div><h1>{t('common.nav.purchases')}</h1><p>{t('purchases.intro')}</p></div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ {t('purchases.new')}</button>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <Tabs<Range> value={range} onChange={setRange} tabs={(['month', 'lastMonth', '30', 'all'] as Range[]).map((r) => ({ id: r, label: t(`purchases.range.${r}`) }))} />
      </div>

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <Stat label={t('purchases.spent')} value={money(sum(inRange))} sub={inRange.length === 1 ? t('purchases.countOne') : t('purchases.count', { n: inRange.length })} />
        <Stat label={t('purchases.stockSpent')} value={money(stock)} sub={t('purchases.stockSpentSub')} />
        <Stat label={t('purchases.costsSpent')} value={money(sum(inRange) - stock)} sub={t('purchases.costsSpentSub')} />
      </div>

      {byType.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 10 }}>{t('purchases.byType')}</h2>
          <div className="type-bars">
            {byType.map((x) => (
              <button key={x.id} className={`type-bar ${type === x.id ? 'on' : ''}`} onClick={() => setType(type === x.id ? 'all' : x.id)}>
                <span className="type-bar-label">{x.icon} {t(`purchases.type.${x.id}`)}</span>
                <span className="type-bar-track"><span style={{ width: `${(x.total / max) * 100}%` }} /></span>
                <strong>{money(x.total)}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h2>{type === 'all' ? t('purchases.all') : `${typeInfo(type).icon} ${t(`purchases.type.${type}`)}`}</h2>
          {type !== 'all' && <button className="btn sm ghost" onClick={() => setType('all')}>{t('purchases.showAll')}</button>}
        </div>
        {list.length === 0 ? <Empty title={t('purchases.emptyTitle')}>{t('purchases.emptyBody')}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{t('purchases.col.date')}</th><th>{t('purchases.col.type')}</th><th>{t('purchases.col.supplier')}</th><th>{t('purchases.col.items')}</th><th>{t('purchases.col.paid')}</th><th className="num">{t('purchases.col.total')}</th><th /></tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setOpen(p)}>
                    <td className="nowrap">{fmtDate(p.date)}</td>
                    <td className="nowrap">{typeInfo(p.type).icon} {t(`purchases.type.${p.type}`)}</td>
                    <td>{p.supplier || <span className="muted">—</span>}</td>
                    <td>{p.lines.map((l) => (l.qty ? `${l.description} ×${l.qty}${l.unit ? ` ${l.unit}` : ''}` : l.description)).join(', ')}{p.receipt && ' 🧾'}</td>
                    <td>{p.payment ? methodLabel(p.payment, lang) : <span className="muted">—</span>}</td>
                    <td className="num"><strong>{money(p.total)}</strong></td>
                    <td className="actions"><button className="btn sm">{t('purchases.view')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && <NewPurchase onClose={() => setAdding(false)} />}
      {open && (
        <Modal
          title={`${typeInfo(open.type).icon} ${t(`purchases.type.${open.type}`)} · ${fmtDate(open.date)}`}
          onClose={() => setOpen(null)}
          footer={<><button className="btn danger" onClick={() => remove(open)}>{t('purchases.delete')}</button><span className="spacer" /><button className="btn" onClick={() => setOpen(null)}>{t('common.close')}</button></>}
        >
          {open.supplier && <div className="kv"><span>{t('purchases.col.supplier')}</span><strong>{open.supplier}</strong></div>}
          {open.payment && <div className="kv"><span>{t('purchases.col.paid')}</span><strong>{methodLabel(open.payment, lang)}</strong></div>}
          <div className="kv-list">
            {open.lines.map((l) => (
              <div key={l.id} className="kv">
                <span>{l.description}{l.qty ? ` × ${l.qty}${l.unit ? ` ${l.unit}` : ''}` : ''}{l.expiresAt ? ` · ${t('purchases.expires', { date: fmtDate(l.expiresAt) })}` : ''}</span>
                <strong>{money(l.amount)}</strong>
              </div>
            ))}
            <div className="kv" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 8 }}><span>{t('purchases.col.total')}</span><strong>{money(open.total)}</strong></div>
          </div>
          {open.note && <p className="muted" style={{ margin: 0 }}>{open.note}</p>}
          {open.receipt && <img className="receipt-photo" src={open.receipt} alt={t('purchases.receipt')} />}
          {isStockType(open.type) && <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t('purchases.stockNote')}</p>}
        </Modal>
      )}
    </>
  );
}

/** Make a receipt photo small enough to keep with the shop's data. */
async function shrinkReceipt(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function NewPurchase({ onClose }: { onClose: () => void }) {
  const { state, update, money } = useStore();
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [type, setType] = useState<PurchaseType>('ingredients');
  const [date, setDate] = useState(localDate());
  const [supplier, setSupplier] = useState('');
  const [payment, setPayment] = useState(state.settings.paymentMethods[0] ?? '');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<string | undefined>();
  const blank = (): PurchaseLine => ({ id: uid(), description: '', amount: 0, qty: 1 });
  const [lines, setLines] = useState<PurchaseLine[]>([blank()]);
  const fileRef = useRef<HTMLInputElement>(null);
  const stock = isStockType(type);
  const info = typeInfo(type);

  const suppliers = useMemo(() => [...new Set((state.purchases ?? []).map((p) => p.supplier).filter(Boolean) as string[])], [state.purchases]);
  const items = state.items.filter((i) => !info.stock || i.kind === info.stock.kind);
  const itemByName = (n: string) => state.items.find((i) => i.name.trim().toLowerCase() === n.trim().toLowerCase());
  const setLine = (id: string, p: Partial<PurchaseLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const valid = lines.filter((l) => l.description.trim() && l.amount > 0 && (!stock || (l.qty ?? 0) > 0));
  const dishes = state.menu.slice().sort((a, b) => dishName(a).localeCompare(dishName(b)));
  function dishName(m: MenuItem) { return (lang === 'en' && m.nameEn) || m.name; }
  /** Menu price that keeps the shop's target food cost */
  const suggestPrice = (l: PurchaseLine) => (l.qty && l.amount ? Math.ceil(l.amount / l.qty / (state.settings.targetFoodCost / 100)) : 0);
  // What a prepacked line sells as: a dish id, '__new', or '' (not on the menu)
  const sellAs = (l: PurchaseLine) => (l.newDish ? '__new' : l.menuItemId ?? dishToLink(state, l.description)?.id ?? '');
  const setSellAs = (l: PurchaseLine, v: string) => setLine(l.id, v === '__new'
    ? { menuItemId: undefined, newDish: { price: suggestPrice(l), category: state.settings.menuCategories[0] ?? t('purchases.type.prepacked') } }
    : { menuItemId: v, newDish: undefined });
  const total = valid.reduce((a, l) => a + l.amount, 0);
  const missingPrice = type === 'prepacked' && valid.some((l) => l.newDish && (!(l.newDish.price > 0) || !l.newDish.category.trim()));

  const save = () => {
    const p: Purchase = {
      id: uid(), date, type, lines: valid.map((l) => ({
        ...l, description: l.description.trim(),
        ...(stock ? {} : { qty: undefined, unit: undefined, expiresAt: undefined }),
        ...(type === 'prepacked' ? (l.newDish ? { newDish: { ...l.newDish, category: l.newDish.category.trim() } } : { menuItemId: sellAs(l) }) : { menuItemId: undefined, newDish: undefined }),
      })),
      total, createdAt: new Date().toISOString(),
      ...(supplier.trim() ? { supplier: supplier.trim() } : {}),
      ...(payment ? { payment } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(receipt ? { receipt } : {}),
      ...(user ? { createdBy: user.name } : {}),
    };
    update((d) => savePurchase(d, p, t(`purchases.type.${type}`)));
    onClose();
  };

  return (
    <Modal
      wide
      title={t('purchases.new')}
      onClose={onClose}
      footer={
        <>
          <span className="purchase-total">{t('purchases.col.total')}: <strong>{money(total)}</strong></span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!valid.length || missingPrice} onClick={save}>{t('purchases.save')}</button>
        </>
      }
    >
      <div className="purchase-types">
        {PURCHASE_TYPES.map((pt) => (
          <button key={pt.id} type="button" className={`purchase-type ${type === pt.id ? 'on' : ''}`} onClick={() => setType(pt.id)}>
            <span aria-hidden>{pt.icon}</span>{t(`purchases.type.${pt.id}`)}{pt.stock && <small>{t('purchases.addsStock')}</small>}
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t(stock ? 'purchases.stockHint' : 'purchases.costHint')}</p>

      <div className="form-grid">
        <Field label={t('purchases.col.date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label={t('purchases.col.supplier')}>
          <input list="purchase-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder={t('purchases.supplierPh')} />
          <datalist id="purchase-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label={t('purchases.col.paid')}>
          <select value={payment} onChange={(e) => setPayment(e.target.value)}>
            <option value="">—</option>
            {state.settings.paymentMethods.map((m) => <option key={m} value={m}>{methodLabel(m, lang)}</option>)}
            <option value={t('purchases.transfer')}>{t('purchases.transfer')}</option>
          </select>
        </Field>
      </div>

      <div className="purchase-lines">
        <datalist id="purchase-items">{items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        <datalist id="purchase-menu-cats">{state.settings.menuCategories.map((c) => <option key={c} value={c} />)}</datalist>
        {lines.map((l) => {
          const item = stock ? itemByName(l.description) : undefined;
          const sell = type === 'prepacked' && l.description.trim() ? sellAs(l) : undefined;
          const sellDish = sell && sell !== '__new' ? state.menu.find((m) => m.id === sell) : undefined;
          const replaces = sellDish && sellDish.recipe.length > 0 && !(item && sellDish.recipe.length === 1 && sellDish.recipe[0].itemId === item.id);
          return (
            <div key={l.id} className={`purchase-line ${stock ? 'stock' : ''}`}>
              <Field label={stock ? t('purchases.item') : t('purchases.description')}>
                <input list={stock ? 'purchase-items' : undefined} value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} placeholder={t(stock ? 'purchases.itemPh' : `purchases.ph.${type}`)} />
              </Field>
              {stock && (
                <>
                  <Field label={t('purchases.qty')}>
                    <div className="input-unit">
                      <NumInput value={l.qty ?? 0} onChange={(qty) => setLine(l.id, { qty })} />
                      {item ? <span>{item.unit}</span> : <input className="unit-input" value={l.unit ?? ''} onChange={(e) => setLine(l.id, { unit: e.target.value })} placeholder={t('purchases.unitPh')} aria-label={t('purchases.unit')} />}
                    </div>
                  </Field>
                  <Field label={t('purchases.expiry')}><input type="date" value={l.expiresAt ?? ''} onChange={(e) => setLine(l.id, { expiresAt: e.target.value || undefined })} /></Field>
                </>
              )}
              <Field label={t('purchases.amount')} hint={stock && l.qty && l.amount ? t('purchases.each', { price: money(l.amount / l.qty), unit: item?.unit || l.unit?.trim() || t('purchases.unitPh') }) : undefined}>
                <NumInput value={l.amount} onChange={(amount) => setLine(l.id, { amount })} />
              </Field>
              <button type="button" className="icon-btn" aria-label={t('common.remove')} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>✕</button>
              {stock && l.description.trim() && (
                <span className="purchase-line-note">
                  {item ? t('purchases.addsTo', { name: item.name }) : t('purchases.newItem', { name: l.description.trim() })}
                </span>
              )}
              {sell !== undefined && (
                <div className="purchase-sell">
                  <Field label={t('purchases.sellAs')}>
                    <select value={sell} onChange={(e) => setSellAs(l, e.target.value)}>
                      <option value="">{t('purchases.notOnMenu')}</option>
                      <option value="__new">+ {t('purchases.addToMenu')}</option>
                      <optgroup label={t('purchases.linkDish')}>
                        {dishes.map((m) => <option key={m.id} value={m.id}>{dishName(m)}</option>)}
                      </optgroup>
                    </select>
                  </Field>
                  {l.newDish && (
                    <>
                      <Field label={t('purchases.menuPrice')} hint={suggestPrice(l) ? t('purchases.suggested', { price: money(suggestPrice(l)), pct: state.settings.targetFoodCost }) : undefined}>
                        <NumInput value={l.newDish.price} onChange={(price) => setLine(l.id, { newDish: { ...l.newDish!, price } })} />
                      </Field>
                      <Field label={t('purchases.menuCategory')}>
                        <input list="purchase-menu-cats" value={l.newDish.category} onChange={(e) => setLine(l.id, { newDish: { ...l.newDish!, category: e.target.value } })} />
                      </Field>
                    </>
                  )}
                  <span className="purchase-line-note">
                    {l.newDish ? t('purchases.newDishNote', { name: l.description.trim() })
                      : sellDish ? (replaces ? t('purchases.replacesRecipe', { name: dishName(sellDish) }) : t('purchases.linksDish', { name: dishName(sellDish) }))
                      : t('purchases.notOnMenuNote')}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        <button className="btn sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ {t('purchases.addLine')}</button>
      </div>

      <div className="form-grid">
        <Field label={t('purchases.note')} className="span-all"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => fileRef.current?.click()}>🧾 {receipt ? t('purchases.changeReceipt') : t('purchases.addReceipt')}</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setReceipt(await shrinkReceipt(f)); }} />
        {receipt && <><img className="receipt-thumb" src={receipt} alt="" /><button className="btn sm ghost" onClick={() => setReceipt(undefined)}>{t('common.remove')}</button></>}
      </div>
    </Modal>
  );
}

