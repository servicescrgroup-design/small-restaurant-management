import type { DeliveryApp, MenuItem } from './types';

/**
 * Read a delivery app's sales report (GrabMerchant, LINE MAN Merchant, ShopeeFood Partner) that the
 * owner downloaded, into orders. Nothing is fetched from the apps: they only share live orders with
 * approved partners, so the owner exports the report and gives it to us.
 *
 * Report layouts differ and change, so columns are recognised by their header (English or Thai) and
 * the owner can correct any of them before importing.
 */

export const APPS: { id: DeliveryApp; name: string; portal: string }[] = [
  { id: 'grab', name: 'GrabFood', portal: 'https://merchant.grab.com/' },
  { id: 'lineman', name: 'LINE MAN', portal: 'https://merchant.wongnai.com/' },
  { id: 'shopeefood', name: 'ShopeeFood', portal: 'https://partner.shopee.co.th/' },
];

export type SalesCol = 'orderId' | 'date' | 'time' | 'gross' | 'fee' | 'net' | 'status' | 'items' | 'ignore';
export const SALES_COLS: SalesCol[] = ['orderId', 'date', 'time', 'gross', 'fee', 'net', 'status', 'items', 'ignore'];

// Checked in this order, so "Net sales" is read as the payout before "sales" could match the food total
const GUESS: [SalesCol, RegExp][] = [
  ['orderId', /(order|booking|transaction|bill)\s*(id|no\.?|number|code|#|ref)|^id$|รหัส(คำสั่งซื้อ|ออเดอร์|การสั่งซื้อ)|(หมายเลข|เลขที่)\s*(คำสั่งซื้อ|ออเดอร์|การสั่งซื้อ)/i],
  ['status', /status|สถานะ/i],
  ['net', /net|payout|settle|you (receive|earn)|merchant (receive|earn|income)|amount to merchant|ยอดสุทธิ|รับจริง|ได้รับ|โอน|รายได้สุทธิ/i],
  ['fee', /commission|\bgp\b|fee|charge|deduct|ค่าคอม|ค่าธรรมเนียม|หัก|จีพี/i],
  ['gross', /gross|subtotal|order (value|amount|total)|food (value|total|price|amount)|item (total|amount)|sales|total|amount|price|ยอดขาย|ยอดรวม|ราคา|มูลค่า|ค่าอาหาร/i],
  ['time', /^(time|เวลา)$/i],
  ['date', /date|created|placed|ordered|time|วันที่|วันเวลา|เวลาสั่ง/i],
  ['items', /items?|menu|dish|order details|description|products?|รายการ|เมนู|สินค้า/i],
];

export function guessSalesColumns(headers: string[]): SalesCol[] {
  const used = new Set<SalesCol>();
  return headers.map((h) => {
    for (const [col, re] of GUESS) if (!used.has(col) && re.test(h.trim())) { used.add(col); return col; }
    return 'ignore';
  });
}

/** Score a header row: an order id or a date plus some money is what a sales report looks like. */
const headerScore = (cols: SalesCol[]) =>
  (cols.includes('orderId') ? 3 : 0) + (cols.includes('date') ? 2 : 0) + (['gross', 'net', 'fee'].filter((c) => cols.includes(c as SalesCol)).length) + (cols.includes('items') ? 1 : 0);

/** Find the table in a workbook: the sheet and row whose header looks most like a sales report. */
export function findSalesTable(sheets: string[][][]): { rows: string[][]; columns: SalesCol[] } | null {
  let best: { rows: string[][]; columns: SalesCol[]; score: number } | null = null;
  for (const sheet of sheets) {
    for (let i = 0; i < Math.min(sheet.length, 25); i++) {
      const columns = guessSalesColumns(sheet[i]);
      const score = headerScore(columns);
      if (score >= 4 && (!best || score > best.score)) best = { rows: sheet.slice(i), columns, score };
    }
  }
  return best && { rows: best.rows, columns: best.columns };
}

/** "฿1,234.50", "1 234,50", "(45.00)", "-45" → number */
export function parseMoney(s: string): number {
  const t = s.replace(/[฿$€\s]|THB|บาท/gi, '');
  if (!t) return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[()\-+]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

/**
 * Dates as Thai reports write them: 2026-10-26 14:03, 26/10/2026 2:03 PM, 26 Oct 2026, 26 ต.ค. 2569
 * (Buddhist years are converted). Day comes before month unless the first number can't be a month.
 */
export function parseDateTime(dateText: string, timeText = ''): Date | null {
  const s = `${dateText} ${timeText}`.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  let y = 0, mo = 0, d = 0;
  let m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
    let a = +m[1], b = +m[2];
    if (b > 12 && a <= 12) [a, b] = [b, a]; // month/day order
    d = a; mo = b; y = +m[3];
  } else if ((m = s.match(/(\d{1,2})\s*([A-Za-z]{3,}|[ก-๙]+\.[ก-๙]+\.?)\s*,?\s*(\d{2,4})/))) {
    d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()] ?? MONTHS[m[2].endsWith('.') ? m[2] : `${m[2]}.`] ?? 0; y = +m[3];
  } else if ((m = s.match(/([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})/))) {
    mo = MONTHS[m[1].slice(0, 3).toLowerCase()] ?? 0; d = +m[2]; y = +m[3];
  }
  if (!y || !mo || !d) return null;
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543; // Buddhist era
  let hh = 12, mm = 0;
  const tm = s.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp][Mm])?/g);
  const last = tm?.[tm.length - 1]?.match(/(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (last && !(last[1].length === 4)) {
    hh = +last[1]; mm = +last[2];
    if (last[3]) { const pm = /p/i.test(last[3]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  }
  const date = new Date(y, mo - 1, d, hh, mm);
  return Number.isNaN(date.getTime()) ? null : date;
}

const CANCELLED = /cancel|refund|reject|fail|void|ยกเลิก|คืนเงิน|ปฏิเสธ|ไม่สำเร็จ/i;

export interface ParsedItem { name: string; qty: number; menuItemId?: string }
export interface ParsedOrder {
  externalId: string;
  createdAt: Date | null;
  gross: number;
  fee: number;
  net: number;
  feeEstimated: boolean;
  cancelled: boolean;
  items: ParsedItem[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[()（）]/g, '').trim();

/** "2x กะเพรา, ชาไทย x1; 3 Fried rice" → items with quantities, matched to menu dishes by name. */
export function parseItems(text: string, menu: MenuItem[]): ParsedItem[] {
  if (!text.trim()) return [];
  const names = menu.map((m) => ({ id: m.id, keys: [m.name, m.nameEn ?? ''].filter(Boolean).map(norm) }));
  const match = (name: string) => {
    const n = norm(name);
    return names.find((x) => x.keys.includes(n))?.id
      ?? names.find((x) => x.keys.some((k) => k.length > 2 && (n.includes(k) || k.includes(n))))?.id;
  };
  return text.split(/[,;\n|]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
    let qty = 1, name = p;
    let m = p.match(/^(\d+)\s*[x×*]?\s+(.+)$/i) ?? p.match(/^(\d+)\s*[x×*]\s*(.+)$/i);
    if (m) { qty = +m[1]; name = m[2]; }
    else if ((m = p.match(/^(.+?)\s*[x×*]\s*(\d+)$/i) ?? p.match(/^(.+?)\s*\((\d+)\)$/))) { name = m[1]; qty = +m[2]; }
    name = name.replace(/\s*[-–]\s*฿?\d[\d,.]*\s*$/, '').trim();
    return { name, qty: Math.max(1, qty), menuItemId: match(name) };
  });
}

/** Turn report rows into orders. Missing amounts are worked out from the others (or the shop's GP). */
export function parseSalesRows(rows: string[][], columns: SalesCol[], menu: MenuItem[], appCut: number): ParsedOrder[] {
  const at = (r: string[], c: SalesCol) => { const i = columns.indexOf(c); return i >= 0 ? (r[i] ?? '').trim() : ''; };
  const has = (c: SalesCol) => columns.includes(c);
  const out: ParsedOrder[] = [];
  for (const r of rows) {
    const id = at(r, 'orderId');
    const date = parseDateTime(at(r, 'date'), at(r, 'time'));
    let gross = has('gross') ? parseMoney(at(r, 'gross')) : 0;
    let fee = has('fee') ? Math.abs(parseMoney(at(r, 'fee'))) : 0;
    let net = has('net') ? parseMoney(at(r, 'net')) : 0;
    if (!id && !date && !gross && !net) continue; // totals or blank lines
    if (/^(total|sum|รวม|ยอดรวม)/i.test(id)) continue;
    let feeEstimated = false;
    if (!gross && net && fee) gross = net + fee;
    if (!gross && net && !fee) { gross = appCut < 1 ? net / (1 - appCut) : net; fee = gross - net; feeEstimated = true; }
    if (gross && !has('fee') && has('net')) fee = Math.max(0, gross - net);
    if (gross && !has('fee') && !has('net')) { fee = gross * appCut; feeEstimated = true; }
    if (!has('net') || (!net && !gross)) net = gross - fee;
    out.push({
      externalId: id,
      createdAt: date,
      gross: Math.round(gross * 100) / 100,
      fee: Math.round(fee * 100) / 100,
      net: Math.round(net * 100) / 100,
      feeEstimated,
      cancelled: CANCELLED.test(at(r, 'status')),
      items: parseItems(at(r, 'items'), menu),
    });
  }
  return out;
}
