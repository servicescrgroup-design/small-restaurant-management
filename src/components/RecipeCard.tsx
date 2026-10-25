import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { fmtQty } from '../utils';
import { hueOf } from './ui';

export interface CardLine {
  key: string;
  name: string;
  /** Amount for `baseServings` */
  qty: number;
  unit: string;
  note?: string;
  /** Cost of `qty` (for `baseServings`) */
  cost?: number;
}

/** Warm gradients in the spirit of a recipe app; each dish keeps the same one. */
const PALETTES = [
  ['#ff5f8f', '#ff8a5c'],
  ['#ff7a3d', '#f6a338'],
  ['#ec5a8c', '#f7a072'],
  ['#e8603c', '#f08a4b'],
  ['#d9467f', '#ff9a6b'],
];
export const paletteOf = (name: string, index?: number) => PALETTES[(index ?? hueOf(name)) % PALETTES.length];

/** Round "plate" holding the dish photo, or its first letter. */
export function Plate({ image, name, size = 120 }: { image?: string; name: string; size?: number }) {
  return (
    <span className="rc-plate" style={{ width: size, height: size }}>
      {image ? <img src={image} alt="" loading="lazy" /> : <span className="rc-plate-letter">{name.trim().charAt(0).toUpperCase() || '?'}</span>}
    </span>
  );
}

/**
 * Recipe card: gradient header with the dish on a plate, a zig-zag edge, a servings dial that scales
 * every amount, and a dotted ingredient list. Rows slide in as they scroll into view.
 */
export function RecipeCard({
  title, subtitle, image, lines, servings, onServings, baseServings = 1, servingsLabel, money, empty, footer, compact,
}: {
  title: string;
  subtitle?: string;
  image?: string;
  lines: CardLine[];
  servings: number;
  onServings: (n: number) => void;
  baseServings?: number;
  servingsLabel?: string;
  money?: (n: number) => string;
  empty?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [from, to] = paletteOf(title || '?');
  const factor = baseServings > 0 ? servings / baseServings : 0;
  const total = lines.reduce((a, l) => a + (l.cost ?? 0), 0) * factor;
  const hasCost = !!money && lines.some((l) => l.cost);
  const step = (d: number) => onServings(Math.max(1, Math.round(servings + d)));

  return (
    <article className={`recipe-card ${compact ? 'compact' : ''}`} style={{ ['--rc-from' as string]: from, ['--rc-to' as string]: to }}>
      {/* Slides in at the top of a scrolling recipe sheet once the big header has gone by */}
      <div className="rc-minibar" aria-hidden>
        <div>
          <strong>{title || t('calc.recipeCard.untitled')}</strong>
          <span className="rc-mini-dial">
            <button type="button" tabIndex={-1} onClick={() => step(-1)} disabled={servings <= 1}>−</button>
            <b>{servings}</b> <small>{servingsLabel ?? t('calc.recipeCard.servings')}</small>
            <button type="button" tabIndex={-1} onClick={() => step(1)}>+</button>
          </span>
        </div>
      </div>
      <header className="rc-head">
        <Plate image={image} name={title || '?'} size={compact ? 92 : 124} />
        <h2 className="rc-title">{title || t('calc.recipeCard.untitled')}</h2>
        {subtitle && <p className="rc-sub">{subtitle}</p>}
        <div className="rc-dial">
          <button type="button" className="rc-step" onClick={() => step(-1)} disabled={servings <= 1} aria-label={t('calc.recipeCard.fewer')}>−</button>
          <label className="rc-circle">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={servings}
              onChange={(e) => onServings(Math.max(1, Math.round(Number(e.target.value) || 1)))}
              aria-label={servingsLabel ?? t('calc.recipeCard.servings')}
            />
            <span>{servingsLabel ?? t('calc.recipeCard.servings')}</span>
          </label>
          <button type="button" className="rc-step" onClick={() => step(1)} aria-label={t('calc.recipeCard.more')}>+</button>
        </div>
      </header>


      <h3 className="rc-section">{t('calc.recipeCard.ingredients')}</h3>
      {lines.length === 0 ? (
        <div className="rc-empty">{empty ?? t('calc.recipeCard.empty')}</div>
      ) : (
        <ul className="rc-lines">
          {lines.map((l, i) => (
            <li key={l.key} className="reveal" style={{ ['--i' as string]: i }}>
              <span className="rc-amount">
                <strong>{fmtQty(Math.round(l.qty * factor * 100) / 100)}</strong>
                <small>{l.unit}</small>
              </span>
              <span className="rc-name">
                {l.name}
                {l.note && <small>({l.note})</small>}
              </span>
              {hasCost && <span className="rc-cost">{money!((l.cost ?? 0) * factor)}</span>}
            </li>
          ))}
        </ul>
      )}
      {hasCost && lines.length > 0 && (
        <div className="rc-total">
          <span>{t('calc.recipeCard.totalFor', { n: servings })}</span>
          <strong>{money!(total)}</strong>
          <span className="muted">{t('calc.recipeCard.each', { amount: money!(servings ? total / servings : 0) })}</span>
        </div>
      )}
      {footer}
    </article>
  );
}
