import { useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { Field, NumInput, Pill } from '../components/ui';
import { guessColumns, parsePastedMenu, readSpreadsheet, rowsFromTable, type Column, type ImportRow } from '../importer';
import type { MenuItem } from '../types';
import { uid } from '../utils';

type Source = 'wongnai' | 'foodstory' | 'other';

/** Bring an existing menu (and phone number) in from Wongnai, FoodStory or any spreadsheet/text. */
export default function ImportTab() {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  const [source, setSource] = useState<Source>('wongnai');
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [phone, setPhone] = useState<string | undefined>();
  const [usePhone, setUsePhone] = useState(true);
  const [table, setTable] = useState<string[][] | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [tab, setTab] = useState(s.menuTabs[0] ?? '');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fallbackCat = s.menuCategories[0] ?? t('importer.defaultCategory');

  const reset = () => { setRows(null); setTable(null); setPhone(undefined); setMsg(null); };

  const readText = () => {
    const r = parsePastedMenu(text, fallbackCat);
    setPhone(r.phone);
    setRows(r.rows);
    setMsg(r.rows.length ? null : { tone: 'bad', text: t('importer.nothingFound') });
  };

  const readFile = async (file: File) => {
    try {
      const all = await readSpreadsheet(file);
      if (all.length < 2) throw new Error('empty');
      const cols = guessColumns(all[0]);
      setTable(all);
      setColumns(cols);
      setRows(rowsFromTable(all.slice(1), cols, fallbackCat));
      setMsg(cols.includes('name') && cols.includes('price') ? null : { tone: 'info', text: t('importer.checkColumns') });
    } catch {
      setMsg({ tone: 'bad', text: t('importer.fileError') });
    }
  };

  const remap = (i: number, col: Column) => {
    if (!table) return;
    const next = columns.map((c, j) => (j === i ? col : c === col && col !== 'ignore' ? 'ignore' : c));
    setColumns(next);
    setRows(rowsFromTable(table.slice(1), next, fallbackCat));
  };

  const setRow = (i: number, p: Partial<ImportRow>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const chosen = rows?.filter((r) => r.include && r.name.trim()) ?? [];
  const existing = new Set(state.menu.map((m) => m.name.trim().toLowerCase()));
  const dupes = mode === 'add' ? chosen.filter((r) => existing.has(r.name.trim().toLowerCase())).length : 0;

  const doImport = () => {
    if (!chosen.length) return;
    if (mode === 'replace' && !confirm(t('importer.confirmReplace', { n: state.menu.length }))) return;
    const toAdd = mode === 'add' ? chosen.filter((r) => !existing.has(r.name.trim().toLowerCase())) : chosen;
    const items: MenuItem[] = toAdd.map((r) => {
      const id = uid();
      return {
        id, name: r.name.trim(), tab, category: r.category.trim() || fallbackCat, price: r.price, active: true, recipe: [],
        ...(r.description ? { description: r.description } : {}),
        // A price range becomes a required size choice: normal at the low price, special at the high one
        ...(r.priceHigh && r.priceHigh > r.price ? {
          optionGroups: [{ id: `${id}-size`, name: t('menu.sizeGroup'), required: true, multi: false, options: [
            { id: `${id}-n`, name: t('menu.sizeNormal'), price: 0, scale: 1, recipe: [] },
            { id: `${id}-s`, name: t('menu.sizeSpecial'), price: r.priceHigh - r.price, scale: 1.3, recipe: [] },
          ] }],
        } : {}),
      };
    });
    update((d) => {
      if (mode === 'replace') {
        const old = new Set(d.menu.map((m) => m.id));
        d.menu = [];
        d.tickets = d.tickets.map((tk) => ({ ...tk, lines: tk.lines.filter((l) => !old.has(l.menuItemId)) })).filter((tk) => tk.lines.length);
      }
      d.menu.push(...items);
      const cats = [...new Set(items.map((m) => m.category))].filter((c) => !d.settings.menuCategories.includes(c));
      d.settings.menuCategories = mode === 'replace'
        ? [...new Set(items.map((m) => m.category))]
        : [...d.settings.menuCategories, ...cats];
      if (phone && usePhone) d.settings.phone = phone;
    });
    setMsg({ tone: 'ok', text: t('importer.done', { n: items.length, skipped: dupes }) });
    setRows(null);
    setTable(null);
    setText('');
  };

  const wongnaiUrl = /^https?:\/\/(?:www\.)?wongnai\.com\//i.test(link.trim()) ? link.trim() : 'https://www.wongnai.com/';

  return (
    <div className="grid">
      <div className="card">
        <h2>{t('importer.title')}</h2>
        <p className="muted" style={{ marginTop: 4 }}>{t('importer.intro')}</p>
        <div className="import-sources">
          {(['wongnai', 'foodstory', 'other'] as Source[]).map((src) => (
            <button key={src} className={`import-source ${source === src ? 'active' : ''} ${src}`} onClick={() => { setSource(src); reset(); }}>
              <span className="import-logo" aria-hidden>{src === 'wongnai' ? 'W' : src === 'foodstory' ? 'F' : '⇪'}</span>
              <strong>{t(`importer.src.${src}`)}</strong>
              <span>{t(`importer.src.${src}Hint`)}</span>
            </button>
          ))}
        </div>
      </div>

      {!rows && (
        <div className="card">
          {source === 'wongnai' && (
            <>
              <ol className="import-steps">
                <li>
                  {t('importer.wn.step1')}
                  <div className="row" style={{ marginTop: 8, flexWrap: 'nowrap' }}>
                    <input placeholder="https://www.wongnai.com/restaurants/…" value={link} onChange={(e) => setLink(e.target.value)} />
                    <a className="btn" href={wongnaiUrl} target="_blank" rel="noopener noreferrer">{t('importer.wn.open')}</a>
                  </div>
                </li>
                <li>{t('importer.wn.step2')}</li>
                <li>{t('importer.wn.step3')}</li>
              </ol>
              <Field label={t('importer.pasteLabel')}>
                <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('importer.pastePlaceholder')} />
              </Field>
              <button className="btn primary" style={{ marginTop: 12 }} disabled={!text.trim()} onClick={readText}>{t('importer.read')}</button>
            </>
          )}

          {source === 'foodstory' && (
            <>
              <ol className="import-steps">
                <li>{t('importer.fs.step1')}</li>
                <li>{t('importer.fs.step2')}</li>
                <li>{t('importer.fs.step3')}</li>
              </ol>
              <FileDrop onFile={readFile} fileRef={fileRef} />
            </>
          )}

          {source === 'other' && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>{t('importer.other.intro')}</p>
              <FileDrop onFile={readFile} fileRef={fileRef} />
              <div className="import-or"><span>{t('importer.or')}</span></div>
              <Field label={t('importer.pasteLabel')}>
                <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('importer.pastePlaceholderOther')} />
              </Field>
              <button className="btn primary" style={{ marginTop: 12 }} disabled={!text.trim()} onClick={readText}>{t('importer.read')}</button>
            </>
          )}
          {msg && <div className={`callout ${msg.tone}`} style={{ marginTop: 12 }}>{msg.text}</div>}
        </div>
      )}

      {rows && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>{t('importer.preview', { n: rows.length })}</h2>
              <p>{t('importer.previewHint')}</p>
            </div>
            <button className="btn ghost" onClick={reset}>{t('common.back')}</button>
          </div>

          {table && (
            <div className="import-columns">
              <span className="field-label">{t('importer.columns')}</span>
              <div className="row">
                {table[0].map((h, i) => (
                  <label key={i} className="import-col">
                    <span>{h || `#${i + 1}`}</span>
                    <select value={columns[i]} onChange={(e) => remap(i, e.target.value as Column)}>
                      {(['name', 'price', 'category', 'description', 'ignore'] as Column[]).map((c) => <option key={c} value={c}>{t(`importer.col.${c}`)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}
          {msg && <div className={`callout ${msg.tone}`} style={{ marginBottom: 12 }}>{msg.text}</div>}

          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" checked={rows.every((r) => r.include)} onChange={(e) => setRows(rows.map((r) => ({ ...r, include: e.target.checked })))} aria-label={t('importer.selectAll')} />
                  </th>
                  <th>{t('importer.col.name')}</th><th>{t('importer.col.category')}</th>
                  <th style={{ width: 110 }}>{t('importer.col.price')}</th><th style={{ width: 120 }}>{t('importer.specialPrice')}</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const dup = mode === 'add' && existing.has(r.name.trim().toLowerCase());
                  return (
                    <tr key={i} style={r.include ? undefined : { opacity: 0.45 }}>
                      <td><input type="checkbox" checked={r.include} onChange={(e) => setRow(i, { include: e.target.checked })} aria-label={r.name} /></td>
                      <td>
                        <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                        {r.description && <div className="sub" style={{ marginTop: 4 }}>{r.description}</div>}
                      </td>
                      <td><input list="import-cats" value={r.category} onChange={(e) => setRow(i, { category: e.target.value })} /></td>
                      <td><NumInput value={r.price} onChange={(price) => setRow(i, { price })} /></td>
                      <td><NumInput value={r.priceHigh ?? 0} onChange={(n) => setRow(i, { priceHigh: n > r.price ? n : undefined })} placeholder="—" /></td>
                      <td>{dup ? <Pill tone="warn">{t('importer.onMenuAlready')}</Pill> : r.priceHigh ? <Pill tone="info">{t('importer.sizes', { low: money(r.price), high: money(r.priceHigh) })}</Pill> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="import-cats">{[...new Set([...s.menuCategories, ...rows.map((r) => r.category)])].map((c) => <option key={c} value={c} />)}</datalist>
          </div>

          <div className="import-options">
            {s.menuTabs.length > 0 && (
              <Field label={t('importer.menuTab')}>
                <select value={tab} onChange={(e) => setTab(e.target.value)}>{s.menuTabs.map((x) => <option key={x}>{x}</option>)}</select>
              </Field>
            )}
            <Field label={t('importer.how')}>
              <div className="seg">
                <button className={mode === 'add' ? 'active' : ''} onClick={() => setMode('add')}>{t('importer.add')}</button>
                <button className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>{t('importer.replace')}</button>
              </div>
            </Field>
            {phone && (
              <label className="check">
                <input type="checkbox" checked={usePhone} onChange={(e) => setUsePhone(e.target.checked)} />
                {t('importer.usePhone', { phone })}
              </label>
            )}
          </div>
          {dupes > 0 && <div className="callout warn" style={{ marginTop: 10 }}>{t('importer.dupes', { n: dupes })}</div>}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary lg" disabled={!chosen.length} onClick={doImport}>
              {mode === 'replace' ? t('importer.doReplace', { n: chosen.length }) : t('importer.doAdd', { n: chosen.length - dupes })}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>{t('importer.afterHint')}</span>
          </div>
        </div>
      )}

      {!rows && msg?.tone === 'ok' && <div className="callout ok">{msg.text}</div>}
    </div>
  );
}

function FileDrop({ onFile, fileRef }: { onFile: (f: File) => void; fileRef: React.RefObject<HTMLInputElement> }) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  return (
    <div
      className={`file-drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => fileRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click(); }}
    >
      <span className="file-drop-icon" aria-hidden>📄</span>
      <strong>{t('importer.dropTitle')}</strong>
      <span className="muted">{t('importer.dropHint')}</span>
      <input ref={fileRef} type="file" hidden accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}
