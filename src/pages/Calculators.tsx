import { useState } from 'react';
import type { Page } from '../App';
import { useStore } from '../store';
import { IngredientPicker } from '../components/Recipe';
import { useAuth } from '../auth';
import { unitCost } from '../inventory';
import { Field, NumInput, Tabs } from '../components/ui';
import { RecipeCard, type CardLine } from '../components/RecipeCard';
import { MenuItemModal, dishDefaults, foodCostTone } from './Menu';
import type { DishExtra, MenuItem } from '../types';
import { dishName, fmtInt, fmtQty, pct, uid } from '../utils';
import { useI18n } from '../i18n';
import Select from '../components/Select';

type Tab = 'plate' | 'yield' | 'scale' | 'margin';

export default function Calculators({ go }: { go: (p: Page) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('plate');
  return (
    <>
      <div className="page-head">
        <div><h1>{t('common.nav.calculators')}</h1><p>{t('calc.intro')}</p></div>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: 'plate', label: t('calc.tab.plate') },
          { id: 'yield', label: t('calc.tab.yield') },
          { id: 'scale', label: t('calc.tab.scale') },
          { id: 'margin', label: t('calc.tab.margin') },
        ]} />
      </div>
      {tab === 'plate' && <PlateCost go={go} />}
      {tab === 'yield' && <YieldCalc />}
      {tab === 'scale' && <Scaler />}
      {tab === 'margin' && <MarginCalc />}
    </>
  );
}

// ---------- Plate cost ----------

type Line =
  | { id: string; kind: 'inv'; itemId: string; qty: number }
  | { id: string; kind: 'custom'; name: string; packPrice: number; packQty: number; packUnit: string; useQty: number; yieldPct: number };

function PlateCost({ go }: { go: (p: Page) => void }) {
  const { state, update, money } = useStore();
  const { t } = useI18n();
  const s = state.settings;
  const [name, setName] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [qFactor, setQFactor] = useState(3);
  const [packaging, setPackaging] = useState(0);
  const [price, setPrice] = useState(0);
  const [target, setTarget] = useState(s.targetFoodCost);
  const [adding, setAdding] = useState<MenuItem | null>(null);
  const [plates, setPlates] = useState(1);
  const isOwner = useAuth().user?.role === 'owner';
  const items = [...state.items].sort((a, b) => a.name.localeCompare(b.name));

  const lineCost = (l: Line) =>
    l.kind === 'inv'
      ? unitCost(state, l.itemId) * l.qty
      : l.packQty > 0 && l.yieldPct > 0 ? (l.packPrice / l.packQty) * l.useQty / (l.yieldPct / 100) : 0;
  const ingredients = lines.reduce((a, l) => a + lineCost(l), 0);
  // The store's own extra costs per dish (saved, so every calculation includes them)
  const extras = s.dishExtras ?? [];
  const extraCost = (x: DishExtra) => (x.pct ? ingredients * x.amount / 100 : x.amount);
  const extrasTotal = extras.reduce((a, x) => a + extraCost(x), 0);
  const setExtras = (fn: (xs: DishExtra[]) => DishExtra[]) => update((d) => { d.settings.dishExtras = fn(d.settings.dishExtras ?? []); });
  const plate = ingredients * (1 + qFactor / 100) + packaging + extrasTotal;
  const fc = price > 0 ? plate / price : 0;
  const suggested = target > 0 ? plate / (target / 100) : 0;
  const roundUp = (n: number) => Math.max(0.99, Math.ceil(n) - 0.01 < n ? Math.ceil(n) + 0.99 : Math.ceil(n) - 0.01);

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...p } as Line) : l)));
  const addInv = () => items[0] && setLines((ls) => [...ls, { id: uid(), kind: 'inv', itemId: items[0].id, qty: 1 }]);
  const addCustom = () => setLines((ls) => [...ls, { id: uid(), kind: 'custom', name: '', packPrice: 0, packQty: 1, packUnit: 'kg', useQty: 0, yieldPct: 100 }]);
  const customCount = lines.filter((l) => l.kind === 'custom').length;
  // The plate being built, as a recipe card that scales to any number of plates
  const cardLines: CardLine[] = lines.map((l) => {
    if (l.kind === 'inv') {
      const it = state.items.find((x) => x.id === l.itemId);
      return { key: l.id, name: it?.name ?? '?', qty: l.qty, unit: it?.unit ?? '', cost: lineCost(l) };
    }
    return { key: l.id, name: l.name || t('calc.ingredientName'), qty: l.useQty, unit: l.packUnit, note: l.yieldPct < 100 ? t('calc.recipeCard.yieldNote', { pct: l.yieldPct }) : undefined, cost: lineCost(l) };
  });

  const toMenu = () => setAdding({
    id: uid(), name: name.trim() || t('calc.newDish'), category: s.menuCategories[0] ?? 'Mains', price: price || roundUp(suggested), active: true,
    recipe: lines.filter((l): l is Extract<Line, { kind: 'inv' }> => l.kind === 'inv').map((l) => ({ itemId: l.itemId, qty: l.qty })),
  });

  return (
    <div className="grid split plate-calc">
      <div className="grid">
      <div className="card">
        <Field label={t('calc.dishName')}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('calc.dishPlaceholder')} /></Field>
        <h3 style={{ margin: '18px 0 8px' }}>{t('calc.perPlate')}</h3>
        <div className="table-wrap">
          <table className="table compact plate-lines">
            <thead><tr><th>{t('calc.col.ingredient')}</th><th>{t('calc.col.amountUsed')}</th><th className="num">{t('calc.col.cost')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  {l.kind === 'inv' ? (
                    <>
                      <td>
                        <IngredientPicker value={l.itemId} onPick={(itemId) => patch(l.id, { itemId })} />
                      </td>
                      <td><div className="input-unit"><NumInput value={l.qty} onChange={(qty) => patch(l.id, { qty })} /><span>{state.items.find((i) => i.id === l.itemId)?.unit}</span></div></td>
                    </>
                  ) : (
                    <>
                      <td>
                        <input value={l.name} onChange={(e) => patch(l.id, { name: e.target.value })} placeholder={t('calc.ingredientName')} style={{ marginBottom: 6 }} />
                        <div className="input-unit">
                          <span>{t('calc.buy')}</span><NumInput value={l.packQty} onChange={(packQty) => patch(l.id, { packQty })} style={{ width: 70 }} />
                          <input value={l.packUnit} onChange={(e) => patch(l.id, { packUnit: e.target.value })} style={{ width: 64 }} />
                          <span>{t('calc.for')}</span><NumInput value={l.packPrice} onChange={(packPrice) => patch(l.id, { packPrice })} style={{ width: 80 }} />
                        </div>
                      </td>
                      <td>
                        <div className="input-unit" style={{ marginBottom: 6 }}><NumInput value={l.useQty} onChange={(useQty) => patch(l.id, { useQty })} /><span>{l.packUnit}</span></div>
                        <div className="input-unit"><span>{t('calc.yield')}</span><NumInput value={l.yieldPct} onChange={(yieldPct) => patch(l.id, { yieldPct })} style={{ width: 64 }} /><span>%</span></div>
                      </td>
                    </>
                  )}
                  <td className="num">{money(lineCost(l))}</td>
                  <td><button className="icon-btn" aria-label={t('common.remove')} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lines.length === 0 && <p className="muted">{t('calc.emptyLines')}</p>}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={addInv} disabled={!items.length}>{t('calc.fromInventory')}</button>
          <button className="btn sm" onClick={addCustom}>{t('calc.newIngredient')}</button>
        </div>
        <div className="form-grid" style={{ marginTop: 18 }}>
          <Field label={t('calc.qFactorLabel')} hint={t('calc.qFactorHint')}>
            <div className="input-unit"><NumInput value={qFactor} onChange={setQFactor} /><span>%</span></div>
          </Field>
          <Field label={t('calc.packagingLabel')}><NumInput value={packaging} onChange={setPackaging} /></Field>
        </div>

        <div className="extras">
          <div className="extras-head">
            <h3>{t('calc.extras.title')}</h3>
            <span className="muted">{t('calc.extras.hint')}</span>
          </div>
          {extras.map((x) => (
            <div key={x.id} className="extra-row">
              <input value={x.name} placeholder={t('calc.extras.namePh')} aria-label={t('calc.extras.name')} onChange={(e) => setExtras((xs) => xs.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} />
              <div className="extra-amount">
                <NumInput value={x.amount} onChange={(amount) => setExtras((xs) => xs.map((y) => (y.id === x.id ? { ...y, amount } : y)))} aria-label={t('calc.extras.amount')} />
                <Select value={x.pct ? 'pct' : 'baht'} onChange={(e) => setExtras((xs) => xs.map((y) => (y.id === x.id ? { ...y, pct: e.target.value === 'pct' } : y)))} aria-label={t('calc.extras.kind')}>
                  <option value="baht">{t('calc.extras.perPlate')}</option>
                  <option value="pct">{t('calc.extras.pctOfIngredients')}</option>
                </Select>
              </div>
              <span className="extra-cost">{money(extraCost(x))}</span>
              <button className="icon-btn" aria-label={t('common.remove')} onClick={() => setExtras((xs) => xs.filter((y) => y.id !== x.id))}>✕</button>
            </div>
          ))}
          <div className="row">
            <button className="btn sm" onClick={() => setExtras((xs) => [...xs, { id: uid(), name: '', amount: 0 }])}>+ {t('calc.extras.add')}</button>
            {extras.length === 0 && ['gas', 'labour', 'utilities'].map((k) => (
              <button key={k} className="btn sm ghost" onClick={() => setExtras((xs) => [...xs, { id: uid(), name: t(`calc.extras.ex.${k}`), amount: 0 }])}>+ {t(`calc.extras.ex.${k}`)}</button>
            ))}
          </div>
        </div>
      </div>
      {plate > 0 && (
        <PriceChart
          price={price > 0 ? price : roundUp(suggested)}
          atYourPrice={price > 0}
          parts={[
            { key: 'ing', label: t('calc.ingredients'), value: ingredients },
            { key: 'q', label: t('calc.qFactor'), value: ingredients * qFactor / 100 },
            { key: 'pack', label: t('calc.packaging'), value: packaging },
            { key: 'other', label: t('calc.extras.chartLabel'), value: extrasTotal, detail: extras.filter((x) => extraCost(x) > 0).map((x) => `${x.name || t('calc.extras.unnamed')} ${money(extraCost(x))}`).join(' · ') },
          ]}
        />
      )}
        {plate > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{t('calc.priceTargets')}</h3>
          <table className="table compact">
            <thead><tr><th>{t('calc.col.foodCost')}</th><th className="num">{t('calc.col.price')}</th><th className="num">{t('calc.col.profit')}</th></tr></thead>
            <tbody>
              {[25, 28, 30, 32, 35, 40].map((p) => (
                <tr key={p} style={p === target ? { fontWeight: 700 } : undefined}>
                  <td>{p}%</td><td className="num">{money(plate / (p / 100))}</td><td className="num">{money(plate / (p / 100) - plate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>

      <div className="grid">
        <RecipeCard
          compact
          title={name}
          subtitle={plate > 0 ? t('calc.recipeCard.plateCost', { amount: money(plate) }) : undefined}
          lines={cardLines}
          servings={plates}
          onServings={setPlates}
          servingsLabel={t('calc.recipeCard.plates')}
          money={money}
          empty={t('calc.recipeCard.emptyPlate')}
        />
        <div className="card">
          <div className="result-box">
            <div className="muted">{t('calc.plateCost')}</div>
            <div className="result-big">{money(plate)}</div>
            <div className="kv"><span>{t('calc.ingredients')}</span><span>{money(ingredients)}</span></div>
            <div className="kv"><span>{t('calc.qFactor')}</span><span>{money(ingredients * qFactor / 100)}</span></div>
            {packaging > 0 && <div className="kv"><span>{t('calc.packaging')}</span><span>{money(packaging)}</span></div>}
            {extras.filter((x) => extraCost(x) > 0).map((x) => <div key={x.id} className="kv"><span>{x.name || t('calc.extras.unnamed')}</span><span>{money(extraCost(x))}</span></div>)}
          </div>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label={t('calc.targetFoodCost')}><div className="input-unit"><NumInput value={target} onChange={setTarget} /><span>%</span></div></Field>
            <Field label={t('calc.yourPrice')}><NumInput value={price} onChange={setPrice} placeholder="0.00" /></Field>
          </div>
          {plate > 0 && (
            <div className="result-box" style={{ marginTop: 14 }}>
              <div className="kv"><span>{t('calc.suggestedAt', { target })}</span><strong>{money(suggested)}</strong></div>
              <div className="kv"><span>{t('calc.rounded')}</span><strong>{money(roundUp(suggested))}</strong></div>
              {price > 0 && (
                <>
                  <hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />
                  <div className="kv"><span>{t('calc.foodCostAt', { price: money(price) })}</span><strong>{pct(fc)}</strong></div>
                  <div className="kv"><span>{t('calc.grossProfit')}</span><strong>{money(price - plate)}</strong></div>
                  <div className="kv"><span>{t('calc.grossMargin')}</span><strong>{pct(1 - fc)}</strong></div>
                  <div className={`callout ${foodCostTone(fc, target)}`}>
                    {fc <= target / 100 ? t('calc.underTarget', { target }) : t('calc.overTarget', { price: money(suggested), amount: money(plate - price * target / 100) })}
                  </div>
                </>
              )}
            </div>
          )}
          {isOwner && <button className="btn primary" style={{ width: '100%', marginTop: 14 }} disabled={!lines.length} onClick={toMenu}>{t('calc.addToMenu')}</button>}
          {isOwner && customCount > 0 && <p className="muted" style={{ fontSize: 12.5 }}>{t(customCount > 1 ? 'calc.customMany' : 'calc.customOne', { n: customCount })}</p>}
        </div>
      </div>

      {adding && (
        <MenuItemModal
          item={adding}
          onClose={() => setAdding(null)}
          onSave={(m) => { update((d) => { d.menu.push(m); }); setAdding(null); go('menu'); }}
        />
      )}
    </div>
  );
}

// ---------- Where the price goes ----------

// Fixed slot per cost type (validated for colour-blind separation in light and dark); profit always last
const SLOTS: Record<string, string> = { ing: 'var(--viz-1)', q: 'var(--viz-2)', pack: 'var(--viz-3)', other: 'var(--viz-4)', profit: 'var(--viz-5)' };

function PriceChart({ price, atYourPrice, parts }: { price: number; atYourPrice: boolean; parts: { key: string; label: string; value: number; detail?: string }[] }) {
  const { money } = useStore();
  const { t } = useI18n();
  const [hi, setHi] = useState<string | null>(null);
  const cost = parts.reduce((a, p) => a + p.value, 0);
  const profit = price - cost;
  const slices = [...parts.filter((p) => p.value > 0.004), ...(profit > 0.004 ? [{ key: 'profit', label: t('calc.chart.profit'), value: profit, detail: undefined }] : [])];
  // A loss means costs are more than the price: draw against the cost so the ring still closes
  const whole = Math.max(price, cost) || 1;
  const R = 70, C = 2 * Math.PI * R, GAP = slices.length > 1 ? 3 : 0;
  let at = 0;
  const arcs = slices.map((p) => {
    const len = (p.value / whole) * C;
    const arc = { ...p, dash: Math.max(0, len - GAP), offset: -at };
    at += len;
    return arc;
  });
  const shown = slices.find((p) => p.key === hi);

  return (
    <div className="card price-chart">
      <div className="card-head">
        <div>
          <h3>{t('calc.chart.title')}</h3>
          <p className="muted">{t(atYourPrice ? 'calc.chart.atYourPrice' : 'calc.chart.atSuggested', { price: money(price) })}</p>
        </div>
      </div>
      <div className="price-chart-body">
        <svg viewBox="0 0 180 180" className="price-donut" role="img" aria-label={t('calc.chart.title')}>
          <circle cx="90" cy="90" r={R} fill="none" stroke="var(--glass-soft)" strokeWidth="26" />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx="90" cy="90" r={R} fill="none"
              stroke={SLOTS[a.key]} strokeWidth={hi === a.key ? 30 : 26}
              strokeDasharray={`${a.dash} ${C}`} strokeDashoffset={a.offset}
              transform="rotate(-90 90 90)"
              opacity={hi && hi !== a.key ? 0.35 : 1}
              onPointerEnter={() => setHi(a.key)} onPointerLeave={() => setHi(null)}
              style={{ transition: 'opacity 0.15s, stroke-width 0.15s', cursor: 'default' }}
            >
              <title>{`${a.label}: ${money(a.value)} (${pct(a.value / price)})`}</title>
            </circle>
          ))}
          <text x="90" y="84" textAnchor="middle" className="donut-label">{shown ? shown.label : t(profit >= 0 ? 'calc.chart.profit' : 'calc.chart.loss')}</text>
          <text x="90" y="106" textAnchor="middle" className="donut-value">{shown ? pct(shown.value / price) : pct(Math.abs(profit) / price)}</text>
        </svg>
        <ul className="price-legend">
          {slices.map((p) => (
            <li key={p.key} className={hi === p.key ? 'on' : ''} onPointerEnter={() => setHi(p.key)} onPointerLeave={() => setHi(null)}>
              <span className="legend-chip" style={{ background: SLOTS[p.key] }} aria-hidden />
              <span className="legend-name">{p.label}{p.detail && <small>{p.detail}</small>}</span>
              <span className="legend-amount">{money(p.value)}</span>
              <span className="legend-pct">{pct(p.value / price)}</span>
            </li>
          ))}
          {profit < -0.004 && (
            <li className="loss">
              <span className="legend-chip" aria-hidden>!</span>
              <span className="legend-name">{t('calc.chart.loss')}</span>
              <span className="legend-amount">−{money(-profit)}</span>
              <span className="legend-pct">{pct(-profit / price)}</span>
            </li>
          )}
          <li className="total">
            <span />
            <span className="legend-name">{t('calc.chart.price')}</span>
            <span className="legend-amount">{money(price)}</span>
            <span className="legend-pct">100%</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ---------- Yield ----------

function YieldCalc() {
  const { money } = useStore();
  const { t } = useI18n();
  // Example: 5 kg of pork shoulder for ฿900, 3.6 kg usable after trimming, 150 g per plate
  const [apPrice, setApPrice] = useState(900);
  const [apQty, setApQty] = useState(5);
  const [unit, setUnit] = useState('kg');
  const [usable, setUsable] = useState(3.6);
  const [portion, setPortion] = useState(0.15);
  const yieldPct = apQty > 0 ? usable / apQty : 0;
  const apCost = apQty > 0 ? apPrice / apQty : 0;
  const epCost = yieldPct > 0 ? apCost / yieldPct : 0;
  const portions = portion > 0 ? usable / portion : 0;
  const [tipA, tipB = ''] = t('calc.yieldTip').split('{pct}');

  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h2>{t('calc.tab.yield')}</h2>
        <p className="muted">{t('calc.yieldIntro')}</p>
        <div className="form-grid">
          <Field label={t('calc.apPrice')}><NumInput value={apPrice} onChange={setApPrice} /></Field>
          <Field label={t('calc.apQty')}><div className="input-unit"><NumInput value={apQty} onChange={setApQty} /><input value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 70 }} /></div></Field>
          <Field label={t('calc.usable')} hint={t('calc.usableHint')}><div className="input-unit"><NumInput value={usable} onChange={setUsable} /><span>{unit}</span></div></Field>
          <Field label={t('calc.portion')}><div className="input-unit"><NumInput value={portion} onChange={setPortion} /><span>{unit}</span></div></Field>
        </div>
      </div>
      <div className="card">
        <div className="result-box">
          <div className="muted">{t('calc.trueCost', { unit })}</div>
          <div className="result-big">{money(epCost)}</div>
          <div className="kv"><span>{t('calc.yield')}</span><strong>{pct(yieldPct)}</strong></div>
          <div className="kv"><span>{t('calc.pricePer', { unit })}</span><span>{money(apCost)}</span></div>
          <div className="kv"><span>{t('calc.hiddenCost', { unit })}</span><span>{money(epCost - apCost)}</span></div>
          <div className="kv"><span>{t('calc.portions')}</span><strong>{fmtQty(Math.floor(portions * 10) / 10)}</strong></div>
          <div className="kv"><span>{t('calc.costPerPortion')}</span><strong>{money(epCost * portion)}</strong></div>
        </div>
        {yieldPct > 0 && yieldPct < 1 && (
          <div className="callout info" style={{ marginTop: 12 }}>
            {tipA}<strong>{(yieldPct * 100).toFixed(0)}%</strong>{tipB}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Recipe scaler ----------

interface ScaleLine { id: string; name: string; qty: number; unit: string; cost: number }

function Scaler() {
  const { state, money } = useStore();
  const { t } = useI18n();
  const preps = state.items.filter((i) => i.kind === 'prep');
  const [origYield, setOrigYield] = useState(10);
  const [newYield, setNewYield] = useState(25);
  const [yieldUnit, setYieldUnit] = useState('servings');
  const [lines, setLines] = useState<ScaleLine[]>([{ id: uid(), name: '', qty: 0, unit: '', cost: 0 }]);
  const [loaded, setLoaded] = useState<{ name: string; image?: string } | null>(null);
  const factor = origYield > 0 ? newYield / origYield : 0;

  const load = (id: string) => {
    const p = state.items.find((i) => i.id === id);
    if (!p) return;
    setLoaded({ name: p.name, image: p.image });
    setOrigYield(p.yieldQty ?? 1);
    setYieldUnit(p.unit);
    setLines((p.recipe ?? []).map((r) => {
      const it = state.items.find((x) => x.id === r.itemId);
      return { id: uid(), name: it?.name ?? '?', qty: r.qty, unit: it?.unit ?? '', cost: unitCost(state, r.itemId) };
    }));
  };
  const patch = (id: string, p: Partial<ScaleLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));

  return (
    <div className="grid split scale-layout">
      <div className="card">
        <div className="card-head">
          <div><h2>{t('calc.tab.scale')}</h2><p>{t('calc.scaleIntro')}</p></div>
          {preps.length > 0 && (
            <Select style={{ width: 240 }} value="" onChange={(e) => load(e.target.value)}>
              <option value="">{t('calc.loadPrep')}</option>
              {preps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </div>
        <div className="form-grid" style={{ marginBottom: 16 }}>
          <Field label={t('calc.origYield')}><NumInput value={origYield} onChange={setOrigYield} /></Field>
          <Field label={t('calc.newYield')}><NumInput value={newYield} onChange={setNewYield} /></Field>
          <Field label={t('calc.yieldUnit')}><input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} /></Field>
          <div className="result-box"><div className="muted">{t('calc.scaleFactor')}</div><div className="result-big">×{factor.toFixed(2)}</div></div>
        </div>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>{t('calc.col.ingredient')}</th><th>{t('calc.col.origQty')}</th><th>{t('calc.col.unit')}</th><th>{t('calc.col.costPerUnit')}</th><th className="num">{t('calc.col.scaledQty')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td><input value={l.name} onChange={(e) => patch(l.id, { name: e.target.value })} placeholder={t('calc.ingredientPlaceholder')} /></td>
                  <td><NumInput value={l.qty} onChange={(qty) => patch(l.id, { qty })} /></td>
                  <td><input value={l.unit} onChange={(e) => patch(l.id, { unit: e.target.value })} style={{ width: 80 }} /></td>
                  <td><NumInput value={l.cost} onChange={(cost) => patch(l.id, { cost })} /></td>
                  <td className="num"><strong>{fmtQty(Math.round(l.qty * factor * 100) / 100)}</strong> {l.unit}</td>
                  <td><button className="icon-btn" aria-label={t('common.remove')} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setLines((ls) => [...ls, { id: uid(), name: '', qty: 0, unit: '', cost: 0 }])}>{t('calc.addLine')}</button>
      </div>
      <div className="scale-card">
        <RecipeCard
          title={loaded?.name ?? t('calc.recipeCard.yourRecipe')}
          subtitle={t('calc.recipeCard.scaledFrom', { from: fmtQty(origYield), unit: yieldUnit, factor: factor.toFixed(2) })}
          image={loaded?.image}
          lines={lines.filter((l) => l.name.trim() || l.qty).map((l) => ({ key: l.id, name: l.name || '—', qty: l.qty, unit: l.unit, cost: l.cost * l.qty }))}
          servings={Math.max(1, Math.round(newYield))}
          onServings={setNewYield}
          baseServings={origYield}
          servingsLabel={yieldUnit}
          money={money}
        />
      </div>
    </div>
  );
}

// ---------- Margin & break-even ----------

function MarginCalc() {
  const { state, money } = useStore();
  const { t } = useI18n();
  const [cost, setCost] = useState(3.5);
  const [price, setPrice] = useState(12);
  const [desiredMargin, setDesiredMargin] = useState(70);

  const [rent, setRent] = useState(4500);
  const [labor, setLabor] = useState(14000);
  const [utilities, setUtilities] = useState(1200);
  const [other, setOther] = useState(1500);
  const [avgCheck, setAvgCheck] = useState(22);
  const [foodPct, setFoodPct] = useState(state.settings.targetFoodCost);
  const [varPct, setVarPct] = useState(3);
  const [daysOpen, setDaysOpen] = useState(26);

  const margin = price > 0 ? (price - cost) / price : 0;
  const markup = cost > 0 ? (price - cost) / cost : 0;
  const priceForMargin = desiredMargin < 100 ? cost / (1 - desiredMargin / 100) : 0;

  const fixed = rent + labor + utilities + other;
  const contribution = avgCheck * (1 - foodPct / 100 - varPct / 100);
  const checksMonth = contribution > 0 ? fixed / contribution : Infinity;
  const checksDay = daysOpen > 0 ? checksMonth / daysOpen : Infinity;

  return (
    <div className="grid">
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h2>{t('calc.marginTitle')}</h2>
        <p className="muted">{t('calc.marginIntro')}</p>
        <div className="form-grid">
          <Field label={t('calc.yourCost')}><NumInput value={cost} onChange={setCost} /></Field>
          <Field label={t('calc.sellingPrice')}><NumInput value={price} onChange={setPrice} /></Field>
        </div>
        <div className="result-box" style={{ marginTop: 14 }}>
          <div className="kv"><span>{t('calc.profit')}</span><strong>{money(price - cost)}</strong></div>
          <div className="kv"><span>{t('calc.marginLine')}</span><strong>{pct(margin)}</strong></div>
          <div className="kv"><span>{t('calc.markupLine')}</span><strong>{pct(markup)}</strong></div>
          <div className="kv"><span>{t('calc.costPctLine')}</span><strong>{pct(price ? cost / price : 0)}</strong></div>
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <Field label={t('calc.wantMargin')}><div className="input-unit"><NumInput value={desiredMargin} onChange={setDesiredMargin} /><span>%</span></div></Field>
          <div className="result-box"><div className="muted">{t('calc.charge')}</div><div className="result-big">{money(priceForMargin)}</div></div>
        </div>
      </div>

      <div className="card">
        <h2>{t('calc.breakEven')}</h2>
        <p className="muted">{t('calc.breakEvenIntro')}</p>
        <div className="form-grid">
          <Field label={t('calc.rent')}><NumInput value={rent} onChange={setRent} /></Field>
          <Field label={t('calc.labor')}><NumInput value={labor} onChange={setLabor} /></Field>
          <Field label={t('calc.utilities')}><NumInput value={utilities} onChange={setUtilities} /></Field>
          <Field label={t('calc.other')}><NumInput value={other} onChange={setOther} /></Field>
          <Field label={t('calc.avgCheck')}><NumInput value={avgCheck} onChange={setAvgCheck} /></Field>
          <Field label={t('calc.foodCost')}><div className="input-unit"><NumInput value={foodPct} onChange={setFoodPct} /><span>%</span></div></Field>
          <Field label={t('calc.varCosts')} hint={t('calc.varHint')}><div className="input-unit"><NumInput value={varPct} onChange={setVarPct} /><span>%</span></div></Field>
          <Field label={t('calc.daysOpen')}><NumInput value={daysOpen} onChange={setDaysOpen} /></Field>
        </div>
        <div className="result-box" style={{ marginTop: 14 }}>
          <div className="kv"><span>{t('calc.fixedCosts')}</span><strong>{money(fixed)}</strong></div>
          <div className="kv"><span>{t('calc.keepPerCheck')}</span><strong>{money(contribution)}</strong></div>
          <div className="kv"><span>{t('calc.beSales')}</span><strong>{Number.isFinite(checksMonth) ? money(checksMonth * avgCheck) : '—'}</strong></div>
          <div className="kv"><span>{t('calc.checksMonth')}</span><strong>{Number.isFinite(checksMonth) ? fmtInt(Math.ceil(checksMonth)) : '—'}</strong></div>
          <div className="result-big" style={{ fontSize: '1.4rem' }}>{Number.isFinite(checksDay) ? t('calc.checksDay', { n: fmtInt(Math.ceil(checksDay)) }) : t('calc.costsExceed')}</div>
        </div>
      </div>
    </div>
    <BreakEvenDetail
      costs={[
        { key: 'rent', label: t('calc.be.rent'), value: rent },
        { key: 'labor', label: t('calc.be.labor'), value: labor },
        { key: 'utilities', label: t('calc.be.utilities'), value: utilities },
        { key: 'other', label: t('calc.be.other'), value: other },
      ]}
      foodPct={foodPct}
      varPct={varPct}
      daysOpen={daysOpen}
    />
    </div>
  );
}

const COST_SLOTS = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)'];

/**
 * The break-even worked out per fixed cost and per dish: what each cost is per day, and how many of
 * each menu dish you'd have to sell (on its own) to pay for it. Dishes use their real recipe cost;
 * a dish with no recipe uses the food-cost % above as an estimate.
 */
function BreakEvenDetail({ costs, foodPct, varPct, daysOpen }: { costs: { key: string; label: string; value: number }[]; foodPct: number; varPct: number; daysOpen: number }) {
  const { state, money } = useStore();
  const { t, lang } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [exampleId, setExampleId] = useState('');
  const fixed = costs.reduce((a, c) => a + c.value, 0);
  const days = daysOpen > 0 ? daysOpen : 30;

  const dishes = state.menu.filter((m) => m.active && m.price > 0).map((m) => {
    const d = dishDefaults(state, m);
    const estimated = !d.recipe.length;
    const cost = estimated ? d.price * foodPct / 100 : d.cost;
    const keep = d.price - cost - d.price * varPct / 100;
    return { m, price: d.price, cost, keep, estimated, perMonth: keep > 0 ? fixed / keep : Infinity };
  }).sort((a, b) => a.perMonth - b.perMonth);
  const shown = showAll ? dishes : dishes.slice(0, 8);
  const example = dishes.find((d) => d.m.id === exampleId) ?? dishes[Math.floor(dishes.length / 2)];
  const n = (x: number) => (Number.isFinite(x) ? fmtInt(Math.ceil(x)) : '—');
  const [hi, setHi] = useState<string | null>(null);

  if (fixed <= 0) return null;
  return (
    <div className="card be-detail">
      <div className="card-head">
        <div>
          <h2>{t('calc.be.title')}</h2>
          <p>{t('calc.be.intro')}</p>
        </div>
      </div>

      <div className="be-top">
        <div>
          <h3>{t('calc.be.costsTitle')}</h3>
          <div className="be-bar" role="img" aria-label={t('calc.be.costsTitle')}>
            {costs.filter((c) => c.value > 0).map((c) => (
              <span
                key={c.key}
                style={{ flexGrow: c.value, background: COST_SLOTS[costs.indexOf(c)], opacity: hi && hi !== c.key ? 0.35 : 1 }}
                onPointerEnter={() => setHi(c.key)} onPointerLeave={() => setHi(null)}
                title={`${c.label}: ${money(c.value)} (${pct(c.value / fixed)})`}
              />
            ))}
          </div>
          <table className="table compact be-costs">
            <thead><tr><th>{t('calc.be.col.cost')}</th><th className="num">{t('calc.be.col.month')}</th><th className="num">{t('calc.be.col.day')}</th><th className="num">{t('calc.be.col.share')}</th></tr></thead>
            <tbody>
              {costs.map((c, i) => (
                <tr key={c.key} className={hi === c.key ? 'hi' : ''} onPointerEnter={() => setHi(c.key)} onPointerLeave={() => setHi(null)}>
                  <td><span className="legend-chip" style={{ background: COST_SLOTS[i] }} aria-hidden /> {c.label}</td>
                  <td className="num">{money(c.value)}</td>
                  <td className="num">{money(c.value / days)}</td>
                  <td className="num muted">{pct(c.value / fixed)}</td>
                </tr>
              ))}
              <tr className="total"><td>{t('calc.be.total')}</td><td className="num">{money(fixed)}</td><td className="num">{money(fixed / days)}</td><td className="num muted">100%</td></tr>
            </tbody>
          </table>
        </div>

        {example && (
          <div className="be-example">
            <div className="be-example-head">
              <h3>{t('calc.be.exampleTitle')}</h3>
              <Select value={example.m.id} onChange={(e) => setExampleId(e.target.value)} aria-label={t('calc.be.pickDish')}>
                {dishes.map((d) => <option key={d.m.id} value={d.m.id}>{dishName(d.m, lang)}</option>)}
              </Select>
            </div>
            <p className="be-sentence">
              {t('calc.be.exampleLine', { dish: dishName(example.m, lang), price: money(example.price), cost: money(example.cost), fees: money(example.price * varPct / 100), keep: money(example.keep) })}
            </p>
            {example.keep > 0 ? (
              <>
                <ul className="be-steps">
                  {costs.filter((c) => c.value > 0).map((c) => (
                    <li key={c.key}>
                      <span className="legend-chip" style={{ background: COST_SLOTS[costs.indexOf(c)] }} aria-hidden />
                      <span>{t('calc.be.toCover', { cost: c.label, amount: money(c.value) })}</span>
                      <strong>{t('calc.be.plates', { n: n(c.value / example.keep) })}</strong>
                    </li>
                  ))}
                </ul>
                <div className="be-answer">
                  <span>{t('calc.be.allFixed')}</span>
                  <strong>{t('calc.be.platesMonth', { n: n(example.perMonth) })}</strong>
                  <span className="be-answer-day">{t('calc.be.perDay', { n: n(example.perMonth / days), days })}</span>
                </div>
                {example.estimated && <p className="muted be-note">{t('calc.be.estimated', { pct: foodPct })}</p>}
              </>
            ) : <div className="callout bad">{t('calc.be.noProfit')}</div>}
          </div>
        )}
      </div>

      {dishes.length > 0 ? (
        <>
          <h3 style={{ margin: '22px 0 4px' }}>{t('calc.be.dishesTitle')}</h3>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>{t('calc.be.dishesHint')}</p>
          <div className="table-wrap">
            <table className="table compact be-dishes">
              <thead>
                <tr>
                  <th>{t('calc.be.col.dish')}</th>
                  <th className="num">{t('calc.be.col.keep')}</th>
                  {costs.map((c, i) => <th key={c.key} className="num"><span className="legend-chip" style={{ background: COST_SLOTS[i] }} aria-hidden /> {c.label}</th>)}
                  <th className="num">{t('calc.be.col.allMonth')}</th>
                  <th className="num">{t('calc.be.col.perDay')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.m.id} className={d.m.id === example?.m.id ? 'hi' : 'clickable'} onClick={() => setExampleId(d.m.id)}>
                    <td>
                      <strong>{dishName(d.m, lang)}</strong>
                      <div className="sub">{money(d.price)}{d.estimated ? ` · ${t('calc.be.est')}` : ''}</div>
                    </td>
                    <td className="num">{d.keep > 0 ? money(d.keep) : <span className="bad-text">{money(d.keep)}</span>}</td>
                    {costs.map((c) => <td key={c.key} className="num">{d.keep > 0 ? n(c.value / d.keep) : '—'}</td>)}
                    <td className="num"><strong>{n(d.perMonth)}</strong></td>
                    <td className="num"><strong>{n(d.perMonth / days)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dishes.length > 8 && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => setShowAll(!showAll)}>{showAll ? t('calc.be.showLess') : t('calc.be.showAll', { n: dishes.length })}</button>}
          <p className="muted be-note">{t('calc.be.mixNote')}</p>
        </>
      ) : <p className="muted">{t('calc.be.noDishes')}</p>}
    </div>
  );
}
