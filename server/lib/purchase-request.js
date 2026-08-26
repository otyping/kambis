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

/** รูปแบบเลขที่เอกสาร — ใช้เป็นด่านแรกตอนรับค่าจาก URL */
export const DOC_NO_RE = /^PR-\d{8}-\d{3}$/;

/**
 * แปลงเลขที่เอกสาร → พาธของสำเนาที่เก็บไว้
 *
 * **ค่านี้มาจาก URL โดยตรง** จึงกันสามชั้น ไม่ใช่ชั้นเดียว:
 *   1. ต้องเข้ารูปแบบ PR-YYYYMMDD-NNN เป๊ะ ๆ (ตัด `..` และอักขระแปลกทิ้งตั้งแต่ต้นทาง)
 *   2. ยังต้องผ่าน safeFileName() ที่ตอนเขียนไฟล์ใช้อยู่ — ให้อ่านกับเขียนใช้กฎเดียวกัน
 *   3. ผลลัพธ์ต้องอยู่ใน PR_DIR จริง ๆ เผื่อสองข้อบนถูกแก้ในอนาคตจนหลุด
 *
 * @returns {{fileName:string, fullPath:string}|null} null = เลขที่ใช้ไม่ได้
 */
export function requestFilePath(docNo) {
  if (typeof docNo !== 'string' || !DOC_NO_RE.test(docNo)) return null;
  const fileName = `${safeFileName(docNo)}.xlsx`;
  if (fileName !== `${docNo}.xlsx`) return null;
  const fullPath = path.join(PR_DIR, fileName);
  if (path.dirname(fullPath) !== PR_DIR) return null;
  return { fileName, fullPath };
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

    /* เบราว์เซอร์ส่ง `packs` = จำนวน **หน่วยซื้อ** (ลัง/กล่อง/แพ็ค)
     * ส่วน `qty` แบบเดิมเป็นหน่วยสต๊อก ยังรับไว้ให้ client รุ่นเก่ายิงได้
     *
     * **ห้ามตีความ qty เป็นแพ็คเด็ดขาด** ใบขอซื้อของกระดาษทิชชู่จะเพี้ยนไป 24 เท่า
     * โดยไม่มีใครทันสังเกต เพราะเอกสารถูกส่งไปให้เซ็นแล้ว — ส่งมาทั้งคู่ = ปฏิเสธ */
    const hasPacks = raw?.packs !== undefined && raw?.packs !== null;
    const hasQty = raw?.qty !== undefined && raw?.qty !== null;
    if (hasPacks && hasQty) {
      errors.push(`รายการ "${name}" ส่งมาทั้ง packs และ qty — บอกไม่ได้ว่าเป็นหน่วยไหน`);
      continue;
    }

    /* ขนาดแพ็คเอาจากชีตเสมอ เหมือนราคา — ไม่งั้นแก้จากฝั่ง client แล้วสั่งของผิดจำนวนได้ */
    const packSize = source.purchasePackSize || 1;
    const packs = hasPacks ? Number(raw.packs) : Number(raw?.qty) / packSize;
    const qty = hasPacks ? Number(raw.packs) * packSize : Number(raw?.qty);

    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) {
      errors.push(`จำนวนของ "${name}" ต้องเป็นตัวเลขมากกว่า 0`);
      continue;
    }
    // ซื้อครึ่งลังไม่ได้ — จำนวนหน่วยซื้อที่ส่งมาต้องเป็นจำนวนเต็ม
    if (hasPacks && (!Number.isInteger(packs) || packs <= 0)) {
      errors.push(`จำนวนของ "${name}" ต้องเป็นจำนวนเต็มของหน่วยที่ซื้อ`);
      continue;
    }

    /* ราคาเอาจากชีตเสมอ ไม่เอาที่เบราว์เซอร์ส่งมา
     * ไม่งั้นใครก็แก้ราคาในใบขอซื้อได้จากฝั่ง client */
    const unitPrice = source.unitPrice ?? null;
    items.push({
      item: name,
      // หน่วยสต๊อก + จำนวนหน่วยสต๊อก — **ความหมายเดิม ห้ามเปลี่ยน**
      // ทะเบียนใบขอซื้อกับ attachPendingRequests() เทียบกับคอลัมน์ "รับ" ซึ่งเป็นหน่วยสต๊อก
      unit: source.unit ?? null,
      qty,
      unitPrice,
      // หน่วยที่ซื้อจริง — บรรทัดในเอกสารใช้ชุดนี้ (1 ลัง × 799 ไม่ใช่ 24 ห่อ × 33.29)
      packs,
      purchaseUnit: source.purchaseUnit ?? source.unit ?? null,
      purchasePackSize: packSize,
      purchaseUnitPrice: source.purchaseUnitPrice ?? null,
      packSizeSource: source.pack?.sizeSource ?? null,
      // คิดจากหน่วยสต๊อกเสมอ — สูตรเดียวกับที่หน้าจอใช้ กันสองฝั่งเพี้ยนจากกัน
      amount: unitPrice === null ? null : qty * unitPrice,
      balance: source.balance ?? null,
      minimum: source.minimum ?? null,
      /* group มาจาก parser (12 แท็บปุ๋ย = base/coco/co2/additive · ที่เหลือ = 'item')
       * ใช้แยกว่าจะออกด้วยแบบฟอร์มไหน — ห้ามให้เบราว์เซอร์ส่งมาเอง */
      group: NUTRIENT_GROUPS.has(source.group) ? source.group : 'item',
    });
  }

  return { items, errors };
}

/**
 * หมวดที่ออกด้วย **ฟอร์มปุ๋ย (Athena)** — คนละเรื่องกับหมวดที่ผู้ใช้เห็นบนหน้าจอ
 *
 * ผู้ใช้แยกปุ๋ยออกเป็น 4 หมวดเพื่อดูกราฟการเบิก (ส.ค. 69) แต่ **แบบฟอร์มยังมีสองใบเท่าเดิม**
 * ทั้งสี่หมวดนี้สั่งกับผู้ขายเจ้าเดียวกันบนใบเดียวกัน — แยกใบตามหมวดที่แสดงผล
 * จะกลายเป็นสั่งของเจ้าเดียวสี่ใบ ซึ่งไม่มีใครขอ
 *
 * เพิ่มหมวดปุ๋ยใหม่เมื่อไร **ต้องเติมที่นี่ด้วย** ไม่งั้นมันจะไปโผล่ในฟอร์มวัสดุทั่วไปเงียบ ๆ
 */
const NUTRIENT_GROUPS = new Set(['base', 'coco', 'co2', 'additive']);

/**
 * แยกรายการเป็นใบละแบบฟอร์ม
 *
 * บริษัทใช้ฟอร์มปุ๋ย (Athena/Coco/Co2) คนละแบบกับฟอร์มวัสดุทั่วไป
 * เลือกปนกันมาในครั้งเดียวจึงออกเป็นสองใบ ไม่ใช่บังคับให้ผู้ใช้กดสองรอบ
 * เรียงวัสดุก่อนเสมอเพื่อให้เลขที่เอกสารคาดเดาได้
 */
export function splitByForm(items) {
  const general = items.filter((i) => !NUTRIENT_GROUPS.has(i.group));
  const nutrient = items.filter((i) => NUTRIENT_GROUPS.has(i.group));
  const out = [];
  if (general.length) out.push({ form: 'general', items: general });
  if (nutrient.length) out.push({ form: 'nutrient', items: nutrient });
  return out;
}

/* ═══════════════════════════════════════════════════════════════
   แบบฟอร์มใบขอซื้อของบริษัท
   ═══════════════════════════════════════════════════════════════

   ถอดจากชีตจริงสองใบในไฟล์ `Purchase Request/Purchase Request Form-Ping.xlsx`:
   `PurchaseRe-Cosy` (วัสดุทั่วไป) กับ `PurchaseRe-Athena-1` (ปุ๋ย)

   **สองใบนี้เป็นโครงเดียวกัน** — ลำดับ · รายการ · ช่องเวลาส่งของ 4 ช่อง ·
   จำนวน · ราคา/หน่วย · ราคารวม · หมายเหตุ สิ่งที่ต่างคือช่อง Project
   กับจำนวนวันบนหัวช่องเวลา ซึ่งตกลงกันใหม่ทุกครั้งที่สั่ง
   จึงใช้ตัวสร้างตัวเดียวแล้วส่ง config ต่างกัน ไม่ต้องมีสองก้อนที่ต้องแก้คู่กัน

   สิ่งที่ **ไม่** ลอกมาจากชีตต้นฉบับ: คอลัมน์ที่ซ่อนไว้ (กว้าง 0) และตัวเลข
   ที่ค้างอยู่ในเซลล์โดยไม่มีหัวคอลัมน์ — เป็นเศษจากการแก้ไฟล์ด้วยมือ
   ลอกมาจะได้เอกสารที่มีเลขลอยโดยไม่มีใครอธิบายได้ว่าคืออะไร */

const FORMS = {
  // ชีต PurchaseRe-Cosy — ช่องเวลา 1/5/7/15 วัน
  general: { project: 'Farm — Supply Stock', leadColumns: ['1 วัน', '5 วัน', '7 วัน', '15 วัน'] },
  // ชีต PurchaseRe-Athena-1 — ปุ๋ยสั่งล่วงหน้านานกว่า ช่องเวลาจึงยาวกว่า
  nutrient: { project: 'ปุ๋ย/ธาตุอาหาร (Athena)', leadColumns: ['1 วัน', '7 วัน', '15 วัน', '30 วัน'] },
};

/* ชื่อผู้ขอซื้อและผู้อนุมัติ — ตามชีตตัวอย่าง PurchaseRe-Cosy
 * พิมพ์ไว้ให้เลยเพราะเอกสารมีไว้ปริ้นให้เซ็น ไม่ใช่กรอกในคอมพิวเตอร์ */
const SIGNERS = [
  { label: 'Requested by:', name: 'Chamaiphorn Chama-oot' },
  { label: 'Approved by:', name: 'Patira  Kambhu Na Ayudhaya' },
];

/* โลโก้บริษัทมุมซ้ายบน — อ่านครั้งเดียวแล้วใช้ซ้ำทุกใบ
 * อ่านไม่ได้ก็ยังต้องออกใบได้ แค่ไม่มีโลโก้ (ไฟล์หายไม่ใช่เหตุให้สั่งของไม่ได้) */
let logoCache;
async function readLogo() {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = await readFile(path.join(ROOT, 'public', 'assets', 'logo-kambis.png'));
  } catch (err) {
    console.warn('[pr] อ่านโลโก้ไม่สำเร็จ ออกใบโดยไม่มีโลโก้:', err.message);
    logoCache = null;
  }
  return logoCache;
}

/**
 * ประกอบแผ่นงานตามแบบฟอร์มบริษัท
 *
 * @returns {{rows:Array, merges:string[], rowHeights:object, columnWidths:number[]}}
 */
export function buildCompanyForm({ form, items, docNo, dateText, requestedBy, totalAmount, missingPrice, note }) {
  const cfg = FORMS[form] ?? FORMS.general;
  const LEAD = cfg.leadColumns.length;
  /* ลำดับ · รายการ · (ช่องเวลา) · จำนวน · ราคา/หน่วย · ราคารวม
   * ไม่มีคอลัมน์หมายเหตุตามที่ผู้ใช้สั่ง — ในชีตต้นฉบับก็ถูกซ่อนไว้ (กว้าง 0) อยู่แล้ว
   * และการตัดออกทำให้ตารางกว้างพอดี A4 แนวตั้งโดยไม่ต้องย่อ */
  const COLS = 3 + LEAD + 2;
  const col = (i) => String.fromCharCode(65 + i);
  const lastCol = col(COLS - 1);

  const rows = [];
  const merges = [];
  const rowHeights = {};
  const blank = (style) => ({ v: '', s: style });
  const pad = (cells) => [...cells, ...Array(Math.max(0, COLS - cells.length)).fill('')];

  /* แถว 1 เว้นไว้ให้โลโก้ที่มุมซ้ายบน — รูปเป็น oneCellAnchor ลอยทับเซลล์
   * จึงต้องกันความสูงไว้เอง ไม่งั้นโลโก้จะทับหัวเอกสาร
   * แถว 2 เป็นหัวเอกสาร (ชีตจริงเขียนเป็นอังกฤษทั้งสองใบ) */
  rows.push([]);
  rowHeights[1] = 46;
  rows.push(pad([{ v: 'Purchase Request Form', s: STYLE.TITLE }]));
  merges.push(`A2:${lastCol}2`);
  rowHeights[2] = 30;

  /* แถว 3 — ชื่อผู้ขอ / วันที่ · แถว 4 — Project / เลขที่เอกสาร
   *
   * ค่าทางขวาต้อง merge ให้กว้างพอเสมอ ไม่งั้นถูกคอลัมน์ถัดไปตัดหัวทิ้ง
   * (เคยได้ "2/08/2026" แทน "12/08/2026" และ "!0260812-003" แทนเลขที่เต็ม)
   * และเขียนป้ายรวมกับค่าไว้ในเซลล์เดียวแบบชีต Cosy จะไม่มีอะไรให้ตัดตั้งแต่แรก
   *
   * **ฝั่งซ้ายกับฝั่งขวาไม่ใช่ของชนิดเดียวกัน** ซ้าย (ชื่อ/Project) เป็นช่องที่คนเขียนต่อได้
   * จึงมีเส้นใต้ ส่วนขวา (วันที่/เลขที่) ระบบเติมค่าให้แล้ว ไม่มีอะไรให้กรอก —
   * ผู้ใช้จึงสั่งให้ตัดเส้นออกแล้วดันไปชิดขอบขวาของกระดาษ (STYLE.FIELD_R) */
  const half = 1 + Math.ceil((COLS - 1) / 2); // คอลัมน์ที่เริ่มบล็อกขวา
  const rightCol = col(half);
  const fieldRow = (label, value, rightLabel, rightValue) => {
    const r = rows.length + 1;
    const cells = Array(COLS).fill('');
    cells[0] = { v: label, s: STYLE.LABEL };
    for (let i = 1; i < half; i++) cells[i] = { v: i === 1 ? value : '', s: STYLE.FIELD };
    for (let i = half; i < COLS; i++) {
      cells[i] = { v: i === half ? `${rightLabel}  ${rightValue}` : '', s: STYLE.FIELD_R };
    }
    rows.push(cells);
    merges.push(`B${r}:${col(half - 1)}${r}`, `${rightCol}${r}:${lastCol}${r}`);
    rowHeights[r] = 22;
  };
  fieldRow('ชื่อ', requestedBy ?? '', 'วันที่', dateText);
  fieldRow('Project', cfg.project, 'เลขที่', docNo);
  rows.push([]);

  // แถว 6 — หัวตาราง
  rows.push(
    ['ลำดับ', 'รายการ', ...cfg.leadColumns, 'จำนวน', 'ราคา/หน่วย', 'ราคารวม'].map((h) => ({
      v: h,
      s: STYLE.TH,
    }))
  );

  /* บรรทัดในเอกสารเขียนเป็น **หน่วยที่ซื้อจริง** ไม่ใช่หน่วยที่ใช้นับสต๊อก
   *
   * กระดาษทิชชู่นับคงเหลือเป็น "ห่อ" แต่ผู้ขายขายเป็น "ลัง" เท่านั้น (1 ลัง = 24 ห่อ)
   * ใบขอซื้อจึงต้องเขียน `1 ลัง × 799` ไม่ใช่ `24 ห่อ × 33.29` — คนที่ถือใบนี้ไปสั่งของ
   * ต้องอ่านแล้วสั่งได้เลยโดยไม่ต้องแปลงหน่วยเอง และ 799 คือเลขที่เขียนอยู่ในชีตจริง ๆ
   *
   * ยอดรวมยังคิดจากหน่วยสต๊อก (qty × unitPrice) ซึ่งเท่ากับ packs × ราคาต่อหน่วยซื้อ
   * โดยนิยาม — คิดทางเดียวกันทั้งระบบ จะได้ไม่มีทางเพี้ยนจากหน้าจอ */
  items.forEach((item, i) => {
    const unit = item.purchaseUnit ? ` (${item.purchaseUnit})` : '';
    rows.push([
      { v: i + 1, s: STYLE.TD_C },
      { v: item.item + unit, s: STYLE.TD },
      // ช่องติ๊กเวลาส่งของ — ระบบไม่รู้ว่าตกลงกันกี่วัน ต้องให้คนกาเอง
      ...Array(LEAD).fill(blank(STYLE.TD_C)),
      { v: item.packs, s: STYLE.TD_C },
      // ไม่มีราคาในชีตให้เว้นว่าง ห้ามใส่ 0 เพราะยอดรวมจะดูเหมือนถูกต้องทั้งที่ขาด
      item.purchaseUnitPrice === null
        ? blank(STYLE.TD_C)
        : { v: item.purchaseUnitPrice, s: STYLE.TD_MONEY },
      item.amount === null ? blank(STYLE.TD_C) : { v: item.amount, s: STYLE.TD_MONEY },
    ]);
  });
  /* ไม่มีแถวว่างเผื่อไว้ตามที่ผู้ใช้สั่ง — ตารางจบตรงรายการสุดท้าย
   * ถ้าต้องเพิ่มรายการ ผู้ใช้แทรกแถวเองใน Excel ซึ่งได้เส้นขอบตามแถวข้างบนอยู่แล้ว
   * (แถวว่างที่เว้นไว้ล่วงหน้าทำให้เอกสารที่มีของ 2 รายการดูเหมือนกรอกไม่ครบ) */

  // แถวรวม — ป้ายกินตั้งแต่ A ถึงก่อนช่องราคารวม ตามชีตจริง (A16:H16)
  const totalRow = rows.length + 1;
  rows.push([
    { v: 'รวมราคาทั้งหมด', s: STYLE.TOTAL_LABEL },
    ...Array(COLS - 2).fill(blank(STYLE.TOTAL_LABEL)),
    { v: totalAmount, s: STYLE.TOTAL_VALUE },
  ]);
  merges.push(`A${totalRow}:${col(COLS - 2)}${totalRow}`);

  // รายการที่ยังไม่มีราคา — ต้องเห็นก่อนอนุมัติ ไม่ใช่ให้เซ็นไปแล้วค่อยรู้
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

  /* ── ช่องเซ็น: Requested by / Approved by อย่างละบล็อก ──
   * ตามชีต PurchaseRe-Cosy ซึ่งมีสองชั้น ไม่ใช่สามชั้นแบบฟอร์มเก่าของระบบ
   * เว้นบรรทัดว่างเหนือชื่อไว้ให้เซ็น แล้วพิมพ์ชื่อกำกับใต้เส้น */
  rows.push([]);
  /* ── ช่องเซ็น ──
   *
   * สามบรรทัดต่อคน: ป้าย+เส้นเซ็น · ชื่อใต้เส้น · แล้วค่อยช่องวันที่ที่มีเส้นของตัวเอง
   * ถ้าเอาชื่อไปไว้บรรทัดเดียวกับ "Date:" จะอ่านเหมือนชื่อเป็นค่าของช่องวันที่
   *
   * **ทุกเซลล์ในช่วงที่ merge ต้องมีสไตล์เส้นเอง** Excel วาดขอบจากเซลล์แต่ละช่อง
   * ไม่ได้ยืดขอบของเซลล์ซ้ายบนให้ ใส่แค่ช่องแรกจะได้ขีดสั้น ๆ แทนเส้นยาว */
  /* บล็อกเซ็นอยู่ **ชิดขวา** ของหน้า ตามที่ผู้ใช้สั่ง
   * ป้ายชิดขวาไปติดกับเส้น เพื่อให้อ่านเป็นคู่กันแทนที่จะลอยอยู่คนละฝั่งของกระดาษ */
  const LABEL_FROM = 2; // ป้ายเริ่มที่คอลัมน์ C
  const SIGN_FROM = COLS - 3; // เส้นกินสามคอลัมน์ขวาสุด (G–I)
  const SIGN_TO = COLS - 1;
  const spanRow = (label, value, style) => {
    const r = rows.length + 1;
    const cells = Array(COLS).fill('');
    for (let i = LABEL_FROM; i < SIGN_FROM; i++) {
      cells[i] = { v: i === LABEL_FROM ? label : '', s: STYLE.LABEL_R };
    }
    for (let i = SIGN_FROM; i <= SIGN_TO; i++) {
      cells[i] = { v: i === SIGN_FROM ? value : '', s: style };
    }
    rows.push(cells);
    merges.push(
      `${col(LABEL_FROM)}${r}:${col(SIGN_FROM - 1)}${r}`,
      `${col(SIGN_FROM)}${r}:${col(SIGN_TO)}${r}`
    );
    return r;
  };

  for (const signer of SIGNERS) {
    rows.push([]);
    rowHeights[spanRow(signer.label, '', STYLE.SIGN_LINE)] = 30;
    spanRow('', signer.name, STYLE.SIGN_NAME);
    rowHeights[spanRow('Date:', '', STYLE.SIGN_LINE)] = 26;
  }

  return {
    rows,
    merges,
    rowHeights,
    /* รวมกันต้องไม่เกินความกว้างที่ A4 แนวตั้งรับได้ (~92 หน่วย Excel ที่ขอบ 1 ซม.)
     * 6 + 40 + 4×7 + 9 + 12 + 14 = 109 → ยังเกิน จึงเปิด fitToPage ให้ย่อลงพอดี
     * ที่ไม่บีบคอลัมน์รายการให้แคบกว่านี้เพราะชื่อวัสดุยาว ถ้าตัดคำจะอ่านไม่รู้เรื่อง */
    columnWidths: [10, 38, ...Array(LEAD).fill(7), 9, 12, 14],
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

  const built = buildCompanyForm({
    form, items, docNo, dateText, requestedBy, totalAmount, missingPrice, note,
  });
  const logo = await readLogo();
  const buffer = buildXlsx({
    sheetName: docNo,
    rows: built.rows,
    columnWidths: built.columnWidths,
    merges: built.merges,
    rowHeights: built.rowHeights,
    modified: now,
    /* เอกสารนี้มีไว้ปริ้นให้ผู้บริหารเซ็น ต้องพอดี A4 แผ่นเดียว
     * fitToPage ย่อให้ลงเองถ้ารายการเยอะ ดีกว่าปล่อยล้นไปหน้าสองแบบไม่มีใครรู้ */
    page: { fitToPage: true, orientation: 'portrait', margins: { left: 0.4, right: 0.3, top: 0.4, bottom: 0.4 } },
    image: logo
      ? { data: logo, name: 'Kambis', col: 0, row: 0, width: 58, height: 58, offsetX: 38100, offsetY: 19050 }
      : null,
  });

  const saved = await saveCopy(docNo, buffer);
  return { docNo, form, totalAmount, missingPrice, buffer, ...saved };
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
          /* `qty`/`unit` เป็น **หน่วยสต๊อก** เหมือนเดิมเสมอ ห้ามเปลี่ยนความหมาย
           * `attachPendingRequests()` เอาไปเทียบกับคอลัมน์ "รับ" ของ log เพื่อปิดสถานะ
           * "รอของ" ให้เอง ถ้าเปลี่ยนเป็นหน่วยซื้อเมื่อไร ใบขอซื้อจะค้างเป็น "รอของ" ตลอดไป
           * ส่วนหน่วยซื้อเก็บเพิ่มต่างหาก — ใบเก่าที่ไม่มีฟิลด์นี้ต้องยังอ่านได้ */
          qty: i.qty,
          unit: i.unit ?? null,
          unitPrice: i.unitPrice,
          packs: i.packs ?? null,
          purchaseUnit: i.purchaseUnit ?? null,
          purchaseUnitPrice: i.purchaseUnitPrice ?? null,
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
