import { useMemo, useState } from 'react';
import type { Page } from '../App';
import { useStore } from '../store';
import { netSales, onHand, orderCogs, recipeCost } from '../inventory';
import { BarChart, Empty, Pill, Stat, Tabs } from '../components/ui';
import { addDays, expiryLabel, fmtInt, fmtLongDate, fmtQty, localDate, orderDay, parseDate, pct } from '../utils';
import { useI18n } from '../i18n';
import type { Order } from '../types';

type Range = '1' | '7' | '30';

function summarize(orders: Order[]) {
  const net = orders.reduce((a, o) => a + netSales(o), 0);
  const cogs = orders.reduce((a, o) => a + orderCogs(o), 0);
  // GP the delivery apps kept on imported app orders
  const fees = orders.reduce((a, o) => a + (o.appFee ?? 0), 0);
  return { net, cogs, fees, count: orders.length, tips: orders.reduce((a, o) => a + o.tip, 0), avg: orders.length ? net / orders.length : 0, fc: net ? cogs / net : 0 };
}

function Delta({ now, prev, invert }: { now: number; prev: number; invert?: boolean }) {
  useI18n();
  if (!prev) return null;
  const d = (now - prev) / prev;
  const good = invert ? d <= 0 : d >= 0;
  return <span className={good ? 'delta-up' : 'delta-down'}>{d >= 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(0)}%</span>;
}

export default function Dashboard({ go }: { go: (p: Page) => void }) {
  const { state, money } = useStore();
  const { t, lang } = useI18n();
  const [range, setRange] = useState<Range>('7');
  const s = state.settings;
  const today = localDate();
  const days = Number(range);
  const start = addDays(today, -(days - 1));
  const prevStart = addDays(start, -days);

  const paid = useMemo(() => state.orders.filter((o) => o.status === 'paid').map((o) => ({ o, day: orderDay(o.createdAt) })), [state.orders]);
  const cur = paid.filter((x) => x.day >= start && x.day <= today).map((x) => x.o);
  const prev = paid.filter((x) => x.day >= prevStart && x.day < start).map((x) => x.o);
  const now = summarize(cur);
  const before = summarize(prev);
  // Everything bought in the range (stock and running costs), from the Purchases page
  const spent = (state.purchases ?? []).filter((p) => p.date >= start && p.date <= today).reduce((a, p) => a + p.total, 0);
  const target = s.targetFoodCost / 100;

  const waste = state.adjustments
    .filter((a) => (a.reason === 'waste' || a.reason === 'expired') && orderDay(a.at) >= start)
    .reduce((a, x) => a + x.cost, 0);
  const invValue = state.batches.reduce((a, b) => a + b.qtyRemaining * b.unitCost, 0);

  // Daily sales for the last 14 days
  const daily = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(today, i - 13);
    const v = paid.filter((x) => x.day === d).reduce((a, x) => a + netSales(x.o), 0);
    return { label: String(parseDate(d).getDate()), value: v, highlight: d >= start };
  });

  // Busiest hours in range
  const hours = Array.from({ length: 24 }, () => 0);
  cur.forEach((o) => { hours[new Date(o.createdAt).getHours()] += 1; });
  const firstHour = hours.findIndex((h) => h > 0);
  const lastHour = 23 - [...hours].reverse().findIndex((h) => h > 0);
  const hourData = firstHour < 0 ? [] : hours.slice(firstHour, lastHour + 1).map((v, i) => {
    const h = firstHour + i;
    return { label: lang === 'th' ? `${String(h).padStart(2, '0')}:00` : `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`, value: v };
  });
  const peak = hourData.length ? hourData.reduce((a, b) => (b.value > a.value ? b : a)) : null;

  // Top sellers
  const top = new Map<string, { name: string; qty: number; revenue: number; cost: number }>();
  for (const o of cur) for (const l of o.lines) {
    const acc = top.get(l.name) ?? { name: l.name, qty: 0, revenue: 0, cost: 0 };
    acc.qty += l.qty; acc.revenue += l.price * l.qty; acc.cost += l.unitCost * l.qty;
    top.set(l.name, acc);
  }
  const topList = [...top.values()].sort((a, b) => b.revenue - a.revenue);

  // Alerts
  const itemsById = new Map(state.items.map((i) => [i.id, i]));
  const expiring = state.batches
    .filter((b) => b.qtyRemaining > 0 && b.expiresAt && expiryLabel(b.expiresAt).days <= s.expiryWarnDays && itemsById.has(b.itemId))
    .sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!));
  const low = state.items
    .filter((i) => i.parLevel > 0 && onHand(state, i.id) <= i.parLevel)
    .map((i) => ({ i, qty: onHand(state, i.id) }))
    .sort((a, b) => a.qty / a.i.parLevel - b.qty / b.i.parLevel);
  const overCost = state.menu
    .filter((m) => m.active && m.recipe.length && m.price > 0)
    .map((m) => ({ m, fc: recipeCost(state, m.recipe) / m.price }))
    .filter((x) => x.fc > target)
    .sort((a, b) => b.fc - a.fc);

  const rangeLabel = range === '1' ? t('dashboard.range.today') : t('dashboard.range.lastDays', { n: days });
  const prevLabel = range === '1' ? t('dashboard.prev.yesterday') : t('dashboard.prev.days', { n: days });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('common.nav.dashboard')}</h1>
          <p>{fmtLongDate(today)} · {s.storeName}</p>
        </div>
        <Tabs<Range> value={range} onChange={setRange} tabs={[{ id: '1', label: t('dashboard.tab.today') }, { id: '7', label: t('dashboard.tab.days', { n: 7 }) }, { id: '30', label: t('dashboard.tab.days', { n: 30 }) }]} />
      </div>

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <Stat label={t('dashboard.stat.netSales', { range: rangeLabel })} value={money(now.net)} sub={<><Delta now={now.net} prev={before.net} /> {prevLabel}</>} />
        <Stat label={t('dashboard.stat.orders')} value={fmtInt(now.count)} sub={<><Delta now={now.count} prev={before.count} /> {prevLabel}</>} />
        <Stat label={t('dashboard.stat.avgTicket')} value={money(now.avg)} sub={<><Delta now={now.avg} prev={before.avg} /> {prevLabel}</>} />
        <Stat
          label={t('dashboard.stat.foodCost')}
          value={now.net ? pct(now.fc) : '—'}
          tone={!now.net ? undefined : now.fc <= target ? 'good' : now.fc <= target + 0.05 ? 'warn' : 'bad'}
          sub={t('dashboard.stat.foodCostSub', { target: s.targetFoodCost, cogs: money(now.cogs) })}
        />
        <Stat
          label={t('dashboard.stat.grossProfit')}
          value={money(now.net - now.cogs - now.fees)}
          sub={now.fees > 0 ? t('dashboard.stat.grossProfitSubFees', { fees: money(now.fees) }) : t('dashboard.stat.grossProfitSub')}
        />
        <Stat label={t('dashboard.stat.waste')} value={money(waste)} tone={waste > 0 ? 'warn' : undefined} sub={now.net ? t('dashboard.stat.wasteSub', { pct: pct(waste / now.net) }) : rangeLabel} />
        <Stat label={t('dashboard.stat.purchases')} value={money(spent)} sub={<button className="link-btn" onClick={() => go('purchases')}>{t('dashboard.stat.purchasesSub')}</button>} />
        <Stat
          label={t('dashboard.stat.cashLeft')}
          value={money(now.net - now.fees - spent)}
          tone={spent && now.net - now.fees - spent < 0 ? 'bad' : undefined}
          sub={t('dashboard.stat.cashLeftSub')}
        />
        <Stat label={t('dashboard.stat.inventory')} value={money(invValue)} sub={t('dashboard.stat.inventorySub', { n: fmtInt(state.batches.filter((b) => b.qtyRemaining > 0).length) })} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><div><h2>{t('dashboard.daily.title')}</h2><p>{t('dashboard.daily.sub')}</p></div></div>
          <BarChart data={daily} format={money} />
        </div>
        <div className="card">
          <div className="card-head"><div><h2>{t('dashboard.hours.title')}</h2><p>{t('dashboard.hours.sub', { range: rangeLabel })}{peak ? t('dashboard.hours.peak', { hour: peak.label }) : ''}</p></div></div>
          {hourData.length ? <BarChart data={hourData} format={(n) => (n === 1 ? t('dashboard.hours.orderOne') : t('dashboard.hours.ordersN', { n: fmtInt(n) }))} /> : <Empty title={t('dashboard.noOrders')} />}
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-head"><h2>{t('dashboard.expiring.title')}</h2><button className="btn sm" onClick={() => go('inventory')}>{t('common.nav.inventory')}</button></div>
          {expiring.length === 0 ? <Empty title={t('dashboard.expiring.empty')} /> : (
            <div className="alert-list">
              {expiring.slice(0, 8).map((b) => {
                const it = itemsById.get(b.itemId)!;
                const e = expiryLabel(b.expiresAt);
                return (
                  <div key={b.id} className="alert-item">
                    <div className="grow"><strong>{it.name}</strong><div className="muted" style={{ fontSize: 12.5 }}>{fmtQty(b.qtyRemaining)} {it.unit} · {b.location}</div></div>
                    <Pill tone={e.tone}>{e.text}</Pill>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>{t('dashboard.low.title')}</h2><button className="btn sm" onClick={() => go('inventory')}>{t('common.nav.inventory')}</button></div>
          {low.length === 0 ? <Empty title={t('dashboard.low.empty')} /> : (
            <div className="alert-list">
              {low.slice(0, 8).map(({ i, qty }) => (
                <div key={i.id} className="alert-item">
                  <div className="grow">
                    <strong>{i.name}</strong>
                    <div className="muted" style={{ fontSize: 12.5 }}>{t('dashboard.low.par', { qty: fmtQty(qty), par: fmtQty(i.parLevel), unit: i.unit })}{i.kind === 'prep' ? t('dashboard.low.prep') : i.supplier ? ` · ${i.supplier}` : ''}</div>
                    <div className={`meter ${qty === 0 ? 'bad' : 'warn'}`} style={{ marginTop: 4 }}><div style={{ width: `${Math.min(100, (qty / i.parLevel) * 100)}%` }} /></div>
                  </div>
                  {qty === 0 ? <Pill tone="bad">{t('dashboard.low.out')}</Pill> : <Pill tone="warn">{t('dashboard.low.low')}</Pill>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>{t('dashboard.over.title')}</h2><button className="btn sm" onClick={() => go('menu')}>{t('common.nav.menu')}</button></div>
          {overCost.length === 0 ? <Empty title={t('dashboard.over.empty', { target: s.targetFoodCost })} /> : (
            <div className="alert-list">
              {overCost.slice(0, 8).map(({ m, fc }) => (
                <div key={m.id} className="alert-item">
                  <div className="grow"><strong>{m.name}</strong><div className="muted" style={{ fontSize: 12.5 }}>{t('dashboard.over.priceAt', { price: money(m.price), suggested: money(recipeCost(state, m.recipe) / target) })}</div></div>
                  <Pill tone={fc > target + 0.05 ? 'bad' : 'warn'}>{pct(fc)}</Pill>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>{t('dashboard.perf.title')}</h2><p>{t('dashboard.perf.sub', { range: rangeLabel })}</p></div><button className="btn sm" onClick={() => go('orders')}>{t('dashboard.perf.allOrders')}</button></div>
        {topList.length === 0 ? <Empty title={t('dashboard.perf.empty')}>{t('dashboard.perf.emptyHint')}</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('dashboard.col.item')}</th><th className="num">{t('dashboard.col.sold')}</th><th className="num">{t('dashboard.col.revenue')}</th><th className="num">{t('dashboard.col.ingredientCost')}</th><th className="num">{t('dashboard.col.foodCost')}</th><th className="num">{t('dashboard.col.profit')}</th><th style={{ width: '22%' }}>{t('dashboard.col.share')}</th></tr></thead>
              <tbody>
                {topList.map((row) => {
                  const fc = row.revenue ? row.cost / row.revenue : 0;
                  const gross = cur.reduce((a, o) => a + o.subtotal, 0);
                  return (
                    <tr key={row.name}>
                      <td><strong>{row.name}</strong></td>
                      <td className="num">{fmtQty(row.qty)}</td>
                      <td className="num">{money(row.revenue)}</td>
                      <td className="num">{money(row.cost)}</td>
                      <td className="num"><Pill tone={fc <= target ? 'ok' : fc <= target + 0.05 ? 'warn' : 'bad'}>{pct(fc)}</Pill></td>
                      <td className="num">{money(row.revenue - row.cost)}</td>
                      <td><div className="meter"><div style={{ width: `${gross ? (row.revenue / gross) * 100 : 0}%` }} /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
