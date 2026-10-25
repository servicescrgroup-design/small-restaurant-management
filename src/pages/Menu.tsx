import { Fragment, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { defaultChoices, recipeCost, resolveDish, servingsAvailable, tabOf, unitCost } from '../inventory';
import { Empty, Field, ImageField, Modal, NumInput, Pill, Thumb } from '../components/ui';
import { RecipeEditor } from '../components/Recipe';
import { Plate, RecipeCard, paletteOf, type CardLine } from '../components/RecipeCard';
import type { MenuItem, MenuOption, OptionGroup } from '../types';
import { pct, uid } from '../utils';
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

export default function Menu() {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [viewing, setViewing] = useState<MenuItem | null>(null);
  const [view, setViewState] = useState<View>(savedView);
  const setView = (v: View) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const [cat, setCat] = useState('All');
  const [tab, setTab] = useState('All');
  const target = state.settings.targetFoodCost;
  const tabs = state.settings.menuTabs;
  const inTab = state.menu.filter((m) => tab === 'All' || tabOf(m, tabs) === tab);
  const cats = ['All', ...state.settings.menuCategories.filter((c) => tab === 'All' || inTab.some((m) => m.category === c))];
  const list = inTab
    .filter((m) => cat === 'All' || m.category === cat)
    .sort((a, b) => state.settings.menuCategories.indexOf(a.category) - state.settings.menuCategories.indexOf(b.category) || a.name.localeCompare(b.name));

  const blank = (): MenuItem => ({ id: uid(), name: '', tab: tab !== 'All' ? tab : tabs[0], category: cat !== 'All' ? cat : state.settings.menuCategories[0] ?? 'Mains', price: 0, recipe: [], active: true });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('common.nav.menu')}</h1>
          <p>{t('menu.intro', { target })}</p>
        </div>
        <button className="btn primary" onClick={() => setEditing(blank())}>{t('menu.newItem')}</button>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        {tabs.length > 1 && (
          <div className="pill-tabs">
            {['All', ...tabs].map((x) => <button key={x} className={tab === x ? 'active' : ''} onClick={() => { setTab(x); setCat('All'); }}>{x === 'All' ? t('common.all') : x}</button>)}
          </div>
        )}
        <div className="seg">
          {cats.map((c) => <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>{c === 'All' ? t('common.all') : c}</button>)}
        </div>
        <span className="spacer" />
        <div className="seg view-toggle" role="group" aria-label={t('menu.view.label')}>
          <button className={view === 'cards' ? 'active' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>▦ {t('menu.view.cards')}</button>
          <button className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>≡ {t('menu.view.list')}</button>
        </div>
      </div>

      {view === 'cards' && (list.length === 0 ? (
        <div className="card"><Empty title={t('menu.emptyTitle')}>{t('menu.emptyBody')}</Empty></div>
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
                  <h3>{m.name}</h3>
                  <div className="dish-card-meta">
                    <strong>{groups ? t('menu.fromPrice', { price: money(price) }) : money(price)}</strong>
                    {recipe.length > 0 && <span className={`dish-card-fc ${foodCostTone(fc, target)}`}>{t('menu.card.foodCost', { pct: pct(fc) })}</span>}
                  </div>
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
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('menu.col.item')}</th><th>{t('menu.col.tab')}</th><th>{t('menu.col.category')}</th><th className="num">{t('menu.col.price')}</th><th className="num">{t('menu.col.plateCost')}</th>
                  <th className="num">{t('menu.col.foodCost')}</th><th className="num">{t('menu.col.profit')}</th><th className="num">{t('menu.col.canMake')}</th><th>{t('menu.col.status')}</th><th />
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const { cost, price, recipe } = dishDefaults(state, m);
                  const fc = price ? cost / price : 0;
                  const avail = recipe.length ? servingsAvailable(state, recipe) : null;
                  const groups = m.optionGroups?.length ?? 0;
                  return (
                    <tr key={m.id} className="clickable" onClick={() => setEditing(structuredClone(m))}>
                      <td>
                        <div className="cell-thumb">
                          <Thumb src={m.image} name={m.name} size="xs" />
                          <div>
                            <strong>{m.name}</strong>
                            {m.description && <div className="sub">{m.description}</div>}
                            {groups > 0 && <div className="sub">{m.optionGroups!.map((g) => g.name).join(' · ')}</div>}
                          </div>
                        </div>
                      </td>
                      <td>{tabOf(m, tabs)}</td>
                      <td>{m.category}</td>
                      <td className="num">{groups ? t('menu.fromPrice', { price: money(price) }) : money(price)}</td>
                      <td className="num">{money(cost)}</td>
                      <td className="num"><Pill tone={recipe.length ? foodCostTone(fc, target) : 'muted'}>{recipe.length ? pct(fc) : t('menu.noRecipe')}</Pill></td>
                      <td className="num">{money(price - cost)}</td>
                      <td className="num">{avail === null ? <span className="muted">—</span> : avail === 0 ? <Pill tone="bad">{t('menu.soldOut')}</Pill> : avail}</td>
                      <td>{m.active ? <Pill tone="ok">{t('menu.onMenu')}</Pill> : <Pill>{t('menu.hidden')}</Pill>}</td>
                      <td className="actions"><button className="btn sm">{t('common.edit')}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>}

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

/** Full recipe for one dish as a recipe card; the header shrinks as you scroll the ingredients. */
function RecipeSheet({ item, onClose, onEdit }: { item: MenuItem; onClose: () => void; onEdit: () => void }) {
  const { state, money } = useStore();
  const { t } = useI18n();
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
          title={item.name}
          subtitle={[item.category, money(price)].join(' · ')}
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
  const usedHere = new Set(state.menu.filter((x) => x.id !== m.id && tabOf(x, tabs) === tab).map((x) => x.category));
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
        {tabs.length > 0 && (
          <Field label={t('menu.tab')}>
            <select value={tab} onChange={(e) => set('tab', e.target.value)}>{tabs.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
        )}
        <Field label={t('menu.category')}>
          <select value={m.category} onChange={(e) => set('category', e.target.value)}>{cats.map((c) => <option key={c}>{c}</option>)}</select>
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
    </Modal>
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
