import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export interface Column<T> {
  id: string;
  label: string;
  /** Starting width in px */
  width: number;
  min?: number;
  /** Right-aligned numbers */
  num?: boolean;
  /** Pinned in place and always shown (e.g. the dish name, the Edit button) */
  fixed?: 'start' | 'end';
  className?: string;
  render: (row: T) => ReactNode;
  /** Value to sort by when the header is clicked; null/undefined always go last */
  sort?: (row: T) => string | number | null | undefined;
}

interface Sort { id: string; dir: 1 | -1 }
interface Layout { order: string[]; widths: Record<string, number>; hidden: string[]; compact: boolean; sort?: Sort }

const load = (key: string): Partial<Layout> => {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Layout>; } catch { return {}; }
};

/**
 * A table the owner can arrange: drag a header to move the column, drag its right edge to resize
 * (double-click to reset), hide columns, and choose compact or comfortable rows. The arrangement is
 * remembered on this device under `storageKey`. On phones it shows as cards like every other table.
 */
export default function ColumnTable<T>({ storageKey, columns: baseColumns, rows, rowKey, onRowClick, className = '', selected, onSelectedChange }: {
  storageKey: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  className?: string;
  /** Row checkboxes for bulk actions (ids from rowKey) */
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
}) {
  const { t } = useI18n();
  const selectable = !!selected && !!onSelectedChange;
  const allOn = selectable && rows.length > 0 && rows.every((r) => selected!.has(rowKey(r)));
  const someOn = selectable && rows.some((r) => selected!.has(rowKey(r)));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const r of rows) { if (allOn) next.delete(rowKey(r)); else next.add(rowKey(r)); }
    onSelectedChange!(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedChange!(next);
  };
  const selectCol: Column<T>[] = selectable ? [{
    id: '__select', label: '', width: 40, min: 40, fixed: 'start', className: 'select-col',
    render: (row) => (
      <span className="select-cell" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected!.has(rowKey(row))} onChange={() => toggleOne(rowKey(row))} aria-label={t('common.columns.selectRow')} />
      </span>
    ),
  }] : [];
  const columns = [...selectCol, ...baseColumns];
  const [layout, setLayoutState] = useState<Layout>(() => {
    const saved = load(storageKey);
    return { order: saved.order ?? [], widths: saved.widths ?? {}, hidden: saved.hidden ?? [], compact: saved.compact ?? true, sort: saved.sort };
  });
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Saved order first, then any new columns where they're defined; pinned ones stay at the ends
  const movable = columns.filter((c) => !c.fixed);
  const ordered = [
    ...columns.filter((c) => c.fixed === 'start'),
    ...[...layout.order.map((id) => movable.find((c) => c.id === id)).filter((c): c is Column<T> => !!c), ...movable.filter((c) => !layout.order.includes(c.id))],
    ...columns.filter((c) => c.fixed === 'end'),
  ];
  // Click a header: ascending, then descending, then back to the page's own order
  const sortCol = layout.sort && columns.find((c) => c.id === layout.sort!.id && c.sort);
  const sortedRows = sortCol ? rows.map((row, i) => ({ row, i, v: sortCol.sort!(row) })).sort((a, b) => {
    const an = a.v === null || a.v === undefined || a.v === '';
    const bn = b.v === null || b.v === undefined || b.v === '';
    if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
    const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true, sensitivity: 'base' });
    return c * layout.sort!.dir || a.i - b.i;
  }).map((x) => x.row) : rows;
  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    const cur = layoutRef.current.sort;
    const sort: Sort | undefined = cur?.id !== c.id ? { id: c.id, dir: 1 } : cur.dir === 1 ? { id: c.id, dir: -1 } : undefined;
    setLayout({ ...layoutRef.current, sort });
  };
  const visible = ordered.filter((c) => c.fixed || !layout.hidden.includes(c.id));
  const widthOf = (c: Column<T>) => Math.max(c.min ?? 50, layout.widths[c.id] ?? c.width);
  const total = visible.reduce((a, c) => a + widthOf(c), 0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const headRef = useRef<HTMLTableRowElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  // Resize from the header's right edge
  const startResize = (e: React.PointerEvent, c: Column<T>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(c);
    const onMove = (ev: PointerEvent) => {
      const w = Math.round(Math.max(c.min ?? 50, startW + ev.clientX - startX));
      setLayout({ ...layoutRef.current, widths: { ...layoutRef.current.widths, [c.id]: w } });
    };
    const stop = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
  };
  const resetWidth = (c: Column<T>) => {
    const widths = { ...layoutRef.current.widths };
    delete widths[c.id];
    setLayout({ ...layoutRef.current, widths });
  };

  // Move a column by dragging its header sideways
  const startMove = (e: React.PointerEvent, c: Column<T>) => {
    if (e.button !== 0) return;
    const th = e.currentTarget;
    const startX = e.clientX;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      if (c.fixed) return;
      if (!dragging && Math.abs(ev.clientX - startX) < 6) return;
      dragging = true;
      setMoving(c.id);
      const ths = [...(headRef.current?.querySelectorAll<HTMLElement>('th[data-col]') ?? [])];
      const over = ths.find((th) => { const r = th.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX < r.right; });
      const target = over?.dataset.col;
      if (!target || target === c.id) return;
      const ids = ordered.filter((x) => !x.fixed).map((x) => x.id);
      const current = [...layoutRef.current.order.filter((id) => ids.includes(id)), ...ids.filter((id) => !layoutRef.current.order.includes(id))];
      if (!current.includes(target)) return;
      const next = current.filter((id) => id !== c.id);
      next.splice(current.indexOf(target), 0, c.id);
      setLayout({ ...layoutRef.current, order: next });
    };
    const stop = (ev: PointerEvent) => {
      if (!dragging && (ev.target as HTMLElement | null)?.closest?.('th') === th) toggleSort(c);
      setMoving(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
  };
  const nudge = (c: Column<T>, dir: -1 | 1) => {
    const ids = ordered.filter((x) => !x.fixed).map((x) => x.id);
    const i = ids.indexOf(c.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setLayout({ ...layoutRef.current, order: ids });
  };

  const toggleHidden = (id: string) => {
    const hidden = layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id];
    setLayout({ ...layout, hidden });
  };

  return (
    <div className="column-table">
      <div className="column-table-tools">
        {/* Phones show rows as cards with no header, so sorting is a menu here */}
        {columns.some((c) => c.sort) && (
          <select
            className="sort-select"
            value={layout.sort ? `${layout.sort.id}:${layout.sort.dir}` : ''}
            onChange={(e) => { const [id, dir] = e.target.value.split(':'); setLayout({ ...layout, sort: id ? { id, dir: Number(dir) as 1 | -1 } : undefined }); }}
            aria-label={t('common.columns.sortBy')}
          >
            <option value="">{t('common.columns.sortDefault')}</option>
            {ordered.filter((c) => c.sort && c.label).flatMap((c) => [
              <option key={`${c.id}:1`} value={`${c.id}:1`}>{c.label} ↑</option>,
              <option key={`${c.id}:-1`} value={`${c.id}:-1`}>{c.label} ↓</option>,
            ])}
          </select>
        )}
        {/* Phones show rows as cards with no header, so select-all lives here */}
        {selectable && rows.length > 0 && (
          <button className="btn sm select-all-btn" onClick={toggleAll}>{allOn ? t('common.columns.selectNone') : t('common.columns.selectAll')}</button>
        )}
        <div className="col-menu" ref={menuRef}>
          <button className="btn sm" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>⚙ {t('common.columns.button')}</button>
          {menuOpen && (
            <div className="col-menu-pop" role="dialog" aria-label={t('common.columns.button')}>
              <strong>{t('common.columns.show')}</strong>
              {ordered.filter((c) => !c.fixed).map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" checked={!layout.hidden.includes(c.id)} onChange={() => toggleHidden(c.id)} /> {c.label}
                </label>
              ))}
              <strong style={{ marginTop: 6 }}>{t('common.columns.rows')}</strong>
              <div className="seg">
                <button className={layout.compact ? 'active' : ''} onClick={() => setLayout({ ...layout, compact: true })}>{t('common.columns.compact')}</button>
                <button className={!layout.compact ? 'active' : ''} onClick={() => setLayout({ ...layout, compact: false })}>{t('common.columns.comfortable')}</button>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>{t('common.columns.hint')}</p>
              <button className="btn sm ghost" onClick={() => setLayout({ order: [], widths: {}, hidden: [], compact: true })}>{t('common.columns.reset')}</button>
            </div>
          )}
        </div>
      </div>
      <div className="table-wrap">
        <table className={`table custom-cols ${layout.compact ? 'tight' : ''} ${className}`} style={{ width: total, minWidth: '100%' }}>
          <colgroup>{visible.map((c) => <col key={c.id} style={{ width: widthOf(c) }} />)}</colgroup>
          <thead>
            <tr ref={headRef}>
              {visible.map((c) => (
                <th
                  key={c.id}
                  data-col={c.fixed ? undefined : c.id}
                  className={`${c.num ? 'num' : ''} ${c.fixed ? '' : 'movable'} ${c.sort ? 'sortable' : ''} ${moving === c.id ? 'moving' : ''} ${c.className ?? ''}`}
                  aria-sort={layout.sort?.id === c.id ? (layout.sort.dir === 1 ? 'ascending' : 'descending') : c.sort ? 'none' : undefined}
                  onPointerDown={(e) => startMove(e, c)}
                  tabIndex={c.fixed && !c.sort ? undefined : 0}
                  title={c.fixed ? (c.sort ? t('common.columns.sortHint') : undefined) : t(c.sort ? 'common.columns.dragSortHint' : 'common.columns.dragHint')}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && c.sort) { e.preventDefault(); toggleSort(c); return; }
                    if (c.fixed || !e.altKey) return;
                    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(c, -1); }
                    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(c, 1); }
                  }}
                >
                  {c.id === '__select'
                    ? <input type="checkbox" checked={allOn} ref={(el) => { if (el) el.indeterminate = someOn && !allOn; }} onChange={toggleAll} onPointerDown={(e) => e.stopPropagation()} aria-label={t('common.columns.selectAll')} />
                    : <span className="th-label">{c.label}{layout.sort?.id === c.id && <span className="sort-arrow" aria-hidden>{layout.sort.dir === 1 ? '▲' : '▼'}</span>}</span>}
                  {c.label && (
                    <span
                      className="col-resize"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t('common.columns.resize', { name: c.label })}
                      onPointerDown={(e) => startResize(e, c)}
                      onDoubleClick={(e) => { e.stopPropagation(); resetWidth(c); }}
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={rowKey(row)} className={`${onRowClick ? 'clickable' : ''} ${selectable && selected!.has(rowKey(row)) ? 'selected' : ''}`} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {visible.map((c) => <td key={c.id} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
