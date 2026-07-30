/**
 * normalize.js — ตัวช่วยแปลงค่าดิบจากชีตให้เป็นข้อมูลที่คำนวณได้
 *
 * หลักการสำคัญ: "-" และเซลล์ว่าง = null ไม่ใช่ 0
 * ในชีตของ Kambis "-" แปลว่า "ไม่มีข้อมูล/ไม่เกี่ยวข้อง" การนับเป็น 0 จะทำให้ค่าเฉลี่ยผิด
 */

/** ขนาดดอกเรียงจากใหญ่ไปเล็ก — ใช้เป็นลำดับมาตรฐานทั่วทั้งระบบ */
export const SIZE_KEYS = ['XXL', 'XL', 'L', 'M', 'S', 'XS'];

/** เกรดพรีเมียม (>M) ที่ใช้คิด % เกรดสูงในรายงานผู้บริหาร */
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

/**
 * แปลงเซลล์เป็นตัวเลข
 * @returns {number|null} null เมื่อเป็นค่าว่าง, "-", หรือแปลงไม่ได้
 */
export function num(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === '-' || s === '—' || s === '–' || s === 'N/A' || s === '#DIV/0!') return null;

  // ตัด comma คั่นหลักพัน, ช่องว่าง, และสัญลักษณ์หน่วยที่อาจติดมา
  const cleaned = s.replace(/,/g, '').replace(/\s/g, '').replace(/[฿%]/g, '');
  if (cleaned === '' || cleaned === '-') return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** แปลงเซลล์เป็นเปอร์เซ็นต์ (คืน null ถ้าไม่ใช่ตัวเลข) */
export function pct(value) {
  return num(value);
}

/** บวกตัวเลขโดยข้าม null — คืน null ถ้าไม่มีค่าที่ใช้ได้เลย */
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

/** บวกตัวเลขโดยมองว่า null = 0 — ใช้ตอนรวมยอดรวมทั้งระบบ */
export function sum(values) {
  return values.reduce((t, v) => t + (typeof v === 'number' && Number.isFinite(v) ? v : 0), 0);
}

const THAI_MONTHS = {
  'ม.ค.': 0, มกราคม: 0, jan: 0, january: 0,
  'ก.พ.': 1, กุมภาพันธ์: 1, feb: 1, february: 1,
  'มี.ค.': 2, มีนาคม: 2, mar: 2, march: 2, arp: 3,
  'เม.ย.': 3, เมษายน: 3, apr: 3, april: 3,
  'พ.ค.': 4, พฤษภาคม: 4, may: 4,
  'มิ.ย.': 5, มิถุนายน: 5, jun: 5, june: 5,
  'ก.ค.': 6, กรกฎาคม: 6, jul: 6, july: 6,
  'ส.ค.': 7, สิงหาคม: 7, aug: 7, august: 7,
  'ก.ย.': 8, กันยายน: 8, sep: 8, sept: 8, september: 8,
  'ต.ค.': 9, ตุลาคม: 9, oct: 9, october: 9,
  'พ.ย.': 10, พฤศจิกายน: 10, nov: 10, november: 10,
  'ธ.ค.': 11, ธันวาคม: 11, dec: 11, december: 11,
};

/** แปลงปี 2 หลัก / พ.ศ. / ค.ศ. ให้เป็น ค.ศ. 4 หลัก */
function normalizeYear(raw) {
  let y = Number(raw);
  if (!Number.isFinite(y)) return null;
  if (y < 100) y += 2000;
  // ปี พ.ศ. (เช่น 2569) → ค.ศ.
  if (y > 2400) y -= 543;
  return y;
}

/**
 * แปลงข้อความวันที่จากชีตเป็น ISO date string (YYYY-MM-DD)
 *
 * รองรับรูปแบบที่พบจริงในชีต:
 *   10/03/2026 · 21/06/26 · 4 Feb 26 · 20-May-26 · Mar-26 · 12 FEB 26 · 7 Aug 28
 *
 * @returns {string|null}
 */
export function parseSheetDate(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || s === '-') return null;

  // dd/mm/yyyy หรือ dd/mm/yy
  let m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = normalizeYear(m[3]);
    if (year !== null && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return toIso(year, month, day);
    }
    return null;
  }

  // "4 Feb 26" · "12 FEB 26" · "4-Feb-26" · "20-May-26"
  m = s.match(/^(\d{1,2})\s*[-\s]\s*([A-Za-zก-๙.]+)\s*[-\s]\s*(\d{2,4})$/);
  if (m) {
    const month = THAI_MONTHS[m[2].toLowerCase()] ?? THAI_MONTHS[m[2]];
    const year = normalizeYear(m[3]);
    if (month !== undefined && year !== null) return toIso(year, month, Number(m[1]));
    return null;
  }

  // "Mar-26" · "Feb-2026" (ไม่มีวัน → ใช้วันที่ 1)
  m = s.match(/^([A-Za-zก-๙.]+)\s*[-\s]\s*(\d{2,4})$/);
  if (m) {
    const month = THAI_MONTHS[m[1].toLowerCase()] ?? THAI_MONTHS[m[1]];
    const year = normalizeYear(m[2]);
    if (month !== undefined && year !== null) return toIso(year, month, 1);
    return null;
  }

  return null;
}

function toIso(year, monthIndex, day) {
  const d = new Date(Date.UTC(year, monthIndex, day));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * เติมค่าที่หายจากเซลล์ merge — ถ้าเซลล์ว่าง ให้ใช้ค่าล่าสุดที่ไม่ว่างจากแถวก่อนหน้า
 * ใช้กับชีตขายดอกที่วันที่/ลูกค้าเขียนแค่แถวแรกของกลุ่ม
 *
 * @param {string[][]} rows
 * @param {number[]} colIndexes คอลัมน์ที่ต้องเติม
 * @returns {string[][]} array ใหม่ (ไม่แก้ของเดิม)
 */
export function forwardFill(rows, colIndexes) {
  const carry = {};
  return rows.map((row) => {
    const next = [...row];
    for (const c of colIndexes) {
      const v = String(next[c] ?? '').trim();
      if (v) carry[c] = v;
      else if (carry[c] !== undefined) next[c] = carry[c];
    }
    return next;
  });
}

/**
 * หาแถว header โดยมองหาแถวที่มีคำสำคัญครบตามที่กำหนด
 * @param {string[][]} rows
 * @param {string[]} keywords คำที่ต้องปรากฏ (บางส่วนก็พอ)
 * @param {number} minHits จำนวนคำที่ต้องเจอขั้นต่ำ
 * @returns {number} index ของแถว header หรือ -1
 */
export function findHeaderRow(rows, keywords, minHits = 2) {
  const limit = Math.min(rows.length, 30);
  for (let r = 0; r < limit; r++) {
    const joined = rows[r].map((c) => String(c ?? '').toLowerCase()).join('|');
    const hits = keywords.filter((k) => joined.includes(k.toLowerCase())).length;
    if (hits >= minHits) return r;
  }
  return -1;
}

/**
 * สร้าง map จากชื่อคอลัมน์ → index โดย match แบบยืดหยุ่น
 * (ชีตมีทั้ง "XXL (g)", "XXL  (g)", "ขนาด (น้ำหนัก ) XXL (Kg)")
 *
 * @param {string[]} headerRow
 * @returns {(pattern: RegExp|string, opts?:{from?:number}) => number}
 */
export function columnFinder(headerRow) {
  const cells = headerRow.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
  return function find(pattern, opts = {}) {
    const from = opts.from ?? 0;
    for (let i = from; i < cells.length; i++) {
      if (pattern instanceof RegExp) {
        if (pattern.test(cells[i])) return i;
      } else if (cells[i].toLowerCase() === String(pattern).toLowerCase()) {
        return i;
      }
    }
    return -1;
  };
}

/** สร้าง object ขนาดดอกเปล่า */
export function emptySizes() {
  return { XXL: null, XL: null, L: null, M: null, S: null, XS: null };
}

/** สร้าง object ของไม่ใช่ดอกเปล่า */
export function emptyNonFlower() {
  return {
    shake: null,
    shake2: null,
    sugarleaf: null,
    kief: null,
    dokPan: null,
    dokRon: null,
    sesDok: null,
  };
}

/**
 * สร้าง record มาตรฐานของระบบ — parser ทุกตัวต้องคืนหน้าตานี้
 * flowerTotal/nonFlowerTotal คำนวณใหม่จาก sizes เสมอ ไม่เชื่อคอลัมน์ Total ในชีต
 */
export function makeRecord(fields) {
  const sizes = { ...emptySizes(), ...(fields.sizes || {}) };
  const nonFlower = { ...emptyNonFlower(), ...(fields.nonFlower || {}) };
  return {
    date: fields.date ?? null,
    crop: fields.crop ?? null,
    strain: fields.strain ?? null,
    sizes,
    nonFlower,
    flowerTotal: sumOrNull(SIZE_KEYS.map((k) => sizes[k])),
    nonFlowerTotal: sumOrNull(NON_FLOWER_KEYS.map((k) => nonFlower[k])),
    premiumTotal: sumOrNull(PREMIUM_SIZES.map((k) => sizes[k])),
    source: fields.source ?? null,
    tab: fields.tab ?? null,
    rowIndex: fields.rowIndex ?? null,
    raw: fields.raw ?? {},
    ...(fields.extra || {}),
  };
}

/**
 * ทำให้ชื่อสายพันธุ์เทียบกันได้
 *
 * ชีตสะกดชื่อเดียวกันได้หลายสิบแบบ ทั้งพิมพ์ผิด ใส่หมายเหตุต่อท้าย และขึ้นบรรทัดใหม่ในเซลล์
 *   "Cookie 's Gelato" · "Cookies Gelato" · "Cookie’s Gelato"   → Cookie's Gelato
 *   "Feisian Dew" · "Fisian Dew" · "Frisiain Dew"               → Frisian Dew
 *   "Dante Tnfene" · "Dante lnfene" (l กับ I สลับกัน)            → Dante Inferno
 *   "Royal Gorilla เขียนหน้าถุง (A)"                             → Royal Gorilla
 *
 * ค่าดิบยังเก็บไว้ที่ raw.strainText เสมอ และ analysis.js จะรายงานว่าชื่อไหน
 * มีการสะกดหลายแบบ เพื่อให้แก้ที่ต้นทางได้
 */
const STRAIN_ALIASES = [
  [/cookie'?s?\s*gelato/, "Cookie's Gelato"],
  [/royal\s*gor+il+a/, 'Royal Gorilla'],
  [/(frisian|frision|frisiain|frisain|frissian|fisian|feisian)\s*dew/, 'Frisian Dew'],
  [/dante\s*(inferno|tnfene|lnfene|infene)/, 'Dante Inferno'],
  [/mokum'?s?\s*tulip/, "Mokum's Tulip"],
  [/s\.?\s*b\.?\s*su[gp]er\s*boof/, 'SB Super Boof'],
  [/sho\s*gun/, 'Shogun'],
  [/og\s*ku[sc]?[hk]/, 'OG Kush'],
  [/alien\s*mint/, 'Alien Mint'],
  [/pablo\s*revenge/, 'Pablo Revenge'],
];

export function canonicalStrain(name) {
  if (name === null || name === undefined) return null;
  const s = String(name)
    .replace(/[‘’ʼ]/g, "'") // ' ' ʼ → '
    .replace(/\s+/g, ' ')
    .replace(/\s*'\s*/g, "'")
    .trim();
  if (!s || s === '-') return null;

  const lower = s.toLowerCase();
  for (const [re, canonical] of STRAIN_ALIASES) {
    if (re.test(lower)) return canonical;
  }
  return s;
}

/**
 * ทำให้รหัสครอปเทียบกันได้
 *
 * ชีตเขียนรหัสเดียวกันได้หลายแบบ ต้องยุบให้เหลือรูปเดียวเพื่อเทียบข้ามรายงาน:
 *   "G4/2 -7 NOV 25" · "G4/2-7NOV25" · "G 4/2 - 4 FEB 26"  → G4/2-07NOV25
 *   "G1/06JAN25" · "G 4/15SEP25"                            → G1-06JAN25 (ไม่มีเลขห้อง)
 *   "G1/1 & G1/3 - 17NOV25"                                 → G1/1&G1/3-17NOV25
 *
 * จุดที่ต้องระวัง: ตัวเลขหลังเครื่องหมาย / เป็น "เลขห้อง" ก็ได้ เป็น "วันที่" ก็ได้
 * แยกกันด้วยว่ามีตัวอักษรเดือนตามมาติดกันหรือไม่ (G2/1ARP25 → 1 คือวันที่ ไม่ใช่ห้อง)
 */
export function canonicalCrop(code) {
  if (code === null || code === undefined) return null;
  const s = String(code).replace(/\s+/g, ' ').trim();
  if (!s || s === '-') return null;

  const upper = s.toUpperCase();

  // ตัดส่วนวันที่ท้ายรหัสออกก่อน (วัน + เดือนอังกฤษ + ปี 2 หลัก)
  const dateMatch = upper.match(/(\d{1,2})\s*([A-Z]{3,4})\s*'?\s*(\d{2})\s*$/);
  let datePart = null;
  let head = upper;
  if (dateMatch) {
    datePart = `${dateMatch[1].padStart(2, '0')}${dateMatch[2]}${dateMatch[3]}`;
    head = upper.slice(0, dateMatch.index);
  }

  // เก็บคู่ house/room ทั้งหมด (รองรับรูปแบบรวมสองห้องด้วย "&")
  const units = [];
  const unitRe = /G\s*(\d{1,2})\s*(?:\/\s*(\d)(?![\d]))?/g;
  let m;
  while ((m = unitRe.exec(head)) !== null) {
    const house = String(Number(m[1]));
    units.push(m[2] ? `G${house}/${m[2]}` : `G${house}`);
  }

  if (units.length === 0) return datePart ? `${head.replace(/[\s-]+$/, '')}-${datePart}` : s;

  const unitPart = [...new Set(units)].join('&');
  return datePart ? `${unitPart}-${datePart}` : unitPart;
}
