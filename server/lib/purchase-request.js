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
import { writeFile, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildXlsx, STYLE } from './xlsx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PR_DIR = path.join(ROOT, 'data', 'purchase-requests');
const INDEX_FILE = path.join(PR_DIR, 'index.json');

const MAX_ITEMS = 300;
const MAX_QTY = 1_000_000;

/** ชื่อไฟล์ต้องปลอดภัยเสมอ — กันการหลุดออกนอกโฟลเดอร์ที่ตั้งใจ */
function safeFileName(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
}

/* ═══════════════════════════════════════════════════════════════
   ทะเบียนใบขอซื้อ — data/purchase-requests/index.json
   ═══════════════════════════════════════════════════════════════

   เดิมระบบเก็บแค่ไฟล์ .xlsx ซึ่ง **เครื่องอ่านกลับไม่ได้** จึงไม่มีทางรู้ว่า
   เคยขอซื้ออะไรไปแล้วบ้าง พอของยังไม่มาแล้วรายการนั้นยังต่ำกว่าขั้นต่ำอยู่
   มันก็โผล่ในตาราง "ของที่ต้องสั่งซื้อ" เหมือนไม่เคยขอ — ฝ่ายจัดซื้อจึงขอซ้ำ

   ทะเบียนนี้คือส่วนที่ขาดไป: จดว่าใบไหนขออะไร จำนวนเท่าไร เมื่อไร
   แล้วให้ระบบไปเทียบกับคอลัมน์ "รับ" ใน Log Sheet เองว่าของมาหรือยัง
   (ดู attachPendingRequests ใน shared/kpi.js) — ไม่มีใครต้องมากดอัปเดตสถานะ

   เขียนแบบ atomic (tmp → rename) ตามแบบเดียวกับ config/users.json
   ถ้าไฟล์เสียหายจะถือว่า "ยังไม่เคยมีใบขอซื้อ" ไม่ใช่ทำให้ทั้งระบบล่ม */

const INDEX_VERSION = 1;

/** @returns {Promise<{version:number, requests:Array}>} */
export async function readRequestIndex() {
  try {
    const raw = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
    if (!raw || !Array.isArray(raw.requests)) return { version: INDEX_VERSION, requests: [] };
    return raw;
  } catch {
    // ยังไม่มีไฟล์ หรือไฟล์พัง — เริ่มใหม่ ดีกว่าทำให้ออกใบขอซื้อไม่ได้เลย
    return { version: INDEX_VERSION, requests: [] };
  }
}

async function writeRequestIndex(index) {
  const tmp = `${INDEX_FILE}.tmp`;
  await mkdir(PR_DIR, { recursive: true });
  await writeFile(tmp, JSON.stringify(index, null, 2), 'utf8');
  await rename(tmp, INDEX_FILE);
}

/**
 * ออกเลขที่เอกสารแบบ PR-YYYYMMDD-NNN
 *
 * นับจาก **ทั้งทะเบียนและชื่อไฟล์** แล้วเอาค่ามากสุด — ทะเบียนอย่างเดียวไม่พอ
 * เพราะใบที่ออกก่อนมีทะเบียน (8 ใบแรก) มีแต่ไฟล์ ส่วนชื่อไฟล์อย่างเดียวก็ไม่พอ
 * เพราะถ้าวันหนึ่งเก็บสำเนาไม่สำเร็จ เลขจะถูกใช้ซ้ำ
 *
 * ออกเลขฐานครั้งเดียวแล้วให้ผู้เรียกบวก offset เอง — **ห้ามเรียกซ้ำระหว่างวนลูป**
 * เพราะไฟล์ของใบก่อนหน้าถูกเขียนลงดิสก์ไปแล้ว การสแกนรอบสองจะเห็นมันแล้วบวกซ้ำ
 * (เคยได้เลข 002 แล้วข้ามไป 004 เพราะเหตุนี้)
 *
 * @param {Date} now
 * @param {{requests:Array}} index
 * @returns {Promise<{stamp:string, base:number}>}
 */
async function docNumberBase(now, index) {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const seqOf = (name) => {
    const m = String(name).match(new RegExp(`^PR-${stamp}-(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  let maxSeq = 0;
  for (const r of index.requests) maxSeq = Math.max(maxSeq, seqOf(r.docNo));
  try {
    for (const file of await readdir(PR_DIR)) maxSeq = Math.max(maxSeq, seqOf(file));
  } catch {
    /* ยังไม่มีโฟลเดอร์ = ยังไม่เคยออกใบไหน */
  }
  return { stamp, base: maxSeq };
}

const formatDocNo = (stamp, seq) => `PR-${stamp}-${String(seq).padStart(3, '0')}`;

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
      /* group มาจาก parser (แท็บปุ๋ย 12 แท็บ = 'nutrient' ที่เหลือ = 'item')
       * ใช้แยกว่าจะออกด้วยแบบฟอร์มไหน — ห้ามให้เบราว์เซอร์ส่งมาเอง */
      group: source.group === 'nutrient' ? 'nutrient' : 'item',
    });
  }

  return { items, errors };
}

/**
 * แยกรายการเป็นใบละแบบฟอร์ม
 *
 * บริษัทใช้ฟอร์มปุ๋ย (Athena/Coco/Co2) คนละแบบกับฟอร์มวัสดุทั่วไป
 * เลือกปนกันมาในครั้งเดียวจึงออกเป็นสองใบ ไม่ใช่บังคับให้ผู้ใช้กดสองรอบ
 * เรียงวัสดุก่อนเสมอเพื่อให้เลขที่เอกสารคาดเดาได้
 */
export function splitByForm(items) {
  const general = items.filter((i) => i.group !== 'nutrient');
  const nutrient = items.filter((i) => i.group === 'nutrient');
  const out = [];
  if (general.length) out.push({ form: 'general', items: general });
  if (nutrient.length) out.push({ form: 'nutrient', items: nutrient });
  return out;
}

/* ผู้อนุมัติตามแบบฟอร์มของบริษัท (Purchase Request/Purchase Request_03-08-2026.xlsx)
 * เอกสารที่ออกจากระบบต้องหน้าตาเหมือนที่ใช้กันอยู่ ไม่งั้นต้องพิมพ์ใหม่ทั้งใบ */
const APPROVERS = ['Ekaluck', 'Chamaiphorn', 'CEO'];

/** จำนวนแถวว่างขั้นต่ำในตาราง — ให้เขียนเพิ่มด้วยมือได้เหมือนฟอร์มเดิม */
const MIN_TABLE_ROWS = 5;

/* ช่วงเวลาส่งของบนฟอร์มปุ๋ยของบริษัท (ชีต PurchaseRe-Athena-1)
 * เป็นช่องติ๊กว่าตกลงกันไว้กี่วัน ระบบไม่รู้ค่านี้ จึงเว้นให้คนกาเอง */
const NUTRIENT_LEAD_COLUMNS = ['1 วัน', '7 วัน', '15 วัน', '30 วัน'];

/**
 * ใบขอซื้อปุ๋ย — โครงตามชีต `PurchaseRe-Athena-1`
 *
 * ต่างจากใบวัสดุทั่วไปตรงที่มี **คอลัมน์ลำดับ** และ **ช่องเวลาส่งของให้ติ๊ก**
 * และหัวตารางเป็นภาษาไทย ตามที่ฝ่ายจัดซื้อใช้กับซัพพลายเออร์ปุ๋ยอยู่จริง
 *
 * สิ่งที่ **ไม่** ลอกมาจากชีตต้นฉบับ: คอลัมน์ที่ซ่อนไว้ (D กับ K กว้าง 0)
 * และตัวเลขที่ค้างอยู่ในเซลล์โดยไม่มีหัวคอลัมน์ — เป็นเศษจากการแก้ไฟล์ด้วยมือ
 * ลอกมาจะได้เอกสารที่มีเลขลอยโดยไม่มีใครอธิบายได้ว่าคืออะไร
 *
 * @returns {{rows:Array, merges:string[], rowHeights:object, columnWidths:number[]}}
 */
function buildNutrientForm({ items, docNo, dateText, requestedBy, totalAmount, missingPrice, note }) {
  const rows = [];
  const merges = [];
  const rowHeights = {};
  const blank = (style) => ({ v: '', s: style });
  const LEAD = NUTRIENT_LEAD_COLUMNS.length;
  // ลำดับ · รายการ · (ช่องเวลา) · จำนวน · ราคา/หน่วย · ราคารวม · หมายเหตุ
  const COLS = 4 + LEAD + 2;
  const pad = (cells) => [...cells, ...Array(Math.max(0, COLS - cells.length)).fill('')];
  const lastCol = String.fromCharCode(65 + COLS - 1);

  rows.push(pad([{ v: 'ใบขอซื้อ — ปุ๋ยและธาตุอาหาร', s: STYLE.TITLE }]));
  merges.push(`A1:${lastCol}1`);
  rowHeights[1] = 28;
  rows.push([]);

  rows.push(pad([
    { v: 'ชื่อ', s: STYLE.LABEL },
    { v: requestedBy ?? '', s: STYLE.FIELD },
    { v: 'วันที่', s: STYLE.LABEL_C },
    { v: dateText, s: STYLE.FIELD },
  ]));
  rows.push(pad([
    { v: 'Project', s: STYLE.LABEL },
    { v: 'Kambis — ปุ๋ย/ธาตุอาหาร', s: STYLE.FIELD },
    { v: 'เลขที่', s: STYLE.LABEL_C },
    { v: docNo, s: STYLE.FIELD },
  ]));
  rows.push([]);

  rows.push(
    ['ลำดับ', 'รายการ', ...NUTRIENT_LEAD_COLUMNS, 'จำนวน', 'ราคา/หน่วย', 'ราคารวม', 'หมายเหตุ'].map(
      (h) => ({ v: h, s: STYLE.TH })
    )
  );

  items.forEach((item, i) => {
    const unit = item.unit ? ` (${item.unit})` : '';
    rows.push([
      { v: i + 1, s: STYLE.TD_C },
      { v: item.item + unit, s: STYLE.TD },
      ...Array(LEAD).fill(blank(STYLE.TD_C)), // ช่องติ๊กเวลาส่งของ — คนกาเอง
      { v: item.qty, s: STYLE.TD_C },
      item.unitPrice === null ? blank(STYLE.TD_C) : { v: item.unitPrice, s: STYLE.TD_MONEY },
      item.amount === null ? blank(STYLE.TD_C) : { v: item.amount, s: STYLE.TD_MONEY },
      blank(STYLE.TD),
    ]);
  });
  for (let i = items.length; i < MIN_TABLE_ROWS; i++) {
    rows.push([blank(STYLE.TD_C), blank(STYLE.TD), ...Array(LEAD + 4).fill(blank(STYLE.TD_C))]);
  }

  const totalRow = rows.length + 1;
  const totalValueCol = String.fromCharCode(65 + COLS - 2);
  rows.push([
    { v: 'รวมราคาทั้งหมด (บาท)', s: STYLE.TOTAL_LABEL },
    ...Array(COLS - 3).fill(blank(STYLE.TOTAL_LABEL)),
    { v: totalAmount, s: STYLE.TOTAL_VALUE },
    blank(STYLE.TOTAL_LABEL),
  ]);
  merges.push(`A${totalRow}:${String.fromCharCode(65 + COLS - 3)}${totalRow}`);

  if (missingPrice > 0) {
    rows.push([]);
    const r = rows.length + 1;
    rows.push(pad([{ v: `* มี ${missingPrice} รายการที่ยังไม่มีราคาในชีต ยอดรวมจึงยังไม่ครบ`, s: STYLE.NOTE }]));
    merges.push(`A${r}:${lastCol}${r}`);
    rowHeights[r] = 30;
  }
  if (String(note ?? '').trim()) {
    rows.push([]);
    const r = rows.length + 1;
    rows.push(pad([{ v: `หมายเหตุ: ${String(note).slice(0, 300)}`, s: STYLE.NOTE }]));
    merges.push(`A${r}:${lastCol}${r}`);
  }

  rows.push([]);
  rows.push([]);
  const signBlock = (label, name) => {
    rows.push([]);
    const r = rows.length + 1;
    rows.push(pad([{ v: label, s: STYLE.LABEL_C }, '', blank(STYLE.SIGN_LINE)]));
    merges.push(`A${r}:B${r}`, `C${r}:${lastCol}${r}`);
    if (name) {
      const nr = rows.length + 1;
      rows.push(pad(['', '', { v: name, s: STYLE.SIGN_NAME }]));
      merges.push(`C${nr}:${lastCol}${nr}`);
    }
  };
  signBlock('ผู้ขอซื้อ:', null);
  for (const approver of APPROVERS) signBlock('ผู้อนุมัติ:', approver);

  return {
    rows,
    merges,
    rowHeights,
    // ลำดับแคบ · รายการกว้าง · ช่องเวลาแคบเท่ากัน · ตัวเลขพอใส่หลักหมื่น
    columnWidths: [6.5, 46, ...Array(LEAD).fill(7.5), 10, 13, 14, 20],
    totalValueCol,
  };
}

/**
 * ประกอบใบขอซื้อเป็น .xlsx แล้วเก็บสำเนาลงดิสก์
 *
 * @param {object} opts
 * @param {Array} opts.items ผลจาก validateItems()
 * @param {'general'|'nutrient'} [opts.form]
 * @param {string} [opts.requestedBy] ชื่อผู้ใช้ที่ล็อกอินอยู่
 * @param {string} [opts.note]
 * @param {Date} [opts.now]
 * @param {string} [opts.docNo] ระบุเลขที่เอง (ใช้ตอนออกหลายใบในคำขอเดียว)
 * @returns {Promise<{docNo:string, fileName:string, buffer:Buffer, savedTo:string|null, totalAmount:number, missingPrice:number, form:string}>}
 */
export async function createPurchaseRequest({
  items,
  form = 'general',
  requestedBy = null,
  note = '',
  now = new Date(),
  docNo: fixedDocNo = null,
}) {
  let docNo = fixedDocNo;
  if (!docNo) {
    const { stamp, base } = await docNumberBase(now, await readRequestIndex());
    docNo = formatDocNo(stamp, base + 1);
  }
  const dateText = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}/${now.getFullYear()}`;

  const totalAmount = items.reduce((t, i) => t + (i.amount ?? 0), 0);
  const missingPrice = items.filter((i) => i.unitPrice === null).length;

  if (form === 'nutrient') {
    const built = buildNutrientForm({
      items, docNo, dateText, requestedBy, totalAmount, missingPrice, note,
    });
    const buffer = buildXlsx({
      sheetName: docNo,
      rows: built.rows,
      columnWidths: built.columnWidths,
      merges: built.merges,
      rowHeights: built.rowHeights,
      modified: now,
    });
    const saved = await saveCopy(docNo, buffer);
    return { docNo, form, totalAmount, missingPrice, buffer, ...saved };
  }

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

  const saved = await saveCopy(docNo, buffer);
  return { docNo, form: 'general', totalAmount, missingPrice, buffer, ...saved };
}

/** เก็บสำเนาลงดิสก์ — ล้มเหลวได้ ผู้ใช้ยังต้องดาวน์โหลดไฟล์ได้อยู่ดี */
async function saveCopy(docNo, buffer) {
  const fileName = `${safeFileName(docNo)}.xlsx`;
  try {
    await mkdir(PR_DIR, { recursive: true });
    const savedTo = path.join(PR_DIR, fileName);
    await writeFile(savedTo, buffer);
    return { fileName, savedTo };
  } catch (err) {
    console.warn('[pr] เก็บสำเนาใบขอซื้อไม่สำเร็จ:', err.message);
    return { fileName, savedTo: null };
  }
}

/**
 * ออกใบขอซื้อจากรายการที่เลือก — **แยกเป็นหลายใบเองถ้าเลือกปนกลุ่มกัน**
 *
 * ปุ๋ยใช้แบบฟอร์มคนละแบบกับวัสดุทั่วไป เลือกปนกันมาจึงได้สองไฟล์
 * (PR-…-001 วัสดุ · PR-…-002 ปุ๋ย) แทนที่จะบังคับให้ผู้ใช้กดสองรอบ
 *
 * ทุกใบถูกจดลงทะเบียนพร้อมกันในการเขียนครั้งเดียว — ถ้าเขียนทะเบียนไม่สำเร็จ
 * ผู้ใช้ยังได้ไฟล์ แต่ระบบจะจำไม่ได้ว่าเคยขอ จึงต้องส่งสัญญาณกลับไปด้วย
 *
 * @returns {Promise<{documents:Array, indexed:boolean}>}
 */
export async function createPurchaseRequests({
  items,
  requestedBy = null,
  note = '',
  now = new Date(),
}) {
  const index = await readRequestIndex();
  const groups = splitByForm(items);
  const documents = [];

  // เลขฐานคิดครั้งเดียว แล้วไล่ +1 เอง — ดูเหตุผลที่ docNumberBase()
  const { stamp, base } = await docNumberBase(now, index);

  for (let i = 0; i < groups.length; i++) {
    const { form, items: subset } = groups[i];
    const docNo = formatDocNo(stamp, base + 1 + i);
    const doc = await createPurchaseRequest({ items: subset, form, requestedBy, note, now, docNo });
    documents.push({ ...doc, items: subset });
  }

  /* จดทะเบียนหลังออกครบทุกใบ — เขียนทีเดียวจบ ไม่ให้เกิดสภาพครึ่ง ๆ กลาง ๆ
   * เก็บ balance/minimum ณ ตอนขอไว้ด้วย เผื่ออยากรู้ทีหลังว่าตอนนั้นเหลือเท่าไร */
  let indexed = false;
  try {
    for (const doc of documents) {
      index.requests.push({
        docNo: doc.docNo,
        form: doc.form,
        createdAt: now.toISOString(),
        requestedBy: requestedBy ?? null,
        totalAmount: doc.totalAmount,
        items: doc.items.map((i) => ({
          item: i.item,
          qty: i.qty,
          unit: i.unit ?? null,
          unitPrice: i.unitPrice,
          balanceAtRequest: i.balance ?? null,
          minimumAtRequest: i.minimum ?? null,
        })),
      });
    }
    await writeRequestIndex(index);
    indexed = true;
  } catch (err) {
    // ไฟล์ออกไปแล้ว แต่ระบบจะจำไม่ได้ว่าเคยขอ — ต้องบอก ไม่ใช่เงียบ
    console.warn('[pr] บันทึกทะเบียนใบขอซื้อไม่สำเร็จ:', err.message);
  }

  return { documents, indexed };
}

export { PR_DIR, INDEX_FILE };
