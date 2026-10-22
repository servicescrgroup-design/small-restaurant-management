import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store';
import { onHand, receiveStock, recipeCost, unitCost } from '../inventory';
import type { InvItem, RecipeLine } from '../types';
import { useI18n } from '../i18n';
import { localDate, fmtQty, uid } from '../utils';
import { Field, Modal, NumInput, Thumb } from './ui';

const UNITS = ['lb', 'oz', 'kg', 'g', 'each', 'slice', 'L', 'ml', 'bunch', 'can', 'bag', 'pack', 'serving', 'portion', 'bowl'];

/**
 * Searchable ingredient picker. Shows a button with the current choice; opens a floating panel with a
 * search box, unit, cost and stock for each ingredient, keyboard navigation, and "create new".
 * With no `value` it acts as an "+ Add ingredient" button.
 */
export function IngredientPicker({ value, onPick, excludeId, addLabel }: { value?: string; onPick: (itemId: string) => void; excludeId?: string; addLabel?: string }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = state.items.find((i) => i.id === value);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return state.items
      .filter((i) => i.id !== excludeId && (!needle || i.name.toLowerCase().includes(needle) || i.category.toLowerCase().includes(needle)))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'raw' ? -1 : 1)
        || Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle))
        || a.name.localeCompare(b.name));
  }, [state.items, q, excludeId]);
  const showCreate = !!q.trim() && !results.some((i) => i.name.toLowerCase() === q.trim().toLowerCase());
  const total = results.length + (showCreate ? 1 : 0) + (q.trim() ? 0 : 1);

  // Float the panel next to the button (fixed, so modals that scroll don't clip it)
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const width = Math.min(Math.max(r.width, 340), window.innerWidth - 16);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setPos(below >= 260 || below >= above
      ? { left, top: r.bottom + 6, width, maxH: Math.min(420, below) }
      : { left, bottom: window.innerHeight - r.top + 6, width, maxH: Math.min(420, above) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onMove = () => place();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [open]);

  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { panelRef.current?.querySelector('.ip-row.hi')?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  const choose = (id: string) => { onPick(id); setOpen(false); setQ(''); };
  const startCreate = () => { setCreating(q.trim()); setOpen(false); };
  const activate = (i: number) => {
    if (i < results.length) choose(results[i].id);
    else startCreate();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(total - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (total) activate(hi); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  const mark = (name: string) => {
    const needle = q.trim();
    const i = needle ? name.toLowerCase().indexOf(needle.toLowerCase()) : -1;
    if (i < 0) return name;
    return <>{name.slice(0, i)}<mark>{name.slice(i, i + needle.length)}</mark>{name.slice(i + needle.length)}</>;
  };

  let lastKind: InvItem['kind'] | null = null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={value ? 'ip-button' : 'btn ghost sm'}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {value ? (
          <>
            <span className="ip-name">{current?.name ?? t('common.picker.missing')}</span>
            {current?.kind === 'prep' && <span className="ip-tag">{t('common.picker.prep')}</span>}
            <span className="ip-caret" aria-hidden>▾</span>
          </>
        ) : (addLabel ?? t('common.recipe.add'))}
      </button>

      {open && pos && createPortal(
        <div ref={panelRef} className="ip-panel" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxH }} role="dialog">
          <div className="ip-search">
            <span aria-hidden>🔍</span>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('common.picker.search')} aria-label={t('common.picker.search')} />
          </div>
          <div className="ip-list" role="listbox">
            {results.length === 0 && q.trim() && <div className="ip-empty">{t('common.picker.none', { q: q.trim() })}</div>}
            {results.map((i, idx) => {
              const header = i.kind !== lastKind ? (lastKind = i.kind, <div key={`h-${i.kind}`} className="ip-group">{i.kind === 'raw' ? t('common.recipe.groupIngredients') : t('common.recipe.groupPrep')}</div>) : null;
              const stock = onHand(state, i.id);
              return (
                <div key={i.id}>
                  {header}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i.id === value}
                    className={`ip-row ${idx === hi ? 'hi' : ''} ${i.id === value ? 'sel' : ''}`}
                    onMouseEnter={() => setHi(idx)}
                    onClick={() => choose(i.id)}
                  >
                    <Thumb src={i.image} name={i.name} size="xs" />
                    <span className="ip-row-main">
                      <span className="ip-row-name">{mark(i.name)}</span>
                      <span className="ip-row-sub">{i.category} · {t('common.picker.onHand', { qty: `${fmtQty(Math.round(stock * 100) / 100)} ${i.unit}` })}</span>
                    </span>
                    <span className="ip-row-cost">{money(unitCost(state, i.id))}<small>/{i.unit}</small></span>
                    {i.id === value && <span className="ip-check" aria-hidden>✓</span>}
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" className={`ip-create ${hi === results.length ? 'hi' : ''}`} onMouseEnter={() => setHi(results.length)} onClick={startCreate}>
            {q.trim() && showCreate ? t('common.picker.create', { q: q.trim() }) : t('common.picker.createNew')}
          </button>
        </div>,
        document.body,
      )}

      {creating !== null && (
        <QuickAddIngredient initialName={creating} onClose={() => setCreating(null)} onCreated={(id) => { setCreating(null); onPick(id); }} />
      )}
    </>
  );
}

/** Small "new ingredient" pop-up so a recipe can be finished without leaving the page. */
export function QuickAddIngredient({ initialName, onClose, onCreated }: { initialName: string; onClose: () => void; onCreated: (id: string) => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState('kg');
  const [cost, setCost] = useState(0);
  const [category, setCategory] = useState(s.inventoryCategories[0] ?? '');
  const [location, setLocation] = useState(s.storageLocations[0] ?? '');
  const [shelfLife, setShelfLife] = useState(7);
  const [stock, setStock] = useState(0);
  const taken = state.items.some((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ok = name.trim() && unit.trim() && !taken;

  const save = () => {
    const id = uid();
    update((d) => {
      d.items.push({ id, name: name.trim(), kind: 'raw', unit: unit.trim(), category, location, parLevel: 0, shelfLifeDays: shelfLife, defaultCost: cost });
      if (stock > 0) receiveStock(d, { itemId: id, qty: stock, unitCost: cost, receivedAt: localDate() });
    });
    onCreated(id);
  };

  return (
    <Modal
      title={t('common.quick.title')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!ok} onClick={save}>{t('common.quick.add')}</button></>}
    >
      <p className="muted" style={{ margin: 0 }}>{t('common.quick.intro')}</p>
      <div className="form-grid">
        <Field label={t('common.quick.name')} className="span-all"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('common.quick.unit')} hint={t('common.quick.unitHint')}>
          <input list="quick-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <datalist id="quick-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        </Field>
        <Field label={t('common.quick.cost', { unit: unit || '—' })}><NumInput value={cost} onChange={setCost} /></Field>
        <Field label={t('common.quick.category')}>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>{s.inventoryCategories.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label={t('common.quick.location')}>
          <select value={location} onChange={(e) => setLocation(e.target.value)}>{s.storageLocations.map((c) => <option key={c}>{c}</option>)}</select>
        </Field>
        <Field label={t('common.quick.shelfLife')}><NumInput value={shelfLife} onChange={(n) => setShelfLife(Math.max(0, Math.round(n)))} /></Field>
        <Field label={t('common.quick.onHand')} hint={stock > 0 ? t('common.quick.onHandHint', { total: money(stock * cost) }) : undefined}>
          <div className="input-unit"><NumInput value={stock} onChange={setStock} /><span>{unit}</span></div>
        </Field>
      </div>
      {taken && <div className="callout warn">{t('common.quick.nameTaken')}</div>}
    </Modal>
  );
}

/** Ingredient list editor used by menu items, choices, prep recipes. */
export function RecipeEditor({ lines, onChange, excludeId }: { lines: RecipeLine[]; onChange: (l: RecipeLine[]) => void; excludeId?: string }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const set = (i: number, patch: Partial<RecipeLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="recipe-editor">
      {lines.length > 0 && (
        <table className="table compact">
          <thead>
            <tr><th>{t('common.recipe.ingredient')}</th><th style={{ width: 130 }}>{t('common.recipe.qty')}</th><th className="num">{t('common.recipe.unitCost')}</th><th className="num">{t('common.recipe.lineCost')}</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const it = state.items.find((x) => x.id === l.itemId);
              const uc = unitCost(state, l.itemId);
              return (
                <tr key={i}>
                  <td style={{ minWidth: 200 }}><IngredientPicker value={l.itemId} excludeId={excludeId} onPick={(itemId) => set(i, { itemId })} /></td>
                  <td>
                    <div className="input-unit">
                      <NumInput value={l.qty} onChange={(qty) => set(i, { qty })} />
                      <span>{it?.unit}</span>
                    </div>
                  </td>
                  <td className="num muted">{money(uc)}/{it?.unit}</td>
                  <td className="num">{money(uc * l.qty)}</td>
                  <td><button className="icon-btn" aria-label={t('common.remove')} onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>{t('common.recipe.total')}</td><td className="num"><strong>{money(recipeCost(state, lines))}</strong></td><td /></tr>
          </tfoot>
        </table>
      )}
      <IngredientPicker excludeId={excludeId} onPick={(itemId) => onChange([...lines, { itemId, qty: 1 }])} />
    </div>
  );
}
