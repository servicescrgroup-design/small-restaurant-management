import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useI18n } from '../i18n';
import { menuReadStatus, scanMenu, type MenuReadStatus, type PhotoBox, type ScannedMenu } from '../cloud';
import { useAccount } from '../account';
import { fmtPlanPrice, planCurrency, planPrices } from '../plans';
import type { MenuItem, MenuOption, OptionGroup } from '../types';
import { uid } from '../utils';
import { Modal, NumInput, Pill } from './ui';
import Select from './Select';

const MAX_PHOTOS = 4;

type Prepped = { media_type: string; data: string; preview: string };

/** Shrink a picture so it uploads quickly but stays sharp enough to read small print. */
function encodeForUpload(src: CanvasImageSource, width: number, height: number): Prepped {
  for (const [edge, quality] of [[2000, 0.85], [1600, 0.78], [1280, 0.72]] as const) {
    const scale = Math.min(1, edge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // PDFs can be transparent
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if (data.length < 1_000_000 || edge === 1280) return { media_type: 'image/jpeg', data, preview: dataUrl };
  }
  throw new Error('unreachable');
}

async function prepPhoto(file: File): Promise<Prepped[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    return [encodeForUpload(img, img.naturalWidth, img.naturalHeight)];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Each page of a PDF menu as a picture (pdf.js is loaded only when a PDF is dropped). */
async function prepPdf(file: File, maxPages: number): Promise<{ pages: Prepped[]; total: number }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: Prepped[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, 2200 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    pages.push(encodeForUpload(canvas, canvas.width, canvas.height));
  }
  const total = doc.numPages;
  await task.destroy(); // frees the PDF worker
  return { pages, total };
}

interface Row {
  key: string;
  include: boolean;
  nameTh: string;
  nameEn: string;
  categoryTh: string;
  categoryEn: string;
  variants: { th: string; en: string; price: number; on: boolean }[];
  /** Where the dish's own photo is on the menu (from the reader) */
  box?: PhotoBox;
  /** That photo cut out as a small square, and whether to use it */
  photo?: string;
  usePhoto: boolean;
}

/** Cut a dish photo out of a menu picture as a small square (a little padding, centred on the food). */
async function cropDish(pictureUrl: string, b: PhotoBox, px = 256): Promise<string | undefined> {
  if (!(b.w > 0.02 && b.h > 0.02 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1.02 && b.y + b.h <= 1.02)) return undefined;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = pictureUrl;
  });
  const W = img.naturalWidth, H = img.naturalHeight;
  const side = Math.min(Math.max(b.w * W, b.h * H) * 1.08, W, H);
  const cx = (b.x + b.w / 2) * W, cy = (b.y + b.h / 2) * H;
  const sx = Math.min(Math.max(0, cx - side / 2), W - side), sy = Math.min(Math.max(0, cy - side / 2), H - side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  canvas.getContext('2d')!.drawImage(img, sx, sy, side, side, 0, 0, px, px);
  const webp = canvas.toDataURL('image/webp', 0.82);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.82);
}

const MEATS = /ไก่|หมู|เนื้อ|ทะเล|กุ้ง|ปลา|หมึก|เป็ด|chicken|pork|beef|seafood|shrimp|prawn|fish|squid|duck/i;
const label = (th: string, en: string) => (th && en && th !== en ? `${th} / ${en}` : th || en);

function rowsFrom(menu: ScannedMenu): Row[] {
  return menu.sections.flatMap((s) => s.dishes.map((d) => ({
    key: uid(),
    include: true,
    nameTh: d.name_th.trim(),
    nameEn: d.name_en.trim(),
    categoryTh: s.category_th.trim(),
    categoryEn: s.category_en.trim(),
    variants: d.variants.filter((v) => v.price > 0).map((v) => ({ th: v.label_th.trim(), en: v.label_en.trim(), price: v.price, on: true })),
    box: d.photo?.[0],
    usePhoto: true,
  }))).filter((r) => (r.nameTh || r.nameEn) && r.variants.length);
}

/**
 * "Add your menu from a photo": owners drop in photos of their printed menu, it's read for them
 * (Thai + English names, meat/size columns as choices, footer extras), they check it, then it's added.
 */
export default function MenuScan({ onClose, onAdded }: { onClose: () => void; onAdded?: (n: number) => void }) {
  const { state, update, money } = useStore();
  const { t, lang } = useI18n();
  const s = state.settings;
  const [photos, setPhotos] = useState<{ id: string; media_type: string; data: string; preview: string }[]>([]);
  const [stage, setStage] = useState<'pick' | 'reading' | 'review'>('pick');
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [extras, setExtras] = useState<{ th: string; en: string; price: number; on: boolean }[]>([]);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [tab, setTab] = useState(s.menuTabs[0] ?? '');
  const [elapsed, setElapsed] = useState(0);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const account = useAccount();
  // Yearly-plan feature: 3 reads during the free trial
  const [allowance, setAllowance] = useState<MenuReadStatus | null>(null);
  const refreshAllowance = () => { if (account) void menuReadStatus(account.business.id).then(setAllowance); };
  useEffect(refreshAllowance, [account?.business.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = !!allowance && !allowance.allowed;

  useEffect(() => {
    if (stage !== 'reading') return;
    setElapsed(0);
    const id = window.setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [stage]);

  const addFiles = async (files: FileList | File[]) => {
    setError('');
    const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    const list = [...files].filter((f) => f.type.startsWith('image/') || isPdf(f));
    if (!list.length) return;
    let room = MAX_PHOTOS - photos.length;
    const added: Prepped[] = [];
    try {
      for (const f of list) {
        if (room <= 0) { setError(t('importer.scan.err.tooMany', { n: MAX_PHOTOS })); break; }
        if (isPdf(f)) {
          const { pages, total } = await prepPdf(f, room);
          added.push(...pages);
          if (total > pages.length) setError(t('importer.scan.err.pdfPages', { used: pages.length, total }));
        } else added.push(...(await prepPhoto(f)));
        room = MAX_PHOTOS - photos.length - added.length;
      }
    } catch {
      setError(t('importer.scan.err.photo'));
    }
    if (added.length) setPhotos((p) => [...p, ...added.map((x) => ({ ...x, id: uid() }))].slice(0, MAX_PHOTOS));
  };

  const read = async () => {
    setStage('reading');
    setError('');
    try {
      if (!account) throw new Error('sign_in_required');
      const menu = await scanMenu(account.business.id, photos.map(({ media_type, data }) => ({ media_type, data })));
      if (allowance?.plan === 'trial') setAllowance({ ...allowance, trial_left: menu.trial_left, allowed: (menu.trial_left ?? 0) > 0 });
      const r = rowsFrom(menu);
      if (!r.length) { setError(t('importer.scan.err.nothing')); setStage('pick'); return; }
      // Cut out each dish's photo from the picture it's in
      await Promise.all(r.map(async (row) => {
        const pic = row.box ? photos[row.box.image] : undefined;
        if (pic && row.box) row.photo = await cropDish(pic.preview, row.box).catch(() => undefined);
      }));
      setRows(r);
      setExtras(menu.extras.filter((x) => x.price > 0).map((x) => ({ th: x.name_th.trim(), en: x.name_en.trim(), price: x.price, on: true })));
      setUnsure(menu.unsure);
      setStage('review');
    } catch (e) {
      const code = (e as Error).message;
      setError(t(`importer.scan.err.${code}`));
      if (['yearly_only', 'trial_used', 'daily_limit'].includes(code)) refreshAllowance();
      setStage('pick');
    }
  };

  const existing = new Set(state.menu.flatMap((m) => [m.name, m.nameEn ?? ''].map((n) => n.trim().toLowerCase())).filter(Boolean));
  const isDup = (r: Row) => existing.has(r.nameTh.toLowerCase()) || (!!r.nameEn && existing.has(r.nameEn.toLowerCase()));
  const chosen = rows.filter((r) => r.include && (r.nameTh || r.nameEn) && r.variants.some((v) => v.on && v.price > 0));
  const setRow = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setVariant = (key: string, i: number, p: Partial<Row['variants'][number]>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, variants: r.variants.map((v, j) => (j === i ? { ...v, ...p } : v)) } : r)));
  const category = (r: Row) => (lang === 'th' ? r.categoryTh || r.categoryEn : r.categoryEn || r.categoryTh) || t('importer.defaultCategory');

  const add = () => {
    const extraOptions = extras.filter((x) => x.on && x.price > 0);
    const items: MenuItem[] = chosen.map((r) => {
      const id = uid();
      const vs = r.variants.filter((v) => v.on && v.price > 0).sort((a, b) => a.price - b.price);
      const base = vs[0].price;
      const groups: OptionGroup[] = [];
      // Two or more prices (chicken / beef / seafood columns) become a required choice priced from the cheapest
      if (vs.length > 1) {
        const meat = vs.every((v) => MEATS.test(`${v.th} ${v.en}`));
        groups.push({
          id: `${id}-v`, name: t(meat ? 'importer.scan.meatGroup' : 'importer.scan.choiceGroup'), required: true, multi: false,
          options: vs.map((v, i): MenuOption => ({ id: `${id}-v${i}`, name: label(v.th, v.en) || `#${i + 1}`, price: v.price - base, scale: 1, recipe: [] })),
        });
      }
      if (extraOptions.length) {
        groups.push({
          id: `${id}-x`, name: t('importer.scan.extrasGroup'), required: false, multi: true,
          options: extraOptions.map((x, i): MenuOption => ({ id: `${id}-x${i}`, name: label(x.th, x.en), price: x.price, scale: 1, recipe: [] })),
        });
      }
      return {
        id, name: r.nameTh || r.nameEn, ...(r.nameEn && r.nameEn !== r.nameTh ? { nameEn: r.nameEn } : {}),
        tab, category: category(r), price: base, active: true, recipe: [],
        ...(r.photo && r.usePhoto ? { image: r.photo } : {}),
        ...(groups.length ? { optionGroups: groups } : {}),
      };
    });
    update((d) => {
      d.menu.push(...items);
      const cats = [...new Set(items.map((m) => m.category))].filter((c) => !d.settings.menuCategories.includes(c));
      d.settings.menuCategories.push(...cats);
    });
    onAdded?.(items.length);
    onClose();
  };

  const dupes = chosen.filter(isDup).length;

  return (
    <Modal
      wide
      title={t('importer.scan.title')}
      onClose={stage === 'reading' ? () => undefined : onClose}
      footer={
        stage === 'pick' ? (
          <>
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn primary" disabled={!photos.length || locked || !account} onClick={() => void read()}>{t('importer.scan.read', { n: photos.length })}</button>
          </>
        ) : stage === 'review' ? (
          <>
            <button className="btn" onClick={() => setStage('pick')}>← {t('importer.scan.backToPhotos')}</button>
            <span className="spacer" />
            <button className="btn primary" disabled={!chosen.length} onClick={add}>{t('importer.scan.add', { n: chosen.length })}</button>
          </>
        ) : undefined
      }
    >
      {stage === 'pick' && locked && <YearlyOnly status={allowance!} onSeePlans={() => { onClose(); window.location.hash = 'account'; }} />}
      {stage === 'pick' && !locked && (
        <>
          {!account && <div className="callout warn">{t('importer.scan.err.sign_in_required')}</div>}
          {allowance?.plan === 'trial' && <div className="callout info scan-allowance">🎁 {t('importer.scan.trialLeft', { n: allowance.trial_left ?? 0 })}</div>}
          {allowance?.plan === 'yearly' && <div className="scan-allowance"><Pill tone="ok">★ {t('importer.scan.included')}</Pill></div>}
          <p className="muted" style={{ margin: 0 }}>{t('importer.scan.intro')}</p>
          <div
            className={`file-drop scan-drop ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void addFiles(e.dataTransfer.files); }}
            onClick={() => pickRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') pickRef.current?.click(); }}
          >
            <span className="file-drop-icon" aria-hidden>📷</span>
            <strong>{t('importer.scan.drop')}</strong>
            <span className="muted">{t('importer.scan.dropHint', { n: MAX_PHOTOS })}</span>
            <input ref={pickRef} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
          </div>
          <div className="row">
            <button className="btn" onClick={() => cameraRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>📸 {t('importer.scan.camera')}</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
            <span className="muted" style={{ fontSize: 13 }}>{t('importer.scan.tips')}</span>
          </div>
          {photos.length > 0 && (
            <div className="scan-photos">
              {photos.map((p, i) => (
                <figure key={p.id} className="scan-photo reveal" style={{ ['--i' as string]: i }}>
                  <img src={p.preview} alt={t('importer.scan.photoN', { n: i + 1 })} />
                  <button className="scan-photo-x" onClick={() => setPhotos((ps) => ps.filter((x) => x.id !== p.id))} aria-label={t('common.remove')}>✕</button>
                </figure>
              ))}
            </div>
          )}
          {error && <div className="callout bad">{error}</div>}
        </>
      )}

      {stage === 'reading' && (
        <div className="scan-reading" aria-live="polite">
          <div className="scan-stack" aria-hidden>
            {photos.slice(0, 3).map((p, i) => <img key={p.id} src={p.preview} alt="" style={{ ['--i' as string]: i }} />)}
            <span className="scan-beam" />
          </div>
          <strong>{t('importer.scan.reading')}</strong>
          <span className="muted">{t(elapsed < 15 ? 'importer.scan.step1' : elapsed < 40 ? 'importer.scan.step2' : 'importer.scan.step3')}</span>
          <span className="muted" style={{ fontSize: 13 }}>{t('importer.scan.wait', { s: elapsed })}</span>
        </div>
      )}

      {stage === 'review' && (
        <>
          <div className="callout info">{t('importer.scan.reviewIntro', { n: rows.length })}</div>
          {rows.some((r) => r.photo) && <div className="callout ok">📷 {t('importer.scan.photos', { n: rows.filter((r) => r.photo).length })}</div>}
          {unsure.length > 0 && <div className="callout warn">{t('importer.scan.unsure', { names: unsure.join(', ') })}</div>}
          <div className="scan-rows">
            {rows.map((r, i) => (
              <div key={r.key} className={`scan-row reveal ${r.include ? '' : 'off'}`} style={{ ['--i' as string]: i % 8 }}>
                <input type="checkbox" checked={r.include} onChange={(e) => setRow(r.key, { include: e.target.checked })} aria-label={r.nameTh || r.nameEn} />
                <div className="scan-names">
                  {r.photo && (
                    <label className={`scan-dish-photo ${r.usePhoto ? '' : 'off'}`} title={t('importer.scan.usePhoto')}>
                      <img src={r.photo} alt="" />
                      <span><input type="checkbox" checked={r.usePhoto} onChange={(e) => setRow(r.key, { usePhoto: e.target.checked })} /> {t('importer.scan.usePhoto')}</span>
                    </label>
                  )}
                  <input value={r.nameTh} onChange={(e) => setRow(r.key, { nameTh: e.target.value })} placeholder={t('importer.scan.nameTh')} aria-label={t('importer.scan.nameTh')} />
                  <input value={r.nameEn} onChange={(e) => setRow(r.key, { nameEn: e.target.value })} placeholder={t('importer.scan.nameEn')} aria-label={t('importer.scan.nameEn')} />
                  <span className="scan-cat">{category(r)}{isDup(r) && <> · <Pill tone="warn">{t('importer.onMenuAlready')}</Pill></>}</span>
                </div>
                <div className="scan-variants">
                  {r.variants.map((v, j) => (
                    <label key={j} className={`scan-variant ${v.on ? '' : 'off'}`}>
                      {r.variants.length > 1 && <input type="checkbox" checked={v.on} onChange={(e) => setVariant(r.key, j, { on: e.target.checked })} />}
                      <span>{label(lang === 'th' ? v.th : v.en, lang === 'th' ? v.en : v.th) || t('importer.scan.price')}</span>
                      <NumInput value={v.price} onChange={(price) => setVariant(r.key, j, { price })} aria-label={t('importer.scan.price')} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {extras.length > 0 && (
            <div className="scan-extras">
              <strong>{t('importer.scan.extrasTitle')}</strong>
              <span className="muted" style={{ fontSize: 13 }}>{t('importer.scan.extrasHint')}</span>
              <div className="row">
                {extras.map((x, i) => (
                  <label key={i} className={`scan-variant ${x.on ? '' : 'off'}`}>
                    <input type="checkbox" checked={x.on} onChange={(e) => setExtras((xs) => xs.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
                    <span>{label(x.th, x.en)}</span>
                    <span className="muted">+{money(x.price)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="import-options">
            {s.menuTabs.length > 0 && (
              <label className="field">
                <span className="field-label">{t('importer.menuTab')}</span>
                <Select value={tab} onChange={(e) => setTab(e.target.value)}>{s.menuTabs.map((x) => <option key={x}>{x}</option>)}</Select>
              </label>
            )}
            {dupes > 0 && <div className="callout warn" style={{ margin: 0 }}>{t('importer.scan.dupes', { n: dupes })}</div>}
          </div>
        </>
      )}
    </Modal>
  );
}

/** Shown instead of the upload area when this shop's plan doesn't include photo reading. */
function YearlyOnly({ status, onSeePlans }: { status: MenuReadStatus; onSeePlans: () => void }) {
  const { t, lang } = useI18n();
  const cur = planCurrency(lang);
  const p = planPrices(cur);
  const money = (n: number) => fmtPlanPrice(n, cur);
  return (
    <div className="scan-locked">
      <span className="scan-locked-icon" aria-hidden>📷</span>
      <h3>{t('importer.scan.lockedTitle')}</h3>
      <p>{t(status.reason === 'daily_limit' ? 'importer.scan.lockedDaily' : status.plan === 'trial' ? 'importer.scan.lockedTrialUsed' : 'importer.scan.lockedBody')}</p>
      {status.reason !== 'daily_limit' && (
        <>
          <div className="scan-locked-price">{money(p.yearly)}<small>/{t('account.perYear')}</small> · {t('account.perMonthEquiv', { amount: money(p.yearlyPerMonth) })}</div>
          <button className="btn" onClick={onSeePlans}>{t('importer.scan.seePlans')}</button>
        </>
      )}
    </div>
  );
}
