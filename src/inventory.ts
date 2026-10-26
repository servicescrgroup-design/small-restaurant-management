import type { AdjReason, AppState, Batch, MenuItem, MenuOption, Order, OrderType, RecipeLine } from './types';
import { addDays, localDate, round, uid } from './utils';

const EPS = 1e-9;

export const liveBatches = (s: AppState, itemId: string) =>
  s.batches.filter((b) => b.itemId === itemId && b.qtyRemaining > EPS);

export const onHand = (s: AppState, itemId: string) =>
  liveBatches(s, itemId).reduce((a, b) => a + b.qtyRemaining, 0);

/** Weighted-average cost of what's on hand; falls back to last batch, then recipe, then default cost. */
export function unitCost(s: AppState, itemId: string, depth = 0): number {
  const live = liveBatches(s, itemId);
  const qty = live.reduce((a, b) => a + b.qtyRemaining, 0);
  if (qty > EPS) return live.reduce((a, b) => a + b.qtyRemaining * b.unitCost, 0) / qty;

  const last = s.batches
    .filter((b) => b.itemId === itemId)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  if (last) return last.unitCost;

  const item = s.items.find((i) => i.id === itemId);
  if (!item) return 0;
  if (item.kind === 'prep' && item.recipe?.length && item.yieldQty && depth < 5) {
    return recipeCost(s, item.recipe, depth + 1) / item.yieldQty;
  }
  return item.defaultCost || 0;
}

export type Choices = Record<string, string[]>;

/** Which menu tab a dish shows under. */
export function tabOf(m: MenuItem, tabs: string[]) {
  if (m.tab && tabs.includes(m.tab)) return m.tab;
  return tabs.find((t) => t.toLowerCase() === m.category.toLowerCase()) ?? tabs[0] ?? '';
}

/** The pre-selected choices: the first option of every required group. */
export function defaultChoices(m: MenuItem): Choices {
  const c: Choices = {};
  for (const g of m.optionGroups ?? []) if (g.required && g.options[0]) c[g.id] = [g.options[0].id];
  return c;
}

export const sameChoices = (a: Choices = {}, b: Choices = {}) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => [...(a[k] ?? [])].sort().join() === [...(b[k] ?? [])].sort().join());
};

/** Price, label and per-unit ingredients for a dish with the given choices. */
export function resolveDish(m: MenuItem | undefined, choices: Choices = {}) {
  if (!m) return { price: 0, label: '', recipe: [] as RecipeLine[], picked: [] as MenuOption[] };
  const picked: MenuOption[] = [];
  const extras = new Set<MenuOption>();
  for (const g of m.optionGroups ?? []) for (const id of choices[g.id] ?? []) {
    const o = g.options.find((x) => x.id === id);
    if (!o) continue;
    picked.push(o);
    if (g.multi) extras.add(o);
  }
  // A size scales the dish and its main picks (rice, meat); add-on extras stay as entered.
  const scale = picked.reduce((a, o) => a * (o.scale || 1), 1);
  const merged = new Map<string, number>();
  const addAll = (lines: RecipeLine[], k: number) => { for (const l of lines) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty * k); };
  addAll(m.recipe, scale);
  for (const o of picked) addAll(o.recipe, extras.has(o) ? 1 : scale);
  return {
    price: Math.max(0, m.price + picked.reduce((a, o) => a + o.price, 0)),
    label: picked.map((o) => o.name).join(', '),
    recipe: [...merged].map(([itemId, qty]) => ({ itemId, qty })),
    picked,
  };
}

/**
 * What a dish costs the customer with these choices. Delivery orders use the dish's confirmed
 * delivery-app price for its first choices, and other choices add the same amount as in the shop.
 * Dishes without a delivery price keep their shop price.
 */
export function priceFor(m: MenuItem | undefined, choices: Choices = {}, type?: OrderType) {
  const dish = resolveDish(m, choices);
  if (type !== 'Delivery' || !m?.deliveryPrice) return dish.price;
  return Math.max(0, round(m.deliveryPrice + dish.price - resolveDish(m, defaultChoices(m)).price));
}

/** True when a delivery order will charge this dish's delivery price. */
export const usesDeliveryPrice = (m: MenuItem | undefined, type?: OrderType) => type === 'Delivery' && !!m?.deliveryPrice;

/** Which required groups are still missing a choice. */
export const missingGroups = (m: MenuItem, choices: Choices) =>
  (m.optionGroups ?? []).filter((g) => g.required && !(choices[g.id]?.length));

export const recipeCost = (s: AppState, lines: RecipeLine[], depth = 0) =>
  lines.reduce((a, l) => a + l.qty * unitCost(s, l.itemId, depth), 0);

/** First-expired, first-out: soonest expiry first, then oldest received. */
export function sortFEFO(a: Batch, b: Batch) {
  const ea = a.expiresAt ?? '9999-99-99';
  const eb = b.expiresAt ?? '9999-99-99';
  return ea.localeCompare(eb) || a.receivedAt.localeCompare(b.receivedAt);
}

export const nextExpiry = (s: AppState, itemId: string) =>
  liveBatches(s, itemId).sort(sortFEFO)[0]?.expiresAt;

/** How many of a menu item can be made from current stock (ignoring items with no recipe). */
export function servingsAvailable(s: AppState, recipe: RecipeLine[], reserved: Record<string, number> = {}) {
  let max = Infinity;
  for (const l of recipe) {
    if (l.qty <= 0) continue;
    const avail = onHand(s, l.itemId) - (reserved[l.itemId] ?? 0);
    max = Math.min(max, Math.floor((avail + EPS) / l.qty));
  }
  return Math.max(0, max);
}

/**
 * Remove stock from an item FEFO. Mutates the draft state. Returns the cost of what was used.
 * If there isn't enough stock, the shortfall is costed at the item's last known cost.
 */
export function consume(
  d: AppState,
  itemId: string,
  qty: number,
  opts: { reason?: AdjReason; note?: string; log: boolean },
): number {
  let remaining = qty;
  let cost = 0;
  const at = new Date().toISOString();
  for (const b of liveBatches(d, itemId).sort(sortFEFO)) {
    if (remaining <= EPS) break;
    const take = Math.min(b.qtyRemaining, remaining);
    b.qtyRemaining = round(b.qtyRemaining - take, 4);
    remaining -= take;
    cost += take * b.unitCost;
    if (opts.log && opts.reason) {
      d.adjustments.push({ id: uid(), at, itemId, batchId: b.id, qty: -take, cost: take * b.unitCost, reason: opts.reason, note: opts.note });
    }
  }
  if (remaining > EPS) {
    const c = remaining * unitCost(d, itemId);
    cost += c;
    if (opts.log && opts.reason) {
      d.adjustments.push({
        id: uid(), at, itemId, qty: -remaining, cost: c, reason: opts.reason,
        note: [opts.note, 'short — not enough stock on hand'].filter(Boolean).join(' · '),
      });
    }
  }
  return cost;
}

/** Drop emptied batches, keeping the most recent one per item so its cost is remembered. */
function pruneBatches(d: AppState) {
  const newest = new Map<string, Batch>();
  for (const b of d.batches) {
    const cur = newest.get(b.itemId);
    if (!cur || b.receivedAt >= cur.receivedAt) newest.set(b.itemId, b);
  }
  const keep = new Set([...newest.values()].map((b) => b.id));
  d.batches = d.batches.filter((b) => b.qtyRemaining > EPS || keep.has(b.id));
}

// ---------- Actions (all mutate a draft copy of state) ----------

export interface ReceiveInput {
  itemId: string;
  qty: number;
  unitCost: number;
  receivedAt: string;
  expiresAt?: string;
  lot?: string;
  location?: string;
  note?: string;
}

export function receiveStock(d: AppState, p: ReceiveInput) {
  const item = d.items.find((i) => i.id === p.itemId);
  if (!item || p.qty <= 0) return;
  const expiresAt = p.expiresAt || (item.shelfLifeDays > 0 ? addDays(p.receivedAt, item.shelfLifeDays) : undefined);
  const b: Batch = {
    id: uid(), itemId: p.itemId, qtyReceived: p.qty, qtyRemaining: p.qty, unitCost: p.unitCost,
    receivedAt: p.receivedAt, expiresAt, lot: p.lot || undefined, location: p.location || item.location, note: p.note,
  };
  d.batches.push(b);
  d.adjustments.push({
    id: uid(), at: new Date().toISOString(), itemId: p.itemId, batchId: b.id, qty: p.qty,
    cost: p.qty * p.unitCost, reason: 'received', note: p.lot ? `Lot ${p.lot}` : p.note,
  });
}

/** Cook a prep recipe: pulls ingredients from stock and creates a new batch of servings. */
export function makePrepBatch(d: AppState, p: { itemId: string; multiplier: number; madeOn: string; expiresAt?: string; note?: string }) {
  const item = d.items.find((i) => i.id === p.itemId);
  if (!item || item.kind !== 'prep' || !item.yieldQty || p.multiplier <= 0) return;
  let cost = 0;
  for (const l of item.recipe ?? []) {
    cost += consume(d, l.itemId, l.qty * p.multiplier, { reason: 'prep-used', note: `Used for ${item.name}`, log: true });
  }
  const qty = item.yieldQty * p.multiplier;
  const expiresAt = p.expiresAt || (item.shelfLifeDays > 0 ? addDays(p.madeOn, item.shelfLifeDays) : undefined);
  const b: Batch = {
    id: uid(), itemId: item.id, qtyReceived: qty, qtyRemaining: qty, unitCost: qty ? cost / qty : 0,
    receivedAt: p.madeOn, expiresAt, location: item.location, note: p.note, lot: `Prep ${p.madeOn}`,
  };
  d.batches.push(b);
  d.adjustments.push({ id: uid(), at: new Date().toISOString(), itemId: item.id, batchId: b.id, qty, cost, reason: 'prep-made', note: p.note });
  pruneBatches(d);
}

/** Record a paid order and deduct its ingredients from stock. */
export function recordSale(d: AppState, order: Order) {
  const o: Order = structuredClone(order);
  for (const line of o.lines) {
    const mi = d.menu.find((m) => m.id === line.menuItemId);
    let cost = 0;
    for (const rl of line.recipe ?? mi?.recipe ?? []) cost += consume(d, rl.itemId, rl.qty * line.qty, { log: false });
    line.unitCost = line.qty ? cost / line.qty : 0;
    delete line.recipe; // only needed to deduct stock; keeps saved history small
  }
  d.orders.push(o);
  d.settings.nextOrderNumber = Math.max(d.settings.nextOrderNumber, o.number) + 1;
  pruneBatches(d);
}

export function discardFromBatch(d: AppState, batchId: string, qty: number, reason: 'waste' | 'expired', note?: string) {
  const b = d.batches.find((x) => x.id === batchId);
  if (!b) return;
  const take = Math.min(qty, b.qtyRemaining);
  if (take <= 0) return;
  b.qtyRemaining = round(b.qtyRemaining - take, 4);
  d.adjustments.push({ id: uid(), at: new Date().toISOString(), itemId: b.itemId, batchId, qty: -take, cost: take * b.unitCost, reason, note });
  pruneBatches(d);
}

/** Physical count: set on-hand to what's actually on the shelf. */
export function setCount(d: AppState, itemId: string, counted: number, note?: string) {
  const diff = counted - onHand(d, itemId);
  if (Math.abs(diff) < EPS) return;
  if (diff < 0) {
    consume(d, itemId, -diff, { reason: 'count', note: note || 'Count correction', log: true });
    pruneBatches(d);
  } else {
    const item = d.items.find((i) => i.id === itemId);
    const today = localDate();
    const b: Batch = {
      id: uid(), itemId, qtyReceived: diff, qtyRemaining: diff, unitCost: unitCost(d, itemId), receivedAt: today,
      expiresAt: item && item.shelfLifeDays > 0 ? addDays(today, item.shelfLifeDays) : undefined,
      location: item?.location ?? '', note: 'Found in count',
    };
    d.batches.push(b);
    d.adjustments.push({ id: uid(), at: new Date().toISOString(), itemId, batchId: b.id, qty: diff, cost: diff * b.unitCost, reason: 'count', note: note || 'Count correction' });
  }
}

export function orderCogs(o: Order) {
  return o.lines.reduce((a, l) => a + l.unitCost * l.qty, 0);
}

export const netSales = (o: Order) => o.subtotal - o.discount;
