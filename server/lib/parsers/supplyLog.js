/**
 * parsers/supplyLog.js — รายงาน Log Stock บันทึกประจำวัน (วัสดุสิ้นเปลือง)
 *
 * ชีตนี้ไม่เกี่ยวกับดอกไม้เลย จึงติด kind:'supply' ไว้ที่ config
 * แล้ว analysis.js จะข้ามกฎที่เป็นเรื่องน้ำหนักดอก/ขนาด/สายพันธุ์ทั้งหมด
 *
 * โครงของชีต — 139 แท็บ แบ่งเป็นสองแบบ
 *
 * 1) แท็บ "สั่งของรายเดือน" = ตารางจัดซื้อ (แท็บเดียว)
 *      0 ลำดับ · 1 ชื่อรายการ · 2 หน่วย · 3 คงเหลือ ณ ปัจจุบัน · 4 จำนวนสั่งซื้อ
 *      5 ราคา/@ · 6 รวมจำนวนเงิน · 7 สั่งซื้อวันที่ (วันของเดือน) · 8 สั่งซื้อล่าสุด · 9 ระยะเวลาใช้งาน
 *    **เป็นข้อมูลราคาชุดเดียวที่มีในทั้งระบบ** จึงต้องอ่าน ห้าม skip
 *
 * 2) แท็บรายการ (127 อันมีเลขนำหน้า + 12 อันเป็นปุ๋ย/สารเคมี) = log รายวัน
 *      [0] วันที่ · [1] จำนวนรับของ/ซื้อเพิ่ม · [2] จำนวนเบิก · [3] จำนวนคงเหลือ
 *      [4] หน่วย · [5] ขั้นต่ำ · [6] Index (= คงเหลือ − ขั้นต่ำ)
 *
 * สามเรื่องที่ทำให้อ่านแบบตรงไปตรงมาไม่ได้:
 *
 *   ก. **หัวตาราง merge และขึ้นบรรทัดใหม่ในเซลล์** ข้อความหัวคอลัมน์จึงกระจายข้ามแถว 0–2
 *      และบางแท็บมีหัวตาราง 3 แถว → หาคอลัมน์ด้วย "ตำแหน่ง + ตรวจด้วยเลขคณิต"
 *      ห้าม match ข้อความหัวคอลัมน์
 *
 *   ข. **วันที่เป็น พ.ศ.** (01/07/2569) — parseSheetDate() แปลงให้อยู่แล้ว (normalize.js)
 *      ห้ามเขียนตัวแปลงวันที่ตัวที่สอง
 *
 *   ค. **มีแถวลงวันที่ล่วงหน้า** ที่ยอดคงเหลือถูก carry forward ไว้แล้ว
 *      → "ยอดปัจจุบัน" ต้องอ่านจากแถวล่าสุดที่วันที่ ≤ วันนี้ ไม่ใช่แถวสุดท้ายของแท็บ
 *      และ `ขั้นต่ำ` ก็เปลี่ยนได้ระหว่างทาง (เจอจริง: COCO 85→38, Cuts 11→5)
 *      จึงต้องอ่านจากแถวเดียวกันนั้น ไม่ใช่แถวแรก
 *      แถวอนาคตยังเก็บไว้เป็น record ตามเดิม (ทิ้ง = ซ่อมข้อมูลเงียบ ๆ ซึ่งห้ามทำ)
 */
import { isEmptyRow } from '../csv.js';
import { num, makeRecord, parseSheetDate } from '../normalize.js';

/**
 * แท็บปุ๋ย/สารเคมีที่ไม่มีเลขนำหน้าชื่อ → **หมวดของมัน** (ใช้โครงเดียวกับแท็บรายการทุกอย่าง)
 *
 * เดิมทั้ง 12 แท็บนี้เป็นหมวดเดียวกันหมด (`nutrient`) ซึ่งตอบได้แค่ "ปุ๋ยหรือไม่ใช่ปุ๋ย"
 * ผู้ใช้สั่งแยกเป็น 4 หมวด (ส.ค. 69) เพราะของสี่กลุ่มนี้ซื้อคนละจังหวะและคนละเหตุผล:
 * ปุ๋ยหลักใช้ทุกรอบปลูก · COCO เป็นวัสดุปลูกที่เปลี่ยนทั้งล็อต · CO2 เป็นถัง ·
 * สารเสริมใช้เป็นครั้ง ๆ ตามอาการของต้น กองรวมกันแล้วดูกราฟการเบิกไม่ออกว่าเงินไปทางไหน
 *
 * **หมวดกับแบบฟอร์มใบขอซื้อเป็นคนละเรื่องกัน** ทั้ง 4 หมวดนี้ยังออกด้วยฟอร์มปุ๋ย
 * (Athena) ใบเดียวกันเหมือนเดิม — ดู `NUTRIENT_GROUPS` ใน purchase-request.js
 */
const NUTRIENT_TAB_GROUP = new Map(
  [
    // ปุ๋ยหลัก — สูตรน้ำสองส่วน แท็บจริงคือ Bloom A/B · Grow A/B
    ['Bloom', 'base'],
    ['Grow', 'base'],
    // ชื่อเดิมของ Bloom B / Grow B ก่อนผู้ใช้เปลี่ยนมาใช้ปุ๋ยน้ำ — เก็บไว้กันชีตย้อนกลับ
    ['Core', 'base'],
    ['Cleanse', 'base'],
    ['COCO', 'coco'],
    ['CO2', 'co2'],
    // สารเสริม — ใช้เป็นครั้ง ๆ ไม่ใช่ทุกรอบปลูก
    ['Fade', 'additive'],
    ['Cuts', 'additive'],
    ['pH Up', 'additive'],
    ['CaMg', 'additive'],
    ['IPM', 'additive'],
    ['อะบา', 'additive'],
  ].map(([name, group]) => [name.toLowerCase(), group])
);

/* ปุ๋ยตัวเดียวกันถูกแยกเป็นหลายแท็บตามสูตร A/B — `Bloom` กลายเป็น `Bloom A` + `Bloom B`
 *
 * **เคสจริง ส.ค. 69** ผู้ใช้เปลี่ยนจากปุ๋ยผงมาเป็นปุ๋ยน้ำสองส่วน แท็บ `Core` ถูกเปลี่ยนชื่อ
 * เป็น `Bloom B` และ `Cleanse` เป็น `Grow B` (gid เดิม) ส่วน `Bloom A/B` เดิมกลายเป็น `Bloom A`
 *
 * ชื่อพวกนี้ไม่ตรงกับลิสต์แบบเป๊ะ ๆ และไม่มีเลขนำหน้า จึงตกไปเป็น `unknown-tab`
 * ถูกข้ามทั้งแท็บ — ทั้ง 4 รายการหายจากมูลค่าสต๊อกและจากตารางของที่ต้องสั่งซื้อ
 * ทั้งที่ทุกอันต่ำกว่าขั้นต่ำอยู่ (Index −11 · −6 · −6 · −1)
 *
 * ที่จริง `Bloom A/B` กับ `Grow A/B` **ถูกข้ามมาตั้งแต่ก่อนหน้านี้แล้ว** ไม่ใช่เพิ่งพัง
 * รอบนี้แค่หนักขึ้นเพราะ Core/Cleanse ที่เคยอ่านได้ ถูกเอาไปตั้งเป็น Bloom B/Grow B
 *
 * ตัดหางที่เป็น **ตัวอักษรเดี่ยว** ออกก่อนเทียบ (`bloom a` · `bloom a/b` → `bloom`)
 * ต้องมีช่องว่างคั่นเสมอ ไม่งั้น `coco` จะโดนตัด `o` ท้ายกลายเป็น `coc` แล้วหลุดลิสต์
 * และ `pH Up` ปลอดภัยเพราะ `up` มีสองตัวอักษร */
const NUTRIENT_SUFFIX_RE = /\s+[a-z](\s*\/\s*[a-z])*$/i;

/** หมวดของแท็บปุ๋ย/สารเคมี — คืน null ถ้าไม่ใช่แท็บในกลุ่มนี้ */
function nutrientTabGroup(name) {
  const full = String(name ?? '').trim().toLowerCase();
  if (!full) return null;
  const hit = NUTRIENT_TAB_GROUP.get(full);
  if (hit) return hit;
  return NUTRIENT_TAB_GROUP.get(full.replace(NUTRIENT_SUFFIX_RE, '').trim()) ?? null;
}

const ORDER_TAB_RE = /สั่งของรายเดือน/;
const NUMBERED_TAB_RE = /^\s*(\d+)\s*\./;
const TEMPLATE_TAB_RE = /^(ต้นฉบับ|สำเนาของ|สำเนา|copy of)/i;

/** เซลล์ที่เป็นวันที่ล้วน ๆ — ใช้ probe หาจุดเริ่มข้อมูล (รับทั้ง พ.ศ. และ ค.ศ.) */
const DATE_CELL_RE = /^\s*\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}\s*$/;

/**
 * ระยะเวลารอของ (lead time) ที่คนเขียนแทรกไว้ในหัวตาราง
 *
 * หัวตารางเป็นเซลล์ merge หลายบรรทัด บรรทัดที่สามมักเขียนกำกับไว้ว่ารอของกี่วัน
 * ที่เจอจริงในชีตเขียนกัน 3 แบบ ต่างแค่ขีดกับตัวพิมพ์ใหญ่เล็ก:
 *   "Lead time 7 days"  ·  "Lead Time - 5 Days"  ·  "lead time 14 days"
 * เผื่อ "วัน" ไว้ด้วยเพราะแท็บใหม่อาจเขียนเป็นไทย
 *
 * 65 จาก 138 แท็บมีค่านี้ ที่เหลือคืน null — **ห้ามเดาค่าเริ่มต้นให้**
 * เพราะเลขที่เดามาจะถูกเอาไปคิดว่าต้องสั่งของล่วงหน้ากี่วัน แล้วผิดแบบเงียบ ๆ
 */
const LEAD_TIME_RE = /lead\s*-?\s*time\s*[-–—:]?\s*(\d+(?:\.\d+)?)\s*(?:days?|วัน)/i;

export function parseLeadTimeDays(text) {
  const m = LEAD_TIME_RE.exec(String(text ?? ''));
  if (!m) return null;
  const days = Number(m[1]);
  return Number.isFinite(days) && days > 0 ? days : null;
}

/* ═══════════════════════════════════════════════════════════════
   หมายเหตุของรายการ — เซลล์ merge A–G เหนือหัวตาราง
   ═══════════════════════════════════════════════════════════════

   เป็นแหล่งของทั้ง Lead Time และ "ขนาดแพ็ค" จึงต้องหาให้เจอทุกครั้ง
   หน้าตาที่เจอจริง (แท็บกระดาษทิชชู่):

       แถว 0   แบบฟอร์มเบิกของและของคงเหลือ (33)   │  ราคา/ลัง
       แถว 1                                       │  799
       แถว 2   กระดาษทิชชู่เช็ดมือ (250แผ่น/24ห่อ/ลัง): ใช้ 1ลัง/เดือน สั่งครั้งละ 1 ลัง Lead time 7 days
       แถว 3   วัน/เดือน/ปี │ จำนวนรับของ │ …

   **เคยพังมาแล้ว:** โค้ดเดิมอ่าน `rows[0][0]` ตรง ๆ ซึ่งใช้ได้สมัยดึงด้วย `gviz`
   เพราะ gviz กินแถวหัวทิ้ง 2 แถวพอดี แถวแรกที่เหลือจึงบังเอิญเป็นหมายเหตุ
   พอเปลี่ยนมาใช้ `/export?format=csv` ที่คืนกริดดิบ (ดู §1 ของ CLAUDE.md)
   `rows[0][0]` กลายเป็นหัวกระดาษ → `leadTimeDays` เป็น null ทั้ง 136 รายการ
   ทั้งที่ 125 แท็บมีเขียนไว้ คอลัมน์ Lead Time ว่างทั้งตาราง สถานะ "รอของเลยกำหนด"
   ตายเงียบ และ **fixture ของ test ทุกตัวใส่หมายเหตุไว้แถว 0 จึงไม่มีอะไรจับได้**

   จึงต้องหาจากเนื้อหา ไม่ใช่ตำแหน่งตายตัว */

/** หัวกระดาษที่ซ้ำกันทุกแท็บ — ไม่ใช่หมายเหตุของรายการ */
/* ป้ายหัวเอกสารที่ 137 จาก 139 แท็บเขียนเหมือนกันเป๊ะ — ไม่ใช่โน้ตของรายการ
 * **ต้อง anchor ด้วย `$`** เพราะบางแท็บเขียนต่อท้ายป้ายนี้ว่าเป็นของอะไร
 * แล้วบรรทัดนั้นกลายเป็นโน้ตจริง (`…และของคงเหลือ Rockwool Lead Time - 5 Days`)
 * ถ้าตัดแบบ `/^แบบฟอร์ม/` จะทิ้งโน้ตของแท็บพวกนั้นไปด้วย */
const BOILERPLATE_RE = /^แบบฟอร์มเบิกของและของคงเหลือ\s*(?:\(\s*\d+\s*\))?$/;

/** สั้นกว่านี้ไม่ใช่ประโยคบรรยาย เป็นเศษข้อความหรือหัวคอลัมน์ */
const NOTE_MIN_LEN = 20;

/** ลายเซ็นว่าเซลล์นี้เป็นข้อความบรรยายจริง ไม่ใช่ป้ายหัวคอลัมน์ */
const NOTE_SIGNATURE_RE = /lead\s*-?\s*time|สั่งครั้ง|ใช้\s*\d|\/\s*(?:crop|เดือน|ปี)/i;

/**
 * หาหมายเหตุของรายการจากคอลัมน์ A ของแถวเหนือหัวตาราง
 *
 * @param {Array<Array>} rows แถวดิบทั้งแท็บ
 * @param {number} dataStart แถวแรกที่เป็นข้อมูลจริง (ขอบล่างของการค้น)
 * @returns {string|null} ไม่เจอ = null **ห้ามตกไปใช้ `rows[0][0]`** เพราะจะได้หัวกระดาษ
 */
export function readItemNote(rows, dataStart = 0) {
  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const usable = (t) =>
    t.length >= NOTE_MIN_LEN && !BOILERPLATE_RE.test(t) && !DATE_CELL_RE.test(t) && num(t) === null;

  /* ไล่จากแถวที่ "ติดหัวตารางที่สุด" ขึ้นไป แล้วเอาอันแรกที่ใช้ได้
   * เริ่มที่ dataStart-2 เพื่อ **ข้ามแถวหัวตาราง** (dataStart-1) ซึ่งขึ้นต้นด้วย
   * `วัน/เดือน/ปี` และไม่ใช่โน้ต */
  for (let r = dataStart - 2; r >= 0; r--) {
    const text = clean(rows[r]?.[0]);
    if (usable(text)) return text;
  }

  /* ทางสำรองสำหรับแท็บที่หัวตารางเหลือแถวเดียว — ยอมอ่านจากแถวหัวตารางได้
   * **เฉพาะเมื่อมีลายเซ็นของข้อความบรรยาย** ป้าย `วัน/เดือน/ปี` ไม่มีทางเข้าเงื่อนไขนี้ */
  const head = clean(rows[dataStart - 1]?.[0]);
  return usable(head) && NOTE_SIGNATURE_RE.test(head) ? head : null;
}

const ORDER_COL = {
  seq: 0,
  item: 1,
  unit: 2,
  balance: 3,
  orderQty: 4,
  unitPrice: 5,
  amount: 6,
  orderDay: 7,
  lastOrdered: 8,
  lifetime: 9,
};

/* ═══════════════════════════════════════════════════════════════
   ราคา/หน่วย อยู่ในหัวตารางของแท็บรายการ (คอลัมน์ถัดจาก Index = H)
   ═══════════════════════════════════════════════════════════════

   ผู้ใช้ย้ายราคามาไว้ที่นี่ และเลิกใช้ช่องราคาในแท็บ "สั่งของรายเดือน" แล้ว
   หน้าตาที่เจอจริงคือ ป้ายอยู่แถวบนสุด ตัวเลขอยู่แถวถัดมา:

       H1  "ราคา/ถุง"
       H2  4250

   **สามกับดักที่ต้องกันตั้งแต่แรก**

   ก. คอลัมน์ H ถูกใช้จดโน้ตในเนื้อ log ด้วย (เจอจริง: "3/2" · "1/3" · "3/1 3/3")
      ถ้าไล่หาตัวเลขทั้งคอลัมน์จะได้โน้ตมาเป็นราคา → **อ่านเฉพาะไม่กี่แถวใต้ป้าย**
      ไม่ใช่ทั้งคอลัมน์ (โน้ตที่เจอจริงอยู่แถว 38–42 ห่างจากป้ายมาก)

      ผูกหน้าต่างค้นหาไว้กับ *แถวของป้าย* ไม่ใช่กับจุดเริ่มข้อมูล เพราะหัวตารางของ
      ชีตนี้ยาวไม่เท่ากัน — 108 แท็บมีหัวแถวเดียว · 2 แท็บมีสองแถว · 29 แท็บมีสามแถว
      ถ้าใช้ "ก่อนแถวข้อมูลแรก" เป็นขอบ แท็บหัวแถวเดียวที่เพิ่งเติมราคาจะอ่านไม่เจอเลย

   ข. บางแท็บมีป้าย "ราคา/…" แต่ยังไม่ได้กรอกตัวเลข → ต้องเป็น null
      **ห้ามเดา ห้ามคิดเป็น 0** ไม่งั้นมูลค่าสต๊อกจะต่ำกว่าจริงโดยไม่มีอะไรบอก

   ค. ป้ายบางอันบอกราคาของ "หลายหน่วย" (`ราคา/ 5 แพ็ค=5 กิโล` = 420)
      ทั้งที่คอลัมน์หน่วยเขียนว่า `แพ็ค` — เอา 420 ไปคูณจำนวนแพ็คจะเกินจริง 5 เท่า
      หารเองก็เป็นการเดาความหมายจากข้อความไทยที่คนเขียนอิสระ
      → คืน null พร้อมติดธงไว้ให้ออก finding ให้คนไปแก้ที่ชีต (ดู §7 ข้อ 15) */

/** ป้ายหัวคอลัมน์ราคา — ต้องมีคำว่า "ราคา" ถึงจะยอมอ่านตัวเลขใต้มัน */
const PRICE_LABEL_RE = /ราคา/;

/** ตัวคั่นหน่วยในป้าย: "ราคา/ถุง" → "ถุง" · "ราคา/ 5 แพ็ค=5 กิโล" → "5 แพ็ค=5 กิโล" */
const PRICE_UNIT_RE = /ราคา\s*[/:]\s*(.+)$/;

/** ป้ายที่ขึ้นต้นด้วยจำนวน = ราคาของหลายหน่วย ไม่ใช่ราคาต่อหน่วย */
const PRICE_QTY_RE = /^\s*(\d+(?:\.\d+)?)\s*\S/;

/** ป้ายอยู่ในหัวตาราง ซึ่งยาวได้ถึง 3 แถว — ค้นตัวเลขไม่เกินเท่านี้ใต้ป้าย */
const PRICE_SCAN_ROWS = 3;

/**
 * อ่านราคา/หน่วยจากหัวตารางของแท็บรายการ
 *
 * @param {Array<Array>} rows แถวดิบทั้งแท็บ
 * @param {number} priceCol คอลัมน์ราคา (ถัดจาก Index — คิดจากตำแหน่ง ไม่ใช่ชื่อหัว)
 * @param {number} headerEnd แถวแรกที่เป็นข้อมูลจริง (ใช้เป็นขอบล่างเมื่อหัวตารางยาวกว่าปกติ)
 * @returns {{price:number|null, priceLabel:string|null, priceUnit:string|null, priceQty:number|null}}
 *   `price` = ตัวเลขดิบตามที่ชีตเขียน **ยังไม่ได้หารเป็นราคาต่อหน่วยสต๊อก**
 *   ผู้เรียกต้องหารด้วย pricePack.size เอง (ดู parsePackSize)
 */
export function readUnitPrice(rows, priceCol, headerEnd = 0) {
  const empty = { price: null, priceLabel: null, priceUnit: null, priceQty: null };
  if (!Number.isInteger(priceCol) || priceCol < 0) return empty;

  // ป้ายอยู่ในบล็อกหัวตาราง — เผื่อไว้ถึงแถวที่ 3 เสมอ เพราะแท็บหัวแถวเดียวก็มีป้ายได้
  const labelLimit = Math.max(headerEnd, PRICE_SCAN_ROWS);
  let priceLabel = null;
  let labelRow = -1;
  for (let r = 0; r < labelLimit; r++) {
    const text = String(rows[r]?.[priceCol] ?? '').replace(/\s+/g, ' ').trim();
    if (text && PRICE_LABEL_RE.test(text)) {
      priceLabel = text;
      labelRow = r;
      break;
    }
  }
  // ไม่มีป้ายกำกับ = ยังไม่ได้ใส่ราคาไว้ที่นี่ ตัวเลขที่บังเอิญอยู่ตรงนั้นห้ามเอามาใช้
  if (!priceLabel) return empty;

  const unitText = PRICE_UNIT_RE.exec(priceLabel)?.[1]?.trim() ?? null;
  const qtyHit = unitText ? PRICE_QTY_RE.exec(unitText) : null;
  const priceQty = qtyHit ? Number(qtyHit[1]) : null;

  /* ค้นเฉพาะไม่กี่แถวใต้ป้าย — โน้ตในเนื้อ log อยู่ห่างลงไปมาก (แถว 38–42 ที่เจอจริง)
   * และรูปแบบโน้ตอย่าง "3/2" ก็ผ่าน num() ไม่ได้อยู่แล้ว จึงกันได้สองชั้น */
  const valueLimit = Math.min(rows.length, Math.max(headerEnd, labelRow + PRICE_SCAN_ROWS + 1));
  let value = null;
  for (let r = labelRow; r < valueLimit; r++) {
    const v = num(rows[r]?.[priceCol]);
    if (v !== null && v > 0) {
      value = v;
      break;
    }
  }

  return {
    /* คืนตัวเลขดิบเสมอ แม้ป้ายจะบอกราคาของหลายหน่วย (`ราคา/5 ถุง`)
     * เดิมทิ้งราคาไปเลยเมื่อเจอแบบนี้ ซึ่งเสียข้อมูลทั้งที่อ่านออก — ตอนนี้ priceQty
     * กลายเป็นตัวคูณของแพ็ค ผู้เรียกหารเองได้เลย ไม่ต้องทิ้ง */
    price: value,
    priceLabel,
    priceUnit: unitText,
    priceQty: priceQty !== null && priceQty > 1 ? priceQty : null,
  };
}

/* ═══════════════════════════════════════════════════════════════
   สามหน่วยต่อหนึ่งรายการ — ห้ามคิดว่าเป็นหน่วยเดียวกัน
   ═══════════════════════════════════════════════════════════════

   ชีตนี้เก็บหน่วยไว้สามที่ และคนกรอกไม่ได้ทำให้ตรงกัน:

     หน่วยสต๊อก   คอลัมน์ `หน่วย` ในตาราง   นับคงเหลือ/ขั้นต่ำ/เบิก   ห่อ
     หน่วยราคา    ป้าย `ราคา/<X>` ที่ H1     ตัวเลขที่ H2 เป็นของหน่วยนี้  ลัง (799)
     หน่วยซื้อ    หมายเหตุ `สั่งครั้งละ N <X>`  หน่วยที่สั่งกับผู้ขายจริง   ลัง

   **เคสจริงที่ผู้ใช้จับได้ ส.ค. 69** — กระดาษทิชชู่เช็ดมือ ป้ายเขียน `ราคา/ลัง` = 799
   แต่คอลัมน์หน่วยนับเป็น `ห่อ` เอา 39 ห่อ × 799 = 31,161 บาท ซึ่งเกินจริง **24 เท่า**
   (ความจริง 39 × 799÷24 = 1,298) หมายเหตุบอกตัวคูณไว้แล้วว่า `(250แผ่น/24ห่อ/ลัง)`

   **กับดักที่ต้องกัน: แปลงซ้ำสองรอบ** — ใบมีดผ่าตัดเขียน `ราคา/ใบ` = 7.5 ซึ่งตรงกับ
   หน่วยสต๊อก `ใบ` อยู่แล้ว (ไม่ต้องหาร) แต่ซื้อเป็นกล่อง ๆ ละ 100 ใบ
   ถ้าใช้ "แพ็ค" ตัวเดียวรวบทั้งราคาและการสั่งซื้อ จะได้ 7.5 บาท/กล่อง ทันที

   จึงแยกเป็น **สองแกนที่คิดคนละที่** แล้วเก็บทุกอย่างต่อหน่วยสต๊อกเป็นฐานเดียว:

       หน่วยราคา ──(pricePack.size)──▶ หน่วยสต๊อก ◀──(orderPack.size)── หน่วยซื้อ

   `unitPrice` จึงยังแปลว่า "ราคาต่อ 1 หน่วยสต๊อก" เหมือนเดิมทุกตัวอักษร
   ผู้ใช้เดิมทุกจุด (มูลค่าสต๊อก · มูลค่าเบิก · Excel · กราฟ · แชท) ถูกต้องทันที
   ส่วนราคาต่อหน่วยซื้อ = `unitPrice × orderPack.size` ใช้ที่ใบขอซื้อจุดเดียว */

/**
 * หาตัวคูณ "1 <fromUnit> เท่ากับกี่ <toUnit>" จากข้อความหมายเหตุ
 *
 * สี่แพตเทิร์นนี้มาจากการกวาดหมายเหตุจริงทั้ง 133 แท็บ ครอบทุกเคสที่มีตัวคูณเขียนไว้:
 *
 *   N<to>/<from>        `(250แผ่น/24ห่อ/ลัง)` → 24   ·  `(50 ผืน/แพค)` → 50
 *   1 <from> มี N <to>  `1 แพ็คมี 10 ด้าม` → 10      ·  `1 ลังมี 20 แผง` → 20
 *   <from>ละ N <to>     `แพ็คละ 3 อัน` → 3
 *   1 <from> = N <to>   `1 แพ็ค=50 ผืน` → 50         ·  `1 แพ็ค=100 ชิ้น` → 100
 *
 * เทียบบนรูป canonical ของทั้งสองฝั่ง เพราะคนสะกดหน่วยไม่ตรงกันแม้ในแท็บเดียวกัน
 *
 * @returns {{size:number, source:'sameUnit'|'note'|'assumed'}}
 *   `assumed` = หน่วยต่างกันแต่หาตัวคูณไม่เจอ → ใช้ 1:1 ไปก่อน **แต่ต้องออก finding**
 *   ห้ามคืน null แล้วทิ้งราคา เพราะ 7 แท็บที่เป็นแบบนี้เป็นคำพ้องความหมาย 1:1 จริง
 *   (ท่อ/ถัง · อัน/เครื่อง · ชิ้น/ถาด · ชุด/กล่อง · ด้าม/อัน · แผ่น 98 หลุม/แผง)
 */
export function parsePackSize(note, fromUnit, toUnit) {
  if (sameUnit(fromUnit, toUnit)) return { size: 1, source: 'sameUnit' };

  const from = canonUnit(fromUnit);
  const to = canonUnit(toUnit);
  if (!from || !to) return { size: 1, source: 'assumed' };

  const text = canonUnit(note).replace(/,/g, '');
  const NUM = '([0-9]+(?:\\.[0-9]+)?)';
  const patterns = [
    NUM + to + '/' + from,
    '1?' + from + 'มี' + NUM + to,
    from + 'ละ' + NUM + to,
    '1?' + from + '=' + NUM + to,
  ];
  for (const src of patterns) {
    const hit = new RegExp(src).exec(text);
    const size = hit ? Number(hit[1]) : null;
    if (size !== null && Number.isFinite(size) && size > 0) return { size, source: 'note' };
  }
  return { size: 1, source: 'assumed' };
}

/* หน่วยซื้อ + จำนวนขั้นต่ำต่อครั้ง จากหมายเหตุ
 *
 * รูปแบบที่เจอจริง: `สั่งครั้งละ 1 ลัง` · `จะสั่งครั้งละ 2  ลัง` (เว้นวรรคสองครั้ง)
 * · `สั่งครั้ง 5 ตะกร้า` (ตก "ละ") · `สั่งครั้งละ 2 กล่องๆ ละ 15 คน`
 * เข้าเงื่อนไข 126 จาก 133 หมายเหตุ
 *
 * **ที่เหลือต้องเป็น null ห้ามเดา** — `สั่งเมื่อ ถาดเพาะชำเสื่อม แตก` และ
 * `สั่งตามจำนวนถังดับเพลิงที่หมดอายุ` ไม่ใช่จำนวนสั่งขั้นต่ำ เดาแล้วจะไปปัดยอดในใบขอซื้อผิด */
const MOQ_RE = /(?:จะ)?สั่ง\s*ครั้ง(?:ละ)?\s*([0-9]+(?:\.[0-9]+)?)\s*([ก-๙]+)/;

/**
 * @returns {{unit:string, moq:number, size:number, sizeSource:string}|null}
 *   ไม่มีหมายเหตุ / ไม่เข้าแพตเทิร์น = null (แปลว่าซื้อเป็นหน่วยสต๊อกตรง ๆ)
 */
export function parseOrderPack(note, stockUnit) {
  const hit = MOQ_RE.exec(String(note ?? ''));
  if (!hit) return null;

  const moq = Number(hit[1]);
  if (!Number.isFinite(moq) || moq <= 0) return null;

  /* ตัดหางของหน่วยออกก่อน — `กล่องๆ ละ 15 คน` จับได้เป็น `กล่องๆ`
   * และบางอันติดคำเชื่อมมาด้วย (`ลังจะ`) ซึ่งไม่ใช่ส่วนหนึ่งของชื่อหน่วย */
  const unit = hit[2].replace(/ๆ.*$/, '').replace(/(ละ|จะ|และ)$/, '').trim();
  if (!unit) return null;

  const { size, source } = parsePackSize(note, unit, stockUnit);

  /* **หน่วยซื้อต่างจากหน่วยสต๊อกแล้วหาตัวคูณไม่เจอ = ทิ้ง MOQ ไปเลย ห้ามเดา 1:1**
   *
   * ต่างจากแกนราคาที่ผู้ใช้สั่งให้เดา 1:1 ต่อไปได้ เพราะตรงนั้นเดาผิดแล้วมูลค่าเพี้ยน
   * แต่ตรงนี้เดาผิดแล้ว **สั่งของผิด** ซึ่งเสียเงินจริง
   *
   * เคสจริง 80.หัวหยดน้ำ — หน่วยสต๊อกเป็น `แพ็ค` แต่โน้ตเขียน `สั่งครั้งละ 500 ชิ้น
   * (1 แพ็ค=100 ชิ้น)` หน่วยซื้อเล็กกว่าหน่วยสต๊อก 100 เท่า ถ้าเดาว่า 1 ชิ้น = 1 แพ็ค
   * ระบบจะเสนอให้ซื้อ 500 แพ็ค = 280,000 บาท จากของที่ขาดอยู่ไม่กี่แพ็ค
   *
   * ไม่รู้ = ไม่ใช้ MOQ (ปัดตามหน่วยสต๊อกแบบเดิม) แล้วออก finding ให้คนไปเขียนตัวคูณที่ชีต */
  if (source === 'assumed') return { unit, moq, size: null, sizeSource: null };
  return { unit, moq, size, sizeSource: source };
}

/* normalizeItemName ย้ายไปอยู่ไฟล์ร่วม เพราะทั้งฝั่ง server และเบราว์เซอร์
 * ต้องจับคู่ชื่อรายการด้วยกฎเดียวกัน */
export { normalizeItemName } from '../../../public/js/shared/agg-core.js';
import { normalizeItemName, canonUnit, sameUnit } from '../../../public/js/shared/agg-core.js';

/** ชื่อรายการที่เอาไว้แสดงผล — ตัดแค่เลขลำดับนำหน้าออก */
function displayItemName(tabName) {
  return String(tabName).replace(NUMBERED_TAB_RE, '').trim();
}

/**
 * หาแถวแรกที่เป็นข้อมูลจริง และคอลัมน์ของวันที่
 * @returns {{dataStart:number, dateCol:number}|null}
 */
function probeDateColumn(rows) {
  const maxRow = Math.min(rows.length, 12);
  for (let r = 0; r < maxRow; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < Math.min(row.length, 4); c++) {
      if (DATE_CELL_RE.test(String(row[c] ?? '')) && parseSheetDate(row[c])) {
        return { dataStart: r, dateCol: c };
      }
    }
  }
  return null;
}

/**
 * ให้คะแนนว่าเลย์เอาต์ที่เดาไว้ถูกไหม โดยตรวจด้วย "เลขคณิต" ไม่ใช่ชื่อหัวคอลัมน์
 *
 *   คงเหลือ[i] ≈ คงเหลือ[i-1] + รับ[i] − เบิก[i]
 *   Index      === คงเหลือ − ขั้นต่ำ
 *   หน่วย       เป็นข้อความ ไม่ใช่ตัวเลข
 *
 * @returns {{confidence:number, checked:number}}
 */
function scoreLayout(rows, dataStart, dateCol, valueOffset) {
  const c = columnsFor(dateCol, valueOffset);
  let passed = 0;
  let checked = 0;
  let prevBalance = null;

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    if (isEmptyRow(row)) continue;
    if (!parseSheetDate(row[c.date])) continue;

    const balance = num(row[c.balance]);
    const minimum = num(row[c.minimum]);
    const index = num(row[c.index]);
    const received = num(row[c.received]);
    const issued = num(row[c.issued]);
    const unitText = String(row[c.unit] ?? '').trim();

    if (index !== null && balance !== null && minimum !== null) {
      checked++;
      if (Math.abs(index - (balance - minimum)) < 0.5) passed++;
    }
    if (balance !== null && prevBalance !== null) {
      checked++;
      const expected = prevBalance + (received ?? 0) - (issued ?? 0);
      if (Math.abs(balance - expected) < 0.5) passed++;
    }
    if (unitText) {
      checked++;
      if (num(unitText) === null) passed++;
    }
    if (balance !== null) prevBalance = balance;
  }

  return { confidence: checked === 0 ? 0 : passed / checked, checked };
}

function columnsFor(dateCol, valueOffset) {
  const base = dateCol + valueOffset;
  return {
    date: dateCol,
    received: base,
    issued: base + 1,
    balance: base + 2,
    unit: base + 3,
    minimum: base + 4,
    index: base + 5,
  };
}

/** อ่านแท็บรายการหนึ่งอัน */
function parseItemTab(tab, sourceKey, todayIso, group) {
  const rows = tab.rows || [];
  const probe = probeDateColumn(rows);

  if (!probe) {
    return {
      records: [],
      summary: { gid: tab.gid, name: tab.name, rowCount: 0, layoutConfidence: 0 },
      warning: 'ไม่พบคอลัมน์วันที่ — โครงตารางอาจเปลี่ยน',
    };
  }

  // ลองเลื่อนจุดเริ่มของคอลัมน์ตัวเลข 1..3 ช่องจากคอลัมน์วันที่ แล้วเลือกอันที่เข้าเค้าที่สุด
  // (แท็บที่เจอจริงใช้ 1 ทั้งหมด แต่เผื่อแท็บใหม่ที่มีคอลัมน์ว่างคั่น)
  let best = { valueOffset: 1, confidence: -1, checked: 0 };
  for (const valueOffset of [1, 2, 3]) {
    const score = scoreLayout(rows, probe.dataStart, probe.dateCol, valueOffset);
    if (score.confidence > best.confidence) best = { valueOffset, ...score };
  }

  const col = columnsFor(probe.dateCol, best.valueOffset);
  const item = displayItemName(tab.name);
  const itemNo = NUMBERED_TAB_RE.exec(tab.name)?.[1] ?? null;
  // หมายเหตุอยู่เหนือหัวตาราง ไม่ใช่แถวแรก — ดูเหตุผลที่ readItemNote()
  const note = readItemNote(rows, probe.dataStart);
  /* ราคาอยู่คอลัมน์ถัดจาก Index (= H ในเลย์เอาต์มาตรฐาน)
   * คิดจากตำแหน่งเหมือนคอลัมน์อื่นทั้งหมด ไม่ได้ตรึงเป็น 7 ตายตัว
   * แท็บที่คอลัมน์ตัวเลขเลื่อนไปหนึ่งช่อง (valueOffset 2/3) ช่องราคาก็เลื่อนตาม */
  const price = readUnitPrice(rows, col.index + 1, probe.dataStart);

  const records = [];
  let unit = null;
  let current = null;
  let futureCount = 0;

  for (let r = probe.dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    if (isEmptyRow(row)) continue;

    const dateText = String(row[col.date] ?? '').trim();
    const date = parseSheetDate(dateText);
    if (!date) continue;

    const unitText = String(row[col.unit] ?? '').trim() || null;
    if (unitText && num(unitText) === null) unit = unitText;

    const balance = num(row[col.balance]);
    const minimum = num(row[col.minimum]);
    const isFuture = date > todayIso;
    if (isFuture) futureCount++;

    // ยอดปัจจุบัน = แถวล่าสุดที่ยังไม่เลยวันนี้ — ทั้งคงเหลือและขั้นต่ำต้องมาจากแถวเดียวกัน
    if (!isFuture && balance !== null) {
      current = {
        date,
        balance,
        minimum,
        index: balance !== null && minimum !== null ? balance - minimum : num(row[col.index]),
        unit: unitText || unit,
      };
    }

    records.push(
      makeRecord({
        date,
        source: sourceKey,
        tab: tab.name,
        rowIndex: r,
        raw: { dateText },
        extra: {
          kind: 'log',
          item,
          itemNo,
          group,
          unit: unitText || unit,
          received: num(row[col.received]),
          issued: num(row[col.issued]),
          balance,
          minimum,
          index: num(row[col.index]),
          isFuture,
          month: date.slice(0, 7),
        },
      })
    );
  }

  /* แปลงราคาให้เป็น "ต่อ 1 หน่วยสต๊อก" — หน่วยสต๊อกเพิ่งรู้ครบตอนวนแถวจบ
   *
   * `priceQty` (ป้ายที่ขึ้นต้นด้วยตัวเลข เช่น `ราคา/5 ถุง`) ถูกกลืนเข้ามาเป็นตัวคูณ
   * ของแพ็คด้วย เพราะความหมายเหมือนกันเป๊ะ: ราคาก้อนนี้ครอบของกี่หน่วย
   * เดิมโค้ดทิ้งราคาไปเลยเมื่อเจอแบบนี้ ซึ่งเสียข้อมูลทั้งที่อ่านออก */
  const stockUnit = current?.unit ?? unit;
  const fromNote = parsePackSize(note, price.priceUnit, stockUnit);

  /* ป้ายที่ขึ้นต้นด้วยจำนวน (`ราคา/ 5 แพ็ค=5 กิโล` = 420) ยัง **ไม่ใช้ราคาเหมือนเดิม**
   *
   * ต่างจากเคส `ราคา/ลัง` ที่หมายเหตุบอกตัวคูณไว้ชัดเจนว่า 1 ลัง = 24 ห่อ —
   * ป้ายแบบนี้ตีความได้หลายทาง (420 ต่อ 5 แพ็ค? ต่อ 5 กิโล? หรือ 5 แพ็คที่หนักแพ็คละ 5 กิโล?)
   * การหารเองจึงเป็นการเดาความหมาย ไม่ใช่การอ่าน — คืน null แล้วออก finding
   * `supply.priceNotPerUnit` ให้คนไปเขียนราคาต่อ 1 หน่วยที่ชีต (กฎเดิม ห้ามผ่อน)
   *
   * ตอนนี้ไม่มีแท็บไหนเข้าเงื่อนไขนี้แล้ว เพราะผู้ใช้แก้ป้ายเป็น `ราคา/ แพ็ค=5 กิโล`
   * ซึ่งอ่านได้ตรง ๆ ว่า 420 ต่อ 1 แพ็ค — แต่กฎต้องอยู่ กันคนพิมพ์กลับมาแบบเดิม */
  const pricePack =
    price.price === null || price.priceQty
      ? null
      : {
          price: price.price,
          unit: price.priceUnit,
          size: fromNote.size,
          sizeSource: fromNote.source,
        };
  const orderPack = parseOrderPack(note, stockUnit);


  return {
    records,
    summary: {
      gid: tab.gid,
      name: tab.name,
      item,
      itemNo,
      group,
      note,
      // อ่านจากหมายเหตุเดียวกับ note — ชีตไม่มีคอลัมน์แยกให้
      leadTimeDays: parseLeadTimeDays(note),
      unit,
      /* ราคา/หน่วยจากหัวตารางของแท็บนี้เอง — เลิกใช้ช่องราคาในแท็บ "สั่งของรายเดือน" แล้ว
       *
       * **unitPrice = ราคาต่อ 1 หน่วยสต๊อก เสมอ** ความหมายไม่เคยเปลี่ยน
       * ผู้ใช้ปลายทางทุกตัว (มูลค่าสต๊อก · มูลค่าเบิก · Excel · กราฟ · แชท) จึงไม่ต้องแก้
       * ส่วนราคาดิบที่ชีตเขียนไว้เก็บครบใน pricePack เพื่อย้อนกลับไปอธิบายบนหน้าจอได้ */
      unitPrice: pricePack ? pricePack.price / pricePack.size : null,
      pricePack,
      orderPack,
      priceLabel: price.priceLabel,
      priceUnit: price.priceUnit,
      priceQty: price.priceQty,
      rowCount: records.length,
      // analysis.js:132 มีเช็ค structural.layoutAmbiguous (< 0.6) รออยู่แล้ว
      layoutConfidence: best.checked === 0 ? null : Number(best.confidence.toFixed(3)),
      valueOffset: best.valueOffset,
      futureCount,
      current,
    },
    warning: records.length === 0 ? 'อ่านแถวข้อมูลไม่ได้เลย' : null,
  };
}

/** อ่านแท็บ "สั่งของรายเดือน" — ตารางจัดซื้อ ซึ่งเป็นแหล่งราคาแห่งเดียวของระบบ */
function parseOrderSummary(tab, sourceKey) {
  const rows = tab.rows || [];
  const records = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (isEmptyRow(row)) continue;

    const itemText = String(row[ORDER_COL.item] ?? '').trim();
    if (!itemText) continue;
    if (/^(รายการ|item)/i.test(itemText)) continue;

    records.push(
      makeRecord({
        date: null,
        source: sourceKey,
        tab: tab.name,
        rowIndex: r,
        raw: { itemText },
        extra: {
          kind: 'order',
          item: itemText,
          seq: num(row[ORDER_COL.seq]),
          unit: String(row[ORDER_COL.unit] ?? '').trim() || null,
          balance: num(row[ORDER_COL.balance]),
          orderQty: num(row[ORDER_COL.orderQty]),
          unitPrice: num(row[ORDER_COL.unitPrice]),
          amount: num(row[ORDER_COL.amount]),
          orderDay: num(row[ORDER_COL.orderDay]),
          lastOrderedText: String(row[ORDER_COL.lastOrdered] ?? '').trim() || null,
          lifetimeText: String(row[ORDER_COL.lifetime] ?? '').trim() || null,
        },
      })
    );
  }

  return {
    records,
    summary: {
      gid: tab.gid,
      name: tab.name,
      role: 'order',
      rowCount: records.length,
    },
    warning: records.length === 0 ? 'ตารางสั่งของรายเดือนว่างเปล่า' : null,
  };
}

export function parse({ tabs, sourceKey = 'supplyLog', today = null }) {
  const todayIso = today || new Date().toISOString().slice(0, 10);
  const records = [];
  const tabSummaries = [];
  const warnings = [];

  for (const tab of tabs) {
    const name = String(tab.name ?? '').trim();
    const nutrient = nutrientTabGroup(name);
    let result = null;

    if (ORDER_TAB_RE.test(name)) {
      result = parseOrderSummary(tab, sourceKey);
    } else if (NUMBERED_TAB_RE.test(name)) {
      result = parseItemTab(tab, sourceKey, todayIso, 'item');
    } else if (nutrient) {
      result = parseItemTab(tab, sourceKey, todayIso, nutrient);
    } else if (TEMPLATE_TAB_RE.test(name)) {
      tabSummaries.push({ gid: tab.gid, name: tab.name, skipped: 'template', rowCount: 0 });
      continue;
    } else {
      // แท็บชนิดที่ยังไม่รู้จัก — ต้องส่งเสียง ไม่ใช่หายเงียบ
      // (analysis.js ทำ skipped ที่ไม่ใช่ template/summary ให้เป็น warning ให้อยู่แล้ว)
      tabSummaries.push({ gid: tab.gid, name: tab.name, skipped: 'unknown-tab', rowCount: 0 });
      continue;
    }

    records.push(...result.records);
    tabSummaries.push(result.summary);
    if (result.warning) warnings.push({ tab: tab.name, message: result.warning });
  }

  return { rows: records, tabs: tabSummaries, warnings };
}
