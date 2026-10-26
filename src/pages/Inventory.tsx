import { useMemo, useState } from 'react';
import { useStore } from '../store';
import {
  discardFromBatch, liveBatches, makePrepBatch, nextExpiry, onHand, receiveStock, recipeCost, servingsAvailable, setCount, sortFEFO, unitCost,
} from '../inventory';
import { Empty, Field, ImageField, Modal, NumInput, Pill, Tabs, Thumb } from '../components/ui';
import { RecipeEditor } from '../components/Recipe';
import type { AdjReason, Batch, InvItem, MenuItem, Settings } from '../types';
import { useAuth } from '../auth';
import { MenuItemModal } from './Menu';
import { addDays, expiryLabel, fmtDate, fmtDateTime, fmtQty, localDate, uid } from '../utils';
import { useI18n } from '../i18n';

type Tab = 'stock' | 'batches' | 'activity';

/** A blank ingredient or ready-made (prep / packed) item with sensible defaults. */
function newItemOf(kind: 'raw' | 'prep', s: Settings): InvItem {
  const prepCat = s.inventoryCategories.find((c) => /prep|เตรียม/i.test(c));
  return {
    id: uid(), name: '', kind, unit: kind === 'prep' ? 'serving' : 'kg', category: kind === 'prep' ? prepCat ?? 'Prep' : s.inventoryCategories[0] ?? '',
    location: s.storageLocations[0] ?? '', parLevel: 0, shelfLifeDays: kind === 'prep' ? 3 : 7, defaultCost: 0,
    ...(kind === 'prep' ? { recipe: [], yieldQty: 10 } : {}),
  };
}
type Dialog =
  | { kind: 'item'; item: InvItem; isNew: boolean }
  | { kind: 'receive'; itemId: string }
  | { kind: 'prep'; itemId: string }
  | { kind: 'count'; itemId: string }
  | { kind: 'discard'; batch: Batch }
  | null;

const REASONS: AdjReason[] = ['received', 'prep-used', 'prep-made', 'waste', 'expired', 'count'];
const reasonKey = (r: AdjReason) => `inventory.reason.${r}`;

export default function Inventory() {
  const { state } = useStore();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('stock');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState('All');

  const s = state.settings;
  const newItem = (kind: 'raw' | 'prep') => newItemOf(kind, s);

  const match = (i: InvItem) => (loc === 'All' || i.location === loc) && i.name.toLowerCase().includes(q.toLowerCase());
  const close = () => setDialog(null);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('inventory.title')}</h1>
          <p>{t('inventory.intro')}</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setDialog({ kind: 'item', item: newItem('prep'), isNew: true })}>{t('inventory.addPrep')}</button>
          <button className="btn primary" onClick={() => setDialog({ kind: 'item', item: newItem('raw'), isNew: true })}>{t('inventory.addIngredient')}</button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: 'stock', label: t('inventory.tab.stock') }, { id: 'batches', label: t('inventory.tab.batches') }, { id: 'activity', label: t('inventory.tab.activity') }]} />
        <span className="spacer" />
        {tab !== 'activity' && (
          <>
            <input style={{ width: 220 }} placeholder={t('inventory.searchItems')} value={q} onChange={(e) => setQ(e.target.value)} />
            <select style={{ width: 180 }} value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="All">{t('common.all')}</option>
              {s.storageLocations.map((l) => <option key={l}>{l}</option>)}
            </select>
          </>
        )}
      </div>

      {tab === 'stock' && <StockTable match={match} setDialog={setDialog} />}
      {tab === 'batches' && <BatchTable match={match} setDialog={setDialog} />}
      {tab === 'activity' && <Activity />}

      {dialog?.kind === 'item' && <ItemModal item={dialog.item} isNew={dialog.isNew} onClose={close} />}
      {dialog?.kind === 'receive' && <ReceiveModal itemId={dialog.itemId} onClose={close} />}
      {dialog?.kind === 'prep' && <PrepModal itemId={dialog.itemId} onClose={close} />}
      {dialog?.kind === 'count' && <CountModal itemId={dialog.itemId} onClose={close} />}
      {dialog?.kind === 'discard' && <DiscardModal batch={dialog.batch} onClose={close} />}
    </>
  );
}

function StockTable({ match, setDialog }: { match: (i: InvItem) => boolean; setDialog: (d: Dialog) => void }) {
  const { state, update, money } = useStore();
  const { user } = useAuth();
  const { t } = useI18n();
  const [selling, setSelling] = useState<MenuItem | null>(null);
  // Each section can be folded down to its header; remembered on this device
  const [folded, setFolded] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('mise.inventoryFolded') ?? '[]') as string[]; } catch { return []; } });
  const toggleFold = (id: string) => setFolded((f) => {
    const next = f.includes(id) ? f.filter((x) => x !== id) : [...f, id];
    try { localStorage.setItem('mise.inventoryFolded', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const sortItems = (list: InvItem[]) => list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const ready = sortItems(state.items.filter((i) => i.kind === 'prep' && match(i)));
  const ingredients = sortItems(state.items.filter((i) => i.kind === 'raw' && match(i)));
  const valueOf = (list: InvItem[]) => list.reduce((a, i) => a + liveBatches(state, i.id).reduce((x, b) => x + b.qtyRemaining * b.unitCost, 0), 0);
  const totalValue = valueOf(state.items);

  if (!state.items.length) return <div className="card"><Empty title={t('inventory.stock.emptyTitle')}>{t('inventory.stock.emptyBody')}</Empty></div>;

  // Packed / ready-made food can be put straight on the POS: one sale uses one unit of stock.
  const sellOnPos = (i: InvItem) => {
    const cost = unitCost(state, i.id);
    setSelling({
      id: uid(), name: i.name, tab: state.settings.menuTabs[0], category: state.settings.menuCategories[0] ?? '',
      price: Math.ceil(cost / (state.settings.targetFoodCost / 100)), active: true, recipe: [{ itemId: i.id, qty: 1 }],
    });
  };

  const rows = (list: InvItem[]) => list.map((i) => {
    const qty = onHand(state, i.id);
    const uc = unitCost(state, i.id);
    const exp = expiryLabel(nextExpiry(state, i.id));
    const low = i.parLevel > 0 && qty <= i.parLevel;
    const soldAs = i.kind === 'prep' ? state.menu.filter((m) => m.recipe.some((r) => r.itemId === i.id)) : [];
    return (
      <tr key={i.id}>
        <td>
          <div className="cell-thumb">
            <Thumb src={i.image} name={i.name} size="xs" />
            <div>
              <strong className="clickable" onClick={() => setDialog({ kind: 'item', item: structuredClone(i), isNew: false })} style={{ cursor: 'pointer' }}>{i.name}</strong>
              <div className="sub">{i.kind === 'prep' ? t('inventory.stock.prepYields', { qty: fmtQty(i.yieldQty ?? 0), unit: i.unit }) : i.category}{i.supplier ? ` · ${i.supplier}` : ''}</div>
              {soldAs.length > 0 && <div className="sub"><Pill tone="info">{t('inventory.ready.usedIn', { names: soldAs.map((m) => m.name).join(', ') })}</Pill></div>}
            </div>
          </div>
        </td>
        <td>{i.location}</td>
        <td className="num">
          <strong>{fmtQty(qty)}</strong> <span className="muted">{i.unit}</span>
          {qty === 0 ? <div><Pill tone="bad">{t('inventory.pill.out')}</Pill></div> : low && <div><Pill tone="warn">{t('inventory.pill.low')}</Pill></div>}
        </td>
        <td className="num muted">{i.parLevel ? fmtQty(i.parLevel) : '—'}</td>
        <td className="num">{money(uc)}<span className="muted">/{i.unit}</span></td>
        <td className="num">{money(qty * uc)}</td>
        <td>{qty > 0 ? <Pill tone={exp.tone}>{exp.text}</Pill> : <span className="muted">—</span>}</td>
        <td className="actions">
          {i.kind === 'prep' && soldAs.length === 0 && user?.role === 'owner' && (
            <button className="btn sm ghost" onClick={() => sellOnPos(i)}>{t('inventory.ready.sellOnPos')}</button>
          )}
          {i.kind === 'prep'
            ? <button className="btn sm primary" onClick={() => setDialog({ kind: 'prep', itemId: i.id })}>{t('inventory.makeBatch')}</button>
            : <button className="btn sm primary" onClick={() => setDialog({ kind: 'receive', itemId: i.id })}>{t('inventory.receive')}</button>}
          <button className="btn sm" onClick={() => setDialog({ kind: 'count', itemId: i.id })}>{t('inventory.count')}</button>
        </td>
      </tr>
    );
  });

  const foldBtn = (id: string) => (
    <button className="fold-btn" aria-expanded={!folded.includes(id)} onClick={() => toggleFold(id)} title={t(folded.includes(id) ? 'inventory.stock.expand' : 'inventory.stock.collapse')} aria-label={t(folded.includes(id) ? 'inventory.stock.expand' : 'inventory.stock.collapse')}>
      <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  );

  const head = (
    <thead>
      <tr><th>{t('inventory.col.item')}</th><th>{t('inventory.col.location')}</th><th className="num">{t('inventory.col.onHand')}</th><th className="num">{t('inventory.col.par')}</th><th className="num">{t('inventory.col.avgCost')}</th><th className="num">{t('inventory.col.value')}</th><th>{t('inventory.col.nextExpiry')}</th><th /></tr>
    </thead>
  );

  return (
    <div className="grid">
      <div className="muted" style={{ textAlign: 'right' }}>{t('inventory.stock.totalValue')} <strong>{money(totalValue)}</strong></div>

      <section className={`card stock-section ready ${folded.includes('ready') ? 'folded' : ''}`}>
        <div className="card-head">
          <div className="fold-head">
            {foldBtn('ready')}
            <h2 onClick={() => toggleFold('ready')}>🍱 {t('inventory.ready.title')} <span className="muted count">· {ready.length}</span></h2>
            <p>{t('inventory.ready.hint')}</p>
          </div>
          <div className="row">
            <span className="muted">{t('inventory.ready.value')} <strong>{money(valueOf(ready))}</strong></span>
            <button className="btn sm" onClick={() => setDialog({ kind: 'item', item: newItemOf('prep', state.settings), isNew: true })}>{t('inventory.addPrep')}</button>
          </div>
        </div>
        {folded.includes('ready') ? null : ready.length === 0 ? <Empty title={t('inventory.ready.emptyTitle')}>{t('inventory.ready.emptyBody')}</Empty> : (
          <div className="table-wrap"><table className="table">{head}<tbody>{rows(ready)}</tbody></table></div>
        )}
      </section>

      <section className={`card stock-section ${folded.includes('ingredients') ? 'folded' : ''}`}>
        <div className="card-head">
          <div className="fold-head">
            {foldBtn('ingredients')}
            <h2 onClick={() => toggleFold('ingredients')}>🥬 {t('inventory.ingredients.title')} <span className="muted count">· {ingredients.length}</span></h2>
            <p>{t('inventory.ingredients.hint')}</p>
          </div>
          <div className="row">
            <span className="muted">{t('inventory.ready.value')} <strong>{money(valueOf(ingredients))}</strong></span>
            <button className="btn sm" onClick={() => setDialog({ kind: 'item', item: newItemOf('raw', state.settings), isNew: true })}>{t('inventory.addIngredient')}</button>
          </div>
        </div>
        {folded.includes('ingredients') ? null : ingredients.length === 0 ? <Empty title={t('inventory.stock.emptyTitle')}>{t('inventory.stock.emptyBody')}</Empty> : (
          <div className="table-wrap"><table className="table">{head}<tbody>{rows(ingredients)}</tbody></table></div>
        )}
      </section>

      {selling && (
        <MenuItemModal
          item={selling}
          onClose={() => setSelling(null)}
          onSave={(m) => { update((d) => { d.menu.push(m); }); setSelling(null); }}
        />
      )}
    </div>
  );
}

function BatchTable({ match, setDialog }: { match: (i: InvItem) => boolean; setDialog: (d: Dialog) => void }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const byId = new Map(state.items.map((i) => [i.id, i]));
  // Group each product's batches together (soonest-expiring first within the group),
  // and order the groups by their earliest expiry so the most urgent product is on top.
  const live = state.batches.filter((b) => b.qtyRemaining > 0 && byId.has(b.itemId) && match(byId.get(b.itemId)!));
  const groups = new Map<string, Batch[]>();
  for (const b of live) groups.set(b.itemId, [...(groups.get(b.itemId) ?? []), b]);
  const ordered = [...groups.values()].map((g) => g.sort(sortFEFO))
    .sort((a, b) => sortFEFO(a[0], b[0]) || byId.get(a[0].itemId)!.name.localeCompare(byId.get(b[0].itemId)!.name));
  const batches = ordered.flat();
  const band = new Map(ordered.map((g, i) => [g[0].itemId, i % 2 === 1]));

  if (!batches.length) return <div className="card"><Empty title={t('inventory.batches.emptyTitle')}>{t('inventory.batches.emptyBody')}</Empty></div>;

  return (
    <div className="card">
      <div className="card-head"><h2>{t('inventory.batches.heading')}</h2><span className="muted">{t('inventory.batches.sortHint')}</span></div>
      <div className="table-wrap">
        <table className="table grouped">
          <thead>
            <tr><th>{t('inventory.col.item')}</th><th>{t('inventory.col.lot')}</th><th>{t('inventory.col.received')}</th><th>{t('inventory.col.expires')}</th><th className="num">{t('inventory.col.remaining')}</th><th className="num">{t('inventory.col.unitCost')}</th><th className="num">{t('inventory.col.value')}</th><th /></tr>
          </thead>
          <tbody>
            {batches.map((b, idx) => {
              const it = byId.get(b.itemId)!;
              const exp = expiryLabel(b.expiresAt);
              const used = 1 - b.qtyRemaining / (b.qtyReceived || 1);
              const group = groups.get(b.itemId)!;
              const first = idx === 0 || batches[idx - 1].itemId !== b.itemId;
              const last = idx === batches.length - 1 || batches[idx + 1].itemId !== b.itemId;
              const pos = group.indexOf(b);
              return (
                <tr key={b.id} className={`batch-row ${first ? 'group-first' : 'group-rest'} ${last ? 'group-last' : ''} ${band.get(b.itemId) ? 'band' : ''}`}>
                  <td>
                    {first ? (
                      <div className="cell-thumb">
                        <Thumb src={it.image} name={it.name} size="xs" />
                        <div>
                        <strong>{it.name}</strong>
                        <div className="sub">{group.length > 1 ? t('inventory.batches.groupCount', { n: group.length, total: `${fmtQty(Math.round(group.reduce((a, x) => a + x.qtyRemaining, 0) * 100) / 100)} ${it.unit}` }) : b.location}</div>
                        {group.length > 1 && <div className="sub"><Pill tone="ok">{t('inventory.batches.useFirst')}</Pill></div>}
                        </div>
                      </div>
                    ) : (
                      <div className="batch-child"><span aria-hidden>↳</span> {t('inventory.batches.nextBatch', { n: pos + 1 })}<div className="sub">{b.location}</div></div>
                    )}
                  </td>
                  <td>{b.lot || <span className="muted">—</span>}{b.note && <div className="sub">{b.note}</div>}</td>
                  <td>{fmtDate(b.receivedAt)}</td>
                  <td>{b.expiresAt ? <>{fmtDate(b.expiresAt)} <Pill tone={exp.tone}>{exp.text}</Pill></> : <span className="muted">{t('common.expiry.none')}</span>}</td>
                  <td className="num" style={{ minWidth: 120 }}>
                    {fmtQty(b.qtyRemaining)} / {fmtQty(b.qtyReceived)} <span className="muted">{it.unit}</span>
                    <div className="meter" style={{ marginTop: 4 }}><div style={{ width: `${(1 - used) * 100}%` }} /></div>
                  </td>
                  <td className="num">{money(b.unitCost)}</td>
                  <td className="num">{money(b.qtyRemaining * b.unitCost)}</td>
                  <td className="actions"><button className="btn sm danger" onClick={() => setDialog({ kind: 'discard', batch: b })}>{t('inventory.toss')}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Activity() {
  const { state, money } = useStore();
  const { t } = useI18n();
  const [reason, setReason] = useState<'all' | AdjReason>('all');
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const rows = useMemo(
    () => state.adjustments.filter((a) => reason === 'all' || a.reason === reason).slice().reverse().slice(0, 300),
    [state.adjustments, reason],
  );
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>{t('inventory.tab.activity')}</h2><p>{t('inventory.activity.intro')}</p></div>
        <select style={{ width: 200 }} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          <option value="all">{t('inventory.activity.all')}</option>
          {REASONS.map((r) => <option key={r} value={r}>{t(reasonKey(r))}</option>)}
        </select>
      </div>
      {rows.length === 0 ? <Empty title={t('inventory.activity.empty')} /> : (
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>{t('inventory.col.when')}</th><th>{t('inventory.col.item')}</th><th>{t('inventory.col.type')}</th><th className="num">{t('inventory.col.qty')}</th><th className="num">{t('inventory.col.cost')}</th><th>{t('common.note')}</th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const it = byId.get(a.itemId);
                const tone = a.reason === 'waste' || a.reason === 'expired' ? 'bad' : a.qty > 0 ? 'ok' : 'muted';
                return (
                  <tr key={a.id}>
                    <td className="muted">{fmtDateTime(a.at)}</td>
                    <td>{it?.name ?? <span className="muted">{t('inventory.activity.deletedItem')}</span>}</td>
                    <td><Pill tone={tone}>{t(reasonKey(a.reason))}</Pill></td>
                    <td className="num">{a.qty > 0 ? '+' : ''}{fmtQty(a.qty)} <span className="muted">{it?.unit}</span></td>
                    <td className="num">{money(a.cost)}</td>
                    <td className="muted">{a.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Dialogs ----------

// Metric first (Thailand weighs in grams and kilos); imperial last for anyone who still needs it
const UNITS = ['g', 'kg', 'ml', 'L', 'each', 'slice', 'case', 'bunch', 'can', 'bag', 'serving', 'portion', 'lb', 'oz', 'gal', 'qt', 'fl oz'];

function ItemModal({ item, isNew, onClose }: { item: InvItem; isNew: boolean; onClose: () => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const [it, setIt] = useState<InvItem>(item);
  const set = <K extends keyof InvItem>(k: K, v: InvItem[K]) => setIt((x) => ({ ...x, [k]: v }));
  const s = state.settings;
  const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [...list, v] : list);
  const isPrep = it.kind === 'prep';
  const batchCost = isPrep ? recipeCost(state, it.recipe ?? []) : 0;
  const usedIn = state.menu.filter((m) => [...m.recipe, ...(m.optionGroups ?? []).flatMap((g) => g.options.flatMap((o) => o.recipe))].some((r) => r.itemId === it.id)).map((m) => m.name)
    .concat(state.items.filter((x) => x.recipe?.some((r) => r.itemId === it.id)).map((x) => x.name));

  const save = () => {
    update((d) => {
      const i = d.items.findIndex((x) => x.id === it.id);
      const clean = { ...it, name: it.name.trim() };
      if (i >= 0) d.items[i] = clean; else d.items.push(clean);
    });
    onClose();
  };
  const remove = () => {
    if (usedIn.length && !confirm(t('inventory.item.confirmUsedIn', { name: it.name, list: usedIn.join(', ') }))) return;
    if (!usedIn.length && !confirm(t('inventory.item.confirmDelete', { name: it.name }))) return;
    update((d) => {
      d.items = d.items.filter((x) => x.id !== it.id);
      d.batches = d.batches.filter((b) => b.itemId !== it.id);
      d.menu.forEach((m) => {
        m.recipe = m.recipe.filter((r) => r.itemId !== it.id);
        m.optionGroups?.forEach((g) => g.options.forEach((o) => { o.recipe = o.recipe.filter((r) => r.itemId !== it.id); }));
      });
      d.items.forEach((x) => { if (x.recipe) x.recipe = x.recipe.filter((r) => r.itemId !== it.id); });
    });
    onClose();
  };

  return (
    <Modal
      wide={isPrep}
      title={isNew ? (isPrep ? t('inventory.item.newPrep') : t('inventory.item.newIngredient')) : t('inventory.item.editTitle', { name: item.name })}
      onClose={onClose}
      footer={
        <>
          {!isNew && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={remove}>{t('common.delete')}</button>}
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!it.name.trim() || !it.unit.trim() || (isPrep && !(it.yieldQty! > 0))} onClick={save}>{t('common.save')}</button>
        </>
      }
    >
      {isPrep && <div className="callout info">{t('inventory.item.prepCallout', { unit: it.unit || t('inventory.item.servings') })}</div>}
      <div className="form-grid">
        <Field label={t('inventory.item.name')} className="span-all"><input autoFocus value={it.name} onChange={(e) => set('name', e.target.value)} placeholder={isPrep ? t('inventory.item.prepNamePh') : t('inventory.item.ingredientNamePh')} /></Field>
        <div className="span-all"><ImageField value={it.image} name={it.name} onChange={(image) => set('image', image)} /></div>
        <Field label={isPrep ? t('inventory.item.portionUnit') : t('inventory.item.trackUnit')} hint={isPrep ? t('inventory.item.portionUnitHint') : t('inventory.item.trackUnitHint')}>
          <input list="units" value={it.unit} onChange={(e) => set('unit', e.target.value)} />
          <datalist id="units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        <Field label={t('inventory.item.category')}>
          <select value={it.category} onChange={(e) => set('category', e.target.value)}>{withCurrent(s.inventoryCategories, it.category).map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label={t('inventory.item.location')}>
          <select value={it.location} onChange={(e) => set('location', e.target.value)}>{withCurrent(s.storageLocations, it.location).map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label={t('inventory.item.par')} hint={t('inventory.item.parHint')}><div className="input-unit"><NumInput value={it.parLevel} onChange={(n) => set('parLevel', n)} /><span>{it.unit}</span></div></Field>
        <Field label={t('inventory.item.shelfLife')} hint={t('inventory.item.shelfLifeHint')}><div className="input-unit"><NumInput value={it.shelfLifeDays} onChange={(n) => set('shelfLifeDays', Math.max(0, Math.round(n)))} /><span>{t('common.days')}</span></div></Field>
        {!isPrep && (
          <>
            <Field label={t('inventory.item.supplier')}><input value={it.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)} /></Field>
            <Field label={t('inventory.item.typicalCost')} hint={t('inventory.item.typicalCostHint')}><div className="input-unit"><NumInput value={it.defaultCost} onChange={(n) => set('defaultCost', n)} /><span>/{it.unit}</span></div></Field>
          </>
        )}
        {isPrep && (
          <Field label={t('inventory.item.yields')}><div className="input-unit"><NumInput value={it.yieldQty ?? 0} onChange={(n) => set('yieldQty', n)} /><span>{it.unit}</span></div></Field>
        )}
      </div>
      {isPrep && (
        <div>
          <h3 style={{ marginBottom: 8 }}>{t('inventory.item.batchRecipe')}</h3>
          <RecipeEditor lines={it.recipe ?? []} onChange={(recipe) => set('recipe', recipe)} excludeId={it.id} />
          {batchCost > 0 && (it.yieldQty ?? 0) > 0 && (
            <div className="result-box" style={{ marginTop: 12 }}>
              <div className="kv"><span>{t('inventory.item.costPerBatch')}</span><strong>{money(batchCost)}</strong></div>
              <div className="kv"><span>{t('inventory.costPer', { unit: it.unit })}</span><strong>{money(batchCost / (it.yieldQty || 1))}</strong></div>
            </div>
          )}
        </div>
      )}
      {!isNew && usedIn.length > 0 && <p className="muted" style={{ fontSize: 13 }}>{t('inventory.item.usedIn', { list: usedIn.join(', ') })}</p>}
    </Modal>
  );
}

function ReceiveModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const item = state.items.find((i) => i.id === itemId)!;
  const today = localDate();
  const [qty, setQty] = useState(0);
  const [mode, setMode] = useState<'unit' | 'total'>('total');
  const [price, setPrice] = useState(0);
  const [receivedAt, setReceivedAt] = useState(today);
  const [expiresAt, setExpiresAt] = useState(item.shelfLifeDays > 0 ? addDays(today, item.shelfLifeDays) : '');
  const [lot, setLot] = useState('');
  const [location, setLocation] = useState(item.location);
  const uc = mode === 'unit' ? price : qty ? price / qty : 0;

  const save = () => {
    update((d) => receiveStock(d, { itemId, qty, unitCost: uc, receivedAt, expiresAt: expiresAt || undefined, lot, location }));
    onClose();
  };

  return (
    <Modal title={t('inventory.receive.title', { name: item.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={qty <= 0} onClick={save}>{t('inventory.receive.addToStock')}</button></>}>
      <div className="form-grid">
        <Field label={t('inventory.receive.qty')}><div className="input-unit"><NumInput autoFocus value={qty} onChange={setQty} /><span>{item.unit}</span></div></Field>
        <Field label={t('inventory.receive.cost')}>
          <div className="input-unit">
            <NumInput value={price} onChange={setPrice} />
            <select style={{ width: 'auto' }} value={mode} onChange={(e) => setMode(e.target.value as 'unit' | 'total')}>
              <option value="total">{t('inventory.receive.costTotal')}</option>
              <option value="unit">{t('inventory.receive.costPer', { unit: item.unit })}</option>
            </select>
          </div>
        </Field>
        <Field label={t('inventory.receive.receivedOn')}><input type="date" value={receivedAt} onChange={(e) => { setReceivedAt(e.target.value); if (item.shelfLifeDays > 0 && e.target.value) setExpiresAt(addDays(e.target.value, item.shelfLifeDays)); }} /></Field>
        <Field label={t('inventory.receive.expiresOn')} hint={item.shelfLifeDays ? t('inventory.receive.defaultShelfLife', { n: item.shelfLifeDays }) : t('inventory.receive.noExpiryHint')}><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
        <Field label={t('inventory.receive.lot')}><input value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
        <Field label={t('inventory.receive.storedIn')}>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>{[...new Set([...state.settings.storageLocations, item.location])].map((l) => <option key={l}>{l}</option>)}</select>
        </Field>
      </div>
      <div className="result-box">
        <div className="kv"><span>{t('inventory.costPer', { unit: item.unit })}</span><strong>{money(uc)}</strong></div>
        <div className="kv"><span>{t('inventory.receive.batchTotal')}</span><strong>{money(uc * qty)}</strong></div>
        {unitCost(state, itemId) > 0 && uc > 0 && Math.abs(uc / unitCost(state, itemId) - 1) > 0.1 && (
          <div className="callout warn">{t(uc > unitCost(state, itemId) ? 'inventory.receive.warnMore' : 'inventory.receive.warnLess', { avg: money(unitCost(state, itemId)), unit: item.unit })}</div>
        )}
      </div>
    </Modal>
  );
}

function PrepModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const item = state.items.find((i) => i.id === itemId)!;
  const today = localDate();
  const [mult, setMult] = useState(1);
  const [madeOn, setMadeOn] = useState(today);
  const [expiresAt, setExpiresAt] = useState(item.shelfLifeDays > 0 ? addDays(today, item.shelfLifeDays) : '');
  const [note, setNote] = useState('');
  const recipe = item.recipe ?? [];
  const cost = recipeCost(state, recipe) * mult;
  const yieldQty = (item.yieldQty ?? 0) * mult;
  const canMake = servingsAvailable(state, recipe);

  const save = () => {
    update((d) => makePrepBatch(d, { itemId, multiplier: mult, madeOn, expiresAt: expiresAt || undefined, note }));
    onClose();
  };

  return (
    <Modal title={t('inventory.prep.title', { name: item.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={mult <= 0 || !recipe.length} onClick={save}>{t('inventory.prep.record')}</button></>}>
      {!recipe.length && <div className="callout warn">{t('inventory.prep.noRecipe')}</div>}
      <div className="form-grid">
        <Field label={t('inventory.prep.numBatches')} hint={t('inventory.prep.halfHint')}><NumInput autoFocus value={mult} onChange={setMult} /></Field>
        <Field label={t('inventory.prep.madeOn')}><input type="date" value={madeOn} onChange={(e) => { setMadeOn(e.target.value); if (item.shelfLifeDays > 0 && e.target.value) setExpiresAt(addDays(e.target.value, item.shelfLifeDays)); }} /></Field>
        <Field label={t('inventory.prep.useBy')} hint={t('inventory.prep.holdHint', { n: item.shelfLifeDays })}><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
        <Field label={t('common.notes')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('inventory.prep.madeByPh')} /></Field>
      </div>
      <table className="table compact">
        <thead><tr><th>{t('inventory.col.pulls')}</th><th className="num">{t('inventory.col.needed')}</th><th className="num">{t('inventory.col.onHand')}</th></tr></thead>
        <tbody>
          {recipe.map((l) => {
            const it = state.items.find((x) => x.id === l.itemId);
            const need = l.qty * mult;
            const have = onHand(state, l.itemId);
            return (
              <tr key={l.itemId}>
                <td>{it?.name}</td>
                <td className="num">{fmtQty(need)} {it?.unit}</td>
                <td className="num">{have < need ? <Pill tone="bad">{t('inventory.prep.short', { qty: fmtQty(have) })}</Pill> : `${fmtQty(have)} ${it?.unit}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="result-box">
        <div className="kv"><span>{t('inventory.prep.yields')}</span><strong>{fmtQty(yieldQty)} {item.unit}</strong></div>
        <div className="kv"><span>{t('inventory.prep.batchCost')}</span><strong>{money(cost)}</strong></div>
        <div className="kv"><span>{t('inventory.costPer', { unit: item.unit })}</span><strong>{money(yieldQty ? cost / yieldQty : 0)}</strong></div>
        <div className="muted" style={{ fontSize: 13 }}>{t(canMake === 1 ? 'inventory.prep.enoughOne' : 'inventory.prep.enoughMany', { n: canMake })}</div>
      </div>
    </Modal>
  );
}

function CountModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const item = state.items.find((i) => i.id === itemId)!;
  const current = onHand(state, itemId);
  const [counted, setCounted] = useState(Number(current.toFixed(2)));
  const [note, setNote] = useState('');
  const diff = counted - current;
  return (
    <Modal title={t('inventory.count.title', { name: item.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" onClick={() => { update((d) => setCount(d, itemId, counted, note)); onClose(); }}>{t('inventory.count.save')}</button></>}>
      <p className="muted" style={{ margin: 0 }}>{t('inventory.count.intro')} <strong>{fmtQty(current)} {item.unit}</strong>{t('inventory.count.introEnd')}</p>
      <div className="form-grid">
        <Field label={t('inventory.count.actual')}><div className="input-unit"><NumInput autoFocus value={counted} onChange={setCounted} /><span>{item.unit}</span></div></Field>
        <Field label={t('common.notes')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('inventory.count.notePh')} /></Field>
      </div>
      {Math.abs(diff) > 1e-9 && (
        <div className={`callout ${diff < 0 ? 'warn' : 'info'}`}>
          {t(diff < 0 ? 'inventory.count.missing' : 'inventory.count.extra', { qty: fmtQty(Math.abs(diff)), unit: item.unit, cost: money(Math.abs(diff) * unitCost(state, itemId)) })}
          {diff < 0 && t('inventory.count.fifo')}
        </div>
      )}
    </Modal>
  );
}

function DiscardModal({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const item = state.items.find((i) => i.id === batch.itemId)!;
  const expired = !!batch.expiresAt && batch.expiresAt <= localDate();
  const [qty, setQty] = useState(batch.qtyRemaining);
  const [reason, setReason] = useState<'waste' | 'expired'>(expired ? 'expired' : 'waste');
  const [note, setNote] = useState('');
  return (
    <Modal title={t('inventory.toss.title', { name: item.name })} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn danger solid" disabled={qty <= 0} onClick={() => { update((d) => discardFromBatch(d, batch.id, qty, reason, note)); onClose(); }}>{t(reason === 'waste' ? 'inventory.toss.recordWaste' : 'inventory.toss.recordExpired')}</button></>}>
      <p className="muted" style={{ margin: 0 }}>{t('inventory.toss.batchInfo', { batch: batch.lot || fmtDate(batch.receivedAt), qty: fmtQty(batch.qtyRemaining), unit: item.unit })}</p>
      <div className="form-grid">
        <Field label={t('inventory.toss.amount')}><div className="input-unit"><NumInput autoFocus value={qty} onChange={(n) => setQty(Math.min(n, batch.qtyRemaining))} /><span>{item.unit}</span></div></Field>
        <Field label={t('inventory.toss.reason')}>
          <select value={reason} onChange={(e) => setReason(e.target.value as 'waste' | 'expired')}>
            <option value="expired">{t('inventory.toss.optExpired')}</option>
            <option value="waste">{t('inventory.toss.optWaste')}</option>
          </select>
        </Field>
        <Field label={t('common.notes')} className="span-all"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="callout bad">{t('inventory.toss.cost')} <strong>{money(qty * batch.unitCost)}</strong></div>
    </Modal>
  );
}
