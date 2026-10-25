import type { Adjustment, AppState, Batch, InvItem, MenuItem, OpenTicket, Order, OrderType, Settings, Staff, Table } from './types';
import { newStaff } from './pin';
import { getLang } from './i18n';
import { recipeCost, resolveDish } from './inventory';
import { addDays, localDate, parseDate, round } from './utils';

/** Starter lists for a blank store, in the language the owner is using when they start fresh. */
const THAI_DEFAULTS: Partial<Settings> = {
  storeName: 'ร้านของฉัน',
  currency: 'THB',
  taxRate: 7,
  menuTabs: ['อาหาร', 'เครื่องดื่ม', 'ของหวาน'],
  menuCategories: ['อาหารจานหลัก', 'ของทานเล่น', 'เครื่องดื่ม', 'ของหวาน'],
  inventoryCategories: ['เนื้อสัตว์', 'ผักและผลไม้', 'นมและไข่', 'เบเกอรี่', 'ของแห้ง', 'เครื่องดื่ม', 'ของเตรียม (Prep)', 'วัสดุสิ้นเปลือง'],
  storageLocations: ['ห้องเย็น', 'ช่องแช่แข็ง', 'ห้องเก็บของแห้ง', 'ตู้เย็นหน้าไลน์'],
  paymentMethods: ['เงินสด', 'บัตร', 'พร้อมเพย์ / QR', 'บัตรของขวัญ'],
  receiptFooter: 'ขอบคุณที่ใช้บริการ',
};

/** A starter floor: 8 tables inside, 4 outside. */
export const defaultTables = (): Table[] => {
  const th = getLang() === 'th';
  return [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `t${i + 1}`, name: String(i + 1), seats: i % 4 === 3 ? 6 : i % 2 ? 4 : 2, area: th ? 'ในร้าน' : 'Main room' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, seats: 4, area: th ? 'ด้านนอก' : 'Patio' })),
  ];
};

export const defaultSettings = (): Settings => ({
  storeName: 'My Restaurant',
  address: '',
  phone: '',
  currency: 'USD',
  taxRate: 8.25,
  targetFoodCost: 30,
  expiryWarnDays: 2,
  menuTabs: ['Food', 'Drinks', 'Desserts'],
  menuCategories: ['Mains', 'Sides', 'Drinks', 'Desserts'],
  inventoryCategories: ['Protein', 'Produce', 'Dairy', 'Bakery', 'Dry goods', 'Beverage', 'Prep', 'Supplies'],
  storageLocations: ['Walk-in cooler', 'Freezer', 'Dry storage', 'Line cooler'],
  paymentMethods: ['Cash', 'Card', 'Mobile pay', 'Gift card'],
  paymentFees: {},
  receiptFooter: 'Thank you — come again!',
  nextOrderNumber: 1001,
  autoLockMinutes: 5,
});

export const emptyState = (): AppState => ({
  version: 1,
  isDemo: false,
  settings: getLang() === 'th' ? { ...defaultSettings(), ...THAI_DEFAULTS } : defaultSettings(),
  staff: [],
  tables: defaultTables(),
  tickets: [],
  items: [],
  batches: [],
  menu: [],
  orders: [],
  adjustments: [],
});

const raw = (id: string, name: string, unit: string, category: string, location: string, parLevel: number, shelfLifeDays: number, defaultCost: number, supplier: string): InvItem =>
  ({ id, name, kind: 'raw', unit, category, location, parLevel, shelfLifeDays, defaultCost, supplier });

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick the English or Thai wording for demo data, based on the language when the demo is loaded. */
const L = (en: string, th: string) => (getLang() === 'th' ? th : en);

/** Demo PINs: owner 1234, Somchai 1111, Ploy 2222 */
export const demoStaff = (): Staff[] => [
  { ...newStaff(L('Owner', 'เจ้าของร้าน'), 'owner', '1234'), id: 'demo-owner' },
  { ...newStaff(L('Somchai', 'สมชาย'), 'staff', '1111'), id: 'demo-sam' },
  { ...newStaff(L('Ploy', 'พลอย'), 'staff', '2222'), id: 'demo-jordan' },
];

/** Demo: a made-up small Thai noodle and rice shop (not a real business), priced in baht. */
export function demoState(): AppState {
  const today = localDate();
  const FR = L('Walk-in fridge', 'ตู้เย็น'), FZ = L('Freezer', 'ช่องแช่แข็ง'), DRY = L('Dry store', 'ห้องเก็บของแห้ง'), PREP = L('Prep station', 'โต๊ะเตรียม');
  const C = {
    noodles: L('Noodles', 'เส้น'), meat: L('Meat & seafood', 'เนื้อสัตว์และอาหารทะเล'), veg: L('Vegetables & herbs', 'ผักและสมุนไพร'),
    sauce: L('Sauces & seasoning', 'ซอสและเครื่องปรุง'), dry: L('Dry goods', 'ของแห้ง'), drinks: L('Drinks', 'เครื่องดื่ม'),
    prep: L('Prep', 'ของเตรียม'), supplies: L('Supplies', 'วัสดุสิ้นเปลือง'), fruit: L('Fruit & dessert', 'ผลไม้และของหวาน'),
  };
  const MKT = L('Or Tor Kor market', 'ตลาด อ.ต.ก.'), MAKRO = 'Makro', FARM = L('Fresh market', 'ตลาดสด');
  const tabs = { food: L('Food', 'อาหาร'), drinks: L('Drinks', 'เครื่องดื่ม'), desserts: L('Desserts', 'ของหวาน') };
  const cats = {
    soup: L('Noodle soups', 'ก๋วยเตี๋ยวน้ำ'), fried: L('Stir-fried noodles', 'ผัด'), rice: L('Rice dishes', 'จานข้าว'),
    sides: L('Sides', 'ของทานเล่น'), drinks: L('Drinks', 'เครื่องดื่ม'), desserts: L('Desserts', 'ของหวาน'),
  };

  const settings: Settings = {
    ...defaultSettings(),
    storeName: L('Lotus Street Kitchen (demo)', 'ครัวถนนดอกบัว (ตัวอย่าง)'),
    address: L('1 Example Road, Sample District, Bangkok 10000', '1 ถนนตัวอย่าง เขตตัวอย่าง กรุงเทพฯ 10000'),
    phone: '02-000-0000',
    currency: 'THB',
    taxRate: 7,
    targetFoodCost: 40,
    menuTabs: [tabs.food, tabs.drinks, tabs.desserts],
    menuCategories: [cats.soup, cats.fried, cats.rice, cats.sides, cats.drinks, cats.desserts],
    inventoryCategories: Object.values(C),
    storageLocations: [FR, FZ, DRY, PREP],
    paymentMethods: [L('Cash', 'เงินสด'), L('PromptPay QR', 'พร้อมเพย์ QR'), L('Card', 'บัตร'), 'LINE MAN / Grab'],
    paymentFees: { [L('Card', 'บัตร')]: { pct: 3, fixed: 0 } },
    receiptFooter: L('Thank you — see you again! ขอบคุณค่ะ', 'ขอบคุณที่ใช้บริการค่ะ แล้วพบกันใหม่'),
  };

  const items: InvItem[] = [
    raw('senlek', L('Thin rice noodles (sen lek)', 'เส้นเล็ก'), 'kg', C.noodles, FR, 5, 3, 45, MKT),
    raw('senyai', L('Wide rice noodles (sen yai)', 'เส้นใหญ่'), 'kg', C.noodles, FR, 5, 3, 45, MKT),
    raw('senmee', L('Rice vermicelli (sen mee)', 'เส้นหมี่'), 'kg', C.noodles, DRY, 3, 120, 60, MAKRO),
    raw('bamee', L('Egg noodles (bamee)', 'บะหมี่'), 'kg', C.noodles, FR, 3, 5, 70, MKT),
    raw('porkslice', L('Sliced pork', 'หมูสไลซ์'), 'kg', C.meat, FR, 4, 3, 160, MKT),
    raw('porkmince', L('Minced pork', 'หมูสับ'), 'kg', C.meat, FR, 3, 2, 140, MKT),
    raw('porkballs', L('Pork balls', 'ลูกชิ้นหมู'), 'kg', C.meat, FR, 3, 7, 130, MKT),
    raw('fishballs', L('Fish balls', 'ลูกชิ้นปลา'), 'kg', C.meat, FR, 3, 7, 120, MKT),
    raw('beef', L('Sliced beef', 'เนื้อวัวสไลซ์'), 'kg', C.meat, FR, 3, 3, 320, MKT),
    raw('chicken', L('Chicken thigh', 'สะโพกไก่'), 'kg', C.meat, FR, 4, 2, 95, MAKRO),
    raw('shrimp', L('Shrimp (peeled)', 'กุ้งแกะเปลือก'), 'kg', C.meat, FZ, 2, 60, 380, MAKRO),
    raw('bones', L('Pork bones', 'กระดูกหมู'), 'kg', C.meat, FR, 8, 2, 60, MKT),
    raw('sprouts', L('Bean sprouts', 'ถั่วงอก'), 'kg', C.veg, FR, 2, 2, 30, FARM),
    raw('morningglory', L('Morning glory', 'ผักบุ้ง'), 'kg', C.veg, FR, 2, 2, 40, FARM),
    raw('kale', L('Chinese kale', 'คะน้า'), 'kg', C.veg, FR, 2, 4, 50, FARM),
    raw('herbs', L('Coriander & spring onion', 'ผักชีต้นหอม'), 'kg', C.veg, FR, 1, 3, 80, FARM),
    raw('basil', L('Holy basil', 'ใบกะเพรา'), 'kg', C.veg, FR, 0.5, 3, 90, FARM),
    raw('garlic', L('Garlic', 'กระเทียม'), 'kg', C.veg, DRY, 1, 30, 90, MKT),
    raw('chili', L('Bird\'s eye chili', 'พริกขี้หนู'), 'kg', C.veg, FR, 0.5, 7, 120, FARM),
    raw('lime', L('Limes', 'มะนาว'), 'each', C.veg, FR, 30, 14, 3, FARM),
    raw('rice', L('Jasmine rice (cooked)', 'ข้าวสวย (หุงแล้ว)'), 'kg', C.dry, PREP, 8, 1, 25, MAKRO),
    raw('stickyrice', L('Sticky rice (cooked)', 'ข้าวเหนียว (นึ่งแล้ว)'), 'kg', C.dry, PREP, 3, 1, 40, MAKRO),
    raw('eggs', L('Eggs', 'ไข่ไก่'), 'each', C.dry, DRY, 60, 21, 4, MAKRO),
    raw('peanuts', L('Roasted peanuts', 'ถั่วลิสงคั่ว'), 'kg', C.dry, DRY, 1, 60, 110, MAKRO),
    raw('tamarind', L('Tamarind paste', 'น้ำมะขามเปียก'), 'kg', C.sauce, FR, 1, 30, 60, MKT),
    raw('fishsauce', L('Fish sauce', 'น้ำปลา'), 'L', C.sauce, DRY, 2, 365, 45, MAKRO),
    raw('palmsugar', L('Palm sugar', 'น้ำตาลปี๊บ'), 'kg', C.sauce, DRY, 2, 180, 55, MAKRO),
    raw('coconut', L('Coconut milk', 'กะทิ'), 'L', C.fruit, FR, 2, 5, 70, MAKRO),
    raw('mango', L('Nam dok mai mango', 'มะม่วงน้ำดอกไม้'), 'each', C.fruit, FR, 10, 4, 35, FARM),
    raw('thaitea', L('Thai tea leaves', 'ใบชาไทย'), 'kg', C.drinks, DRY, 0.5, 180, 280, MAKRO),
    raw('condensed', L('Sweetened condensed milk', 'นมข้นหวาน'), 'can', C.drinks, DRY, 6, 180, 28, MAKRO),
    raw('ice', L('Ice', 'น้ำแข็ง'), 'kg', C.drinks, FZ, 10, 365, 4, L('Ice delivery', 'ร้านน้ำแข็ง')),
    raw('water', L('Drinking water (bottle)', 'น้ำดื่ม (ขวด)'), 'each', C.drinks, DRY, 48, 365, 6, MAKRO),
    raw('cups', L('Cups + lids', 'แก้วพร้อมฝา'), 'each', C.supplies, DRY, 100, 365, 3, MAKRO),
    raw('bowls', L('Take-away bowls', 'ถ้วยกลับบ้าน'), 'each', C.supplies, DRY, 100, 365, 4, MAKRO),
    {
      id: 'broth', name: L('House bone broth', 'น้ำซุปกระดูกประจำร้าน'), kind: 'prep', unit: 'L', category: C.prep, location: FR,
      parLevel: 10, shelfLifeDays: 2, defaultCost: 0, yieldQty: 20,
      recipe: [{ itemId: 'bones', qty: 6 }, { itemId: 'garlic', qty: 0.2 }, { itemId: 'herbs', qty: 0.2 }, { itemId: 'palmsugar', qty: 0.1 }],
    },
    {
      id: 'tomyum', name: L('Tom yum seasoning', 'เครื่องต้มยำ'), kind: 'prep', unit: 'serving', category: C.prep, location: FR,
      parLevel: 15, shelfLifeDays: 3, defaultCost: 0, yieldQty: 40,
      recipe: [{ itemId: 'chili', qty: 0.2 }, { itemId: 'lime', qty: 12 }, { itemId: 'fishsauce', qty: 0.3 }, { itemId: 'palmsugar', qty: 0.2 }, { itemId: 'peanuts', qty: 0.3 }],
    },
    {
      id: 'padthaisauce', name: L('Pad thai sauce', 'ซอสผัดไทย'), kind: 'prep', unit: 'portion', category: C.prep, location: FR,
      parLevel: 15, shelfLifeDays: 7, defaultCost: 0, yieldQty: 40,
      recipe: [{ itemId: 'tamarind', qty: 1 }, { itemId: 'palmsugar', qty: 1 }, { itemId: 'fishsauce', qty: 0.6 }],
    },
    {
      id: 'kapraobox', name: L('Basil chicken rice box (packed)', 'ข้าวกะเพราไก่กล่อง (แพ็กแล้ว)'), kind: 'prep', unit: L('box', 'กล่อง'), category: C.prep, location: FR,
      parLevel: 8, shelfLifeDays: 1, defaultCost: 0, yieldQty: 20,
      recipe: [{ itemId: 'rice', qty: 5 }, { itemId: 'chicken', qty: 2 }, { itemId: 'basil', qty: 0.2 }, { itemId: 'chili', qty: 0.08 }, { itemId: 'garlic', qty: 0.08 }, { itemId: 'eggs', qty: 20 }, { itemId: 'bowls', qty: 20 }],
    },
    {
      id: 'teabrew', name: L('Brewed Thai tea', 'ชาไทยต้ม'), kind: 'prep', unit: 'cup', category: C.prep, location: FR,
      parLevel: 10, shelfLifeDays: 1, defaultCost: 0, yieldQty: 25,
      recipe: [{ itemId: 'thaitea', qty: 0.25 }, { itemId: 'condensed', qty: 3 }],
    },
  ];

  // ---- Shared choice groups ----
  const opt = (id: string, name: string, price = 0, recipe: { itemId: string; qty: number }[] = [], scale = 1) => ({ id, name, price, recipe, scale });
  const noodleGroup = (p: string, q = 1) => ({
    id: `${p}-noodle`, name: L('Noodles', 'เส้น'), required: true, multi: false, options: [
      opt(`${p}-lek`, L('Thin (sen lek)', 'เส้นเล็ก'), 0, [{ itemId: 'senlek', qty: 0.12 * q }]),
      opt(`${p}-yai`, L('Wide (sen yai)', 'เส้นใหญ่'), 0, [{ itemId: 'senyai', qty: 0.12 * q }]),
      opt(`${p}-mee`, L('Vermicelli (sen mee)', 'เส้นหมี่'), 0, [{ itemId: 'senmee', qty: 0.06 * q }]),
      opt(`${p}-bamee`, L('Egg noodles (bamee)', 'บะหมี่'), 0, [{ itemId: 'bamee', qty: 0.1 * q }]),
    ],
  });
  const sizeGroup = (p: string, extra = 10) => ({
    id: `${p}-size`, name: L('Size', 'ขนาด'), required: true, multi: false, options: [
      opt(`${p}-normal`, L('Normal', 'ธรรมดา')),
      opt(`${p}-special`, L('Special (bigger)', 'พิเศษ'), extra, [], 1.4),
    ],
  });
  const proteinGroup = (p: string, q: number) => ({
    id: `${p}-meat`, name: L('Protein', 'เนื้อสัตว์'), required: true, multi: false, options: [
      opt(`${p}-pork`, L('Pork', 'หมู'), 0, [{ itemId: 'porkslice', qty: q }]),
      opt(`${p}-chicken`, L('Chicken', 'ไก่'), 0, [{ itemId: 'chicken', qty: q }]),
      opt(`${p}-beef`, L('Beef', 'เนื้อ'), 15, [{ itemId: 'beef', qty: q }]),
      opt(`${p}-shrimp`, L('Shrimp', 'กุ้ง'), 25, [{ itemId: 'shrimp', qty: q }]),
    ],
  });
  const friedEgg = (p: string) => ({
    id: `${p}-extra`, name: L('Add-ons', 'เพิ่มเติม'), required: false, multi: true, options: [
      opt(`${p}-egg`, L('Fried egg (khai dao)', 'ไข่ดาว'), 10, [{ itemId: 'eggs', qty: 1 }]),
    ],
  });

  // Original little illustrations for the demo dishes (drawn in code; no photos of any real shop or dish).
  type Art = 'soup' | 'fried' | 'rice' | 'side' | 'drink' | 'dessert';
  const art = (kind: Art, c1: string, c2: string): string => {
    const bodies: Record<Art, string> = {
      soup: `<path d="M18 50h60a30 28 0 0 1-60 0z" fill="${c1}"/><ellipse cx="48" cy="50" rx="30" ry="7" fill="${c2}"/><path d="M36 42c-4-6 4-8 0-14M48 40c-4-6 4-8 0-14M60 42c-4-6 4-8 0-14" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/><path d="M62 24l18 30M68 22l18 30" stroke="#b98a5b" stroke-width="3" stroke-linecap="round"/>`,
      fried: `<ellipse cx="48" cy="56" rx="36" ry="17" fill="#fff"/><ellipse cx="48" cy="54" rx="29" ry="12" fill="${c2}" opacity=".35"/><path d="M26 54c8-14 14 8 22-4s14 8 22-2M30 60c8-8 12 6 20-2s12 6 18-2" stroke="${c1}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="64" cy="46" r="6" fill="#f08a5d"/><path d="M30 44l8 4" stroke="#6fb36b" stroke-width="3" stroke-linecap="round"/>`,
      rice: `<path d="M14 54h68a34 26 0 0 1-68 0z" fill="${c1}"/><path d="M24 54c0-22 48-22 48 0z" fill="#fff"/><ellipse cx="62" cy="40" rx="13" ry="9" fill="#fff"/><circle cx="62" cy="40" r="5" fill="#f5c542"/><path d="M30 44l6 3M40 38l6 3" stroke="${c2}" stroke-width="3" stroke-linecap="round"/>`,
      side: `<ellipse cx="48" cy="60" rx="34" ry="13" fill="${c1}"/><circle cx="34" cy="48" r="10" fill="${c2}"/><circle cx="54" cy="46" r="10" fill="${c2}"/><circle cx="46" cy="58" r="10" fill="${c2}"/><circle cx="66" cy="56" r="9" fill="${c2}"/>`,
      drink: `<path d="M30 22h36l-5 54H35z" fill="${c1}" opacity=".9"/><path d="M33 40h30l-2 36H35z" fill="${c2}"/><rect x="38" y="46" width="9" height="9" rx="2" fill="#fff" opacity=".6"/><rect x="50" y="54" width="9" height="9" rx="2" fill="#fff" opacity=".6"/><path d="M58 10l-8 36" stroke="#e8667a" stroke-width="4" stroke-linecap="round"/>`,
      dessert: `<ellipse cx="48" cy="62" rx="36" ry="13" fill="#fff"/><path d="M22 58c4-20 44-20 52 0-8 8-44 8-52 0z" fill="${c1}"/><path d="M28 50l10-8 8 12zM44 50l10-9 8 12zM58 54l8-8 6 10z" fill="${c2}"/>`,
    };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="14" fill="#f3efe6"/>${bodies[kind]}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };

  const menu: MenuItem[] = [
    { id: 'porknoodle', name: L('Chicken Noodle Soup', 'ก๋วยเตี๋ยวไก่'), tab: tabs.food, category: cats.soup, price: 55, active: true, image: art('soup', '#d9a35b', '#f2d58a'),
      description: L('Clear bone broth with sliced chicken, fish balls and bean sprouts', 'น้ำซุปกระดูกใส ไก่สไลซ์ ลูกชิ้นปลา ถั่วงอก'),
      recipe: [{ itemId: 'broth', qty: 0.35 }, { itemId: 'chicken', qty: 0.05 }, { itemId: 'fishballs', qty: 0.04 }, { itemId: 'sprouts', qty: 0.03 }, { itemId: 'herbs', qty: 0.005 }],
      optionGroups: [
        noodleGroup('pn'),
        { id: 'pn-soup', name: L('Soup', 'น้ำซุป'), required: true, multi: false, options: [
          opt('pn-clear', L('Clear soup (nam sai)', 'น้ำใส')),
          opt('pn-tomyum', L('Tom yum', 'ต้มยำ'), 10, [{ itemId: 'tomyum', qty: 1 }]),
          opt('pn-dry', L('Dry (haeng)', 'แห้ง')),
        ] },
        sizeGroup('pn'),
        { id: 'pn-extra', name: L('Add-ons', 'เพิ่มเติม'), required: false, multi: true, options: [
          opt('pn-moremeat', L('Extra chicken', 'เพิ่มไก่'), 20, [{ itemId: 'chicken', qty: 0.05 }]),
          opt('pn-egg', L('Soft-boiled egg', 'ไข่ต้ม'), 10, [{ itemId: 'eggs', qty: 1 }]),
        ] },
      ] },
    { id: 'boat', name: L('Yen Ta Fo Noodles', 'เย็นตาโฟ'), tab: tabs.food, category: cats.soup, price: 65, active: true, image: art('soup', '#c9657a', '#f0a3b3'),
      description: L('Pink-sauce noodle soup with fish balls and morning glory', 'ก๋วยเตี๋ยวน้ำซุปสีชมพู ลูกชิ้นปลา ผักบุ้ง'),
      recipe: [{ itemId: 'broth', qty: 0.25 }, { itemId: 'fishballs', qty: 0.05 }, { itemId: 'morningglory', qty: 0.03 }, { itemId: 'palmsugar', qty: 0.004 }],
      optionGroups: [noodleGroup('bt'), sizeGroup('bt')] },
    { id: 'tomyumgoong', name: L('Tom Yum Seafood Noodles', 'ก๋วยเตี๋ยวต้มยำทะเล'), tab: tabs.food, category: cats.soup, price: 95, active: true, image: art('soup', '#d9663a', '#f5a27a'),
      recipe: [{ itemId: 'broth', qty: 0.35 }, { itemId: 'tomyum', qty: 1 }, { itemId: 'shrimp', qty: 0.06 }, { itemId: 'fishballs', qty: 0.03 }, { itemId: 'morningglory', qty: 0.02 }],
      optionGroups: [noodleGroup('ty'), sizeGroup('ty', 20)] },
    { id: 'padthai', name: L('Pad Thai', 'ผัดไทย'), tab: tabs.food, category: cats.fried, price: 75, active: true, image: art('fried', '#e0a04a', '#f2d9a4'),
      recipe: [{ itemId: 'senlek', qty: 0.13 }, { itemId: 'eggs', qty: 1 }, { itemId: 'sprouts', qty: 0.04 }, { itemId: 'peanuts', qty: 0.015 }, { itemId: 'padthaisauce', qty: 1 }, { itemId: 'lime', qty: 0.5 }],
      optionGroups: [proteinGroup('pt', 0.07), sizeGroup('pt')] },
    { id: 'padseeew', name: L('Rad Na (gravy noodles)', 'ราดหน้า'), tab: tabs.food, category: cats.fried, price: 70, active: true, image: art('fried', '#7fae5b', '#cfe3b5'),
      recipe: [{ itemId: 'senyai', qty: 0.15 }, { itemId: 'kale', qty: 0.06 }, { itemId: 'garlic', qty: 0.005 }, { itemId: 'fishsauce', qty: 0.01 }],
      optionGroups: [proteinGroup('ps', 0.08), sizeGroup('ps')] },
    { id: 'kaprao', name: L('Basil Chicken on Rice', 'ข้าวกะเพราไก่'), tab: tabs.food, category: cats.rice, price: 65, active: true, image: art('rice', '#c97a4a', '#4f8f4a'),
      recipe: [{ itemId: 'rice', qty: 0.25 }, { itemId: 'chicken', qty: 0.1 }, { itemId: 'basil', qty: 0.01 }, { itemId: 'chili', qty: 0.005 }, { itemId: 'garlic', qty: 0.005 }],
      optionGroups: [
        { id: 'kp-spice', name: L('Spice level', 'ระดับความเผ็ด'), required: true, multi: false, options: [
          opt('kp-mild', L('Not spicy', 'ไม่เผ็ด')), opt('kp-med', L('Medium', 'เผ็ดกลาง')), opt('kp-hot', L('Thai spicy', 'เผ็ดมาก')),
        ] },
        sizeGroup('kp'), friedEgg('kp'),
      ] },
    { id: 'friedrice', name: L('Fried Rice', 'ข้าวผัด'), tab: tabs.food, category: cats.rice, price: 65, active: true, image: art('rice', '#d1a24f', '#e8c76a'),
      recipe: [{ itemId: 'rice', qty: 0.28 }, { itemId: 'eggs', qty: 1 }, { itemId: 'garlic', qty: 0.005 }, { itemId: 'herbs', qty: 0.005 }],
      optionGroups: [proteinGroup('fr', 0.07), sizeGroup('fr'), friedEgg('fr')] },
    { id: 'kaprao-box', name: L('Basil Chicken Box — grab & go', 'ข้าวกะเพราไก่กล่อง พร้อมรับ'), tab: tabs.food, category: cats.rice, price: 60, active: true, image: art('rice', '#b86f45', '#5a9a52'),
      description: L('Packed this morning with a fried egg — sold from ready stock', 'แพ็กเช้านี้ พร้อมไข่ดาว ขายจากสต็อกที่ทำไว้'),
      recipe: [{ itemId: 'kapraobox', qty: 1 }] },
    { id: 'porkballs', name: L('Fried Fish Balls', 'ลูกชิ้นปลาทอด'), tab: tabs.food, category: cats.sides, price: 45, active: true, image: art('side', '#e6dccb', '#d9a35b'),
      recipe: [{ itemId: 'fishballs', qty: 0.1 }] },
    { id: 'plainrice', name: L('Steamed Rice', 'ข้าวสวย'), tab: tabs.food, category: cats.sides, price: 12, active: true, image: art('rice', '#cfc9bd', '#9aa59a'),
      recipe: [{ itemId: 'rice', qty: 0.2 }] },
    { id: 'thaitea', name: L('Thai Iced Tea', 'ชาเย็น'), tab: tabs.drinks, category: cats.drinks, price: 40, active: true, image: art('drink', '#e8a24c', '#d9772e'),
      recipe: [{ itemId: 'teabrew', qty: 1 }, { itemId: 'ice', qty: 0.2 }, { itemId: 'cups', qty: 1 }],
      optionGroups: [
        { id: 'tt-sweet', name: L('Sweetness', 'ความหวาน'), required: true, multi: false, options: [
          opt('tt-normal', L('Normal', 'หวานปกติ')), opt('tt-less', L('Less sweet', 'หวานน้อย')), opt('tt-none', L('No sugar', 'ไม่หวาน')),
        ] },
        { id: 'tt-size', name: L('Size', 'ขนาด'), required: true, multi: false, options: [
          opt('tt-reg', L('Regular', 'ปกติ')), opt('tt-large', L('Large', 'แก้วใหญ่'), 10, [], 1.4),
        ] },
      ] },
    { id: 'water', name: L('Drinking Water', 'น้ำเปล่า'), tab: tabs.drinks, category: cats.drinks, price: 12, active: true, image: art('drink', '#bfe3f2', '#8cc8e6'),
      recipe: [{ itemId: 'water', qty: 1 }] },
    { id: 'mango', name: L('Mango Sticky Rice', 'ข้าวเหนียวมะม่วง'), tab: tabs.desserts, category: cats.desserts, price: 90, active: true, image: art('dessert', '#f3ead2', '#f2b632'),
      recipe: [{ itemId: 'mango', qty: 0.5 }, { itemId: 'stickyrice', qty: 0.15 }, { itemId: 'coconut', qty: 0.05 }] },
  ];

  // [itemId, qtyReceived, qtyRemaining, unitCost, receivedDaysAgo, expiresInDays | null, lot]
  const B: [string, number, number, number, number, number | null, string][] = [
    ['senlek', 10, 3.5, 44, 2, 1, 'OTK-118'], ['senlek', 10, 10, 45, 0, 3, 'OTK-121'],
    ['senyai', 10, 6, 45, 1, 2, 'OTK-119'],
    ['senmee', 5, 4, 60, 10, 110, 'MK-2031'],
    ['bamee', 5, 1.5, 70, 2, 3, 'OTK-117'],
    ['porkslice', 8, 4.2, 158, 1, 2, 'OTK-120'],
    ['porkmince', 5, 2.4, 140, 1, 1, 'OTK-120'],
    ['porkballs', 5, 3, 130, 3, 4, 'OTK-114'],
    ['fishballs', 4, 2.6, 120, 3, 4, 'OTK-114'],
    ['beef', 4, 2.1, 320, 2, 1, 'OTK-116'],
    ['chicken', 6, 4.5, 95, 1, 1, 'MK-2040'],
    ['shrimp', 4, 1.6, 380, 12, 48, 'MK-1998'],
    ['bones', 12, 6, 60, 1, 1, 'OTK-120'],
    ['sprouts', 3, 0.8, 30, 2, 0, 'ARI-55'], ['sprouts', 3, 3, 30, 0, 2, 'ARI-58'],
    ['morningglory', 3, 1.2, 40, 1, 1, 'ARI-56'],
    ['kale', 3, 2, 50, 1, 3, 'ARI-56'],
    ['herbs', 1.5, 0.3, 80, 4, -1, 'ARI-52'], ['herbs', 1.5, 1.4, 80, 0, 3, 'ARI-58'],
    ['basil', 1, 0.4, 90, 1, 2, 'ARI-56'],
    ['garlic', 3, 2.2, 90, 8, 22, 'OTK-101'],
    ['chili', 1, 0.6, 120, 2, 5, 'ARI-55'],
    ['lime', 100, 45, 3, 3, 11, 'ARI-54'],
    ['rice', 15, 9, 25, 0, 1, 'Kitchen'],
    ['stickyrice', 5, 3.2, 40, 0, 1, 'Kitchen'],
    ['eggs', 300, 140, 4, 4, 17, 'MK-2035'],
    ['peanuts', 3, 2.5, 110, 15, 45, 'MK-1990'],
    ['tamarind', 3, 2, 60, 9, 21, 'OTK-100'],
    ['fishsauce', 12, 7, 45, 20, 345, 'MK-1975'],
    ['palmsugar', 6, 4.5, 55, 20, 160, 'MK-1975'],
    ['coconut', 4, 1.5, 70, 2, 3, 'MK-2038'],
    ['mango', 30, 9, 35, 3, 1, 'ARI-54'],
    ['thaitea', 2, 1.3, 280, 25, 155, 'MK-1960'],
    ['condensed', 24, 15, 28, 25, 155, 'MK-1960'],
    ['ice', 50, 30, 4, 0, null, 'ICE-1023'],
    ['water', 96, 52, 6, 12, null, 'MK-2002'],
    ['cups', 500, 320, 3, 18, null, 'MK-1980'],
    ['bowls', 300, 85, 4, 18, null, 'MK-1980'],
  ];
  const batches: Batch[] = B.map(([itemId, qtyReceived, qtyRemaining, unitCost, ago, exp, lot], i) => ({
    id: `demo-b${i}`, itemId, qtyReceived, qtyRemaining, unitCost,
    receivedAt: addDays(today, -ago), expiresAt: exp === null ? undefined : addDays(today, exp),
    lot, location: items.find((x) => x.id === itemId)!.location,
  }));

  const staff = demoStaff();
  const partial: AppState = { version: 1, isDemo: true, settings, staff, tables: defaultTables(), tickets: [], items, batches, menu, orders: [], adjustments: [] };
  // Prep batches already made, costed from their recipes
  const prepCost = (id: string) => { const it = items.find((i) => i.id === id)!; return recipeCost(partial, it.recipe!) / it.yieldQty!; };
  const prepBatch = (id: string, made: number, left: number, daysAgo: number, expires: number) => ({
    id: `demo-${id}`, itemId: id, qtyReceived: made, qtyRemaining: left, unitCost: prepCost(id),
    receivedAt: addDays(today, -daysAgo), expiresAt: addDays(today, expires), location: items.find((i) => i.id === id)!.location, lot: `Prep ${addDays(today, -daysAgo)}`,
  });
  batches.push(prepBatch('kapraobox', 20, 4, 0, 1), prepBatch('broth', 20, 11, 0, 2), prepBatch('tomyum', 40, 13, 1, 2), prepBatch('padthaisauce', 40, 26, 3, 4), prepBatch('teabrew', 25, 8, 0, 1));

  // ---- Sales history: 21 days of orders ----
  const rand = mulberry32(42);
  const weights: [string, number][] = [['porknoodle', 34], ['boat', 18], ['tomyumgoong', 14], ['padthai', 22], ['padseeew', 12], ['kaprao', 20], ['friedrice', 14], ['kaprao-box', 9], ['porkballs', 8], ['plainrice', 6], ['thaitea', 30], ['water', 20], ['mango', 9]];
  const totalW = weights.reduce((a, [, w]) => a + w, 0);
  const pick = () => {
    let r = rand() * totalW;
    for (const [id, w] of weights) if ((r -= w) <= 0) return id;
    return 'porknoodle';
  };
  // Noodle shops are busiest at breakfast-lunch and early dinner
  const hourWeights = [0, 0, 0, 0, 0, 0, 0, 2, 5, 6, 7, 12, 14, 8, 4, 3, 4, 7, 10, 8, 4, 1, 0, 0];
  const hourTotal = hourWeights.reduce((a, b) => a + b, 0);
  const pickHour = () => {
    let r = rand() * hourTotal;
    for (let h = 0; h < 24; h++) if ((r -= hourWeights[h]) <= 0) return h;
    return 12;
  };
  // Order a random choice from every required group (and sometimes an add-on)
  const randomChoices = (m: MenuItem) => {
    const c: Record<string, string[]> = {};
    for (const g of m.optionGroups ?? []) {
      if (g.required) c[g.id] = [g.options[rand() < 0.55 ? 0 : Math.floor(rand() * g.options.length)].id];
      else if (rand() < 0.15) c[g.id] = [g.options[0].id];
    }
    return c;
  };

  const orders: Order[] = [];
  let num = 1001;
  const now = new Date();
  const types: OrderType[] = ['Dine-in', 'Dine-in', 'Dine-in', 'Takeout', 'Delivery'];
  const pay = settings.paymentMethods;
  for (let ago = 20; ago >= 0; ago--) {
    const day = parseDate(addDays(today, -ago));
    const dow = day.getDay();
    const count = Math.round((dow === 6 || dow === 0 ? 70 : 52) * (0.8 + rand() * 0.4));
    const stamps: Date[] = [];
    for (let i = 0; i < count; i++) {
      const t = new Date(day);
      t.setHours(pickHour(), Math.floor(rand() * 60), Math.floor(rand() * 60));
      if (t <= now) stamps.push(t);
    }
    stamps.sort((a, b) => a.getTime() - b.getTime());
    for (const t of stamps) {
      const n = 1 + Math.floor(rand() * 3.4);
      const ol: Order['lines'] = [];
      for (let i = 0; i < n; i++) {
        const id = pick();
        const m = menu.find((x) => x.id === id)!;
        const dish = resolveDish(m, randomChoices(m));
        const qty = 1;
        ol.push({ menuItemId: m.id, name: m.name, options: dish.label || undefined, price: dish.price, qty, unitCost: recipeCost(partial, dish.recipe) * (0.95 + rand() * 0.1) });
      }
      const subtotal = round(ol.reduce((a, l) => a + l.price * l.qty, 0));
      const discount = rand() < 0.04 ? round(subtotal * 0.1) : 0;
      const tax = round((subtotal - discount) * settings.taxRate / 100);
      const type = types[Math.floor(rand() * types.length)];
      const r = rand();
      const payment = type === 'Delivery' ? pay[3] : r < 0.45 ? pay[0] : r < 0.9 ? pay[1] : pay[2];
      const server = staff[1 + Math.floor(rand() * 2)];
      orders.push({
        staffId: server.id, staffName: server.name,
        id: `demo-o${num}`, number: num++, createdAt: t.toISOString(), type,
        lines: ol, subtotal, discount, tax, tip: 0, total: round(subtotal - discount + tax), payment, status: rand() < 0.01 ? 'voided' : 'paid',
      });
    }
  }
  settings.nextOrderNumber = num;

  const adjustments: Adjustment[] = [];
  const waste: [string, number, number, 'waste' | 'expired', string][] = [
    ['sprouts', 0.8, 5, 'expired', L('Turned brown', 'เปลี่ยนสี')], ['broth', 4, 3, 'expired', L('End of 2-day hold', 'ครบ 2 วัน')],
    ['herbs', 0.4, 6, 'expired', L('Wilted', 'เหี่ยว')], ['rice', 2, 2, 'waste', L('Leftover at close', 'เหลือตอนปิดร้าน')],
    ['porkslice', 0.3, 4, 'waste', L('Dropped', 'ทำตก')], ['teabrew', 6, 1, 'expired', L('Next-day tea', 'ชาค้างคืน')],
  ];
  for (const [itemId, qty, ago, reason, note] of waste) {
    const it = items.find((i) => i.id === itemId)!;
    const c = it.kind === 'prep' ? prepCost(itemId) : it.defaultCost;
    const at = parseDate(addDays(today, -ago)); at.setHours(21, 30);
    adjustments.push({ id: `demo-a-${itemId}-${ago}`, at: at.toISOString(), itemId, qty: -qty, cost: qty * c, reason, note });
  }
  for (const b of batches) {
    const at = parseDate(b.receivedAt); at.setHours(7, 15);
    adjustments.push({ id: `demo-r-${b.id}`, at: at.toISOString(), itemId: b.itemId, batchId: b.id, qty: b.qtyReceived, cost: b.qtyReceived * b.unitCost, reason: b.lot?.startsWith('Prep') ? 'prep-made' : 'received', note: b.lot });
  }
  adjustments.sort((a, b) => a.at.localeCompare(b.at));

  // A few tables mid-service so the floor plan shows occupied tables.
  const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const [, somchai, ploy] = staff;
  const tickets: OpenTicket[] = [
    { id: 'demo-tk1', tableId: 't2', type: 'Dine-in', guests: 3, openedAt: minsAgo(18), staffId: somchai.id, staffName: somchai.name, note: '', discType: '%', discVal: 0,
      lines: [
        { id: 'l1', menuItemId: 'boat', qty: 2, choices: { 'bt-noodle': ['bt-lek'], 'bt-size': ['bt-normal'] } },
        { id: 'l2', menuItemId: 'porknoodle', qty: 1, choices: { 'pn-noodle': ['pn-bamee'], 'pn-soup': ['pn-tomyum'], 'pn-size': ['pn-special'] }, note: L('No bean sprouts', 'ไม่ใส่ถั่วงอก') },
        { id: 'l3', menuItemId: 'thaitea', qty: 2, choices: { 'tt-sweet': ['tt-less'], 'tt-size': ['tt-reg'] } },
      ] },
    { id: 'demo-tk2', tableId: 't5', type: 'Dine-in', guests: 2, openedAt: minsAgo(7), staffId: ploy.id, staffName: ploy.name, note: '', discType: '%', discVal: 0,
      lines: [
        { id: 'l4', menuItemId: 'padthai', qty: 1, choices: { 'pt-meat': ['pt-shrimp'], 'pt-size': ['pt-normal'] }, note: L('No peanuts — allergy', 'ไม่ใส่ถั่ว แพ้ถั่ว') },
        { id: 'l5', menuItemId: 'kaprao', qty: 1, choices: { 'kp-spice': ['kp-hot'], 'kp-size': ['kp-normal'], 'kp-extra': ['kp-egg'] } },
      ] },
    { id: 'demo-tk3', tableId: 'p1', type: 'Dine-in', guests: 4, openedAt: minsAgo(33), staffId: somchai.id, staffName: somchai.name, note: '', discType: '%', discVal: 0,
      lines: [
        { id: 'l6', menuItemId: 'tomyumgoong', qty: 2, choices: { 'ty-noodle': ['ty-mee'], 'ty-size': ['ty-normal'] } },
        { id: 'l7', menuItemId: 'friedrice', qty: 1, choices: { 'fr-meat': ['fr-pork'], 'fr-size': ['fr-special'] } },
        { id: 'l8', menuItemId: 'mango', qty: 2 },
        { id: 'l9', menuItemId: 'water', qty: 4 },
      ] },
  ];

  return { ...partial, batches, orders, adjustments, tickets };
}
