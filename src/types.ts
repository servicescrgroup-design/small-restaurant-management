export interface Settings {
  storeName: string;
  address: string;
  phone: string;
  currency: string;
  /** Sales tax, as a percent (8.25 = 8.25%) */
  taxRate: number;
  /** Target food cost, as a percent of menu price */
  targetFoodCost: number;
  /** Batches expiring within this many days are flagged */
  expiryWarnDays: number;
  /** Top-level menu sections on the POS (Food, Drinks, Desserts…), each holding categories */
  menuTabs: string[];
  menuCategories: string[];
  /** Which menu tab each category sits under (set in Menu → Edit tabs & categories) */
  categoryTabs?: Record<string, string>;
  /** Delivery-app pricing (see delivery.ts) */
  delivery?: DeliverySettings;
  inventoryCategories: string[];
  storageLocations: string[];
  paymentMethods: string[];
  /** Automatic transaction charge per payment method, added to the bill (e.g. Card: 3%) */
  paymentFees: Record<string, PaymentFee>;
  receiptFooter: string;
  nextOrderNumber: number;
  /** Lock the app after this many idle minutes (0 = never) */
  autoLockMinutes: number;
}

export interface DeliverySettings {
  /** Delivery app's commission (GP), percent of the delivery price */
  gpPct: number;
  /** VAT charged on the GP, percent */
  vatPct: number;
  /** Default packaging cost per dish for delivery */
  packaging: number;
  /** Round recommended prices up to this (1, 5, 10); 0 = to the satang */
  roundTo: number;
  /** Instead, round up to the next whole price ending in this digit (9 → ฿319); overrides roundTo */
  endsIn?: number;
}

export interface PaymentFee {
  /** Percent of the bill */
  pct: number;
  /** Flat amount per transaction */
  fixed: number;
}

export type StaffRole = 'owner' | 'staff';

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  pinSalt: string;
  pinHash: string;
  active: boolean;
}

export interface RecipeLine {
  itemId: string;
  qty: number;
}

export type ItemKind = 'raw' | 'prep';

/** Anything you keep in storage: a purchased ingredient, or a prepped batch item (sauce, chili, dough). */
export interface InvItem {
  id: string;
  name: string;
  kind: ItemKind;
  unit: string;
  category: string;
  location: string;
  /** Reorder / re-prep when on-hand falls to this level */
  parLevel: number;
  /** Default days until a new batch expires (0 = no expiry) */
  shelfLifeDays: number;
  supplier?: string;
  /** Cost per unit used when no batches have been received yet */
  defaultCost: number;
  /** Small photo as a data URL (resized on upload) */
  image?: string;
  /** Prep items only: what one batch uses */
  recipe?: RecipeLine[];
  /** Prep items only: how many units (servings, oz, ...) one batch yields */
  yieldQty?: number;
}

/** A specific delivery or prepped batch, with its own cost and expiry. */
export interface Batch {
  id: string;
  itemId: string;
  qtyReceived: number;
  qtyRemaining: number;
  unitCost: number;
  receivedAt: string; // YYYY-MM-DD
  expiresAt?: string; // YYYY-MM-DD
  lot?: string;
  location: string;
  note?: string;
}

/** One choice inside an option group, e.g. "Brown rice" or "Special size". */
export interface MenuOption {
  id: string;
  name: string;
  /** Added to the dish's base price (can be 0 or negative) */
  price: number;
  /** Ingredients this choice adds, e.g. 0.25 lb shrimp */
  recipe: RecipeLine[];
  /** Portion multiplier for the whole plate (sizes): 1 = as written, 1.5 = 50% more of everything */
  scale: number;
}

/** A set of choices shown when the dish is ordered, e.g. "Rice", "Meat", "Size". */
export interface OptionGroup {
  id: string;
  name: string;
  /** Customer must pick at least one */
  required: boolean;
  /** Customer may pick several (toppings); otherwise exactly one */
  multi: boolean;
  options: MenuOption[];
}

export interface MenuItem {
  id: string;
  /** Name as printed on the shop's menu (usually Thai) */
  name: string;
  /** English name, shown when the app is in English */
  nameEn?: string;
  /** Menu tab (Food, Drinks…); when missing, a tab matching the category name or the first tab is used */
  tab?: string;
  category: string;
  /** Base price; chosen options add to it */
  price: number;
  /** Price on delivery apps (Grab, LINE MAN…), confirmed by the owner */
  deliveryPrice?: number;
  /** Packaging for delivery/takeaway; falls back to the shop default */
  packagingCost?: number;
  description?: string;
  /** Small photo as a data URL (resized on upload) */
  image?: string;
  recipe: RecipeLine[];
  active: boolean;
  optionGroups?: OptionGroup[];
}

export interface OrderLine {
  menuItemId: string;
  name: string;
  price: number;
  qty: number;
  /** Actual ingredient cost per unit at time of sale */
  unitCost: number;
  /** Chosen options, e.g. "Brown rice, Shrimp, Special" */
  options?: string;
  note?: string;
  /** Ingredients used by one unit, after options — falls back to the dish recipe */
  recipe?: RecipeLine[];
}

export type OrderType = 'Dine-in' | 'Takeout' | 'Delivery';

export interface Table {
  id: string;
  name: string;
  seats: number;
  area: string;
}

export interface TicketLine {
  id: string;
  menuItemId: string;
  /** Chosen option ids per option-group id */
  choices?: Record<string, string[]>;
  qty: number;
  /** Per-item kitchen note, e.g. "no onions" */
  note?: string;
}

/** An order still being built or eaten — kept in state so it survives switching tables or reloading. */
export interface OpenTicket {
  id: string;
  /** Set for dine-in tickets; takeout/delivery tickets have none */
  tableId?: string;
  type: OrderType;
  lines: TicketLine[];
  note: string;
  discType: '%' | '$';
  discVal: number;
  guests: number;
  openedAt: string; // ISO timestamp
  staffId?: string;
  staffName?: string;
  /** Short label for takeout/delivery tickets, e.g. a customer name */
  label?: string;
}

export interface Order {
  id: string;
  number: number;
  createdAt: string; // ISO timestamp
  type: OrderType;
  lines: OrderLine[];
  subtotal: number;
  discount: number;
  tax: number;
  tip: number;
  total: number;
  payment: string;
  tendered?: number;
  status: 'paid' | 'voided';
  note?: string;
  staffId?: string;
  staffName?: string;
  voidedBy?: string;
  tableName?: string;
  guests?: number;
  /** Transaction charge added at checkout (included in total) */
  surcharge?: number;
  /** What the charge was, e.g. "3%" or "฿10" */
  surchargeLabel?: string;
}

export type AdjReason = 'received' | 'prep-used' | 'prep-made' | 'waste' | 'expired' | 'count';

export interface Adjustment {
  id: string;
  at: string; // ISO timestamp
  itemId: string;
  batchId?: string;
  /** Signed: positive adds stock, negative removes */
  qty: number;
  /** Absolute value of the stock moved */
  cost: number;
  reason: AdjReason;
  note?: string;
}

export interface AppState {
  version: 1;
  isDemo: boolean;
  /** Show the step-by-step setup guide (set when a new business starts blank) */
  setupGuide?: boolean;
  /** Step of the demo-shop tour shown to new sign-ups (absent once finished or skipped) */
  tour?: number;
  settings: Settings;
  staff: Staff[];
  tables: Table[];
  tickets: OpenTicket[];
  items: InvItem[];
  batches: Batch[];
  menu: MenuItem[];
  orders: Order[];
  adjustments: Adjustment[];
}
