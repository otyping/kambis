/**
 * parsers/cost.js — แบบฟอร์มต้นทุน (งบรายรับ-รายจ่ายรายเดือน)
 *
 * ชีตที่แปด เพิ่งเพิ่มเข้ามา — เป็นชีตแรกที่มี **ตัวเลขรายได้จริง**
 * ก่อนหน้านี้ Dashboard ขึ้น "รอข้อมูล" ไว้ทุกที่ที่ต้องใช้เงิน เพราะไม่มีชีตไหนมีเลย
 * จึงติด `kind: 'finance'` ให้ analysis.js ข้ามกฎเรื่องน้ำหนัก/ขนาด/สายพันธุ์ทั้งหมด
 *
 * ── โครงของชีต (6 แท็บ) ──
 *
 *   สรุป            งบรวม: Revenue · ต้นทุนวัตถุดิบ · ค่าใช้จ่าย Farm/Office ·
 *                   รวมต้นทุนการปลูก · EBITDA · ค่าเสื่อมราคา · EBIT   ← **ตัวเลขที่เชื่อถือได้**
 *   ต้นทุน          รายละเอียดต้นทุนการปลูก (ค่าบุคลากร ปุ๋ย ค่าไฟ ฯลฯ)
 *   Farm            ค่าใช้จ่ายฝั่งฟาร์มรายรายการ (154 แถว)
 *   Office          ค่าใช้จ่ายฝั่งสำนักงานรายรายการ (56 แถว)
 *   ค่าเสื่อมราคา    ทะเบียนสินทรัพย์ 326 แถว — ยอดรายเดือนมีอยู่ในแท็บ "สรุป" แล้ว
 *   ต้นทุน ต่อ กรัม  **ตอนนี้เนื้อหาซ้ำกับแท็บ Office ทั้งแท็บ** (ดูด้านล่าง)
 *
 * ── สามเรื่องที่ทำให้อ่านตรง ๆ ไม่ได้ ──
 *
 * ก. **หัวคอลัมน์เดือนที่หกถูกชื่อรายงานทับ** ทุกแท็บมีเซลล์ merge ที่เขียนว่า
 *    "รายงานค่าใช้จ่ายจาก Office …" วางทับหัว `Jun-26` พอดี แต่ข้อมูลใต้คอลัมน์นั้น
 *    เป็นของเดือนมิถุนายนจริง (ตรวจแล้ว: ผลรวม 12 เดือนเท่ากับช่อง Total เป๊ะ)
 *    → **หาคอลัมน์เดือนจากตำแหน่ง ไม่ใช่จากข้อความหัวคอลัมน์** แล้วยืนยันด้วยเลขคณิต
 *
 * ข. **แถวยอดรวมปนอยู่กับแถวรายการ** (`รวม`, `Total`, `รวมต้นทุนการปลูก`)
 *    ถ้าบวกทุกแถวจะได้ยอดเกินจริงเท่าตัว → ตัดแถวยอดรวมออกจาก record
 *    แต่เก็บค่าที่ชีตบอกไว้ใน `stated` เพื่อเอาไปเทียบกับผลรวมที่คำนวณเอง
 *
 * ค. **หมวดกับหมวดย่อยเป็นเซลล์ merge** โผล่แค่แถวแรกของกลุ่ม → ต้อง forward-fill
 */
import { isEmptyRow } from '../csv.js';
import { num, makeRecord } from '../normalize.js';

/** หัวคอลัมน์เดือนแบบ `Jan-26` */
const MONTH_HEADER_RE = /^\s*([A-Za-z]{3})\s*[-/]\s*(\d{2})\s*$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** แถวที่เป็นยอดรวม ไม่ใช่รายการ — ห้ามเอาไปบวกกับรายการอื่น */
const SUBTOTAL_RE = /^\s*(รวม|total|ยอดรวม)/i;

/**
 * บรรทัดในงบสรุป → คีย์ที่โค้ดใช้
 * จับจากข้อความเพราะแท็บนี้มีไม่กี่บรรทัดและชื่อบรรทัดคือความหมายของมัน
 * (ต่างจากแท็บรายการที่ต้องใช้ตำแหน่ง เพราะชื่อรายการเปลี่ยนได้ตลอด)
 */
const SUMMARY_LINES = [
  { key: 'revenue', test: (t) => /^revenue|^รายได้|^ยอดขาย/i.test(t) },
  { key: 'materialCost', test: (t) => /ต้นทุนวัตถุดิบ/.test(t) },
  { key: 'farmExpense', test: (t) => /ค่าใช้จ่าย.*farm/i.test(t) },
  { key: 'officeExpense', test: (t) => /ค่าใช้จ่าย.*office/i.test(t) },
  { key: 'growingCost', test: (t) => /^รวมต้นทุนการปลูก/.test(t) },
  { key: 'ebitda', test: (t) => /ebitda/i.test(t) },
  { key: 'depreciation', test: (t) => /ค่าเสื่อมราคา/.test(t) },
  { key: 'ebit', test: (t) => /^ebit\b/i.test(t) },
];

function summaryKeyOf(label) {
  return SUMMARY_LINES.find((l) => l.test(String(label).trim()))?.key ?? null;
}

/**
 * หาบล็อกคอลัมน์เดือน — คืนตำแหน่งเริ่ม จำนวนเดือน และปี
 *
 * มองหาหัว `Jan-26` ก่อน ถ้าไม่เจอ (คนแก้หัวตาราง) จะลองไล่จากเดือนไหนก็ได้
 * ที่อ่านออก แล้วถอยกลับไปหาตำแหน่งของเดือนมกราคม
 *
 * @returns {{headerRow:number, start:number, year:number}|null}
 */
function findMonthBlock(rows) {
  const maxRow = Math.min(rows.length, 8);
  for (let r = 0; r < maxRow; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const m = MONTH_HEADER_RE.exec(String(row[c] ?? ''));
      if (!m) continue;
      const idx = MONTHS.indexOf(m[1].toLowerCase());
      if (idx < 0) continue;
      const start = c - idx;
      // เดือนมกราคมต้องไม่ตกไปอยู่นอกตาราง ไม่งั้นแปลว่าจับผิดเซลล์
      if (start < 0) continue;
      return { headerRow: r, start, year: 2000 + Number(m[2]) };
    }
  }
  return null;
}

/** เลขในชีตมีคอมมาคั่นหลักพัน และใช้ `-` แทนศูนย์ */
function amount(cell) {
  const text = String(cell ?? '').trim();
  if (!text || text === '-' || text === '—') return null;
  return num(text);
}

/**
 * อ่านแท็บหนึ่งอันแบบเดียวกันหมด — ต่างกันแค่ว่าคอลัมน์ก่อนบล็อกเดือนมีกี่ชั้น
 *
 * @param {object} tab
 * @param {string} sourceKey
 * @param {'summary'|'detail'} role
 * @param {string} group ชื่อกลุ่มของแท็บรายการ (growing / farm / office)
 */
function parseCostTab(tab, sourceKey, role, group) {
  const rows = tab.rows || [];
  const block = findMonthBlock(rows);

  if (!block) {
    return {
      records: [],
      summary: { gid: tab.gid, name: tab.name, role, rowCount: 0 },
      warning: 'ไม่พบหัวคอลัมน์เดือน — โครงตารางอาจเปลี่ยน',
    };
  }

  const { start, year } = block;
  const monthCols = Array.from({ length: 12 }, (_, i) => start + i);
  const totalCol = start + 12;

  /* แถวหลัง "ยอดรวมใหญ่" ของแท็บเป็นบรรทัดหมายเหตุ ไม่ใช่รายการ
   *
   * แท็บ Office มีบรรทัด "- ค่าเบ็ดเตล็ด Office 1,252,945" วางไว้ใต้แถวรวม
   * ซึ่งเป็นการหยิบตัวเลขข้างบนมาสรุปซ้ำ ถ้านับเป็นรายการจะบวกเกินไป 1.25 ล้าน
   * ใช้กับแท็บรายละเอียดเท่านั้น — แท็บสรุปมี EBITDA / ค่าเสื่อม / EBIT อยู่ใต้แถวรวม
   * ซึ่งเป็นบรรทัดที่ต้องอ่านจริง ๆ */
  let lastSubtotal = -1;
  if (role !== 'summary') {
    for (let r = block.headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (isEmptyRow(row)) continue;
      const lead = [];
      for (let c = 0; c < start; c++) lead.push(String(row[c] ?? '').trim());
      const label = lead.filter(Boolean).pop();
      if (label && SUBTOTAL_RE.test(label)) lastSubtotal = r;
    }
  }

  const records = [];
  const stated = []; // แถวยอดรวมที่ชีตคำนวณไว้ — เก็บไว้เทียบ ไม่เอาไปบวก
  let rowMismatches = 0;

  // หมวด/หมวดย่อยเป็นเซลล์ merge — โผล่แค่แถวแรกของกลุ่ม ต้องจำต่อ
  let category = null;
  let subCategory = null;

  for (let r = block.headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (isEmptyRow(row)) continue;

    // ข้อความก่อนบล็อกเดือน: ซ้ายสุด = หมวด, ขวาสุดที่ไม่ว่าง = ชื่อรายการ
    const lead = [];
    for (let c = 0; c < start; c++) lead.push(String(row[c] ?? '').trim());
    const labelIdx = lead.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).pop();
    if (labelIdx === undefined) continue;
    const label = lead[labelIdx];

    if (start >= 2) {
      if (lead[0]) category = lead[0];
      if (start >= 3 && lead[1]) subCategory = lead[1];
    }

    const byMonth = {};
    let sum = 0;
    let seen = 0;
    for (let i = 0; i < 12; i++) {
      const v = amount(row[monthCols[i]]);
      if (v === null) continue;
      byMonth[`${year}-${String(i + 1).padStart(2, '0')}`] = v;
      sum += v;
      seen++;
    }
    const statedTotal = amount(row[totalCol]);
    if (!seen && statedTotal === null) continue; // แถวหัวข้อล้วน ไม่มีตัวเลข

    /* ตรวจด้วยเลขคณิตทันที — เป็นตัวยืนยันว่าจับคอลัมน์เดือนถูกจริง
     * (คอลัมน์ที่หกไม่มีหัว เพราะชื่อรายงานทับอยู่ จึงต้องพิสูจน์ด้วยผลรวม) */
    const mismatch =
      statedTotal !== null && seen > 0 && Math.abs(sum - statedTotal) > 1
        ? Number((sum - statedTotal).toFixed(2))
        : null;
    if (mismatch !== null) rowMismatches++;

    const isSubtotal = SUBTOTAL_RE.test(label);
    const summaryKey = role === 'summary' ? summaryKeyOf(label) : null;

    if (isSubtotal || (role === 'summary' && !summaryKey)) {
      stated.push({ label, total: statedTotal ?? sum, rowIndex: r, grand: r === lastSubtotal });
      // แถวยอดรวมไม่กลายเป็น record — กันบวกซ้ำกับแถวรายการ
      // แท็บสรุปที่อ่านชื่อบรรทัดไม่ออก (เช่นบรรทัดหัวข้อ "Cost") ก็ข้ามเหมือนกัน
      continue;
    }

    // บรรทัดหมายเหตุใต้ยอดรวมใหญ่ — เก็บไว้ให้ตรวจได้ แต่ไม่นับเป็นรายการ
    if (lastSubtotal >= 0 && r > lastSubtotal) {
      stated.push({ label, total: statedTotal ?? sum, rowIndex: r, memo: true });
      continue;
    }

    /* หนึ่ง record ต่อหนึ่งเดือน — ทำให้ตัวกรองปี/ช่วงวันที่ของ Dashboard
     * ใช้กับข้อมูลชุดนี้ได้เหมือนรายงานอื่น โดยไม่ต้องเขียนตัวกรองตัวที่สอง */
    for (const [month, value] of Object.entries(byMonth)) {
      records.push(
        makeRecord({
          date: `${month}-01`,
          source: sourceKey,
          tab: tab.name,
          rowIndex: r,
          raw: { label, statedTotal },
          extra: {
            kind: role === 'summary' ? 'summary' : 'expense',
            line: summaryKey,
            group: role === 'summary' ? null : group,
            category: role === 'summary' ? null : category,
            subCategory: role === 'summary' ? null : subCategory,
            item: label,
            month,
            amount: value,
          },
        })
      );
    }
  }

  return {
    records,
    summary: {
      gid: tab.gid,
      name: tab.name,
      role,
      group: group ?? null,
      year,
      monthStart: start,
      stated,
      rowMismatches,
      rowCount: records.length,
    },
    warning: records.length === 0 ? 'อ่านแถวข้อมูลไม่ได้เลย' : null,
  };
}

/** ลายเซ็นของแท็บ ใช้จับว่าสองแท็บมีเนื้อหาเหมือนกันเป๊ะไหม */
function tabFingerprint(rows) {
  return (rows || [])
    .slice(0, 60)
    .map((r) => (r || []).map((c) => String(c ?? '').trim()).join(''))
    .join('');
}

/**
 * แท็บนี้คืออะไร — ตัดสินจาก **ชื่อเต็ม** ไม่ใช่ "มีคำนี้อยู่"
 *
 * ต้องเป๊ะเพราะแท็บ "ต้นทุน ต่อ กรัม 2026" ก็มีคำว่า "ต้นทุน" เหมือนกัน
 * ถ้าจับหลวม ๆ มันจะถูกอ่านเป็นแท็บต้นทุนการปลูก ทั้งที่เนื้อในเป็นค่าใช้จ่าย Office
 * แล้วยอดต้นทุนวัตถุดิบจะเกินจริงไป 1.6 ล้านโดยไม่มีอะไรฟ้อง
 *
 * `priority` ใช้ตัดสินว่าใครได้สิทธิ์อ่านก่อนเมื่อเจอสองแท็บที่เนื้อหาเหมือนกันเป๊ะ
 * แท็บที่ชื่อตรงกับหน้าที่ของมันต้องชนะสำเนาที่ชื่อไม่ตรงเสมอ
 */
function classifyTab(name) {
  const t = String(name ?? '').trim();

  if (/ค่าเสื่อม/.test(t)) return { role: 'detailOnly', priority: 0 };
  if (/^สรุป/.test(t)) return { role: 'summary', priority: 1 };

  /* ต้องมาก่อนกฎ /ต้นทุน/ ด้านล่าง — แท็บนี้ชื่อขึ้นต้นด้วย "ต้นทุน" เหมือนกัน
   * แต่ตั้งใจจะเป็นต้นทุนต่อกรัม ไม่ใช่ต้นทุนการปลูก (ตอนนี้ยังเป็นสำเนาของ Office อยู่)
   * ให้เป็น unknown เพื่อให้ถูกข้ามพร้อมส่งเสียง จนกว่าจะมีคนแก้เนื้อในให้ตรงชื่อ */
  if (/ต่อ\s*กรัม|per\s*gram/i.test(t)) return { role: 'unknown', priority: 9 };

  /* จับแบบ "มีคำนี้อยู่" ไม่ใช่ชื่อเป๊ะ เพราะคนแก้ชื่อแท็บในชีตได้ตลอด
   * เจอจริงระหว่างทำงานนี้: Farm → "ค่าใช้จ่าย-Farm", ต้นทุน → "ต้นทุนวัตถุดิบ"
   * ถ้าจับเป๊ะ ข้อมูลรายละเอียดจะหายทั้งก้อนแค่เพราะมีคนเปลี่ยนชื่อแท็บ */
  if (/farm/i.test(t)) return { role: 'detail', group: 'farm', priority: 2 };
  if (/office/i.test(t)) return { role: 'detail', group: 'office', priority: 2 };
  if (/^ต้นทุน/.test(t)) return { role: 'detail', group: 'growing', priority: 2 };

  // ชื่อที่ยังไม่รู้จัก — ได้สิทธิ์อ่านทีหลังสุด และต้องส่งเสียง ไม่ใช่หายเงียบ
  return { role: 'unknown', priority: 9 };
}

export function parse({ tabs, sourceKey = 'cost' }) {
  const records = [];
  const byName = new Map(); // ชื่อแท็บ → summary (ไว้เรียงกลับตามลำดับเดิมตอนท้าย)
  const warnings = [];
  const seenContent = new Map(); // ลายเซ็นเนื้อหา → ชื่อแท็บที่ได้สิทธิ์อ่าน

  const ordered = tabs
    .map((tab, i) => ({ tab, i, ...classifyTab(tab.name) }))
    .sort((a, b) => a.priority - b.priority || a.i - b.i);

  for (const { tab, role, group } of ordered) {
    const name = String(tab.name ?? '').trim();

    /* ทะเบียนสินทรัพย์ 326 แถว — ยอดค่าเสื่อมราคารายเดือนมีอยู่ในแท็บ "สรุป" แล้ว
     * ถ้าอ่านซ้ำเข้ามาจะกลายเป็นนับสองรอบ จึงมาร์ก detailOnly ให้ analysis รู้ว่าตั้งใจข้าม */
    if (role === 'detailOnly') {
      byName.set(name, { gid: tab.gid, name, detailOnly: true, rowCount: 0 });
      continue;
    }

    /* แท็บที่เนื้อหาซ้ำกับแท็บอื่นทั้งแท็บ
     *
     * ตอนนี้ "ต้นทุน ต่อ กรัม 2026" ยังเป็นสำเนาของ Office อยู่ (ชื่อบอกว่าจะทำ
     * ต้นทุนต่อกรัม แต่ยังไม่ได้แก้เนื้อใน) ถ้าอ่านเข้ามาด้วยค่าใช้จ่าย Office
     * จะถูกนับสองเท่าทันที
     *
     * จับด้วยการเทียบเนื้อหาจริง ไม่ใช่เดาจากชื่อ — วันที่คนแก้ให้เป็นต้นทุนต่อกรัมจริง
     * แท็บนี้จะเลิกเป็นสำเนาเองโดยไม่ต้องแก้โค้ด (แล้วจะขึ้นเป็น unknown-tab ให้มาดูแทน) */
    const fingerprint = tabFingerprint(tab.rows);
    if (seenContent.has(fingerprint)) {
      byName.set(name, {
        gid: tab.gid,
        name,
        skipped: 'duplicate-content',
        duplicateOf: seenContent.get(fingerprint),
        rowCount: 0,
      });
      continue;
    }
    seenContent.set(fingerprint, name);

    if (role === 'unknown') {
      byName.set(name, { gid: tab.gid, name, skipped: 'unknown-tab', rowCount: 0 });
      continue;
    }

    const result = parseCostTab(tab, sourceKey, role, group ?? null);
    records.push(...result.records);
    byName.set(name, result.summary);
    if (result.warning) warnings.push({ tab: name, message: result.warning });
  }

  // คืนสรุปตามลำดับแท็บจริงในชีต เพื่อให้คนอ่านเทียบกับที่เห็นในเบราว์เซอร์ได้
  const tabSummaries = tabs
    .map((t) => byName.get(String(t.name ?? '').trim()))
    .filter(Boolean);

  return { rows: records, tabs: tabSummaries, warnings };
}
