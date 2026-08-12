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

/** แท็บปุ๋ย/สารเคมีที่ไม่มีเลขนำหน้าชื่อ — ใช้โครงเดียวกับแท็บรายการทุกอย่าง */
const NUTRIENT_TABS = new Set(
  ['COCO', 'CO2', 'Bloom', 'Core', 'Grow', 'Cleanse', 'Fade', 'Cuts', 'pH Up', 'CaMg', 'IPM', 'อะบา'].map(
    (n) => n.toLowerCase()
  )
);

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
 * @returns {{unitPrice:number|null, priceLabel:string|null, priceUnit:string|null, priceQty:number|null}}
 */
export function readUnitPrice(rows, priceCol, headerEnd = 0) {
  const empty = { unitPrice: null, priceLabel: null, priceUnit: null, priceQty: null };
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
    // ราคาของหลายหน่วย → บอกไม่ได้ว่าหน่วยละเท่าไร ต้องให้คนไปแก้ป้ายที่ชีต
    unitPrice: priceQty !== null && priceQty > 1 ? null : value,
    priceLabel,
    priceUnit: unitText,
    priceQty: priceQty !== null && priceQty > 1 ? priceQty : null,
  };
}

/* normalizeItemName ย้ายไปอยู่ไฟล์ร่วม เพราะทั้งฝั่ง server และเบราว์เซอร์
 * ต้องจับคู่ชื่อรายการด้วยกฎเดียวกัน */
export { normalizeItemName } from '../../../public/js/shared/agg-core.js';
import { normalizeItemName } from '../../../public/js/shared/agg-core.js';

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
  const note = String(rows[0]?.[0] ?? '').replace(/\s+/g, ' ').trim() || null;
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

  return {
    records,
    summary: {
      gid: tab.gid,
      name: tab.name,
      item,
      itemNo,
      group,
      note,
      // อ่านจากหัวตารางเดียวกับ note — ชีตไม่มีคอลัมน์แยกให้
      leadTimeDays: parseLeadTimeDays(note),
      unit,
      /* ราคา/หน่วยจากหัวตารางของแท็บนี้เอง — เลิกใช้ช่องราคาในแท็บ "สั่งของรายเดือน" แล้ว
       * priceUnit/priceQty เก็บไว้ให้ analysis.js เทียบกับคอลัมน์หน่วยได้ */
      unitPrice: price.unitPrice,
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
    let result = null;

    if (ORDER_TAB_RE.test(name)) {
      result = parseOrderSummary(tab, sourceKey);
    } else if (NUMBERED_TAB_RE.test(name)) {
      result = parseItemTab(tab, sourceKey, todayIso, 'item');
    } else if (NUTRIENT_TABS.has(name.toLowerCase())) {
      result = parseItemTab(tab, sourceKey, todayIso, 'nutrient');
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
