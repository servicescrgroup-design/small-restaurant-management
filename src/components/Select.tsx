import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Opt { value: string; label: string; disabled?: boolean; group?: string }

const textOf = (n: ReactNode): string =>
  Children.toArray(n).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : '')).join('');

/** Read <option> / <optgroup> children the same way a native select would. */
function readOptions(children: ReactNode, group?: string): Opt[] {
  return Children.toArray(children).flatMap((c): Opt[] => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string }>(c)) return [];
    if (c.type === 'optgroup') return readOptions(c.props.children, c.props.label);
    if (c.type !== 'option') return readOptions(c.props.children, group);
    const label = textOf(c.props.children);
    return [{ value: c.props.value !== undefined ? String(c.props.value) : label, label, disabled: c.props.disabled, group }];
  });
}

// Phones and tablets keep the system picker (a wheel or sheet that fits the device)
const coarse = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

type ChangeEvent = { target: { value: string }; currentTarget: { value: string } };

/**
 * Drop-in for <select>: same <option>/<optgroup> children and onChange(e) with e.target.value,
 * but the list is the app's own clean popover instead of the browser's menu.
 */
export default function Select({ value, onChange, children, className = '', style, disabled, 'aria-label': ariaLabel, title }: {
  value?: string | number;
  onChange?: (e: ChangeEvent) => void;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  'aria-label'?: string;
  title?: string;
}) {
  const [native] = useState(coarse);
  const opts = readOptions(children);
  const current = value !== undefined ? String(value) : opts[0]?.value ?? '';
  const selected = opts.find((o) => o.value === current) ?? opts[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const id = useId();

  const pick = (o: Opt) => {
    if (o.disabled) return;
    setOpen(false);
    btnRef.current?.focus();
    if (o.value !== current) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    setPos({
      left: Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8),
      minWidth: r.width,
      maxHeight: Math.min(340, up ? above : below),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  };

  const openList = () => {
    if (disabled) return;
    place();
    setActive(Math.max(0, opts.indexOf(selected!)));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const moved = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('scroll', moved, true);
    window.addEventListener('resize', moved);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('scroll', moved, true); window.removeEventListener('resize', moved); };
  }, [open]);

  if (native) {
    return (
      <select className={className} style={style} value={current} disabled={disabled} aria-label={ariaLabel} title={title} onChange={(e) => onChange?.({ target: { value: e.target.value }, currentTarget: { value: e.target.value } })}>
        {children}
      </select>
    );
  }

  const step = (dir: 1 | -1) => {
    let i = active;
    for (let n = 0; n < opts.length; n++) {
      i = (i + dir + opts.length) % opts.length;
      if (!opts[i].disabled) { setActive(i); return; }
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(opts.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[active]) pick(opts[active]); }
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); setOpen(false); }
    else if (e.key.length === 1) {
      // Type to jump to an option
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = opts.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`select-btn ${open ? 'open' : ''} ${className}`}
        style={style}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        // preventDefault: inside a <label> (Field) the label would otherwise click us a second time
        onClick={(e) => { e.preventDefault(); if (open) setOpen(false); else openList(); }}
        onKeyDown={onKey}
      >
        <span className="select-value">{selected?.label ?? ''}</span>
        <svg className="select-chevron" aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={listRef}
          id={id}
          role="listbox"
          className={`select-pop ${pos.bottom !== undefined ? 'up' : ''}`}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxHeight: pos.maxHeight }}
        >
          {opts.map((o, i) => {
            const head = o.group !== lastGroup && o.group ? <div className="select-group" key={`g-${i}`}>{o.group}</div> : null;
            lastGroup = o.group;
            return [
              head,
              <div
                key={i}
                id={`${id}-${i}`}
                data-i={i}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled || undefined}
                className={`select-opt ${i === active ? 'active' : ''} ${o.value === current ? 'selected' : ''} ${o.disabled ? 'disabled' : ''}`}
                onPointerEnter={() => !o.disabled && setActive(i)}
                onClick={() => pick(o)}
              >
                <span>{o.label || '—'}</span>
                {o.value === current && <svg aria-hidden viewBox="0 0 16 16" width="14" height="14"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>,
            ];
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
