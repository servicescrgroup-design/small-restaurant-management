import { useState } from 'react';
import type { Page } from '../App';
import { useStore } from '../store';
import { IngredientPicker } from '../components/Recipe';
import { useAuth } from '../auth';
import { unitCost } from '../inventory';
import { Field, NumInput, Tabs } from '../components/ui';
import { MenuItemModal, foodCostTone } from './Menu';
import type { MenuItem } from '../types';
import { fmtInt, fmtQty, pct, uid } from '../utils';
import { useI18n } from '../i18n';

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
  const isOwner = useAuth().user?.role === 'owner';
  const items = [...state.items].sort((a, b) => a.name.localeCompare(b.name));

  const lineCost = (l: Line) =>
    l.kind === 'inv'
      ? unitCost(state, l.itemId) * l.qty
      : l.packQty > 0 && l.yieldPct > 0 ? (l.packPrice / l.packQty) * l.useQty / (l.yieldPct / 100) : 0;
  const ingredients = lines.reduce((a, l) => a + lineCost(l), 0);
  const plate = ingredients * (1 + qFactor / 100) + packaging;
  const fc = price > 0 ? plate / price : 0;
  const suggested = target > 0 ? plate / (target / 100) : 0;
  const roundUp = (n: number) => Math.max(0.99, Math.ceil(n) - 0.01 < n ? Math.ceil(n) + 0.99 : Math.ceil(n) - 0.01);

  const patch = (id: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...p } as Line) : l)));
  const addInv = () => items[0] && setLines((ls) => [...ls, { id: uid(), kind: 'inv', itemId: items[0].id, qty: 1 }]);
  const addCustom = () => setLines((ls) => [...ls, { id: uid(), kind: 'custom', name: '', packPrice: 0, packQty: 1, packUnit: 'lb', useQty: 0, yieldPct: 100 }]);
  const customCount = lines.filter((l) => l.kind === 'custom').length;

  const toMenu = () => setAdding({
    id: uid(), name: name.trim() || t('calc.newDish'), category: s.menuCategories[0] ?? 'Mains', price: price || roundUp(suggested), active: true,
    recipe: lines.filter((l): l is Extract<Line, { kind: 'inv' }> => l.kind === 'inv').map((l) => ({ itemId: l.itemId, qty: l.qty })),
  });

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(280px, 1fr)', alignItems: 'start' }}>
      <div className="card">
        <Field label={t('calc.dishName')}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('calc.dishPlaceholder')} /></Field>
        <h3 style={{ margin: '18px 0 8px' }}>{t('calc.perPlate')}</h3>
        <div className="table-wrap">
          <table className="table compact">
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
      </div>

      <div className="grid">
        <div className="card">
          <div className="result-box">
            <div className="muted">{t('calc.plateCost')}</div>
            <div className="result-big">{money(plate)}</div>
            <div className="kv"><span>{t('calc.ingredients')}</span><span>{money(ingredients)}</span></div>
            <div className="kv"><span>{t('calc.qFactor')}</span><span>{money(ingredients * qFactor / 100)}</span></div>
            {packaging > 0 && <div className="kv"><span>{t('calc.packaging')}</span><span>{money(packaging)}</span></div>}
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

// ---------- Yield ----------

function YieldCalc() {
  const { money } = useStore();
  const { t } = useI18n();
  const [apPrice, setApPrice] = useState(28);
  const [apQty, setApQty] = useState(10);
  const [unit, setUnit] = useState('lb');
  const [usable, setUsable] = useState(7.2);
  const [portion, setPortion] = useState(0.375);
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
  const { t, lang } = useI18n();
  const preps = state.items.filter((i) => i.kind === 'prep');
  const [origYield, setOrigYield] = useState(10);
  const [newYield, setNewYield] = useState(25);
  const [yieldUnit, setYieldUnit] = useState('servings');
  const [lines, setLines] = useState<ScaleLine[]>([{ id: uid(), name: '', qty: 0, unit: '', cost: 0 }]);
  const factor = origYield > 0 ? newYield / origYield : 0;
  const totalCost = lines.reduce((a, l) => a + l.cost * l.qty, 0) * factor;

  const load = (id: string) => {
    const p = state.items.find((i) => i.id === id);
    if (!p) return;
    setOrigYield(p.yieldQty ?? 1);
    setYieldUnit(p.unit);
    setLines((p.recipe ?? []).map((r) => {
      const it = state.items.find((x) => x.id === r.itemId);
      return { id: uid(), name: it?.name ?? '?', qty: r.qty, unit: it?.unit ?? '', cost: unitCost(state, r.itemId) };
    }));
  };
  const patch = (id: string, p: Partial<ScaleLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>{t('calc.tab.scale')}</h2><p>{t('calc.scaleIntro')}</p></div>
        {preps.length > 0 && (
          <select style={{ width: 240 }} value="" onChange={(e) => load(e.target.value)}>
            <option value="">{t('calc.loadPrep')}</option>
            {preps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
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
      {totalCost > 0 && (
        <div className="result-box" style={{ marginTop: 16, maxWidth: 420 }}>
          <div className="kv"><span>{t('calc.batchCost')}</span><strong>{money(totalCost)}</strong></div>
          <div className="kv"><span>{t('calc.costPer', { unit: lang === 'en' ? yieldUnit.replace(/s$/, '') : yieldUnit })}</span><strong>{money(newYield ? totalCost / newYield : 0)}</strong></div>
        </div>
      )}
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
  );
}
