import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

/** Color derived from a name, so items without a photo still look distinct. */
export function hueOf(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Photo thumbnail, or a colored first-letter tile when there's no photo. */
export function Thumb({ src, name, size = 'md' }: { src?: string; name: string; size?: 'md' | 'sm' | 'xs' }) {
  if (src) return <img className={`thumb ${size}`} src={src} alt="" loading="lazy" />;
  return <span className={`dish-avatar thumb ${size}`} style={{ ['--h' as string]: hueOf(name) }} aria-hidden>{name.trim().charAt(0).toUpperCase() || '?'}</span>;
}

/** Shrink a photo to a small square (center-cropped) so it stays light in browser storage. */
export async function resizeImage(file: File, px = 192): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = px;
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, px, px);
    const webp = canvas.toDataURL('image/webp', 0.8);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Photo picker for forms: preview, upload/change, remove. */
export function ImageField({ value, name, onChange }: { value?: string; name: string; onChange: (v: string | undefined) => void }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  return (
    <div className="image-field">
      <Thumb src={value} name={name || '?'} />
      <div className="image-field-side">
        <span className="field-label">{t('common.image.label')}</span>
        <div className="row">
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>{value ? t('common.image.change') : t('common.image.upload')}</button>
          {value && <button type="button" className="btn sm ghost danger" onClick={() => onChange(undefined)}>{t('common.image.remove')}</button>}
        </div>
        <span className="field-hint">{error || t('common.image.hint')}</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { onChange(await resizeImage(f)); setError(''); } catch { setError(t('common.image.error')); }
        }}
      />
    </div>
  );
}

// Open modals, newest last, so Escape only closes the one on top.
const modalStack: symbol[] = [];

export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const { t } = useI18n();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Symbol('modal');
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || modalStack[modalStack.length - 1] !== id) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => { modalStack.splice(modalStack.indexOf(id), 1); window.removeEventListener('keydown', onKey); };
  }, []);
  // Rendered on <body> so glass (backdrop-filter) ancestors can't trap the fixed overlay.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Numeric text input that tolerates partial typing like "0." */
export function NumInput({ value, onChange, ...rest }: { value: number; onChange: (n: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  // With a placeholder, 0 shows as an empty box so the hint is visible
  const show = (v: number) => (v === 0 && rest.placeholder ? '' : String(v ?? ''));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    const n = parseFloat(text);
    if ((isNaN(n) ? 0 : n) !== value) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      onFocus={(e) => e.target.select()}
      {...rest}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[^0-9.\-]/g, '');
        setText(t);
        const n = parseFloat(t);
        onChange(isNaN(n) ? 0 : n);
      }}
    />
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Pill({ tone = 'muted', children }: { tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function BarChart({ data, format, height = 180 }: { data: { label: string; value: number; highlight?: boolean }[]; format: (n: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  return (
    // Many bars → phones show every 2nd or 4th label so they don't overlap
    <div className={`barchart ${data.length > 20 ? 'xdense' : data.length > 12 ? 'dense' : ''}`} style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="bar-col" style={{ width: `${w}%` }} title={`${d.label}: ${format(d.value)}`}>
          <div className="bar-track">
            <div className={`bar ${d.highlight ? 'hl' : ''}`} style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
          <div className="bar-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

export function ChipEditor({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setText('');
  };
  return (
    <div className="chips">
      {values.map((v) => (
        <span key={v} className="chip">
          {v}
          <button aria-label={t('common.chips.remove', { v })} onClick={() => onChange(values.filter((x) => x !== v))}>✕</button>
        </span>
      ))}
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} onBlur={add} />
    </div>
  );
}
