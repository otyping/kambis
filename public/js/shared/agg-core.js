/**
 * shared/agg-core.js — สูตรรวมยอดและกฎการเรียงเวลา ที่ **ทั้ง server และเบราว์เซอร์ใช้ตัวเดียวกัน**
 *
 * ทำไมต้องมีไฟล์นี้:
 *
 * เดิมกฎการเรียงช่วงเวลาถูกเขียนไว้สองที่ (server/lib/normalize.js กับ
 * public/js/ui/controls.js) แล้ว CLAUDE.md ต้องเขียนกำกับไว้ว่า "แก้ที่หนึ่งต้องแก้อีกที่ด้วย"
 * ซึ่งเป็นกับดักที่รอวันพลาด
 *
 * พอเพิ่มแถบตัวกรองกลาง เบราว์เซอร์ต้องรวมยอดจากแถวที่กรองแล้วเองด้วย
 * ถ้าเขียนสูตรรวมยอดขึ้นมาอีกชุด จะได้ตัวเลขสองชุดที่เพี้ยนจากกันได้เงียบ ๆ
 *
 * ไฟล์นี้อยู่ใน public/ เพราะเบราว์เซอร์โหลดไฟล์นอก public/ ไม่ได้
 * ส่วน server import จากพาธนี้ตรง ๆ (เป็นแค่ไฟล์บนดิสก์) จึงมีสูตรชุดเดียวจริง ๆ
 *
 * ข้อบังคับ: ไฟล์นี้ต้องเป็น ESM ล้วน **ห้าม import อะไรทั้งสิ้น** และห้ามแตะ DOM
 * ไม่งั้นฝั่งใดฝั่งหนึ่งจะ import ไม่ได้
 */

/** ขนาดดอกเรียงจากใหญ่ไปเล็ก — ลำดับมาตรฐานทั่วทั้งระบบ */
export const SIZE_KEYS = ['XXL', 'XL', 'L', 'M', 'S', 'XS'];

/** เกรดพรีเมียม (>M) ที่ใช้คิด % เกรดสูง */
export const PREMIUM_SIZES = ['XXL', 'XL', 'L', 'M'];

/** ประเภทของที่ไม่ใช่ดอก */
export const NON_FLOWER_KEYS = [
  'shake',
  'shake2',
  'sugarleaf',
  'kief',
  'dokPan',
  'dokRon',
  'sesDok',
];

/** ป้ายชื่อภาษาไทยของของที่ไม่ใช่ดอก */
export const NON_FLOWER_LABELS = {
  shake: 'Shake',
  shake2: 'Shake 2',
  sugarleaf: 'Sugarleaf',
  kief: 'Kief',
  dokPan: 'ดอกปั่น',
  dokRon: 'ดอกร่อน',
  sesDok: 'เศษดอก',
};

// ─────────────────────────────────────────────────────────────
// ตัวเลข
// ─────────────────────────────────────────────────────────────

/** บวกโดยมองว่า null = 0 — ใช้ตอนรวมยอดรวม */
export function sum(values) {
  return values.reduce((t, v) => t + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
}

/** บวกโดยข้าม null — คืน null ถ้าไม่มีค่าที่ใช้ได้เลย (ต่างจาก sum ตรงนี้) */
export function sumOrNull(values) {
  let total = 0;
  let seen = false;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

// ─────────────────────────────────────────────────────────────
// ลำดับเวลา
// ─────────────────────────────────────────────────────────────

/**
 * แปลงป้ายช่วงเวลาเป็นตัวเลขที่เรียงได้
 *
 * ห้ามเรียงป้ายช่วงเวลาด้วย localeCompare เด็ดขาด — เคยพังจริงมาแล้ว:
 * "Q1'2026" มาก่อน "Q2'2025" เพราะเทียบ Q1 กับ Q2 ก่อนถึงปี
 * กราฟจึงดูเหมือนผลผลิตตกแล้วเด้ง ทั้งที่ความจริงแค่เรียงผิด
 */
export function periodOrder(label) {
  const s = String(label ?? '').trim();
  if (!s) return Number.MAX_SAFE_INTEGER;

  // ไตรมาส — ยอมรับทั้ง Q1'2026, Q1 2026 และ 2026-Q1
  const q =
    s.match(/Q\s*([1-4])\s*['’\s/-]*\s*(\d{4})/i) || s.match(/(\d{4})\s*[-\s]*Q\s*([1-4])/i);
  if (q) {
    const [a, b] = [q[1], q[2]];
    const year = Number(a.length === 4 ? a : b);
    const quarter = Number(a.length === 4 ? b : a);
    // เทียบเป็นเดือนสุดท้ายของไตรมาส ให้อยู่มาตราเดียวกับแบบ ปี-เดือน
    return year * 10000 + quarter * 3 * 100;
  }

  const ymd = s.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (ymd) return Number(ymd[1]) * 10000 + Number(ymd[2]) * 100 + Number(ymd[3] ?? 0);

  const year = s.match(/^(\d{4})$/);
  if (year) return Number(year[1]) * 10000;

  return Number.MAX_SAFE_INTEGER;
}

export function comparePeriod(a, b) {
  const oa = periodOrder(a);
  const ob = periodOrder(b);
  if (oa !== ob) return oa - ob;
  return String(a).localeCompare(String(b));
}

/** ป้ายนี้เป็นช่วงเวลาที่อ่านออกไหม */
export function looksLikePeriod(label) {
  return periodOrder(label) !== Number.MAX_SAFE_INTEGER;
}

// ─────────────────────────────────────────────────────────────
// รวมยอด
// ─────────────────────────────────────────────────────────────

/** รวมน้ำหนักแยกตามขนาดจากชุด record */
export function sizeMix(rows) {
  const mix = {};
  for (const key of SIZE_KEYS) mix[key] = sum(rows.map((r) => r.sizes?.[key]));
  return mix;
}

/** รวมน้ำหนักของที่ไม่ใช่ดอกแยกตามประเภท (ตัดประเภทที่เป็นศูนย์ออก) */
export function nonFlowerMix(rows) {
  const mix = {};
  for (const key of NON_FLOWER_KEYS) {
    const total = sum(rows.map((r) => r.nonFlower?.[key]));
    if (total > 0) mix[NON_FLOWER_LABELS[key]] = total;
  }
  return mix;
}

/** จัดกลุ่มและรวมน้ำหนักดอกตาม key ที่กำหนด */
export function groupSum(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (key === null || key === undefined || key === '') continue;
    const entry = map.get(key) || { key, flower: 0, nonFlower: 0, rows: 0, premium: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.premium += r.premiumTotal || 0;
    entry.rows++;
    map.set(key, entry);
  }
  return [...map.values()];
}

/** สัดส่วนเกรดพรีเมียม (>M) เทียบกับน้ำหนักดอกทั้งหมด */
export function premiumPct(rows) {
  const total = sum(rows.map((r) => r.flowerTotal));
  if (!total) return null;
  const premium = sum(rows.map((r) => sum(PREMIUM_SIZES.map((k) => r.sizes?.[k]))));
  return (premium / total) * 100;
}

/** ชุดข้อมูลรายเดือน (YYYY-MM) เรียงตามเวลา */
export function monthlySeries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    const month = r.date.slice(0, 7);
    const entry = map.get(month) || { month, flower: 0, nonFlower: 0, rows: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.rows++;
    map.set(month, entry);
  }
  return [...map.values()].sort((a, b) => comparePeriod(a.month, b.month));
}

/** ชุดข้อมูลรายวัน เรียงตามเวลา */
export function dailySeries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    const entry = map.get(r.date) || { date: r.date, flower: 0, nonFlower: 0, premium: 0, rows: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.premium += r.premiumTotal || 0;
    entry.rows++;
    map.set(r.date, entry);
  }
  return [...map.values()].sort((a, b) => comparePeriod(a.date, b.date));
}

/** ชุดข้อมูลรายปี (YYYY) เรียงตามเวลา */
export function yearlySeries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    const year = r.date.slice(0, 4);
    const entry = map.get(year) || { year, flower: 0, nonFlower: 0, rows: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.rows++;
    map.set(year, entry);
  }
  return [...map.values()].sort((a, b) => comparePeriod(a.year, b.year));
}

/**
 * จัดกลุ่มแบบซ้อน: แกน X หนึ่งค่า → หลายหมวดในแท่งเดียว
 * ใช้กับกราฟแท่งซ้อน (ผลผลิตตามเดือน แยกสายพันธุ์)
 *
 * @returns {{key:string, sub?:string, parts:Record<string,number>, total:number}[]}
 */
export function stackBy(rows, xFn, catFn, valueFn = (r) => r.flowerTotal || 0) {
  const map = new Map();
  for (const r of rows) {
    const x = xFn(r);
    if (x === null || x === undefined || x === '') continue;
    const cat = catFn(r);
    if (cat === null || cat === undefined || cat === '') continue;
    const entry = map.get(x) || { key: x, parts: {}, total: 0 };
    const v = valueFn(r) || 0;
    entry.parts[cat] = (entry.parts[cat] ?? 0) + v;
    entry.total += v;
    map.set(x, entry);
  }
  return [...map.values()];
}

/**
 * เลือกหมวดที่ใหญ่ที่สุด N หมวด ที่เหลือยุบเป็น "อื่น ๆ"
 *
 * **ต้องคำนวณจากข้อมูลทั้งชุดครั้งเดียว แล้วส่ง map ที่ได้ไปใช้ทุกที่**
 * ห้ามคำนวณใหม่จากแถวที่กรองแล้ว ไม่งั้นเปลี่ยนตัวกรองทีสีจะสลับกันทั้งกราฟ
 * (สีต้องผูกกับตัวสายพันธุ์ ไม่ใช่กับอันดับของมัน)
 */
export function topCategories(rows, catFn, limit, otherLabel = 'อื่น ๆ') {
  const totals = new Map();
  for (const r of rows) {
    const cat = catFn(r);
    if (!cat) continue;
    totals.set(cat, (totals.get(cat) ?? 0) + (r.flowerTotal || 0));
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const keep = ranked.slice(0, limit);
  const keepSet = new Set(keep);
  return {
    keys: ranked.length > limit ? [...keep, otherLabel] : keep,
    /** จับหมวดดิบให้กลายเป็นหมวดที่ใช้แสดง */
    map: (cat) => (cat && keepSet.has(cat) ? cat : cat ? otherLabel : null),
    otherLabel,
  };
}

// ─────────────────────────────────────────────────────────────
// ชื่อรายการวัสดุ
// ─────────────────────────────────────────────────────────────

/**
 * ทำให้ชื่อรายการเทียบกันได้ระหว่าง "ชื่อแท็บ" กับ "ชื่อในตารางสั่งของรายเดือน"
 *
 * ชื่อเดียวกันเขียนต่างกันสองที่เสมอ:
 *   แท็บ  "2.Scrog Net"                      ตาราง "Scrog Net ตาข่าย (242 แผ่น/ห่อ/)"
 *   แท็บ  "4.ป้ายแท็กสีขาว"                   ตาราง "ป้ายแท็ก-สีขาว (100 ชิ้น/ห่อ)"
 *   แท็บ  "16.กรรไกรทริมดอก(ตัดด้าย)"         ตาราง "กรรไกร-ทริมดอก(ตัดด้าย)"
 * จึงตัดเลขนำหน้า วงเล็บ ขีด และช่องว่างออกให้หมดก่อนเทียบ
 */
export function normalizeItemName(name) {
  if (name === null || name === undefined) return '';
  return (
    String(name)
      .replace(/^\s*(\d+)\s*\./, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[-–—_.]/g, ' ')
      // ตัดช่องว่างทิ้งทั้งหมด ไม่ใช่แค่ยุบให้เหลือช่องเดียว
      // ภาษาไทยไม่เว้นวรรคระหว่างคำอยู่แล้ว และขีดที่กลายเป็นช่องว่างทำให้
      // "ป้ายแท็ก-สีน้ำเงิน" กับ "ป้ายแท็กสีน้ำเงิน" ไม่ตรงกันทั้งที่เป็นของชิ้นเดียวกัน
      .replace(/\s+/g, '')
      .toLowerCase()
  );
}

// ─────────────────────────────────────────────────────────────
// ชื่อหน่วย (ถุง / ห่อ / ลัง / แพ็ค …)
// ─────────────────────────────────────────────────────────────

/**
 * ทำให้ชื่อหน่วยเทียบกันได้
 *
 * ชีต Log Stock ให้คนพิมพ์หน่วยเองทั้งในป้ายราคา หัวตาราง และหมายเหตุ
 * คำเดียวกันจึงสะกดไม่ตรงกันในแท็บเดียวกันด้วยซ้ำ — วัดจากชีตจริงเจอ
 * `แพ็ค` · `แพค` · `แพ็็ค` (ไม้ไต่คู้ซ้อนสองตัว) ปนกันอยู่ 6 แท็บ
 * ถ้าไม่ล้างวรรณยุกต์ก่อน จะนับเป็น "หน่วยราคาต่างจากหน่วยสต๊อก" ปลอม ๆ 6 รายการ
 *
 * ตัดทิ้ง: วรรณยุกต์/ไม้ไต่คู้/การันต์ (U+0E47–U+0E4E) · ช่องว่าง · จุด · ไม้ยมก
 */
export function canonUnit(unit) {
  if (unit === null || unit === undefined) return '';
  return String(unit)
    .replace(/[็-๎]/g, '')
    .replace(/[\s.ๆ]/g, '')
    .toLowerCase();
}

/**
 * หน่วยสองตัวนี้หมายถึงหน่วยเดียวกันไหม
 *
 * ยอมให้ฝั่งหนึ่งเป็นคำขึ้นต้นของอีกฝั่ง เพราะป้ายราคาชอบมีคำขยายต่อท้าย
 * (`ราคา/แพ็ค=5 กิโล` กับคอลัมน์หน่วย `แพ็ค` = หน่วยเดียวกัน แค่บอกน้ำหนักเพิ่ม
 *  `ราคา/แผ่น 98 หลุม` กับ `แผ่น` ก็เช่นกัน)
 *
 * **แต่ส่วนที่เกินมาต้องไม่ใช่ตัวอักษรไทย** ไม่งั้น `ห่อ` จะไปตรงกับ `ห่อใหญ่`
 * ซึ่งเป็นคนละหน่วย แล้วระบบจะถือว่าไม่ต้องแปลงทั้งที่ต้องแปลง — ผิดข้างที่อันตราย
 * เพราะเงียบ (`includes()` ยิ่งห้ามใช้ใหญ่ ด้วยเหตุผลเดียวกัน)
 */
const UNIT_TAIL_WORD_RE = /^[ก-ๆ]/;

export function sameUnit(a, b) {
  const x = canonUnit(a);
  const y = canonUnit(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [long, short] = x.length > y.length ? [x, y] : [y, x];
  if (!long.startsWith(short)) return false;
  return !UNIT_TAIL_WORD_RE.test(long.slice(short.length));
}
