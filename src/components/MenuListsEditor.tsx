import { useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { tabOf } from '../inventory';
import { uid } from '../utils';
import { Modal } from './ui';

interface Row {
  key: string;
  name: string;
  /** Name before editing (null for a newly added row) */
  original: string | null;
  /** Dishes using it */
  count: number;
}

/**
 * Edit the menu tabs (Food, Drinks…) and categories: drag to reorder, rename in place (dishes follow),
 * add, and delete ones no dish uses. Nothing changes until Save.
 */
export default function MenuListsEditor({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const s = state.settings;

  const [tabs, setTabs] = useState<Row[]>(() =>
    s.menuTabs.map((name) => ({ key: uid(), name, original: name, count: state.menu.filter((m) => tabOf(m, s.menuTabs) === name).length })));
  const [cats, setCats] = useState<Row[]>(() => {
    // Include categories dishes use that went missing from the list, so they can be tidied up too
    const names = [...s.menuCategories, ...state.menu.map((m) => m.category).filter((c) => c && !s.menuCategories.includes(c))];
    return [...new Set(names)].map((name) => ({ key: uid(), name, original: name, count: state.menu.filter((m) => m.category === name).length }));
  });

  const problem = (rows: Row[]) => {
    const names = rows.map((r) => r.name.trim().toLowerCase());
    if (names.some((n) => !n)) return t('menu.lists.errEmpty');
    if (new Set(names).size !== names.length) return t('menu.lists.errDuplicate');
    return '';
  };
  const tabsProblem = problem(tabs);
  const catsProblem = problem(cats);

  const save = () => {
    if (tabsProblem || catsProblem) return;
    const tabMap = new Map(tabs.filter((r) => r.original !== null).map((r) => [r.original!, r.name.trim()]));
    const catMap = new Map(cats.filter((r) => r.original !== null).map((r) => [r.original!, r.name.trim()]));
    update((d) => {
      const oldTabs = d.settings.menuTabs;
      for (const m of d.menu) {
        // Pin each dish to its (possibly renamed) tab so it never jumps to another tab
        const current = tabOf(m, oldTabs);
        if (current && tabMap.has(current)) m.tab = tabMap.get(current);
        if (catMap.has(m.category)) m.category = catMap.get(m.category)!;
      }
      d.settings.menuTabs = tabs.map((r) => r.name.trim());
      d.settings.menuCategories = cats.map((r) => r.name.trim());
    });
    onSaved?.();
    onClose();
  };

  return (
    <Modal
      wide
      title={t('menu.lists.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!!(tabsProblem || catsProblem)} onClick={save}>{t('common.save')}</button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>{t('menu.lists.intro')}</p>
      <div className="lists-editor">
        <SortableList title={t('menu.lists.tabs')} hint={t('menu.lists.tabsHint')} rows={tabs} onChange={setTabs} problem={tabsProblem} addLabel={t('menu.lists.addTab')} />
        <SortableList title={t('menu.lists.categories')} hint={t('menu.lists.categoriesHint')} rows={cats} onChange={setCats} problem={catsProblem} addLabel={t('menu.lists.addCategory')} />
      </div>
    </Modal>
  );
}

function SortableList({ title, hint, rows, onChange, problem, addLabel }: {
  title: string; hint: string; rows: Row[]; onChange: (r: Row[]) => void; problem: string; addLabel: string;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const move = (from: number, to: number) => {
    const current = rowsRef.current;
    if (from < 0 || to < 0 || to >= current.length || from === to) return;
    const next = [...current];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    rowsRef.current = next; // several moves can arrive before the next render
    onChange(next);
  };

  // Drag by the handle with mouse, pen or finger: the row moves to wherever the pointer is.
  // Movement is followed on the window, because reordering moves the handle in the page.
  const startDrag = (e: React.PointerEvent, key: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragging(key);
    const onMove = (ev: PointerEvent) => {
      if (!listRef.current) return;
      const items = [...listRef.current.querySelectorAll<HTMLElement>(':scope > li')];
      const from = rowsRef.current.findIndex((r) => r.key === key);
      let to = items.findIndex((el) => { const b = el.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      if (to === -1) to = items.length - 1;
      else if (to > from) to -= 1;
      move(from, to);
    };
    const stop = () => {
      setDragging(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const add = () => {
    const name = adding.trim();
    if (!name) return;
    onChange([...rows, { key: uid(), name, original: null, count: 0 }]);
    setAdding('');
  };

  return (
    <section className="lists-col">
      <h3>{title}</h3>
      <p className="muted" style={{ margin: '2px 0 10px', fontSize: 13 }}>{hint}</p>
      <ol className="sort-list" ref={listRef}>
        {rows.map((r, i) => (
          <li key={r.key} className={`sort-row ${dragging === r.key ? 'dragging' : ''}`}>
            <button
              type="button"
              className="sort-handle"
              aria-label={t('menu.lists.dragHint', { name: r.name })}
              title={t('menu.lists.drag')}
              onPointerDown={(e) => startDrag(e, r.key)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
                if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
              }}
            >⋮⋮</button>
            <input
              value={r.name}
              onChange={(e) => onChange(rows.map((x) => (x.key === r.key ? { ...x, name: e.target.value } : x)))}
              aria-label={t('menu.lists.rename')}
            />
            {r.original !== null && r.name.trim() !== r.original && <span className="sort-was" title={r.original}>{t('menu.lists.was', { name: r.original })}</span>}
            <span className="sort-count">{t(r.count === 1 ? 'menu.lists.dishOne' : 'menu.lists.dishes', { n: r.count })}</span>
            <button
              type="button"
              className="icon-btn"
              disabled={r.count > 0}
              title={r.count > 0 ? t('menu.lists.inUse', { n: r.count }) : t('common.remove')}
              aria-label={t('common.remove')}
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
            >✕</button>
          </li>
        ))}
      </ol>
      {problem && <div className="callout bad" style={{ marginTop: 8 }}>{problem}</div>}
      <div className="row" style={{ marginTop: 10, flexWrap: 'nowrap' }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={addLabel} />
        <button className="btn" disabled={!adding.trim()} onClick={add}>+ {t('menu.lists.add')}</button>
      </div>
    </section>
  );
}
