/**
 * stock-export.js — ออกไฟล์ Excel ของตาราง "รายการสต๊อกปัจจุบัน"
 *
 * **ตัวเลขทุกช่องมาจากชีตเสมอ ไม่เอาที่เบราว์เซอร์ส่งมา** เบราว์เซอร์บอกได้แค่
 * *แถวไหน* กับ *วันที่ไหน* (ตามที่กรองอยู่บนจอ) กฎเดียวกับใบขอซื้อใน
 * `purchase-request.js` — ไม่งั้นใครก็แก้ราคาในไฟล์ที่ระบบออกให้ได้จากฝั่ง client
 *
 * **รายการที่ยังไม่มีราคาต้องเป็นช่องว่าง ห้ามเป็น 0** และยอดรวมท้ายตารางต้อง
 * บอกด้วยว่าไม่ได้รวมกี่รายการ ไม่งั้นคนเปิดไฟล์จะอ่านว่านี่คือมูลค่าคลังทั้งหมด
 * (กฎเดียวกับที่ตารางบนหน้าเว็บใช้อยู่)
 *
 * กระดาษ: **A4 แนวตั้ง กว้างพอดีหน้า ยาวกี่หน้าก็ได้** พร้อมหัวตารางซ้ำทุกหน้า
 */
import { buildXlsx, STYLE } from './xlsx.js';
import { stockAt } from '../../public/js/shared/kpi.js';

/** สูงสุดที่ยอมออกให้ครั้งเดียว — ชีตมี 138 แท็บ เผื่อไว้เท่าตัว */
const MAX_ROWS = 400;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ประกอบแถวของไฟล์จากรายการที่ขอมา + ข้อมูลจริงจากชีต
 *
 * แยกออกจากการเขียนไฟล์เพื่อให้เทสต์ตรรกะได้โดยไม่ต้องแกะ .xlsx
 *
 * @param {string[]} requested ชื่อรายการที่เห็นอยู่บนจอ (ผ่านตัวกรองแล้ว)
 * @param {Array} known `kpi.items` จากชีต
 * @param {string} asOf `YYYY-MM-DD` หรือ `''` = ยอดปัจจุบันที่ server คิดไว้แล้ว
 * @returns {{rows:Array, total:number, missingPrice:number, skipped:string[]}}
 */
export function buildStockRows(requested, known, asOf = '') {
  const byName = new Map((known ?? []).map((i) => [i.item, i]));
  const at = ISO_DATE_RE.test(asOf) ? asOf : '';
  const rows = [];
  const skipped = [];
  const seen = new Set();

  for (const raw of Array.isArray(requested) ? requested : []) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name)) continue;
    // ชื่อต้องตรงกับแท็บที่มีอยู่จริง — กันการยัดชื่อมั่วเข้ามาให้ไฟล์มีแถวปลอม
    const src = byName.get(name);
    if (!src) {
      skipped.push(name);
      continue;
    }
    seen.add(name);

    /* ดูย้อนหลัง = คิดยอดใหม่ด้วย `stockAt()` ตัวเดียวกับที่เบราว์เซอร์ใช้
     * ถ้าเขียนกฎเลือกแถวเองที่นี่ ไฟล์กับหน้าจอจะค่อย ๆ แยกกันโดยไม่มีใครรู้ */
    const snap = at ? stockAt(src.log, at) : null;
    const balance = snap ? snap.balance : (src.balance ?? null);
    const unitPrice = src.unitPrice ?? null;

    rows.push({
      item: name,
      balance,
      unit: src.unit ?? '',
      unitPrice,
      // มูลค่าคิดได้เฉพาะเมื่อมีทั้งยอดและราคา — ขาดข้างใดข้างหนึ่ง = null ไม่ใช่ 0
      amount: balance !== null && unitPrice !== null ? balance * unitPrice : null,
      lifetime: src.lifetimeText ?? '',
    });
  }

  const priced = rows.filter((r) => r.amount !== null);
  return {
    rows,
    total: priced.reduce((s, r) => s + r.amount, 0),
    missingPrice: rows.length - priced.length,
    skipped,
  };
}

/**
 * สร้างไฟล์ .xlsx
 *
 * @param {object} o
 * @param {string[]} o.items
 * @param {Array} o.known
 * @param {string} [o.asOf]
 * @param {string} [o.asOfSheet] วันที่ล่าสุดที่ชีตมีข้อมูล (ใช้เขียนหัวกระดาษ)
 * @param {Date} [o.now]
 * @returns {{buffer:Buffer, fileName:string, rowCount:number, skipped:string[]}}
 */
export function createStockExport({ items, known, asOf = '', asOfSheet = '', now = new Date() }) {
  const { rows, total, missingPrice, skipped } = buildStockRows(items, known, asOf);
  if (!rows.length) throw new Error('ไม่มีรายการให้ออกไฟล์');
  if (rows.length > MAX_ROWS) throw new Error(`ออกได้ไม่เกิน ${MAX_ROWS} รายการต่อครั้ง`);

  const stamp = (d) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const iso = (s) => (ISO_DATE_RE.test(s) ? `${s.slice(8)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '');

  const dataDate = asOf ? iso(asOf) : iso(asOfSheet) || stamp(now);
  const COLS = 6;

  const sheet = [];
  // หัวเอกสาร — merge ให้เต็มความกว้างตาราง ไม่งั้นถูกคอลัมน์ถัดไปตัดหัวทิ้ง
  sheet.push([{ v: 'รายการสต๊อกคงเหลือ — KAMBIS', s: STYLE.TITLE }, ...Array(COLS - 1).fill('')]);
  sheet.push([
    { v: `ข้อมูล ณ วันที่ ${dataDate}${asOf ? ' (ดูย้อนหลัง)' : ''}`, s: STYLE.NOTE },
    ...Array(COLS - 1).fill(''),
  ]);
  sheet.push([
    { v: `ออกไฟล์เมื่อ ${stamp(now)} · ${rows.length} รายการ`, s: STYLE.NOTE },
    ...Array(COLS - 1).fill(''),
  ]);

  sheet.push(
    ['รายการ', 'คงเหลือ', 'หน่วย', 'ราคา/หน่วย', 'มูลค่า', 'ระยะเวลาใช้งาน'].map((v) => ({
      v,
      s: STYLE.TH,
    }))
  );

  for (const r of rows) {
    sheet.push([
      { v: r.item, s: STYLE.TD },
      // คงเหลือเป็นจำนวนนับ ไม่ใช่เงิน — "2,075.00 แผ่น" อ่านแล้วสะดุด
      { v: r.balance === null ? '' : r.balance, s: STYLE.TD_COUNT },
      { v: r.unit, s: STYLE.TD_C },
      /* ไม่มีราคา = เขียนคำว่า "ยังไม่ใส่ราคา" ไม่ใช่เว้นว่างเฉย ๆ และไม่ใช่ 0
       * คนเปิดไฟล์ต้องรู้ว่าต้องไปเติมที่ชีต ไม่ใช่คิดว่าของชิ้นนี้ฟรี */
      r.unitPrice === null
        ? { v: 'ยังไม่ใส่ราคา', s: STYLE.TD_C }
        : { v: r.unitPrice, s: STYLE.TD_MONEY },
      { v: r.amount === null ? '' : r.amount, s: STYLE.TD_MONEY },
      { v: r.lifetime, s: STYLE.TD_C },
    ]);
  }

  /* แถวรวม — ต้องบอกจำนวนรายการที่ไม่ได้รวมไว้ในแถวเดียวกัน
   * ถ้าโชว์แต่ยอด คนจะอ่านว่าเป็นมูลค่าคลังทั้งหมด ทั้งที่ยังขาดของที่ไม่มีราคา
   *
   * ข้อความอยู่ในช่วง B:D ที่ผสานกัน เพราะช่องเดียวกว้าง 13 ไม่พอ แล้วช่องข้าง ๆ
   * ก็มีค่าอยู่ ข้อความจึงถูกตัดกลางคัน (เคยได้ "ยังไม่รวม 9 รายการที่ไ") */
  const totalRow = sheet.length + 1; // 1-based ตามพิกัดของ Excel
  sheet.push([
    { v: 'มูลค่าสต๊อกรวม', s: STYLE.TOTAL_LABEL },
    {
      v: missingPrice ? `ยังไม่รวม ${missingPrice} รายการที่ไม่มีราคา` : '',
      s: STYLE.TOTAL_LABEL,
    },
    // ทุกช่องในช่วงที่ผสานต้องมีสไตล์เอง Excel ไม่ได้ยืดขอบของช่องซ้ายบนให้
    { v: '', s: STYLE.TOTAL_LABEL },
    { v: '', s: STYLE.TOTAL_LABEL },
    { v: total, s: STYLE.TOTAL_VALUE },
    { v: '', s: STYLE.TOTAL_LABEL },
  ]);

  const buffer = buildXlsx({
    sheetName: 'สต๊อกคงเหลือ',
    rows: sheet,
    /* A4 **แนวตั้ง** แคบกว่าแนวนอนราว 30% คอลัมน์จึงต้องแคบลงตาม ไม่งั้น
     * `fitToWidth` จะย่อทั้งแผ่นจนตัวอักษรเล็กเกินอ่าน — ยอมให้ชื่อรายการยาว ๆ
     * ตัดบรรทัดแทน (STYLE.TD ตั้ง wrapText ไว้แล้ว) ดีกว่าย่อทั้งหน้า */
    columnWidths: [34, 10, 8, 11, 13, 12],
    merges: [
      `A1:${String.fromCharCode(64 + COLS)}1`,
      `A2:${String.fromCharCode(64 + COLS)}2`,
      `A3:${String.fromCharCode(64 + COLS)}3`,
      `B${totalRow}:D${totalRow}`,
    ],
    page: {
      orientation: 'portrait',
      fitToPage: true,
      // กว้างพอดีหน้าเดียว แต่ยาวกี่หน้าก็ได้ตามจำนวนรายการ
      fitToHeight: 0,
      // หัวเอกสาร 3 บรรทัด + หัวตาราง ซ้ำทุกหน้า
      repeatRows: 4,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5 },
    },
    modified: now,
  });

  const fileName = `kambis-stock-${asOf || toIsoLocal(now)}.xlsx`;
  return { buffer, fileName, rowCount: rows.length, skipped };
}

function toIsoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
