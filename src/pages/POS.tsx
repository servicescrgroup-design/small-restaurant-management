import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { defaultChoices, missingGroups, recordSale, resolveDish, sameChoices, servingsAvailable, tabOf, type Choices } from '../inventory';
import { Field, Modal, NumInput, Pill, Thumb } from '../components/ui';
import { Receipt } from '../components/Receipt';
import type { AppState, MenuItem, OpenTicket, Order, OrderType, Table, TicketLine } from '../types';
import { dedupeMethods, feeFor, knownMethod, methodKey, methodLabel } from '../payments';
import { dishName, round, uid } from '../utils';
import { useI18n, type TFunc } from '../i18n';

// Payment names are user data (and may be Thai), so match cash/card loosely.
// Recognised methods match exactly ("Gift card" isn't a card); the shop's own ones by their wording
const isMethod = (m: string, key: string, words: RegExp) => { const k = methodKey(m); return k ? k === key : words.test(m); };
export const isCashMethod = (m: string) => isMethod(m, 'cash', /cash|เงินสด/i);
const isCardMethod = (m: string) => isMethod(m, 'card', /card|บัตร/i);

const ACTIVE_KEY = 'mise-active-ticket';

function ticketTotals(state: AppState, tk: OpenTicket) {
  const subtotal = round(tk.lines.reduce((a, l) => a + resolveDish(state.menu.find((m) => m.id === l.menuItemId), l.choices).price * l.qty, 0));
  const discount = round(Math.min(subtotal, tk.discType === '%' ? (subtotal * tk.discVal) / 100 : tk.discVal));
  const tax = round(((subtotal - discount) * state.settings.taxRate) / 100);
  return { subtotal, discount, tax, due: round(subtotal - discount + tax), count: tk.lines.reduce((a, l) => a + l.qty, 0) };
}

/** Cheapest way to order a dish: base price plus the cheapest choice in each required group. */
const fromPrice = (m: MenuItem) =>
  Math.max(0, m.price + (m.optionGroups ?? []).filter((g) => g.required && g.options.length).reduce((a, g) => a + Math.min(...g.options.map((o) => o.price)), 0));
const pricesVary = (m: MenuItem) => !!m.optionGroups?.some((g) => g.options.some((o) => o.price !== 0));

const minutesSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));

function ticketTitle(state: AppState, tk: OpenTicket, t: TFunc, index?: number) {
  const tb = state.tables.find((x) => x.id === tk.tableId);
  if (tb) return t('pos.table', { name: tb.name });
  return tk.label?.trim() || `${t(`common.orderType.${tk.type}`)}${index != null ? ` ${index + 1}` : ''}`;
}

export default function POS() {
  const { state, update } = useStore();
  const { user } = useAuth();
  const [activeId, setActiveIdState] = useState<string | null>(() => { try { return sessionStorage.getItem(ACTIVE_KEY); } catch { return null; } });
  const [receipt, setReceipt] = useState<Order | null>(null);
  const active = state.tickets.find((tk) => tk.id === activeId) ?? null;

  // Keep the "x min" timers on the floor moving.
  const [, setTick] = useState(0);
  useEffect(() => { const i = window.setInterval(() => setTick((n) => n + 1), 30_000); return () => window.clearInterval(i); }, []);

  const remember = (id: string | null) => {
    setActiveIdState(id);
    try { if (id) sessionStorage.setItem(ACTIVE_KEY, id); else sessionStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  };
  const switchTo = (id: string | null) => {
    // Leaving an empty check frees its table, so a mis-tap never blocks it.
    if (activeId && activeId !== id) update((d) => { d.tickets = d.tickets.filter((tk) => tk.id !== activeId || tk.lines.length > 0); });
    remember(id);
  };

  const newTicket = (p: Partial<OpenTicket> & { type: OrderType }): OpenTicket => ({
    id: uid(), lines: [], note: '', discType: '%', discVal: 0, guests: 1, openedAt: new Date().toISOString(),
    staffId: user?.id, staffName: user?.name, ...p,
  });

  const openTable = (table: Table) => {
    const existing = state.tickets.find((tk) => tk.tableId === table.id);
    if (existing) return switchTo(existing.id);
    const tk = newTicket({ type: 'Dine-in', tableId: table.id, guests: Math.min(2, table.seats) });
    update((d) => { d.tickets.push(tk); });
    switchTo(tk.id);
  };

  const openToGo = (type: OrderType) => {
    const tk = newTicket({ type });
    update((d) => { d.tickets.push(tk); });
    switchTo(tk.id);
  };

  return (
    <>
      {active
        ? <TicketView ticket={active} onSwitch={switchTo} onPaid={(o) => { remember(null); setReceipt(o); }} />
        : <FloorView onOpenTable={openTable} onOpenTicket={switchTo} onNewToGo={openToGo} />}
      {receipt && <ReceiptModal order={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

// ---------- Floor plan ----------

function FloorView({ onOpenTable, onOpenTicket, onNewToGo }: { onOpenTable: (t: Table) => void; onOpenTicket: (id: string) => void; onNewToGo: (type: OrderType) => void }) {
  const { state, money } = useStore();
  const { user } = useAuth();
  const { t } = useI18n();
  const areas = [...new Set(state.tables.map((tb) => tb.area))];
  const [area, setArea] = useState('All');
  const [editing, setEditing] = useState(false);
  const byTable = new Map(state.tickets.filter((tk) => tk.tableId).map((tk) => [tk.tableId!, tk]));
  const toGo = state.tickets.filter((tk) => !tk.tableId);
  const tables = state.tables.filter((tb) => area === 'All' || tb.area === area);
  const openTotal = state.tickets.reduce((a, tk) => a + ticketTotals(state, tk).due, 0);

  return (
    <div className="floor">
      <header className="floor-head">
        <div>
          <h1>{t('pos.floorTitle')}</h1>
          <p className="muted">{t('pos.summaryOpen', { n: byTable.size, total: money(openTotal) })} · {t('pos.floorHint')}</p>
        </div>
        <div className="row">
          {user?.role === 'owner' && <button className="btn ghost" onClick={() => setEditing(true)}>{t('pos.editTables')}</button>}
          <button className="btn" onClick={() => onNewToGo('Delivery')}>{t('pos.newDelivery')}</button>
          <button className="btn primary" onClick={() => onNewToGo('Takeout')}>{t('pos.newTakeout')}</button>
        </div>
      </header>

      {areas.length > 1 && (
        <div className="pill-tabs">
          {['All', ...areas].map((a) => <button key={a} className={area === a ? 'active' : ''} onClick={() => setArea(a)}>{a === 'All' ? t('common.all') : a}</button>)}
        </div>
      )}

      {state.tables.length === 0 ? (
        <div className="glass-panel empty"><strong>{t('pos.noTables')}</strong>{t('pos.noTablesHint')}</div>
      ) : (
        <div className="floor-grid">
          {tables.map((tb) => {
            const tk = byTable.get(tb.id);
            const totals = tk ? ticketTotals(state, tk) : null;
            const top = Math.ceil(tb.seats / 2);
            const seats = (n: number, offset: number) => (
              <div className="seats" aria-hidden>{Array.from({ length: n }, (_, i) => <span key={i} className={tk && i + offset < tk.guests ? 'taken' : ''} />)}</div>
            );
            return (
              <button key={tb.id} className={`table-card ${tk ? 'busy' : ''}`} onClick={() => onOpenTable(tb)}>
                {seats(top, 0)}
                <div className="table-top">
                  <strong>{t('pos.table', { name: tb.name })}</strong>
                  {tk && totals ? (
                    <>
                      <span className="table-amount">{money(totals.due)}</span>
                      <span className="table-meta">{t('pos.itemsCount', { n: totals.count })} · {t('pos.minutes', { n: minutesSince(tk.openedAt) })}</span>
                    </>
                  ) : (
                    <span className="table-meta">{t('pos.free')} · {t('pos.seats', { n: tb.seats })}</span>
                  )}
                </div>
                {seats(tb.seats - top, top)}
              </button>
            );
          })}
        </div>
      )}

      <section className="glass-panel togo">
        <h2>{t('pos.toGoOrders')}</h2>
        {toGo.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t('pos.noToGo')}</p> : (
          <div className="ticket-chips">
            {toGo.map((tk, i) => <TicketChip key={tk.id} ticket={tk} index={i} onClick={() => onOpenTicket(tk.id)} />)}
          </div>
        )}
      </section>

      {editing && <EditTablesModal onClose={() => setEditing(false)} />}
    </div>
  );
}

function TicketChip({ ticket, index, onClick }: { ticket: OpenTicket; index?: number; onClick: () => void }) {
  const { state, money } = useStore();
  const { t } = useI18n();
  const tb = state.tables.find((x) => x.id === ticket.tableId);
  const totals = ticketTotals(state, ticket);
  return (
    <button className="ticket-chip" onClick={onClick}>
      <span className="chip-badge">{tb ? tb.name : ticket.type === 'Delivery' ? '🛵' : '🥡'}</span>
      <span className="chip-text">
        <strong>{ticketTitle(state, ticket, t, index)}</strong>
        <span>{t('pos.itemsCount', { n: totals.count })} · {money(totals.due)}</span>
      </span>
    </button>
  );
}

// ---------- Ticket (menu + check) ----------

function TicketView({ ticket, onSwitch, onPaid }: { ticket: OpenTicket; onSwitch: (id: string | null) => void; onPaid: (o: Order) => void }) {
  const { state, update, money } = useStore();
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const s = state.settings;
  const onMenu = state.menu.filter((m) => m.active);
  const tabs = s.menuTabs.filter((x) => onMenu.some((m) => tabOf(m, s.menuTabs) === x));
  const [tab, setTab] = useState(tabs[0] ?? '');
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  // Search looks across every tab; otherwise show only the chosen tab
  const activeMenu = q.trim() || tabs.length < 2 ? onMenu : onMenu.filter((m) => tabOf(m, s.menuTabs) === tab);
  const cats = s.menuCategories.filter((c) => activeMenu.some((m) => m.category === c));
  const extra = [...new Set(activeMenu.map((m) => m.category))].filter((c) => !cats.includes(c));
  const allCats = ['All', ...cats, ...extra];
  const [showDiscount, setShowDiscount] = useState(ticket.discVal > 0);
  const [paying, setPaying] = useState(false);
  const [moving, setMoving] = useState(false);
  // Option picker: a new dish to add, or an existing line to change
  const [picking, setPicking] = useState<{ item: MenuItem; line?: TicketLine } | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);

  const table = state.tables.find((x) => x.id === ticket.tableId);
  const menuById = useMemo(() => new Map(state.menu.map((m) => [m.id, m])), [state.menu]);
  const patch = (fn: (tk: OpenTicket) => void) => update((d) => { const tk = d.tickets.find((x) => x.id === ticket.id); if (tk) fn(tk); });

  // Ingredients already committed to every open check, so "x left" counts stay honest.
  const reserved = useMemo(() => {
    const r: Record<string, number> = {};
    for (const tk of state.tickets) for (const l of tk.lines) for (const rl of resolveDish(menuById.get(l.menuItemId), l.choices).recipe) r[rl.itemId] = (r[rl.itemId] ?? 0) + rl.qty * l.qty;
    return r;
  }, [state.tickets, menuById]);

  /** Add to the check, merging with an identical line (same dish, same choices, no note). */
  const addLine = (menuItemId: string, choices: Choices = {}, qty = 1, note = '') => {
    const lineId = uid();
    patch((tk) => {
      const same = !note && tk.lines.find((x) => x.menuItemId === menuItemId && !x.note && sameChoices(x.choices, choices));
      if (same) same.qty += qty;
      else tk.lines.push({ id: lineId, menuItemId, qty, ...(Object.keys(choices).length ? { choices } : {}), ...(note ? { note } : {}) });
    });
  };
  const tapDish = (m: MenuItem) => (m.optionGroups?.length ? setPicking({ item: m }) : addLine(m.id));
  const changeQty = (lineId: string, delta: number) => patch((tk) => {
    tk.lines = tk.lines.map((l) => (l.id === lineId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
  });
  const setNote = (lineId: string, note: string) => patch((tk) => {
    const l = tk.lines.find((x) => x.id === lineId);
    if (l) l.note = note || undefined;
  });

  const { subtotal, discount, tax, due } = ticketTotals(state, ticket);
  const shown = activeMenu.filter((m) => (cat === 'All' || m.category === cat) && `${m.name} ${m.nameEn ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  const countIn = (c: string) => activeMenu.filter((m) => c === 'All' || m.category === c).length;
  const currencySymbol = money(0).replace(/[\d.,\s]/g, '') || '$';

  const cancelTicket = () => {
    if (ticket.lines.length && !confirm(t('pos.confirmCancel'))) return;
    update((d) => { d.tickets = d.tickets.filter((x) => x.id !== ticket.id); });
    onSwitch(null);
  };

  const complete = (payment: string, tip: number, tendered: number | undefined, fee: number, feeLabel?: string) => {
    const order: Order = {
      id: uid(), number: s.nextOrderNumber, createdAt: new Date().toISOString(), type: ticket.type,
      lines: ticket.lines.filter((l) => menuById.has(l.menuItemId)).map((l) => {
        const m = menuById.get(l.menuItemId)!;
        const dish = resolveDish(m, l.choices);
        return { menuItemId: m.id, name: m.name, options: dish.label || undefined, note: l.note, price: dish.price, qty: l.qty, unitCost: 0, recipe: dish.recipe };
      }),
      subtotal, discount, tax, tip, total: round(due + tip + fee), payment, tendered, status: 'paid', note: ticket.note.trim() || undefined,
      ...(fee > 0 ? { surcharge: fee, surchargeLabel: feeLabel } : {}),
      staffId: ticket.staffId ?? user?.id, staffName: ticket.staffName ?? user?.name,
      tableName: table?.name, guests: table ? ticket.guests : undefined,
    };
    update((d) => { recordSale(d, order); d.tickets = d.tickets.filter((x) => x.id !== ticket.id); });
    setPaying(false);
    onPaid(order);
  };

  const otherTickets = state.tickets.filter((x) => x.id !== ticket.id);

  return (
    <div className="pos">
      <section className="pos-menu">
        <div className="pos-toolbar">
          <button className="btn" onClick={() => onSwitch(null)}>{t('pos.backToTables')}</button>
          <input className="search" placeholder={t('pos.searchMenu')} value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted nowrap">{t('pos.orderBy', { n: s.nextOrderNumber, name: user?.name ?? '' })}</span>
        </div>
        {tabs.length > 1 && !q.trim() && (
          <div className="menu-tabs" role="tablist">
            {tabs.map((x) => (
              <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'active' : ''} onClick={() => { setTab(x); setCat('All'); }}>{x}</button>
            ))}
          </div>
        )}
        <div className="cat-cards">
          {allCats.map((c) => (
            <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
              <strong>{c === 'All' ? t('common.all') : c}</strong>
              <span>{t('pos.itemsCount', { n: countIn(c) })}</span>
            </button>
          ))}
        </div>
        {onMenu.length === 0 ? (
          <div className="glass-panel empty"><strong>{t('pos.noItems')}</strong>{t('pos.noItemsHint')}</div>
        ) : (
          <div className="pos-grid">
            {shown.map((m) => {
              const base = resolveDish(m, defaultChoices(m));
              const left = base.recipe.length ? servingsAvailable(state, base.recipe, reserved) : Infinity;
              const inCart = ticket.lines.filter((l) => l.menuItemId === m.id).reduce((a, l) => a + l.qty, 0);
              const hasOptions = !!m.optionGroups?.length;
              return (
                <button key={m.id} className={`pos-item ${left === 0 ? 'out' : ''} ${inCart ? 'in-cart' : ''}`} onClick={() => tapDish(m)}>
                  <Thumb src={m.image} name={m.name} />
                  {left === 0 ? <span className="badge"><Pill tone="bad">{t('pos.soldOut')}</Pill></span> : left <= 5 ? <span className="badge"><Pill tone="warn">{t('pos.left', { n: left })}</Pill></span> : null}
                  <span className="name">{dishName(m, lang)}</span>
                  {hasOptions && <span className="item-options">{t('pos.optionsCount', { n: m.optionGroups!.length })}</span>}
                  <span className="item-foot">
                    <span className="price">{pricesVary(m) ? t('pos.from', { price: money(fromPrice(m)) }) : money(base.price)}</span>
                    {inCart > 0 && <span className="in-cart-count">×{inCart}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {otherTickets.length > 0 && (
          <div className="ticket-strip">
            <span className="muted strip-label">{t('pos.openChecks')}</span>
            {otherTickets.map((tk) => <TicketChip key={tk.id} ticket={tk} onClick={() => onSwitch(tk.id)} />)}
          </div>
        )}
      </section>

      <aside className="pos-ticket">
        <div className="ticket-head">
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <div style={{ minWidth: 0 }}>
              <h2>{ticketTitle(state, ticket, t)}</h2>
              <div className="muted" style={{ fontSize: 13 }}>
                {table ? `${table.area} · ` : ''}{t('pos.server', { name: ticket.staffName ?? user?.name ?? '' })} · {t('pos.minutes', { n: minutesSince(ticket.openedAt) })}
              </div>
            </div>
            <span className="spacer" />
            {table && <button className="btn sm" onClick={() => setMoving(true)}>{t('pos.move')}</button>}
          </div>
          {table ? (
            <div className="guests">
              <span>{t('pos.guestsLabel')}</span>
              <div className="qty">
                <button onClick={() => patch((tk) => { tk.guests = Math.max(1, tk.guests - 1); })} aria-label={t('pos.fewerGuests')}>−</button>
                <span>{ticket.guests}</span>
                <button onClick={() => patch((tk) => { tk.guests += 1; })} aria-label={t('pos.moreGuests')}>+</button>
              </div>
            </div>
          ) : (
            <>
              <div className="seg" style={{ width: '100%' }}>
                {(['Takeout', 'Delivery'] as OrderType[]).map((ot) => (
                  <button key={ot} style={{ flex: 1 }} className={ticket.type === ot ? 'active' : ''} onClick={() => patch((tk) => { tk.type = ot; })}>{t(`common.orderType.${ot}`)}</button>
                ))}
              </div>
              <input placeholder={t('pos.customerName')} value={ticket.label ?? ''} onChange={(e) => patch((tk) => { tk.label = e.target.value; })} />
            </>
          )}
        </div>
        <div className="ticket-lines">
          {ticket.lines.length === 0 && <div className="empty">{t('pos.tapToAdd')}</div>}
          {ticket.lines.map((l) => {
            const m = menuById.get(l.menuItemId);
            if (!m) return null;
            const dish = resolveDish(m, l.choices);
            return (
              <div key={l.id} className="ticket-line">
                <Thumb src={m.image} name={m.name} size="sm" />
                <div className="line-main">
                  <strong>{dishName(m, lang)}</strong>
                  {dish.label && (
                    <button className="line-options" onClick={() => setPicking({ item: m, line: l })} title={t('pos.changeOptions')}>{dish.label} ✎</button>
                  )}
                  <span className="muted" style={{ fontSize: 13 }}>{t('pos.each', { price: money(dish.price) })}</span>
                  {noteFor === l.id ? (
                    <input
                      className="line-note-input"
                      autoFocus
                      defaultValue={l.note ?? ''}
                      placeholder={t('pos.itemNotePlaceholder')}
                      onBlur={(e) => { setNote(l.id, e.target.value.trim()); setNoteFor(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setNoteFor(null); }}
                    />
                  ) : (
                    <button className={`line-note ${l.note ? 'has-note' : ''}`} onClick={() => setNoteFor(l.id)}>
                      {l.note ? `📝 ${l.note}` : t('pos.addItemNote')}
                    </button>
                  )}
                </div>
                <div className="line-side">
                  <span className="num">{money(dish.price * l.qty)}</span>
                  <div className="qty">
                    <button onClick={() => changeQty(l.id, -1)} aria-label={t('pos.removeOne')}>−</button>
                    <span>{l.qty}</span>
                    <button onClick={() => changeQty(l.id, 1)} aria-label={t('pos.addOne')}>+</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="ticket-foot">
          <input placeholder={t('pos.notePlaceholder')} value={ticket.note} onChange={(e) => patch((tk) => { tk.note = e.target.value; })} />
          {showDiscount ? (
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <div className="seg">
                <button className={ticket.discType === '%' ? 'active' : ''} onClick={() => patch((tk) => { tk.discType = '%'; })}>%</button>
                <button className={ticket.discType === '$' ? 'active' : ''} onClick={() => patch((tk) => { tk.discType = '$'; })}>{currencySymbol}</button>
              </div>
              <NumInput style={{ flex: 1, width: 'auto' }} value={ticket.discVal} onChange={(n) => patch((tk) => { tk.discVal = n; })} placeholder={t('pos.discount')} />
              <button className="btn sm ghost" onClick={() => { patch((tk) => { tk.discVal = 0; }); setShowDiscount(false); }} aria-label={t('pos.removeDiscount')}>✕</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn sm ghost" onClick={() => setShowDiscount(true)}>{t('pos.addDiscount')}</button>
              <span className="spacer" />
              <button className="btn sm ghost danger" onClick={cancelTicket}>{t('pos.cancelTicket')}</button>
            </div>
          )}
          <div className="totals">
            <div className="totals-row"><span>{t('pos.subtotal')}</span><span>{money(subtotal)}</span></div>
            {discount > 0 && <div className="totals-row"><span>{t('pos.discount')}</span><span>−{money(discount)}</span></div>}
            <div className="totals-row"><span>{t('pos.tax', { rate: s.taxRate })}</span><span>{money(tax)}</span></div>
            <div className="totals-row grand"><span>{t('common.total')}</span><span>{money(due)}</span></div>
          </div>
          <button className="btn primary lg" disabled={!ticket.lines.length} onClick={() => setPaying(true)}>{t('pos.charge', { amount: money(due) })}</button>
        </div>
      </aside>

      {paying && <PayModal due={due} net={subtotal - discount} onClose={() => setPaying(false)} onComplete={complete} />}
      {picking && (
        <OptionPicker
          item={picking.item}
          line={picking.line}
          onClose={() => setPicking(null)}
          onConfirm={(choices, qty, note) => {
            if (picking.line) {
              const id = picking.line.id;
              patch((tk) => { const l = tk.lines.find((x) => x.id === id); if (l) { l.choices = choices; l.qty = qty; l.note = note || undefined; } });
            } else addLine(picking.item.id, choices, qty, note);
            setPicking(null);
          }}
        />
      )}
      {moving && <MoveTableModal ticket={ticket} onClose={() => setMoving(false)} onMove={(tb) => { patch((tk) => { tk.tableId = tb.id; }); setMoving(false); }} />}
    </div>
  );
}

// ---------- Modals ----------

/** Choose rice / meat / size etc. for a dish, with quantity and a kitchen note. */
function OptionPicker({ item, line, onClose, onConfirm }: { item: MenuItem; line?: TicketLine; onClose: () => void; onConfirm: (c: Choices, qty: number, note: string) => void }) {
  const { money } = useStore();
  const { t, lang } = useI18n();
  const [choices, setChoices] = useState<Choices>(line?.choices ?? defaultChoices(item));
  const [qty, setQty] = useState(line?.qty ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  const dish = resolveDish(item, choices);
  const missing = missingGroups(item, choices);

  const toggle = (groupId: string, optionId: string, multi: boolean, required: boolean) => setChoices((c) => {
    const cur = c[groupId] ?? [];
    if (!multi) return { ...c, [groupId]: cur[0] === optionId && !required ? [] : [optionId] };
    return { ...c, [groupId]: cur.includes(optionId) ? cur.filter((x) => x !== optionId) : [...cur, optionId] };
  });

  return (
    <Modal
      title={dishName(item, lang)}
      onClose={onClose}
      footer={
        <>
          <div className="qty" style={{ marginRight: 'auto' }}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label={t('pos.removeOne')}>−</button>
            <span>{qty}</span>
            <button onClick={() => setQty((q) => q + 1)} aria-label={t('pos.addOne')}>+</button>
          </div>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={missing.length > 0} onClick={() => onConfirm(choices, qty, note.trim())}>
            {line ? t('pos.updateItem', { amount: money(dish.price * qty) }) : t('pos.addToOrder', { amount: money(dish.price * qty) })}
          </button>
        </>
      }
    >
      {item.description && <p className="muted" style={{ margin: 0 }}>{item.description}</p>}
      {(item.optionGroups ?? []).map((g) => (
        <div key={g.id} className="option-group">
          <div className="option-group-head">
            <h3>{g.name}</h3>
            <span className={`pill ${g.required ? (choices[g.id]?.length ? 'ok' : 'warn') : 'muted'}`}>
              {g.required ? (g.multi ? t('pos.pickAtLeastOne') : t('pos.pickOne')) : (g.multi ? t('pos.optionalMany') : t('pos.optional'))}
            </span>
          </div>
          <div className="option-choices">
            {g.options.map((o) => {
              const on = choices[g.id]?.includes(o.id);
              return (
                <button key={o.id} className={`option-choice ${on ? 'active' : ''}`} onClick={() => toggle(g.id, o.id, g.multi, g.required)} aria-pressed={on}>
                  <span className={`option-mark ${g.multi ? 'box' : ''}`} aria-hidden>{on ? '✓' : ''}</span>
                  <span className="option-name">{o.name}</span>
                  {o.price !== 0 && <span className="option-price">{o.price > 0 ? '+' : '−'}{money(Math.abs(o.price))}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <Field label={t('pos.itemNote')}>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('pos.itemNotePlaceholder')} />
      </Field>
    </Modal>
  );
}

function ReceiptModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const { money } = useStore();
  const { t } = useI18n();
  return (
    <Modal title={t('pos.orderComplete', { n: order.number })} onClose={onClose} footer={<><button className="btn" onClick={() => window.print()}>{t('pos.printReceipt')}</button><button className="btn primary" onClick={onClose}>{t('pos.backToFloor')}</button></>}>
      {order.tendered != null && order.tendered > order.total && <div className="change-due">{t('pos.changeDue', { amount: money(order.tendered - order.total) })}</div>}
      <Receipt order={order} />
    </Modal>
  );
}

function MoveTableModal({ ticket, onClose, onMove }: { ticket: OpenTicket; onClose: () => void; onMove: (t: Table) => void }) {
  const { state } = useStore();
  const { t } = useI18n();
  const busy = new Set(state.tickets.map((x) => x.tableId).filter(Boolean));
  const free = state.tables.filter((tb) => !busy.has(tb.id) && tb.id !== ticket.tableId);
  return (
    <Modal title={t('pos.moveTitle')} onClose={onClose}>
      {free.length === 0 ? <p className="muted">{t('pos.noFreeTables')}</p> : (
        <div className="move-grid">
          {free.map((tb) => (
            <button key={tb.id} className="table-card mini" onClick={() => onMove(tb)}>
              <div className="table-top">
                <strong>{t('pos.table', { name: tb.name })}</strong>
                <span className="table-meta">{tb.area} · {t('pos.seats', { n: tb.seats })}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function EditTablesModal({ onClose }: { onClose: () => void }) {
  const { state, update } = useStore();
  const { t } = useI18n();
  const [rows, setRows] = useState<Table[]>(state.tables);
  const busy = new Set(state.tickets.map((x) => x.tableId).filter(Boolean));
  const set = (id: string, p: Partial<Table>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const lastArea = rows[rows.length - 1]?.area ?? '';
  const valid = rows.every((r) => r.name.trim() && r.seats > 0);

  return (
    <Modal
      wide
      title={t('pos.editTables')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.cancel')}</button><button className="btn primary" disabled={!valid} onClick={() => { update((d) => { d.tables = rows.map((r) => ({ ...r, name: r.name.trim(), area: r.area.trim() })); }); onClose(); }}>{t('common.save')}</button></>}
    >
      <p className="muted" style={{ margin: 0 }}>{t('pos.editTablesHint')}</p>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>{t('pos.tableName')}</th><th>{t('pos.area')}</th><th style={{ width: 110 }}>{t('pos.seatsLabel')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><input value={r.name} onChange={(e) => set(r.id, { name: e.target.value })} /></td>
                <td><input list="table-areas" value={r.area} onChange={(e) => set(r.id, { area: e.target.value })} /></td>
                <td><NumInput value={r.seats} onChange={(n) => set(r.id, { seats: Math.max(1, Math.min(20, Math.round(n))) })} /></td>
                <td className="actions">
                  {busy.has(r.id)
                    ? <Pill tone="info">{t('pos.tableBusy')}</Pill>
                    : <button className="icon-btn" aria-label={t('common.remove')} onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))}>✕</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="table-areas">{[...new Set(rows.map((r) => r.area))].map((a) => <option key={a} value={a} />)}</datalist>
      </div>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows((r) => [...r, { id: uid(), name: String(r.length + 1), seats: 4, area: lastArea }])}>{t('pos.addTable')}</button>
    </Modal>
  );
}

function PayModal({ due, net, onClose, onComplete }: { due: number; net: number; onClose: () => void; onComplete: (payment: string, tip: number, tendered: number | undefined, fee: number, feeLabel?: string) => void }) {
  const { state, money } = useStore();
  const { t, lang } = useI18n();
  const methods = state.settings.paymentMethods.length ? dedupeMethods(state.settings.paymentMethods) : [knownMethod('cash', lang), knownMethod('card', lang)];
  const [method, setMethod] = useState(methods.find(isCardMethod) ?? methods[0]);
  const [tipPct, setTipPct] = useState<number | 'custom'>(0);
  const [customTip, setCustomTip] = useState(0);
  const [tendered, setTendered] = useState(0);
  // Transaction charge: 'auto' follows the method's setting, 'manual' is typed in, 'none' is removed for this sale
  const [feeMode, setFeeMode] = useState<'auto' | 'manual' | 'none'>('auto');
  const [feeType, setFeeType] = useState<'%' | 'amt'>('%');
  const [feeValue, setFeeValue] = useState(0);
  const [editingFee, setEditingFee] = useState(false);
  const isCash = isCashMethod(method);
  const tip = round(tipPct === 'custom' ? customTip : (net * tipPct) / 100);
  const auto = feeFor(state.settings.paymentFees, method);
  const autoFee = auto ? round((due * auto.pct) / 100 + auto.fixed) : 0;
  const fee = feeMode === 'none' ? 0 : feeMode === 'manual' ? round(feeType === '%' ? (due * feeValue) / 100 : feeValue) : autoFee;
  const feeLabel = feeMode === 'manual'
    ? (feeType === '%' ? `${feeValue}%` : money(feeValue))
    : auto ? [auto.pct ? `${auto.pct}%` : '', auto.fixed ? money(auto.fixed) : ''].filter(Boolean).join(' + ') : '';
  const total = round(due + tip + fee);
  const quick = [...new Set([total, Math.ceil(total / 5) * 5, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, 1000])]
    .filter((v) => v >= total).slice(0, 4);
  const short = isCash && tendered < total;
  const icon = (m: string) => (isCashMethod(m) ? '💵' : isCardMethod(m) ? '💳' : /qr|พร้อมเพย์|mobile/i.test(m) ? '📱' : '🎟️');

  return (
    <Modal
      title={t('pos.charge', { amount: money(total) })}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('common.back')}</button><button className="btn primary lg" disabled={short} onClick={() => onComplete(method, tip, isCash ? tendered : undefined, fee, fee > 0 ? feeLabel : undefined)}>{t('pos.completeSale')}</button></>}
    >
      <Field label={t('pos.paymentMethod')}>
        <div className="pay-methods">
          {methods.map((m) => (
            <button key={m} className={method === m ? 'active' : ''} onClick={() => { setMethod(m); if (feeMode === 'none') setFeeMode('auto'); }}>
              <span className="pay-icon" aria-hidden>{icon(m)}</span>{methodLabel(m, lang)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('pos.tip')}>
        <div className="seg" style={{ width: '100%' }}>
          {[0, 15, 18, 20].map((p) => <button key={p} style={{ flex: 1 }} className={tipPct === p ? 'active' : ''} onClick={() => setTipPct(p)}>{p ? `${p}%` : t('common.none')}</button>)}
          <button style={{ flex: 1 }} className={tipPct === 'custom' ? 'active' : ''} onClick={() => setTipPct('custom')}>{t('common.custom')}</button>
        </div>
      </Field>
      {tipPct === 'custom' && <Field label={t('pos.tipAmount')}><NumInput autoFocus value={customTip} onChange={setCustomTip} /></Field>}
      <div className="fee-box">
        {editingFee ? (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <span className="field-label nowrap">{t('pos.fee')}</span>
            <div className="seg">
              <button className={feeType === '%' ? 'active' : ''} onClick={() => setFeeType('%')}>%</button>
              <button className={feeType === 'amt' ? 'active' : ''} onClick={() => setFeeType('amt')}>{money(0).replace(/[\d.,\s]/g, '') || '$'}</button>
            </div>
            <NumInput autoFocus style={{ flex: 1, width: 'auto' }} value={feeValue} onChange={(n) => { setFeeValue(n); setFeeMode('manual'); }} />
            <button className="btn sm primary" onClick={() => setEditingFee(false)}>{t('pos.feeDone')}</button>
          </div>
        ) : fee > 0 ? (
          <div className="row">
            <span>💳 {t('pos.fee')} <span className="muted">({feeLabel}{feeMode === 'auto' ? ` · ${t('pos.feeAuto')}` : ''})</span></span>
            <span className="spacer" />
            <strong>{money(fee)}</strong>
            <button className="btn sm ghost" onClick={() => { setFeeType(auto && !auto.pct ? 'amt' : '%'); setFeeValue(auto ? (auto.pct || auto.fixed) : 0); setEditingFee(true); }}>{t('common.edit')}</button>
            <button className="btn sm ghost danger" onClick={() => setFeeMode('none')}>{t('common.remove')}</button>
          </div>
        ) : (
          <button className="btn sm ghost" onClick={() => { setFeeMode('manual'); setFeeType('%'); setFeeValue(auto?.pct || 3); setEditingFee(true); }}>{t('pos.addFee')}</button>
        )}
      </div>
      {isCash && (
        <>
          <Field label={t('pos.cashReceived')}><NumInput value={tendered} onChange={setTendered} /></Field>
          <div className="quick-cash">{quick.map((v) => <button key={v} className="btn" onClick={() => setTendered(v)}>{v === total ? t('pos.exact') : money(v)}</button>)}</div>
          {tendered >= total && <div className="change-due">{t('pos.change', { amount: money(tendered - total) })}</div>}
        </>
      )}
      <div className="result-box">
        <div className="kv"><span>{t('pos.orderTotal')}</span><span>{money(due)}</span></div>
        {tip > 0 && <div className="kv"><span>{t('pos.tip')}</span><span>{money(tip)}</span></div>}
        {fee > 0 && <div className="kv"><span>{t('pos.fee')} ({feeLabel})</span><span>{money(fee)}</span></div>}
        <div className="kv"><strong>{t('pos.chargeLabel')}</strong><strong>{money(total)}</strong></div>
      </div>
    </Modal>
  );
}
