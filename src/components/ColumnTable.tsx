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
}

interface Layout { order: string[]; widths: Record<string, number>; hidden: string[]; compact: boolean }

const load = (key: string): Partial<Layout> => {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Layout>; } catch { return {}; }
};

/**
 * A table the owner can arrange: drag a header to move the column, drag its right edge to resize
 * (double-click to reset), hide columns, and choose compact or comfortable rows. The arrangement is
 * remembered on this device under `storageKey`. On phones it shows as cards like every other table.
 */
export default function ColumnTable<T>({ storageKey, columns, rows, rowKey, onRowClick, className = '' }: {
  storageKey: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [layout, setLayoutState] = useState<Layout>(() => {
    const saved = load(storageKey);
    return { order: saved.order ?? [], widths: saved.widths ?? {}, hidden: saved.hidden ?? [], compact: saved.compact ?? true };
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
    if (c.fixed || e.button !== 0) return;
    const startX = e.clientX;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
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
    const stop = () => {
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
                  className={`${c.num ? 'num' : ''} ${c.fixed ? '' : 'movable'} ${moving === c.id ? 'moving' : ''} ${c.className ?? ''}`}
                  onPointerDown={(e) => startMove(e, c)}
                  tabIndex={c.fixed ? undefined : 0}
                  title={c.fixed ? undefined : t('common.columns.dragHint')}
                  onKeyDown={(e) => {
                    if (c.fixed || !e.altKey) return;
                    if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(c, -1); }
                    if (e.key === 'ArrowRight') { e.preventDefault(); nudge(c, 1); }
                  }}
                >
                  <span className="th-label">{c.label}</span>
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
            {rows.map((row) => (
              <tr key={rowKey(row)} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {visible.map((c) => <td key={c.id} className={`${c.num ? 'num' : ''} ${c.className ?? ''}`}>{c.render(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
