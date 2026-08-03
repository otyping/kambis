/**
 * purchase-request.js — ออกใบขอซื้อ (Purchase Request) เป็นไฟล์ .xlsx
 *
 * ผู้ใช้กดปุ่มบนหน้า Supply Stock แล้วได้ไฟล์ Excel ดาวน์โหลดลงเครื่อง
 * พร้อมเก็บสำเนาไว้ที่ data/purchase-requests/ เป็นหลักฐานว่าเคยขอซื้ออะไรไป
 * (data/ ถูก gitignore ทั้งโฟลเดอร์ จึงไม่มีทางหลุดขึ้น git)
 *
 * ความปลอดภัย: รายการที่ส่งมาจากเบราว์เซอร์เชื่อไม่ได้ ต้องตรวจว่า
 * ชื่อรายการมีอยู่จริงในชีต และจำนวนเป็นตัวเลขบวก ก่อนเอาไปเขียนลงเอกสาร
 */
import { writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildXlsx, STYLE } from './xlsx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PR_DIR = path.join(ROOT, 'data', 'purchase-requests');

const MAX_ITEMS = 300;
const MAX_QTY = 1_000_000;

/** ชื่อไฟล์ต้องปลอดภัยเสมอ — กันการหลุดออกนอกโฟลเดอร์ที่ตั้งใจ */
function safeFileName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

/**
 * ออกเลขที่เอกสารแบบ PR-YYYYMMDD-NNN โดยนับต่อจากไฟล์ที่มีอยู่แล้วของวันนั้น
 * @param {Date} now
 */
async function nextDocNumber(now) {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  let maxSeq = 0;
  try {
    for (const file of await readdir(PR_DIR)) {
      const m = file.match(new RegExp(`^PR-${stamp}-(\\d+)\\.xlsx$`));
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
    }
  } catch {
    /* ยังไม่มีโฟลเดอร์ = ยังไม่เคยออกใบไหน */
  }
  return `PR-${stamp}-${String(maxSeq + 1).padStart(3, '0')}`;
}

/**
 * ตรวจรายการที่ผู้ใช้ส่งมา เทียบกับข้อมูลจริงจากชีต
 *
 * @param {Array} requested รายการจาก request body
 * @param {Array} known kpi.supply.items — แหล่งความจริงของชื่อ/หน่วย/ราคา
 * @returns {{items:Array, errors:string[]}}
 */
export function validateItems(requested, known) {
  const errors = [];
  if (!Array.isArray(requested) || requested.length === 0) {
    return { items: [], errors: ['ต้องเลือกอย่างน้อยหนึ่งรายการ'] };
  }
  if (requested.length > MAX_ITEMS) {
    return { items: [], errors: [`เลือกได้ไม่เกิน ${MAX_ITEMS} รายการต่อหนึ่งใบ`] };
  }

  const byName = new Map((known ?? []).map((i) => [i.item, i]));
  const items = [];
  const seen = new Set();

  for (const raw of requested) {
    const name = String(raw?.item ?? '').trim();
    if (!name) {
      errors.push('มีรายการที่ไม่ได้ระบุชื่อ');
      continue;
    }
    // ชื่อต้องตรงกับรายการที่มีแท็บอยู่จริงในชีต — กันการยัดชื่อมั่วเข้ามา
    const source = byName.get(name);
    if (!source) {
      errors.push(`ไม่พบรายการ "${name}" ในชีต Log Stock`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`รายการ "${name}" ซ้ำกัน`);
      continue;
    }
    seen.add(name);

    const qty = Number(raw?.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      errors.push(`จำนวนของ "${name}" ต้องเป็นตัวเลขมากกว่า 0`);
      continue;
    }

    /* ราคาเอาจากชีตเสมอ ไม่เอาที่เบราว์เซอร์ส่งมา
     * ไม่งั้นใครก็แก้ราคาในใบขอซื้อได้จากฝั่ง client */
    const unitPrice = source.unitPrice ?? null;
    items.push({
      item: name,
      unit: source.unit ?? null,
      qty,
      unitPrice,
      amount: unitPrice === null ? null : qty * unitPrice,
      balance: source.balance ?? null,
      minimum: source.minimum ?? null,
    });
  }

  return { items, errors };
}

/* ผู้อนุมัติตามแบบฟอร์มของบริษัท (Purchase Request/Purchase Request_03-08-2026.xlsx)
 * เอกสารที่ออกจากระบบต้องหน้าตาเหมือนที่ใช้กันอยู่ ไม่งั้นต้องพิมพ์ใหม่ทั้งใบ */
const APPROVERS = ['Ekaluck', 'Chamaiphorn', 'CEO'];

/** จำนวนแถวว่างขั้นต่ำในตาราง — ให้เขียนเพิ่มด้วยมือได้เหมือนฟอร์มเดิม */
const MIN_TABLE_ROWS = 5;

/**
 * ประกอบใบขอซื้อเป็น .xlsx แล้วเก็บสำเนาลงดิสก์
 *
 * @param {object} opts
 * @param {Array} opts.items ผลจาก validateItems()
 * @param {string} [opts.requestedBy] ชื่อผู้ใช้ที่ล็อกอินอยู่
 * @param {string} [opts.note]
 * @param {Date} [opts.now]
 * @returns {Promise<{docNo:string, fileName:string, buffer:Buffer, savedTo:string|null, totalAmount:number, missingPrice:number}>}
 */
export async function createPurchaseRequest({ items, requestedBy = null, note = '', now = new Date() }) {
  const docNo = await nextDocNumber(now);
  const dateText = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}/${now.getFullYear()}`;

  const totalAmount = items.reduce((t, i) => t + (i.amount ?? 0), 0);
  const missingPrice = items.filter((i) => i.unitPrice === null).length;

  /* วางตามแบบฟอร์มเดิมของบริษัททุกช่อง — 5 คอลัมน์ A–E
   *   A1:E1  หัวเอกสาร
   *   แถว 3  Name / Date       แถว 4  Project / Phase
   *   แถว 7  หัวตาราง: Date | Item | Number | Price/Unit | Total
   *   แถวถัดมา รายการ แล้วปิดท้ายด้วยแถว Total
   *   ท้ายเอกสาร Requested by + Approve by สามชั้น พร้อมชื่อผู้อนุมัติ
   */
  const rows = [];
  const merges = [];
  const rowHeights = {};
  const blank = (style) => ({ v: '', s: style });

  // แถว 1 — หัวเอกสาร
  rows.push([{ v: 'Purchase Request Form', s: STYLE.TITLE }, '', '', '', '']);
  merges.push('A1:E1');
  rowHeights[1] = 28;
  rows.push([]);

  // แถว 3 — Name / Date
  rows.push([
    { v: 'Name:', s: STYLE.LABEL },
    { v: requestedBy ?? '', s: STYLE.FIELD },
    { v: 'Date:', s: STYLE.LABEL_C },
    { v: dateText, s: STYLE.FIELD },
    blank(STYLE.FIELD),
  ]);
  merges.push('D3:E3');

  // แถว 4 — Project / Phase (ระบุที่มาของเอกสารให้ตามรอยกลับได้)
  rows.push([
    { v: 'Project:', s: STYLE.LABEL },
    { v: 'Kambis — Supply Stock', s: STYLE.FIELD },
    { v: 'Phase:', s: STYLE.LABEL_C },
    { v: docNo, s: STYLE.FIELD },
    blank(STYLE.FIELD),
  ]);
  merges.push('D4:E4');

  rows.push([]);
  rows.push([]);

  // แถว 7 — หัวตาราง
  rows.push(
    ['Date', 'Item', 'Number', 'Price/Unit', 'Total'].map((h) => ({ v: h, s: STYLE.TH }))
  );

  for (const item of items) {
    const unit = item.unit ? ` (${item.unit})` : '';
    rows.push([
      { v: dateText, s: STYLE.TD_C },
      { v: item.item + unit, s: STYLE.TD },
      { v: item.qty, s: STYLE.TD_C },
      // ไม่มีราคาในชีตให้เว้นว่าง ห้ามใส่ 0 เพราะยอดรวมจะดูเหมือนถูกต้องทั้งที่ขาด
      item.unitPrice === null ? blank(STYLE.TD_C) : { v: item.unitPrice, s: STYLE.TD_MONEY },
      item.amount === null ? blank(STYLE.TD_C) : { v: item.amount, s: STYLE.TD_MONEY },
    ]);
  }

  // แถวว่างให้เขียนเพิ่มด้วยมือได้ เหมือนฟอร์มเดิม
  for (let i = items.length; i < MIN_TABLE_ROWS; i++) {
    rows.push([blank(STYLE.TD_C), blank(STYLE.TD), blank(STYLE.TD_C), blank(STYLE.TD_C), blank(STYLE.TD_C)]);
  }

  // แถวรวม
  const totalRow = rows.length + 1;
  rows.push([
    { v: 'Total', s: STYLE.TOTAL_LABEL },
    blank(STYLE.TOTAL_LABEL),
    blank(STYLE.TOTAL_LABEL),
    blank(STYLE.TOTAL_LABEL),
    { v: totalAmount, s: STYLE.TOTAL_VALUE },
  ]);
  merges.push(`A${totalRow}:D${totalRow}`);

  // หมายเหตุเรื่องรายการที่ยังไม่มีราคา — ต้องเห็นก่อนอนุมัติ
  if (missingPrice > 0) {
    rows.push([]);
    const noteRow = rows.length + 1;
    rows.push([
      {
        v: `* ${missingPrice} item(s) have no price in the source sheet — the total above is incomplete. · มี ${missingPrice} รายการที่ยังไม่มีราคาในชีต ยอดรวมจึงยังไม่ครบ`,
        s: STYLE.NOTE,
      },
      '',
      '',
      '',
      '',
    ]);
    merges.push(`A${noteRow}:E${noteRow}`);
    rowHeights[noteRow] = 30;
  }

  if (String(note ?? '').trim()) {
    rows.push([]);
    const r = rows.length + 1;
    rows.push([{ v: `Note: ${String(note).slice(0, 300)}`, s: STYLE.NOTE }, '', '', '', '']);
    merges.push(`A${r}:E${r}`);
  }

  rows.push([]);
  rows.push([]);

  // ── ช่องเซ็น: Requested by + Approve by สามชั้น ──
  const signBlock = (label, name) => {
    rows.push([]);
    const r = rows.length + 1;
    rows.push([
      { v: label, s: STYLE.LABEL_C },
      '',
      blank(STYLE.SIGN_LINE),
      blank(STYLE.SIGN_LINE),
      blank(STYLE.SIGN_LINE),
    ]);
    merges.push(`A${r}:B${r}`, `C${r}:E${r}`);
    if (name) {
      const nr = rows.length + 1;
      rows.push(['', '', { v: name, s: STYLE.SIGN_NAME }, blank(STYLE.SIGN_NAME), blank(STYLE.SIGN_NAME)]);
      merges.push(`C${nr}:E${nr}`);
    }
  };

  signBlock('Requested  by:', null);
  for (const approver of APPROVERS) signBlock('Approve by:', approver);

  const buffer = buildXlsx({
    sheetName: docNo,
    rows,
    // ความกว้างตามฟอร์มเดิม
    columnWidths: [14.875, 54, 13.125, 13, 12.75],
    merges,
    rowHeights,
    modified: now,
  });

  const fileName = `${safeFileName(docNo)}.xlsx`;
  let savedTo = null;
  try {
    await mkdir(PR_DIR, { recursive: true });
    savedTo = path.join(PR_DIR, fileName);
    await writeFile(savedTo, buffer);
  } catch (err) {
    // เก็บสำเนาไม่ได้ก็ยังต้องให้ผู้ใช้ดาวน์โหลดได้ — แค่ไม่มีหลักฐานเก็บไว้
    console.warn('[pr] เก็บสำเนาใบขอซื้อไม่สำเร็จ:', err.message);
    savedTo = null;
  }

  return { docNo, fileName, buffer, savedTo, totalAmount, missingPrice };
}

export { PR_DIR };
