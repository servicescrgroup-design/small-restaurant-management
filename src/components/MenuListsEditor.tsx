import { useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { tabOf } from '../inventory';
import { uid } from '../utils';
import { Modal } from './ui';
import Select from './Select';

interface Cat {
  key: string;
  name: string;
  /** Name before editing (null for one added here) */
  original: string | null;
  /** Dishes in this category */
  count: number;
}

interface Section {
  key: string;
  name: string;
  original: string | null;
  cats: Cat[];
}

type Drag = { kind: 'cat' | 'tab'; key: string } | null;

/**
 * Edit the menu as tabs holding categories: drag a category within its tab to reorder it or into
 * another tab to move it (its dishes follow), drag tab headers to reorder tabs, rename anything in
 * place, add, and delete what's empty. Nothing changes until Save.
 */
export default function MenuListsEditor({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const s = state.settings;

  const [sections, setSectionsState] = useState<Section[]>(() => {
    const tabs = s.menuTabs.length ? s.menuTabs : [t('menu.lists.defaultTab')];
    const catNames = [...new Set([...s.menuCategories, ...state.menu.map((m) => m.category).filter(Boolean)])];
    const home = (c: string) => {
      const saved = s.categoryTabs?.[c];
      if (saved && tabs.includes(saved)) return saved;
      // Otherwise the tab most of its dishes are in
      const votes = new Map<string, number>();
      for (const m of state.menu) if (m.category === c) { const tb = tabOf(m, tabs); votes.set(tb, (votes.get(tb) ?? 0) + 1); }
      return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? tabs[0];
    };
    return tabs.map((name) => ({
      key: uid(),
      name,
      original: s.menuTabs.length ? name : null,
      cats: catNames.filter((c) => home(c) === name).map((c) => ({ key: uid(), name: c, original: c, count: state.menu.filter((m) => m.category === c).length })),
    }));
  });
  const sectionsRef = useRef(sections);
  const setSections = (next: Section[]) => { sectionsRef.current = next; setSectionsState(next); };

  const [drag, setDrag] = useState<Drag>(null);
  const [overSection, setOverSection] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const allCats = sections.flatMap((x) => x.cats);
  const problem = (() => {
    const tabNames = sections.map((x) => x.name.trim().toLowerCase());
    const catNames = allCats.map((c) => c.name.trim().toLowerCase());
    if ([...tabNames, ...catNames].some((n) => !n)) return t('menu.lists.errEmpty');
    if (new Set(tabNames).size !== tabNames.length || new Set(catNames).size !== catNames.length) return t('menu.lists.errDuplicate');
    return '';
  })();

  const patchSection = (key: string, p: Partial<Section>) => setSections(sectionsRef.current.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const patchCat = (key: string, p: Partial<Cat>) =>
    setSections(sectionsRef.current.map((x) => ({ ...x, cats: x.cats.map((c) => (c.key === key ? { ...c, ...p } : c)) })));

  /** Put a category at position `index` of a tab (removing it from wherever it was). */
  const placeCat = (catKey: string, sectionKey: string, index: number) => {
    const cur = sectionsRef.current;
    const fromSec = cur.find((x) => x.cats.some((c) => c.key === catKey));
    if (!fromSec) return;
    const fromIdx = fromSec.cats.findIndex((c) => c.key === catKey);
    if (fromSec.key === sectionKey && (index === fromIdx || index === fromIdx + 1)) return;
    const cat = fromSec.cats[fromIdx];
    let next = cur.map((x) => (x.key === fromSec.key ? { ...x, cats: x.cats.filter((c) => c.key !== catKey) } : x));
    const adjusted = fromSec.key === sectionKey && index > fromIdx ? index - 1 : index;
    next = next.map((x) => (x.key === sectionKey ? { ...x, cats: [...x.cats.slice(0, adjusted), cat, ...x.cats.slice(adjusted)] } : x));
    setSections(next);
  };
  const moveTab = (key: string, to: number) => {
    const cur = sectionsRef.current;
    const from = cur.findIndex((x) => x.key === key);
    if (from < 0 || to < 0 || to >= cur.length || from === to) return;
    const next = [...cur];
    const [sec] = next.splice(from, 1);
    next.splice(to, 0, sec);
    setSections(next);
  };

  // Pointer dragging (mouse, pen or finger), followed on the window because rows move in the page
  const startDrag = (e: React.PointerEvent, d: NonNullable<Drag>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDrag(d);
    const scroller = boardRef.current?.closest<HTMLElement>('.modal-body');
    const onMove = (ev: PointerEvent) => {
      const board = boardRef.current;
      if (!board) return;
      // Scroll the list when dragging near its top or bottom edge
      if (scroller) {
        const b = scroller.getBoundingClientRect();
        if (ev.clientY < b.top + 48) scroller.scrollTop -= 14;
        else if (ev.clientY > b.bottom - 48) scroller.scrollTop += 14;
      }
      const secEls = [...board.querySelectorAll<HTMLElement>('[data-section]')];
      if (d.kind === 'tab') {
        // Tabs sit side by side: the dragged tab takes the place of the tab under the pointer
        const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-section]');
        const to = over ? sectionsRef.current.findIndex((x) => x.key === over.dataset.section) : -1;
        if (to >= 0) moveTab(d.key, to);
        return;
      }
      // Which tab is under the pointer (or the nearest one)
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-section]');
      const secEl = hit ?? secEls.reduce<HTMLElement | null>((best, el) => {
        const r = el.getBoundingClientRect();
        const dist = Math.hypot(Math.max(r.left - ev.clientX, 0, ev.clientX - r.right), Math.max(r.top - ev.clientY, 0, ev.clientY - r.bottom));
        const bd = best ? (() => { const q = best.getBoundingClientRect(); return Math.hypot(Math.max(q.left - ev.clientX, 0, ev.clientX - q.right), Math.max(q.top - ev.clientY, 0, ev.clientY - q.bottom)); })() : Infinity;
        return dist < bd ? el : best;
      }, null);
      if (!secEl) return;
      const sectionKey = secEl.dataset.section!;
      setOverSection(sectionKey);
      const rows = [...secEl.querySelectorAll<HTMLElement>('[data-cat]')];
      let index = rows.findIndex((el) => { const r = el.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (index === -1) index = rows.length;
      placeCat(d.key, sectionKey, index);
    };
    const stop = () => {
      setDrag(null);
      setOverSection(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const keyMoveCat = (e: React.KeyboardEvent, sec: Section, i: number) => {
    const cur = sectionsRef.current;
    const si = cur.findIndex((x) => x.key === sec.key);
    const cat = sec.cats[i];
    if (e.key === 'ArrowUp') { e.preventDefault(); if (i > 0) placeCat(cat.key, sec.key, i - 1); else if (si > 0) placeCat(cat.key, cur[si - 1].key, cur[si - 1].cats.length); }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (i < sec.cats.length - 1) placeCat(cat.key, sec.key, i + 2); else if (si < cur.length - 1) placeCat(cat.key, cur[si + 1].key, 0); }
  };

  const save = () => {
    if (problem) return;
    const final = sectionsRef.current;
    const tabRename = new Map(final.filter((x) => x.original !== null).map((x) => [x.original!, x.name.trim()]));
    const catRename = new Map<string, string>();
    const catHome = new Map<string, string>();
    for (const sec of final) for (const c of sec.cats) {
      if (c.original !== null) catRename.set(c.original, c.name.trim());
      catHome.set(c.original ?? c.name.trim(), sec.name.trim());
    }
    update((d) => {
      const oldTabs = d.settings.menuTabs;
      for (const m of d.menu) {
        const orig = m.category;
        if (catRename.has(orig)) m.category = catRename.get(orig)!;
        // Every dish goes to its category's tab (pinned, so it never jumps)
        const home = catHome.get(orig);
        if (home) m.tab = home;
        else { const cur = tabOf(m, oldTabs); if (tabRename.has(cur)) m.tab = tabRename.get(cur); }
      }
      d.settings.menuTabs = final.map((x) => x.name.trim());
      d.settings.menuCategories = final.flatMap((x) => x.cats.map((c) => c.name.trim()));
      d.settings.categoryTabs = Object.fromEntries(final.flatMap((x) => x.cats.map((c) => [c.name.trim(), x.name.trim()])));
    });
    onSaved?.();
    onClose();
  };

  const [newTab, setNewTab] = useState('');
  const addTab = () => {
    const name = newTab.trim();
    if (!name) return;
    setSections([...sectionsRef.current, { key: uid(), name, original: null, cats: [] }]);
    setNewTab('');
  };

  return (
    <Modal
      wide
      title={t('menu.lists.title')}
      onClose={onClose}
      footer={
        <>
          {problem && <span className="callout bad" style={{ margin: '0 auto 0 0', padding: '6px 10px' }}>{problem}</span>}
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={!!problem} onClick={save}>{t('common.save')}</button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>{t('menu.lists.intro')}</p>
      <div className={`tab-board ${drag ? 'is-dragging' : ''}`} ref={boardRef}>
        {sections.map((sec, si) => {
          const dishes = sec.cats.reduce((a, c) => a + c.count, 0);
          return (
            <section
              key={sec.key}
              data-section={sec.key}
              className={`tab-section ${overSection === sec.key && drag?.kind === 'cat' ? 'drop' : ''} ${drag?.kind === 'tab' && drag.key === sec.key ? 'dragging' : ''}`}
            >
              <header className="tab-section-head">
                <button
                  type="button"
                  className="sort-handle light"
                  aria-label={t('menu.lists.dragTab', { name: sec.name })}
                  title={t('menu.lists.drag')}
                  onPointerDown={(e) => startDrag(e, { kind: 'tab', key: sec.key })}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); moveTab(sec.key, si - 1); }
                    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); moveTab(sec.key, si + 1); }
                  }}
                >⋮⋮</button>
                <input value={sec.name} onChange={(e) => patchSection(sec.key, { name: e.target.value })} aria-label={t('menu.lists.tabName')} />
                <span className="tab-section-count">{t('menu.lists.tabCount', {
                  cats: t(sec.cats.length === 1 ? 'menu.lists.catsOne' : 'menu.lists.catsN', { n: sec.cats.length }),
                  n: t(dishes === 1 ? 'menu.lists.dishOne' : 'menu.lists.dishes', { n: dishes }),
                })}</span>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={sec.cats.length > 0 || sections.length === 1}
                  title={sec.cats.length ? t('menu.lists.tabInUse') : t('common.remove')}
                  aria-label={t('common.remove')}
                  onClick={() => setSections(sectionsRef.current.filter((x) => x.key !== sec.key))}
                >✕</button>
              </header>
              {sec.original !== null && sec.name.trim() !== sec.original && <span className="sort-was tab-was">{t('menu.lists.was', { name: sec.original })}</span>}
              <ol className="sort-list cat-list">
                {sec.cats.map((c, i) => (
                  <li key={c.key} data-cat={c.key} className={`sort-row ${drag?.kind === 'cat' && drag.key === c.key ? 'dragging' : ''}`}>
                    <button
                      type="button"
                      className="sort-handle"
                      aria-label={t('menu.lists.dragHint', { name: c.name })}
                      title={t('menu.lists.drag')}
                      onPointerDown={(e) => startDrag(e, { kind: 'cat', key: c.key })}
                      onKeyDown={(e) => keyMoveCat(e, sec, i)}
                    >⋮⋮</button>
                    <input value={c.name} onChange={(e) => patchCat(c.key, { name: e.target.value })} aria-label={t('menu.lists.rename')} />
                    {c.original !== null && c.name.trim() !== c.original && <span className="sort-was" title={c.original}>{t('menu.lists.was', { name: c.original })}</span>}
                    <span className="sort-count">{t(c.count === 1 ? 'menu.lists.dishOne' : 'menu.lists.dishes', { n: c.count })}</span>
                    {sections.length > 1 && (
                      // Quick move without dragging (handy on phones and long lists)
                      <Select
                        className="cat-move"
                        value=""
                        title={t('menu.lists.moveTo')}
                        aria-label={t('menu.lists.moveToName', { name: c.name })}
                        onChange={(e) => { const target = sectionsRef.current.find((x) => x.key === e.target.value); if (target) placeCat(c.key, target.key, target.cats.length); }}
                      >
                        <option value="">⇄</option>
                        {sections.filter((x) => x.key !== sec.key).map((x) => <option key={x.key} value={x.key}>{t('menu.lists.moveToTab', { tab: x.name })}</option>)}
                      </Select>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={c.count > 0}
                      title={c.count > 0 ? t('menu.lists.inUse', { n: c.count }) : t('common.remove')}
                      aria-label={t('common.remove')}
                      onClick={() => setSections(sectionsRef.current.map((x) => ({ ...x, cats: x.cats.filter((y) => y.key !== c.key) })))}
                    >✕</button>
                  </li>
                ))}
                {!sec.cats.length && <li className="cat-drop-hint">{t('menu.lists.dropHere')}</li>}
              </ol>
              <AddRow
                placeholder={t('menu.lists.addCategory')}
                onAdd={(name) => patchSection(sec.key, { cats: [...sectionsRef.current.find((x) => x.key === sec.key)!.cats, { key: uid(), name, original: null, count: 0 }] })}
              />
            </section>
          );
        })}
        <section className="tab-section add-tab">
          <strong>{t('menu.lists.newTab')}</strong>
          <span className="muted" style={{ fontSize: 13 }}>{t('menu.lists.tabsHint')}</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input value={newTab} onChange={(e) => setNewTab(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTab(); } }} placeholder={t('menu.lists.addTab')} />
            <button className="btn" disabled={!newTab.trim()} onClick={addTab}>+ {t('menu.lists.add')}</button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const add = () => { const n = text.trim(); if (!n) return; onAdd(n); setText(''); };
  return (
    <div className="row cat-add" style={{ flexWrap: 'nowrap' }}>
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder={placeholder} />
      <button className="btn sm" disabled={!text.trim()} onClick={add}>+ {t('menu.lists.add')}</button>
    </div>
  );
}
