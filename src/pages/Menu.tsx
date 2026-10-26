import { Fragment, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { defaultChoices, recipeCost, resolveDish, servingsAvailable, tabOf, unitCost } from '../inventory';
import { Empty, Field, ImageField, Modal, NumInput, Pill, Thumb } from '../components/ui';
import { RecipeEditor } from '../components/Recipe';
import { Plate, RecipeCard, paletteOf, type CardLine } from '../components/RecipeCard';
import MenuScan from '../components/MenuScan';
import MenuListsEditor from '../components/MenuListsEditor';
import ColumnTable, { type Column } from '../components/ColumnTable';
import { appCut, deliveryOf, priceDish } from '../delivery';
import type { MenuItem, MenuOption, OptionGroup } from '../types';
import { dishName, otherDishName, pct, uid } from '../utils';
import { useI18n } from '../i18n';

export function foodCostTone(fc: number, target: number): 'ok' | 'warn' | 'bad' {
  if (fc <= target / 100) return 'ok';
  if (fc <= target / 100 + 0.05) return 'warn';
  return 'bad';
}

/** Cost and price of a dish as most people order it: the first choice of each required group. */
export function dishDefaults(state: Parameters<typeof recipeCost>[0], m: MenuItem) {
  const dish = resolveDish(m, defaultChoices(m));
  return { ...dish, cost: recipeCost(state, dish.recipe) };
}

const VIEW_KEY = 'mise-menu-view';
type View = 'cards' | 'list';
const savedView = (): View => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch { return 'cards'; } };
const DELIVERY_KEY = 'mise-menu-delivery';
const savedDelivery = () => { try { return localStorage.getItem(DELIVERY_KEY) === '1'; } catch { return false; } };

export default function Menu() {
  const { state, update, money } = useStore();
  const { t, lang } = useI18n();
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [viewing, setViewing] = useState<MenuItem | null>(null);
  const [scanning, setScanning] = useState(false);
  // Bulk edit: dishes ticked in the list
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState('');
  const [editingLists, setEditingLists] = useState(false);
  // Show delivery-app prices (GP + VAT) next to in-store prices
  const [showDelivery, setShowDeliveryState] = useState(savedDelivery);
  const setShowDelivery = (v: boolean) => { setShowDeliveryState(v); try { localStorage.setItem(DELIVERY_KEY, v ? '1' : '0'); } catch { /* ignore */ } };
  const dSet = deliveryOf(state.settings);
  const setDeliveryPrice = (id: string, n: number) => update((d) => { const x = d.menu.find((y) => y.id === id); if (x) x.deliveryPrice = n > 0 ? n : undefined; });
  // Hide dishes whose recipe can't be made from the stock on hand
  const [inStockOnly, setInStockOnlyState] = useState(() => { try { return localStorage.getItem('mise-menu-in-stock') === '1'; } catch { return false; } });
  const setInStockOnly = (v: boolean) => { setInStockOnlyState(v); try { localStorage.setItem('mise-menu-in-stock', v ? '1' : '0'); } catch { /* ignore */ } };
  const [scanned, setScanned] = useState(0);
  const [view, setViewState] = useState<View>(savedView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const [cat, setCat] = useState('All');
  const [tab, setTab] = useState('All');
  const target = state.settings.targetFoodCost;
  const tabs = state.settings.menuTabs;
  const inTab = state.menu.filter((m) => tab === 'All' || tabOf(m, tabs) === tab);
  const cats = ['All', ...state.settings.menuCategories.filter((c) => tab === 'All' || inTab.some((m) => m.category === c))];
  const soldOut = (m: MenuItem) => { const { recipe } = dishDefaults(state, m); return recipe.length > 0 && servingsAvailable(state, recipe) === 0; };
  const inCat = inTab.filter((m) => cat === 'All' || m.category === cat);
  const soldOutCount = inCat.filter(soldOut).length;
  const list = inCat
    .filter((m) => !inStockOnly || !soldOut(m))
    .sort((a, b) => state.settings.menuCategories.indexOf(a.category) - state.settings.menuCategories.indexOf(b.category) || a.name.localeCompare(b.name));

  const blank = (): MenuItem => ({ id: uid(), name: '', tab: tab !== 'All' ? tab : tabs[0], category: cat !== 'All' ? cat : state.settings.menuCategories[0] ?? 'Mains', price: 0, recipe: [], active: true });

  // One row per dish with everything the columns need
  const rows = list.map((m) => {
    const { cost, price, recipe } = dishDefaults(state, m);
    const groups = m.optionGroups?.length ?? 0;
    return {
      m, cost, price, recipe, groups,
      fc: price ? cost / price : 0,
      avail: recipe.length ? servingsAvailable(state, recipe) : null,
      dp: priceDish(price, cost, m, dSet),
    };
  });
  type Row = (typeof rows)[number];
  const priceText = (r: Row) => (r.groups ? t('menu.fromPrice', { price: money(r.price) }) : money(r.price));
  const editCol: Column<Row> = { id: 'edit', label: '', width: 70, min: 60, fixed: 'end', className: 'actions', render: () => <button className="btn sm">{t('common.edit')}</button> };
  const itemCol: Column<Row> = {
    id: 'item', label: t('menu.col.item'), width: 240, min: 160, fixed: 'start', sort: (r) => dishName(r.m, lang),
    render: (r) => (
      <div className="cell-thumb">
        <Thumb src={r.m.image} name={r.m.name} size="xs" />
        <div className="cell-text">
          <strong title={dishName(r.m, lang)}>{dishName(r.m, lang)}</strong>
          {otherDishName(r.m, lang) && <div className="sub" title={otherDishName(r.m, lang)}>{otherDishName(r.m, lang)}</div>}
          {r.m.description && <div className="sub desc" title={r.m.description}>{r.m.description}</div>}
          {r.groups > 0 && <div className="sub" title={r.m.optionGroups!.map((g) => g.name).join(' · ')}>{r.m.optionGroups!.map((g) => g.name).join(' · ')}</div>}
        </div>
      </div>
    ),
  };
  const menuColumns: Column<Row>[] = [
    itemCol,
    { id: 'tab', label: t('menu.col.tab'), width: 90, sort: (r) => tabOf(r.m, tabs), render: (r) => <span title={tabOf(r.m, tabs)}>{tabOf(r.m, tabs)}</span> },
    { id: 'category', label: t('menu.col.category'), width: 120, sort: (r) => r.m.category, render: (r) => <span title={r.m.category}>{r.m.category}</span> },
    { id: 'price', label: t('menu.col.price'), width: 115, num: true, sort: (r) => r.price, render: priceText },
    { id: 'cost', label: t('menu.col.plateCost'), width: 90, num: true, sort: (r) => r.cost, render: (r) => money(r.cost) },
    { id: 'fc', label: t('menu.col.foodCost'), width: 105, num: true, sort: (r) => (r.recipe.length ? r.fc : null), render: (r) => <Pill tone={r.recipe.length ? foodCostTone(r.fc, target) : 'muted'}>{r.recipe.length ? pct(r.fc) : t('menu.noRecipe')}</Pill> },
    { id: 'profit', label: t('menu.col.profit'), width: 95, num: true, sort: (r) => r.price - r.cost, render: (r) => money(r.price - r.cost) },
    { id: 'avail', label: t('menu.col.canMake'), width: 80, num: true, sort: (r) => r.avail, render: (r) => (r.avail === null ? <span className="muted">—</span> : r.avail === 0 ? <Pill tone="bad">{t('menu.soldOut')}</Pill> : r.avail) },
    { id: 'status', label: t('menu.col.status'), width: 95, sort: (r) => (r.m.active ? 0 : 1), render: (r) => (r.m.active ? <Pill tone="ok">{t('menu.onMenu')}</Pill> : <Pill>{t('menu.hidden')}</Pill>) },
    editCol,
  ];
  const deliveryColumns: Column<Row>[] = [
    itemCol,
    { id: 'price', label: t('menu.col.price'), width: 105, num: true, sort: (r) => r.price, render: priceText },
    { id: 'cost', label: t('menu.col.plateCost'), width: 95, num: true, sort: (r) => r.cost, render: (r) => money(r.cost) },
    { id: 'inStoreProfit', label: t('menu.delivery.col.inStoreProfit'), width: 115, num: true, sort: (r) => r.dp.inStore.profit, render: (r) => money(r.dp.inStore.profit) },
    {
      id: 'recommended', label: t('menu.delivery.col.recommended'), width: 140, num: true, sort: (r) => r.dp.recommended,
      render: (r) => (
        <>
          {money(r.dp.recommended)}
          {r.m.deliveryPrice !== r.dp.recommended && (
            <button className="btn sm use-rec" onClick={(e) => { e.stopPropagation(); setDeliveryPrice(r.m.id, r.dp.recommended); }}>{t('menu.delivery.use')}</button>
          )}
        </>
      ),
    },
    {
      id: 'deliveryPrice', label: t('menu.delivery.col.price'), width: 125, num: true, className: 'delivery-col', sort: (r) => r.m.deliveryPrice || null,
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <NumInput className={r.m.deliveryPrice ? '' : 'unset'} value={r.m.deliveryPrice ?? 0} placeholder={t('menu.delivery.enter')} onChange={(n) => setDeliveryPrice(r.m.id, n)} aria-label={t('menu.delivery.col.price')} />
        </span>
      ),
    },
    {
      id: 'received', label: t('menu.delivery.col.received'), width: 110, num: true, sort: (r) => (r.dp.delivery ?? r.dp.atRecommended).received,
      render: (r) => { const shown = r.dp.delivery ?? r.dp.atRecommended; return <>{money(shown.received)}{!r.dp.delivery && <div className="sub">{t('menu.delivery.atRecommended')}</div>}</>; },
    },
    {
      id: 'deliveryProfit', label: t('menu.delivery.col.profit'), width: 110, num: true, sort: (r) => (r.dp.delivery ?? r.dp.atRecommended).profit,
      render: (r) => { const shown = r.dp.delivery ?? r.dp.atRecommended; return <Pill tone={shown.profit < r.dp.inStore.profit - 0.005 ? 'warn' : 'ok'}>{money(shown.profit)}</Pill>; },
    },
    editCol,
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('common.nav.menu')}</h1>
          <p>{t('menu.intro', { target })}</p>
        </div>
        <div className="row">
          <button className="btn photo-btn" onClick={() => setScanning(true)}>📷 {t('importer.scan.button')}</button>
          <button className="btn primary" onClick={() => setEditing(blank())}>{t('menu.newItem')}</button>
        </div>
      </div>
      {scanned > 0 && <div className="callout ok" style={{ marginBottom: 14 }}>{t('importer.scan.done', { n: scanned })}</div>}

      <div className="row" style={{ marginBottom: 14 }}>
        {tabs.length > 1 && (
          <div className="pill-tabs">
            {['All', ...tabs].map((x) => <button key={x} className={tab === x ? 'active' : ''} onClick={() => { setTab(x); setCat('All'); }}>{x === 'All' ? t('common.all') : x}</button>)}
          </div>
        )}
        <div className="seg">
          {cats.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c === 'All' ? t('common.all') : c}</button>)}
        </div>
        <button className="btn sm edit-lists-btn" onClick={() => setEditingLists(true)} title={t('menu.lists.title')}>✎ {t('menu.lists.button')}</button>
        <button className={`btn sm delivery-toggle ${inStockOnly ? 'on' : ''}`} aria-pressed={inStockOnly} onClick={() => setInStockOnly(!inStockOnly)} title={t('menu.inStock.hint')}>
          <span className="switch" aria-hidden><span /></span>{t('menu.inStock.toggle')}{soldOutCount > 0 && <span className="toggle-count">{t('menu.inStock.count', { n: soldOutCount })}</span>}
        </button>
        <button className={`btn sm delivery-toggle ${showDelivery ? 'on' : ''}`} aria-pressed={showDelivery} onClick={() => setShowDelivery(!showDelivery)}>
          <span className="switch" aria-hidden><span /></span>🛵 {t('menu.delivery.toggle')}
        </button>
        <span className="spacer" />
        <div className="seg view-toggle" role="group" aria-label={t('menu.view.label')}>
          <button className={view === 'cards' ? 'active' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>▦ {t('menu.view.cards')}</button>
          <button className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>≡ {t('menu.view.list')}</button>
        </div>
      </div>

      {showDelivery && <DeliveryBar list={list} />}

      {view === 'cards' && (list.length === 0 ? (
        <div className="card">
          <Empty title={t('menu.emptyTitle')}>{t('menu.emptyBody')}</Empty>
          <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
            <button className="btn primary lg" onClick={() => setScanning(true)}>📷 {t('importer.scan.button')}</button>
          </div>
        </div>
      ) : (
        <div className="dish-cards" key={`${tab}|${cat}`}>
          {list.map((m, i) => {
            const { cost, price, recipe } = dishDefaults(state, m);
            const fc = price ? cost / price : 0;
            const [from, to] = paletteOf(m.name, i);
            const groups = m.optionGroups?.length ?? 0;
            return (
              <article
                key={m.id}
                className={`dish-card reveal ${m.active ? '' : 'is-hidden'}`}
                style={{ ['--i' as string]: i % 6, ['--rc-from' as string]: from, ['--rc-to' as string]: to }}
              >
                <span className="dish-card-plate spin-on-scroll"><Plate image={m.image} name={m.name} size={112} /></span>
                <div className="dish-card-body">
                  <span className="dish-card-cat">{m.category}{m.active ? '' : ` · ${t('menu.hidden')}`}</span>
                  <h3>{dishName(m, lang)}</h3>
                  {otherDishName(m, lang) && <span className="dish-card-alt">{otherDishName(m, lang)}</span>}
                  <div className="dish-card-meta">
                    <strong>{groups ? t('menu.fromPrice', { price: money(price) }) : money(price)}</strong>
                    {recipe.length > 0 && <span className={`dish-card-fc ${foodCostTone(fc, target)}`}>{t('menu.card.foodCost', { pct: pct(fc) })}</span>}
                  </div>
                  {showDelivery && (() => {
                    const dp = priceDish(price, cost, m, dSet);
                    return (
                      <span className="dish-card-delivery">
                        🛵 {m.deliveryPrice ? money(m.deliveryPrice) : t('menu.delivery.notSet')} · {t('menu.delivery.suggest', { price: money(dp.recommended) })}
                      </span>
                    );
                  })()}
                  <div className="dish-card-actions">
                    <button className="dish-card-btn" onClick={() => setViewing(m)}>{t('menu.card.recipe')}</button>
                    <button className="dish-card-btn ghost" onClick={() => setEditing(structuredClone(m))}>{t('common.edit')}</button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ))}

      {view === 'list' && <div className="card">
        {list.length === 0 ? (
          <Empty title={t('menu.emptyTitle')}>{t('menu.emptyBody')}</Empty>
        ) : (<>
          <BulkBar
            ids={list.filter((m) => picked.has(m.id)).map((m) => m.id)}
            category={bulkCat}
            onCategory={setBulkCat}
            onClear={() => setPicked(new Set())}
          />
          <ColumnTable
            selected={picked}
            onSelectedChange={setPicked}
            key={showDelivery ? 'delivery' : 'menu'}
            storageKey={showDelivery ? 'mise-menu-cols-delivery' : 'mise-menu-cols'}
            className={showDelivery ? 'delivery-table' : ''}
            columns={showDelivery ? deliveryColumns : menuColumns}
            rows={rows}
            rowKey={(r) => r.m.id}
            onRowClick={(r) => setEditing(structuredClone(r.m))}
          />
        </>)}
      </div>}

      {editingLists && <MenuListsEditor onClose={() => setEditingLists(false)} onSaved={() => { setTab('All'); setCat('All'); }} />}
      {scanning && <MenuScan onClose={() => setScanning(false)} onAdded={(n) => { setScanned(n); setTab('All'); setCat('All'); }} />}

      {viewing && (
        <RecipeSheet
          item={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(structuredClone(viewing)); setViewing(null); }}
        />
      )}

      {editing && (
        <MenuItemModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(m) => {
            update((d) => {
              const i = d.menu.findIndex((x) => x.id === m.id);
              if (i >= 0) d.menu[i] = m; else d.menu.push(m);
            });
            setEditing(null);
          }}
          onDelete={state.menu.some((x) => x.id === editing.id) ? () => {
            if (!confirm(t('menu.confirmDelete', { name: editing.name }))) return;
            update((d) => { d.menu = d.menu.filter((x) => x.id !== editing.id); });
            setEditing(null);
          } : undefined}
        />
      )}
    </>
  );
}

/** Actions for the dishes ticked in the list: show, hide, move to a category, delete. */
function BulkBar({ ids, category, onCategory, onClear }: { ids: string[]; category: string; onCategory: (c: string) => void; onClear: () => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  if (!ids.length) return null;
  const set = new Set(ids);
  const each = (fn: (m: MenuItem) => void) => update((d) => { for (const m of d.menu) if (set.has(m.id)) fn(m); });
  const home = state.settings.categoryTabs ?? {};
  const remove = () => {
    if (!confirm(t(ids.length === 1 ? 'menu.bulk.confirmDeleteOne' : 'menu.bulk.confirmDelete', { n: ids.length }))) return;
    update((d) => {
      d.menu = d.menu.filter((m) => !set.has(m.id));
      // Take them off any open orders too; past sales stay in history
      d.tickets = d.tickets.map((tk) => ({ ...tk, lines: tk.lines.filter((l) => !set.has(l.menuItemId)) }));
    });
    onClear();
  };
  return (
    <div className="bulk-bar" role="toolbar" aria-label={t('menu.bulk.label')}>
      <strong>{t(ids.length === 1 ? 'menu.bulk.selectedOne' : 'menu.bulk.selected', { n: ids.length })}</strong>
      <button className="btn sm" onClick={() => each((m) => { m.active = true; })}>{t('menu.bulk.show')}</button>
      <button className="btn sm" onClick={() => each((m) => { m.active = false; })}>{t('menu.bulk.hide')}</button>
      <select
        value={category}
        onChange={(e) => {
          const c = e.target.value;
          onCategory('');
          if (!c) return;
          each((m) => { m.category = c; if (home[c]) m.tab = home[c]; });
        }}
        aria-label={t('menu.bulk.move')}
      >
        <option value="">{t('menu.bulk.move')}…</option>
        {state.settings.menuCategories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button className="btn sm danger" onClick={remove}>🗑 {t('menu.bulk.delete')}</button>
      <span className="spacer" />
      <button className="btn sm ghost" onClick={onClear}>{t('menu.bulk.clear')}</button>
    </div>
  );
}

/** Delivery-app settings (GP, VAT, packaging, rounding) and filling in prices in one go. */
function DeliveryBar({ list }: { list: MenuItem[] }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const d = deliveryOf(state.settings);
  const cut = appCut(d);
  const set = (p: Partial<typeof d>) => update((x) => { x.settings.delivery = { ...deliveryOf(x.settings), ...p }; });
  const missing = list.filter((m) => !m.deliveryPrice);
  const fill = () => {
    if (!confirm(t('menu.delivery.fillConfirm', { n: missing.length }))) return;
    update((x) => {
      for (const m of x.menu) {
        if (m.deliveryPrice || !missing.some((y) => y.id === m.id)) continue;
        const { cost, price } = dishDefaults(x, m);
        m.deliveryPrice = priceDish(price, cost, m, deliveryOf(x.settings)).recommended;
      }
    });
  };
  return (
    <div className="card delivery-bar">
      <div className="delivery-bar-head">
        <div>
          <h3>🛵 {t('menu.delivery.title')}</h3>
          <p className="muted">{t('menu.delivery.explain', { gp: d.gpPct, vat: d.vatPct, cut: (cut * 100).toFixed(1), keep: ((1 - cut) * 100).toFixed(1) })}</p>
        </div>
        {missing.length > 0 && <button className="btn primary sm" onClick={fill}>{t('menu.delivery.fill', { n: missing.length })}</button>}
      </div>
      <div className="delivery-fields">
        <Field label={t('menu.delivery.gp')}><div className="input-unit"><NumInput value={d.gpPct} onChange={(n) => set({ gpPct: Math.min(95, Math.max(0, n)) })} /><span>%</span></div></Field>
        <Field label={t('menu.delivery.vat')}><div className="input-unit"><NumInput value={d.vatPct} onChange={(n) => set({ vatPct: Math.max(0, n) })} /><span>%</span></div></Field>
        <Field label={t('menu.delivery.packaging')} hint={t('menu.delivery.packagingHint')}><NumInput value={d.packaging} onChange={(n) => set({ packaging: Math.max(0, n) })} /></Field>
        <Field label={t('menu.delivery.round')}>
          <select
            value={d.endsIn != null ? `e${d.endsIn}` : `r${d.roundTo}`}
            onChange={(e) => {
              const v = e.target.value;
              set(v.startsWith('e') ? { endsIn: Number(v.slice(1)) } : { roundTo: Number(v.slice(1)), endsIn: undefined });
            }}
          >
            {[0, 1, 5, 10].map((r) => <option key={`r${r}`} value={`r${r}`}>{r ? t('menu.delivery.roundTo', { n: money(r) }) : t('menu.delivery.noRound')}</option>)}
            <optgroup label={t('menu.delivery.endsInGroup')}>
              {[9, 5, 0, 1, 2, 3, 4, 6, 7, 8].map((n) => <option key={`e${n}`} value={`e${n}`}>{t('menu.delivery.endsIn', { n, example: money(310 + n) })}</option>)}
            </optgroup>
          </select>
        </Field>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t('menu.delivery.formula', { keep: ((1 - cut) * 100).toFixed(1) })}</p>
    </div>
  );
}

/** Full recipe for one dish as a recipe card; the header shrinks as you scroll the ingredients. */
function RecipeSheet({ item, onClose, onEdit }: { item: MenuItem; onClose: () => void; onEdit: () => void }) {
  const { state, money } = useStore();
  const { t, lang } = useI18n();
  const [servings, setServings] = useState(1);
  const sheet = useRef<HTMLDivElement>(null);
  const { recipe, price } = dishDefaults(state, item);
  const lines: CardLine[] = recipe.map((r, i) => {
    const it = state.items.find((x) => x.id === r.itemId);
    return { key: `${r.itemId}-${i}`, name: it?.name ?? '?', qty: r.qty, unit: it?.unit ?? '', cost: unitCost(state, r.itemId) * r.qty };
  });
  const avail = recipe.length ? servingsAvailable(state, recipe) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 0 → 1 as the sheet scrolls, so the header can shrink smoothly
  const onScroll = () => {
    const el = sheet.current;
    if (!el) return;
    // The mini bar takes over once the big header (and its servings dial) has scrolled away
    const head = el.querySelector<HTMLElement>('.rc-head')?.offsetHeight ?? 260;
    el.style.setProperty('--shrink', Math.min(1, el.scrollTop / Math.max(1, head - 40)).toFixed(3));
    el.classList.toggle('scrolled', el.scrollTop > head - 20);
  };

  return (
    <div className="recipe-sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="recipe-sheet-wrap" role="dialog" aria-modal="true" aria-label={item.name}>
      <button className="recipe-sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
      <div className="recipe-sheet" ref={sheet} onScroll={onScroll}>
        <RecipeCard
          title={dishName(item, lang)}
          subtitle={[otherDishName(item, lang), item.category, money(price)].filter(Boolean).join(' · ')}
          image={item.image}
          lines={lines}
          servings={servings}
          onServings={setServings}
          servingsLabel={t('menu.card.plates')}
          money={money}
          empty={<>{t('menu.card.noRecipe')} <button className="btn sm" onClick={onEdit}>{t('menu.card.addRecipe')}</button></>}
          footer={
            <div className="rc-foot">
              {item.description && <p className="muted">{item.description}</p>}
              {avail !== null && <p className="muted">{t('menu.card.canMake', { n: avail })}</p>}
              <button className="btn primary" onClick={onEdit}>{t('menu.card.editDish')}</button>
            </div>
          }
        />
      </div>
      </div>
    </div>
  );
}

export function MenuItemModal({ item, onClose, onSave, onDelete }: { item: MenuItem; onClose: () => void; onSave: (m: MenuItem) => void; onDelete?: () => void }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const [m, setM] = useState<MenuItem>(item);
  const set = <K extends keyof MenuItem>(k: K, v: MenuItem[K]) => setM((x) => ({ ...x, [k]: v }));
  const { cost, price } = dishDefaults(state, m);
  const hasGroups = !!m.optionGroups?.length;
  const target = state.settings.targetFoodCost;
  const fc = price ? cost / price : 0;
  // Suggest a base price so the default plate hits the target
  const suggested = Math.max(0, cost / (target / 100) - (price - m.price));
  const tabs = state.settings.menuTabs;
  const tab = tabOf(m, tabs);
  // Categories already used in this tab first, then the rest
  const allCats = state.settings.menuCategories.includes(m.category) ? state.settings.menuCategories : [...state.settings.menuCategories, m.category];
  const homeTab = state.settings.categoryTabs ?? {};
  const usedHere = new Set([
    ...state.menu.filter((x) => x.id !== m.id && tabOf(x, tabs) === tab).map((x) => x.category),
    ...Object.keys(homeTab).filter((c) => homeTab[c] === tab),
  ]);
  const cats = [...allCats.filter((c) => usedHere.has(c)), ...allCats.filter((c) => !usedHere.has(c))];

  return (
    <Modal
      wide
      title={onDelete ? t('menu.editTitle', { name: item.name }) : t('menu.newTitle')}
      onClose={onClose}
      footer={
        <>
          {onDelete && <button className="btn danger" onClick={onDelete} style={{ marginRight: 'auto' }}>{t('common.delete')}</button>}
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!m.name.trim()} onClick={() => onSave({ ...m, name: m.name.trim() })}>{t('common.save')}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('menu.name')}><input autoFocus value={m.name} onChange={(e) => set('name', e.target.value)} placeholder={t('menu.namePlaceholder')} /></Field>
        <Field label={t('menu.nameEn')} hint={t('menu.nameEnHint')}><input value={m.nameEn ?? ''} onChange={(e) => set('nameEn', e.target.value || undefined)} placeholder={t('menu.nameEnPlaceholder')} /></Field>
        {tabs.length > 0 && (
          <Field label={t('menu.tab')}>
            <select value={tab} onChange={(e) => set('tab', e.target.value)}>{tabs.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
        )}
        <Field label={t('menu.category')}>
          <select
            value={m.category}
            onChange={(e) => {
              const c = e.target.value;
              // A category lives under one tab, so picking it moves the dish there too
              setM((x) => ({ ...x, category: c, ...(homeTab[c] && tabs.includes(homeTab[c]) ? { tab: homeTab[c] } : {}) }));
            }}
          >{cats.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label={hasGroups ? t('menu.basePrice') : t('menu.menuPrice')} hint={hasGroups ? t('menu.basePriceHint') : undefined}><NumInput value={m.price} onChange={(n) => set('price', n)} /></Field>
        <Field label={t('menu.description')} className="span-all"><input value={m.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="span-all"><ImageField value={m.image} name={m.name} onChange={(image) => set('image', image)} /></div>
        <label className="check span-all"><input type="checkbox" checked={m.active} onChange={(e) => set('active', e.target.checked)} /> {t('menu.showOnPos')}</label>
      </div>

      <div>
        <h3 style={{ marginBottom: 8 }}>{t('menu.recipeTitle')}</h3>
        <RecipeEditor lines={m.recipe} onChange={(recipe) => set('recipe', recipe)} />
      </div>

      <OptionGroupsEditor item={m} onChange={(optionGroups) => set('optionGroups', optionGroups.length ? optionGroups : undefined)} />

      <div className="result-box">
        {hasGroups && <div className="muted" style={{ fontSize: 13 }}>{t('menu.withDefaults')}</div>}
        <div className="kv"><span>{t('menu.plateCost')}</span><strong>{money(cost)}</strong></div>
        <div className="kv"><span>{t('menu.foodCostPct')}</span><strong>{price ? pct(fc) : '—'}</strong></div>
        <div className="kv"><span>{t('menu.profitPerPlate')}</span><strong>{money(price - cost)}</strong></div>
        {cost > 0 && (
          <div className={`callout ${foodCostTone(fc, target)}`}>
            {t('menu.toHitTarget', { target })} <strong>{money(suggested)}</strong>.{' '}
            <button className="btn sm" onClick={() => set('price', Math.ceil(suggested) - 0.01)}>{t('menu.use', { price: money(Math.ceil(suggested) - 0.01) })}</button>
          </div>
        )}
      </div>

      <DeliveryPanel item={m} price={price} cost={cost} onChange={(p) => setM((x) => ({ ...x, ...p }))} />
    </Modal>
  );
}

/** In the dish editor: packaging, the delivery-app price (recommended vs confirmed) and profit in-store vs delivery. */
function DeliveryPanel({ item, price, cost, onChange }: { item: MenuItem; price: number; cost: number; onChange: (p: Partial<MenuItem>) => void }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const d = deliveryOf(state.settings);
  const dp = priceDish(price, cost, item, d);
  const del = dp.delivery ?? dp.atRecommended;
  const rows: [string, (c: typeof del) => string][] = [
    [t('menu.delivery.row.price'), (c) => money(c.price)],
    [t('menu.delivery.row.food'), (c) => `−${money(c.foodCost)}`],
    [t('menu.delivery.row.packaging'), (c) => (c.packaging ? `−${money(c.packaging)}` : '—')],
    [t('menu.delivery.row.app', { gp: d.gpPct, vat: d.vatPct }), (c) => (c.appFee ? `−${money(c.appFee)}` : '—')],
  ];
  return (
    <div className="delivery-panel">
      <h3>🛵 {t('menu.delivery.panelTitle')}</h3>
      <div className="form-grid">
        <Field label={t('menu.delivery.packagingDish')} hint={t('menu.delivery.packagingDishHint', { amount: money(d.packaging) })}>
          <NumInput value={item.packagingCost ?? 0} placeholder={money(d.packaging)} onChange={(n) => onChange({ packagingCost: n > 0 ? n : undefined })} />
        </Field>
        <Field label={t('menu.delivery.col.price')} hint={t('menu.delivery.priceHint', { price: money(dp.recommended) })}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <NumInput value={item.deliveryPrice ?? 0} placeholder={t('menu.delivery.enter')} onChange={(n) => onChange({ deliveryPrice: n > 0 ? n : undefined })} />
            <button type="button" className="btn sm" disabled={item.deliveryPrice === dp.recommended} onClick={() => onChange({ deliveryPrice: dp.recommended })}>{t('menu.delivery.useRec', { price: money(dp.recommended) })}</button>
          </div>
        </Field>
      </div>
      <div className="compare" role="table" aria-label={t('menu.delivery.compare')}>
        <div className="compare-row compare-head" role="row">
          <span role="columnheader" />
          <span role="columnheader">🍽️ {t('menu.delivery.inStore')}</span>
          <span role="columnheader">🛵 {dp.delivery ? t('menu.delivery.delivery') : t('menu.delivery.deliveryRec')}</span>
        </div>
        {rows.map(([label, f]) => (
          <div key={label} className="compare-row" role="row">
            <span role="rowheader">{label}</span><span role="cell">{f(dp.inStore)}</span><span role="cell">{f(del)}</span>
          </div>
        ))}
        <div className="compare-row compare-total" role="row">
          <span role="rowheader">{t('menu.delivery.row.profit')}</span>
          <span role="cell">{money(dp.inStore.profit)} <small>{pct(dp.inStore.margin)}</small></span>
          <span role="cell" className={del.profit < dp.inStore.profit - 0.005 ? 'worse' : ''}>{money(del.profit)} <small>{pct(del.margin)}</small></span>
        </div>
      </div>
      {dp.delivery && dp.delivery.profit < dp.inStore.profit - 0.005 && (
        <div className="callout warn">{t('menu.delivery.lessProfit', { amount: money(dp.inStore.profit - dp.delivery.profit), price: money(dp.recommended) })}</div>
      )}
      {item.optionGroups?.length ? <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t('menu.delivery.optionsNote')}</p> : null}
    </div>
  );
}

type Rule = 'one' | 'oneOptional' | 'many' | 'manyRequired';
const ruleOf = (g: OptionGroup): Rule => (g.multi ? (g.required ? 'manyRequired' : 'many') : g.required ? 'one' : 'oneOptional');
const fromRule = (r: Rule) => ({ required: r === 'one' || r === 'manyRequired', multi: r === 'many' || r === 'manyRequired' });

/** Edit choice groups (Rice, Meat, Size, Extras…) for a dish. */
function OptionGroupsEditor({ item, onChange }: { item: MenuItem; onChange: (g: OptionGroup[]) => void }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const groups = item.optionGroups ?? [];
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const target = state.settings.targetFoodCost;

  const opt = (name: string, price = 0, scale = 1): MenuOption => ({ id: uid(), name, price, scale, recipe: [] });
  const setGroup = (gid: string, fn: (g: OptionGroup) => OptionGroup) => onChange(groups.map((g) => (g.id === gid ? fn(g) : g)));
  const setOption = (gid: string, oid: string, p: Partial<MenuOption>) =>
    setGroup(gid, (g) => ({ ...g, options: g.options.map((o) => (o.id === oid ? { ...o, ...p } : o)) }));
  const addGroup = (g: Omit<OptionGroup, 'id'>) => onChange([...groups, { id: uid(), ...g }]);

  // Cost and price of the dish if this choice replaced the default in its group
  const withChoice = (g: OptionGroup, o: MenuOption) => {
    const choices = { ...defaultChoices(item), [g.id]: [o.id] };
    const dish = resolveDish(item, choices);
    const cost = recipeCost(state, dish.recipe);
    return { cost, fc: dish.price ? cost / dish.price : 0 };
  };

  return (
    <div className="options-editor">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <div>
          <h3>{t('menu.optionsTitle')}</h3>
          <p>{t('menu.optionsHint')}</p>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.id} className="option-group-card">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="grow" value={g.name} placeholder={t('menu.groupNamePlaceholder')} onChange={(e) => setGroup(g.id, (x) => ({ ...x, name: e.target.value }))} />
            <select style={{ width: 'auto' }} value={ruleOf(g)} onChange={(e) => setGroup(g.id, (x) => ({ ...x, ...fromRule(e.target.value as Rule) }))}>
              {(['one', 'oneOptional', 'many', 'manyRequired'] as Rule[]).map((r) => <option key={r} value={r}>{t(`menu.rule.${r}`)}</option>)}
            </select>
            <button className="icon-btn" aria-label={t('menu.removeGroup')} title={t('menu.removeGroup')} onClick={() => onChange(groups.filter((x) => x.id !== g.id))}>✕</button>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('menu.col.choice')}</th><th style={{ width: 120 }}>{t('menu.col.priceChange')}</th><th style={{ width: 110 }}>{t('menu.col.portion')}</th>
                  <th>{t('menu.col.ingredients')}</th><th className="num">{t('menu.col.costWhenChosen')}</th><th />
                </tr>
              </thead>
              <tbody>
                {g.options.map((o) => {
                  const r = withChoice(g, o);
                  return (
                    <Fragment key={o.id}>
                      <tr>
                        <td><input value={o.name} placeholder={t('menu.choicePlaceholder')} onChange={(e) => setOption(g.id, o.id, { name: e.target.value })} /></td>
                        <td><NumInput value={o.price} onChange={(price) => setOption(g.id, o.id, { price })} /></td>
                        <td><div className="input-unit"><NumInput value={Math.round(o.scale * 100)} onChange={(n) => setOption(g.id, o.id, { scale: Math.max(0.05, n / 100) })} /><span>%</span></div></td>
                        <td>
                          <button className="btn sm ghost" onClick={() => setOpenRecipe(openRecipe === o.id ? null : o.id)}>
                            {o.recipe.length === 1 ? t('menu.ingredientsOne') : o.recipe.length ? t('menu.ingredientsCount', { n: o.recipe.length }) : t('menu.addIngredients')} {openRecipe === o.id ? '▴' : '▾'}
                          </button>
                        </td>
                        <td className="num nowrap">{money(r.cost)} <Pill tone={foodCostTone(r.fc, target)}>{pct(r.fc)}</Pill></td>
                        <td className="actions">
                          <button className="icon-btn" aria-label={t('common.remove')} onClick={() => setGroup(g.id, (x) => ({ ...x, options: x.options.filter((y) => y.id !== o.id) }))}>✕</button>
                        </td>
                      </tr>
                      {openRecipe === o.id && (
                        <tr>
                          <td colSpan={6} className="option-recipe">
                            <RecipeEditor lines={o.recipe} onChange={(recipe) => setOption(g.id, o.id, { recipe })} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setGroup(g.id, (x) => ({ ...x, options: [...x.options, opt('')] }))}>{t('menu.addChoice')}</button>
        </div>
      ))}

      <div className="row">
        <button className="btn sm" onClick={() => addGroup({ name: '', required: true, multi: false, options: [opt(''), opt('')] })}>{t('menu.addGroup')}</button>
        <button className="btn sm ghost" onClick={() => addGroup({ name: t('menu.sizeGroup'), required: true, multi: false, options: [opt(t('menu.sizeNormal')), opt(t('menu.sizeSpecial'), 2, 1.5)] })}>{t('menu.addSizeNS')}</button>
        <button className="btn sm ghost" onClick={() => addGroup({ name: t('menu.sizeGroup'), required: true, multi: false, options: [opt(t('menu.sizeSmall'), -1, 0.75), opt(t('menu.sizeMedium')), opt(t('menu.sizeLarge'), 1.5, 1.35)] })}>{t('menu.addSizeSML')}</button>
      </div>
    </div>
  );
}
