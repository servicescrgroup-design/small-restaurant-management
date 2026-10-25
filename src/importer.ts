/**
 * Turn a menu someone copied (from their Wongnai or GrabFood page, a LINE MAN listing, a PDF, a sign…) or a
 * spreadsheet export (GrabMerchant, FoodStory or any other POS) into menu rows the owner can review before importing.
 *
 * No site is scraped: the owner copies or exports their own information and gives it to us.
 */

export interface ImportRow {
  include: boolean;
  name: string;
  category: string;
  price: number;
  /** Higher price when the source showed a range like "45-50" → becomes a ธรรมดา / พิเศษ size choice */
  priceHigh?: number;
  description?: string;
}

export interface PasteResult {
  rows: ImportRow[];
  phone?: string;
}

// "฿45", "45 บาท", "45.-", "THB 45", "45-50", "45 – 50 บาท", "1,200"
const NUM = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?`;
const PRICE_RE = new RegExp(String.raw`(?:฿|THB|thb|บาท)?\s*(${NUM})\s*(?:[-–~ถึง]+\s*(?:฿|THB)?\s*(${NUM}))?\s*(?:บาท|฿|THB|\.-|-)?\s*$`);
const PHONE_RE = /(?:\+66|0)\d{1,2}[-\s]?\d{3}[-\s]?\d{3,4}/;

// Lines that are page furniture, not menu content
const NOISE = /^(?:ดูเพิ่มเติม|ดูทั้งหมด|see (?:more|all)|รีวิว|reviews?|เมนูแนะนำ|recommended|ราคา|price|แชร์|share|บันทึก|save|สั่งเลย|order now|เปิด(?:อยู่)?|open now|ปิด(?:แล้ว)?|closed|เวลาเปิด|opening hours|★|⭐|\d(?:\.\d)?\s*(?:ดาว|stars?)?$|\d+(?:\.\d)?\s*(?:ดาว|stars?)$|\d+\s*(?:รีวิว|reviews?)$|delivery fee|ค่า(?:จัด)?ส่ง|min(?:imum)? order|สั่งขั้นต่ำ|[\d,+]+\s*(?:ratings?|คะแนน)|\d+(?:\.\d)?\s*(?:km|กม\.?)$)/i;

const toNum = (s: string) => Number(s.replace(/,/g, ''));
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[•·|:：]+\s*$/, '').replace(/^\s*[-•·*\d.)]+\s+/, '').trim();

/** A short line with no price, followed by priced lines, is treated as a category heading. */
function looksLikeHeading(line: string) {
  return line.length <= 40 && !/\d{2,}/.test(line) && !/[.!?]$/.test(line) && !looksLikeDescription(line);
}

/** Sentences under a dish: commas, several words, or longer Thai phrases with spaces (but not "A / B" headings). */
function looksLikeDescription(line: string) {
  if (line.includes('/')) return false;
  const words = line.split(/\s+/).length;
  const thai = /[\u0E00-\u0E7F]/.test(line);
  return /[,，、]/.test(line) || words >= 4 || (thai && words >= 2 && line.length > 15);
}

export function parsePastedMenu(text: string, fallbackCategory: string): PasteResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: ImportRow[] = [];
  let category = fallbackCategory;
  let pendingName: string | null = null;
  let pendingDesc: string | undefined;
  let phone: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!phone && PHONE_RE.test(raw) && !/[฿]|บาท/.test(raw)) { phone = raw.match(PHONE_RE)![0]; continue; }
    if (NOISE.test(raw)) continue;

    const m = raw.match(PRICE_RE);
    const price = m ? toNum(m[1]) : NaN;
    const high = m && m[2] ? toNum(m[2]) : undefined;
    const priceOnly = m && clean(raw.slice(0, m.index)) === '';
    const plausible = m && price > 0 && price < 100000 && (!high || high >= price);

    if (plausible && !priceOnly) {
      // "ก๋วยจั๊บ 45-50" on one line
      rows.push({ include: true, name: clean(raw.slice(0, m!.index)), category, price, priceHigh: high && high > price ? high : undefined });
      pendingName = null;
    } else if (plausible && priceOnly && pendingName) {
      // Name on one line, price on the next (how Wongnai and most listings lay it out)
      rows.push({ include: true, name: pendingName, category, price, priceHigh: high && high > price ? high : undefined, ...(pendingDesc ? { description: pendingDesc } : {}) });
      pendingName = null;
      pendingDesc = undefined;
    } else if (!plausible) {
      // Could be a dish name waiting for its price, a description, or a category heading.
      const next = lines[i + 1] ?? '';
      const nextIsPriceOnly = (() => { const n = next.match(PRICE_RE); return !!n && clean(next.slice(0, n.index)) === ''; })();
      const nextHasPrice = PRICE_RE.test(next);
      if (pendingName && !nextIsPriceOnly && rows.length && rows[rows.length - 1].name === pendingName) {
        pendingName = null;
      }
      const afterNext = lines[i + 2] ?? '';
      const afterNextIsPriceOnly = (() => { const n = afterNext.match(PRICE_RE); return !!n && clean(afterNext.slice(0, n.index)) === ''; })();
      if (nextIsPriceOnly) {
        pendingName = clean(raw);
        pendingDesc = undefined;
      } else if (afterNextIsPriceOnly && !looksLikeDescription(raw) && looksLikeDescription(next) && !PRICE_RE.test(next)) {
        // Name, then a description, then the price (how GrabFood and LINE MAN lay it out)
        pendingName = clean(raw);
        pendingDesc = clean(next);
        i++;
      } else if (pendingName === null && rows.length && !rows[rows.length - 1].description && looksLikeDescription(raw)) {
        // A sentence under the previous dish → its description
        const last = rows[rows.length - 1];
        if (!last.description) last.description = clean(raw);
      } else if (looksLikeHeading(raw) && (nextHasPrice || !rows.length || PRICE_RE.test(lines[i + 2] ?? ''))) {
        category = clean(raw);
        pendingName = null;
      } else {
        pendingName = clean(raw);
      }
    }
  }
  // Drop duplicates (same name + price), keep the first
  const seen = new Set<string>();
  return {
    phone,
    rows: rows.filter((r) => r.name && !seen.has(`${r.name}|${r.price}`) && (seen.add(`${r.name}|${r.price}`), true)),
  };
}

// ---------- Spreadsheets (Excel / CSV) ----------

export type Column = 'name' | 'price' | 'category' | 'description' | 'ignore';

const GUESS: [Column, RegExp][] = [
  ['name', /^(?:name|item|item name|item_name|menu|menu name|menu item|product|product name|dish|ชื่อ|ชื่อเมนู|ชื่อรายการ|ชื่อสินค้า|เมนู|รายการ|สินค้า)$/i],
  ['price', /^(?:price|unit price|selling price|sale price|item price|price \(thb\)|ราคา|ราคาขาย|ราคาต่อหน่วย)$/i],
  ['category', /^(?:category|categories|category name|category_name|group|menu group|type|section|หมวด|หมวดหมู่|ชื่อหมวดหมู่|หมวดหมู่สินค้า|กลุ่ม|กลุ่มสินค้า|ประเภท)$/i],
  ['description', /^(?:description|detail|details|note|รายละเอียด|คำอธิบาย)$/i],
];

/** Guess what each column holds from its header (Thai or English), falling back to looser matches. */
export function guessColumns(headers: string[]): Column[] {
  const used = new Set<Column>();
  const pick = (h: string, loose: boolean): Column => {
    const t = h.trim();
    for (const [col, re] of GUESS) {
      if (used.has(col)) continue;
      if (re.test(t) || (loose && new RegExp(re.source.replace(/^\^\(\?:|\)\$$/g, ''), 'i').test(t))) { used.add(col); return col; }
    }
    return 'ignore';
  };
  const strict = headers.map((h) => pick(h, false));
  return strict.map((c, i) => (c !== 'ignore' ? c : pick(headers[i], true)));
}

export function rowsFromTable(table: string[][], columns: Column[], fallbackCategory: string): ImportRow[] {
  const at = (r: string[], col: Column) => { const i = columns.indexOf(col); return i >= 0 ? String(r[i] ?? '').trim() : ''; };
  // Exports often write the category once and leave it blank for the dishes under it (merged cells)
  let lastCategory = fallbackCategory;
  return table
    .map((r) => {
      lastCategory = at(r, 'category') || lastCategory;
      const priceText = at(r, 'price');
      const m = priceText.match(new RegExp(String.raw`(${NUM})(?:\s*[-–~]\s*(${NUM}))?`));
      const price = m ? toNum(m[1]) : 0;
      const high = m && m[2] ? toNum(m[2]) : undefined;
      return {
        include: true,
        name: at(r, 'name'),
        category: lastCategory,
        price,
        priceHigh: high && high > price ? high : undefined,
        description: at(r, 'description') || undefined,
      };
    })
    .filter((r) => r.name);
}

/** Minimal CSV reader (quotes, commas, newlines in quotes, BOM). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  const delim = (s.split('\n')[0].match(/\t/g)?.length ?? 0) > (s.split('\n')[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row);
  return out;
}

/**
 * Pull the spreadsheets out of a .zip (GrabMerchant's menu download comes zipped), biggest first —
 * the menu items sheet is the largest. Uses the browser's own unzip, so nothing extra is downloaded.
 */
async function unzipSpreadsheets(file: File): Promise<File[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  // The central directory lists every file with its real sizes (local headers may leave them blank)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: File[] = [];
  for (let n = 0; n < count && view.getUint32(p, true) === 0x02014b50; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xlsx|xls|csv|tsv)$/i.test(name) || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = buf.slice(start, start + size);
    let data: BlobPart = raw;
    if (method === 8) data = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    else if (method !== 0) continue;
    out.push(new File([data], name.split('/').pop()!));
  }
  return out.sort((a, b) => b.size - a.size);
}

/** Read an Excel, CSV or zipped file into rows of text. Excel support is loaded only when needed. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  if (/\.zip$/i.test(file.name)) {
    for (const inner of await unzipSpreadsheets(file)) {
      const rows = await readSpreadsheet(inner);
      const cols = rows[0] ? guessColumns(rows[0]) : [];
      if (cols.includes('name') && cols.includes('price')) return rows;
    }
    throw new Error('no menu in zip');
  }
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    const rows = parseCsv(await file.text());
    const i = rows.findIndex((r) => { const c = guessColumns(r); return c.includes('name') && c.includes('price'); });
    return i > 0 ? rows.slice(i) : rows;
  }
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  // Use the first sheet that has a recognisable name/price header
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' }) as string[][];
    const cleaned = rows.filter((r) => r.some((c) => String(c).trim()));
    // Exports often start with a title row: the header is the first row with both a name and a price column
    const cols = cleaned.map((r) => guessColumns(r.map(String)));
    let headerIdx = cols.findIndex((c) => c.includes('name') && c.includes('price'));
    if (headerIdx < 0) headerIdx = cols.findIndex((c) => c.includes('name'));
    if (headerIdx >= 0) return cleaned.slice(headerIdx).map((r) => r.map(String));
  }
  const first = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }) as string[][];
  return first.filter((r) => r.some((c) => String(c).trim())).map((r) => r.map(String));
}
