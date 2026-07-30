/**
 * parsers/layout.js — ตรวจหาโครงคอลัมน์ของตารางน้ำหนักโดยอัตโนมัติ
 *
 * ปัญหา: ฟอร์มน้ำหนักของ Kambis ถูกคัดลอกและแก้ต่อกันมาหลายรุ่น
 * บาง tab ลบคอลัมน์ Shake2 ออก บางอันเพิ่ม S1/S2 ทำให้คอลัมน์เลื่อนไปทั้งแถว
 * และหัวตารางถูก merge จนป้ายชื่อหายไปหลายช่อง
 *
 * วิธีแก้: ไม่เดาจากตำแหน่งตายตัว แต่
 *   1. หาคอลัมน์ผลรวม (รวมน้ำหนักดอก / รวมน้ำหนักที่ไม่ใช่ดอก) จากข้อความหัวตาราง
 *   2. หาจุดแบ่งระหว่าง "ดอก" กับ "ไม่ใช่ดอก" โดยทดสอบทุกจุดที่เป็นไปได้
 *      แล้วเลือกจุดที่ทำให้ผลรวมตรงกับที่ชีตคำนวณไว้เองมากที่สุด
 *   3. ตั้งชื่อคอลัมน์จากป้ายในหัวตาราง ถ้าไม่มีก็เติมตามลำดับมาตรฐาน
 *
 * ผลลัพธ์: ทนต่อรุ่นฟอร์มที่ยังไม่เคยเห็น และบอกได้ว่ามั่นใจแค่ไหน
 */
import { num, sum } from '../normalize.js';

const TOLERANCE = 0.5;

/** ป้ายชื่อขนาดดอก — ต้องมีวงเล็บหน่วยต่อท้าย เพื่อไม่ให้ไปชนคำอื่นในข้อความที่ merge มา */
const SIZE_LABEL_RE = /(?:^|[\s_)(])(XXL|XL|S2|S1|XS|L|M|S)\s*\(\s*(?:kg|g|กรัม|กก\.?)\s*\)/i;

const NON_FLOWER_PATTERNS = [
  [/shake\s*2|\*\s*xs\s*\*/i, 'shake2'],
  [/shake/i, 'shake'],
  [/sugar\s*leaf/i, 'sugarleaf'],
  [/kief/i, 'kief'],
  [/ดอกปั่น/, 'dokPan'],
  [/ดอกร่อน/, 'dokRon'],
  [/เศษดอก/, 'sesDok'],
];

const FLOWER_ORDER_BY_COUNT = {
  4: ['XXL', 'XL', 'L', 'M'],
  5: ['XXL', 'XL', 'L', 'M', 'XS'],
  6: ['XXL', 'XL', 'L', 'M', 'S', 'XS'],
  7: ['XXL', 'XL', 'L', 'M', 'S2', 'S1', 'XS'],
  8: ['XXL', 'XL', 'L', 'M', 'S2', 'S1', 'XS', 'XS2'],
};

const NON_FLOWER_ORDER_BY_COUNT = {
  3: ['shake', 'sugarleaf', 'dokRon'],
  4: ['shake', 'sugarleaf', 'kief', 'dokRon'],
  5: ['shake', 'sugarleaf', 'kief', 'dokPan', 'dokRon'],
  6: ['shake', 'shake2', 'sugarleaf', 'kief', 'dokPan', 'dokRon'],
  7: ['shake', 'shake2', 'sugarleaf', 'kief', 'dokPan', 'dokRon', 'sesDok'],
};

/** รวมข้อความหัวตารางของแต่ละคอลัมน์จากหลายแถวบนสุด (หัวตารางถูกแยกเป็นหลายบรรทัด) */
function mergeHeaderText(rows, headerRowCount) {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const cells = new Array(width).fill('');
  for (let r = 0; r < Math.min(headerRowCount, rows.length); r++) {
    for (let c = 0; c < width; c++) {
      const text = String(rows[r][c] ?? '').replace(/\s+/g, ' ').trim();
      if (text) cells[c] = cells[c] ? `${cells[c]} ${text}` : text;
    }
  }
  return cells;
}

/** หาคอลัมน์ผลรวมทั้งสองช่องจากข้อความหัวตาราง */
function findTotalColumns(headerCells) {
  let flower = -1;
  let nonFlower = -1;
  for (let c = 0; c < headerCells.length; c++) {
    const text = headerCells[c];
    if (!text) continue;
    if (nonFlower === -1 && /(รวมน้ำหนักที่ไม่ใช่ดอก|total\s*non[-\s]?flower)/i.test(text)) {
      nonFlower = c;
      continue;
    }
    if (flower === -1 && /(รวมน้ำหนักดอก|total\s*flower)/i.test(text)) {
      flower = c;
    }
  }
  return { flower, nonFlower };
}

/** อ่านป้ายชื่อขนาด/ประเภทของแต่ละคอลัมน์เท่าที่หัวตารางบอกได้ */
function readLabels(headerCells) {
  const labels = new Array(headerCells.length).fill(null);
  for (let c = 0; c < headerCells.length; c++) {
    const text = headerCells[c];
    if (!text) continue;

    for (const [re, key] of NON_FLOWER_PATTERNS) {
      if (re.test(text)) {
        labels[c] = key;
        break;
      }
    }
    if (labels[c]) continue;

    const m = text.match(SIZE_LABEL_RE);
    if (m) labels[c] = m[1].toUpperCase();
  }
  return labels;
}

/** รวมค่าในช่วงคอลัมน์ [from, to) ของแถวเดียว */
function sumRange(row, from, to) {
  const values = [];
  for (let c = from; c < to; c++) {
    const v = num(row[c]);
    if (v !== null) values.push(v);
  }
  return values.length ? sum(values) : 0;
}

/**
 * ตรวจหาโครงคอลัมน์ของตาราง
 *
 * @param {string[][]} rows แถวทั้งหมดใน tab
 * @param {object} opts
 * @param {number} opts.bodyStart คอลัมน์แรกของบล็อกน้ำหนัก
 * @param {number} [opts.headerRowCount=6] จำนวนแถวบนสุดที่ถือเป็นหัวตาราง
 * @param {number[]} [opts.dataRowIndexes] แถวข้อมูลที่ใช้ทดสอบ (ถ้าไม่ระบุจะใช้ทุกแถวหลังหัวตาราง)
 * @returns {{flowerCols, nonFlowerCols, statedFlowerCol, statedNonFlowerCol, confidence, tested, hits, split}}
 */
export function detectLayout(rows, opts) {
  const { bodyStart, headerRowCount = 6, dataRowIndexes } = opts;
  const headerCells = mergeHeaderText(rows, headerRowCount);
  const labels = readLabels(headerCells);
  let { flower: statedFlowerCol, nonFlower: statedNonFlowerCol } = findTotalColumns(headerCells);

  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);

  // ถ้าหัวตารางไม่บอก ให้เดาว่าเป็นสองคอลัมน์สุดท้าย
  if (statedFlowerCol === -1 || statedNonFlowerCol === -1) {
    statedNonFlowerCol = width - 1;
    statedFlowerCol = width - 2;
  }

  const bodyEnd = statedFlowerCol; // บล็อกน้ำหนักจบก่อนคอลัมน์ผลรวม
  const candidateRows = (dataRowIndexes ?? rows.map((_, i) => i).slice(headerRowCount)).map(
    (i) => rows[i]
  );

  // ทดสอบทุกจุดแบ่งที่เป็นไปได้ เลือกจุดที่ยอดรวมตรงกับที่ชีตบอกมากที่สุด
  let best = { split: bodyEnd, hits: -1, tested: 0 };
  for (let split = bodyStart; split <= bodyEnd; split++) {
    let hits = 0;
    let tested = 0;
    for (const row of candidateRows) {
      if (!row) continue;
      const statedFlower = num(row[statedFlowerCol]);
      const statedNonFlower = num(row[statedNonFlowerCol]);
      if (!statedFlower && !statedNonFlower) continue; // แถวว่าง/แถวแม่แบบ

      const flower = sumRange(row, bodyStart, split);
      const nonFlower = sumRange(row, split, bodyEnd);
      tested++;
      const flowerOk = statedFlower === null || Math.abs(flower - statedFlower) <= TOLERANCE;
      const nonFlowerOk =
        statedNonFlower === null || Math.abs(nonFlower - statedNonFlower) <= TOLERANCE;
      if (flowerOk && nonFlowerOk) hits++;
    }
    if (hits > best.hits) best = { split, hits, tested };
  }

  const flowerRange = [];
  for (let c = bodyStart; c < best.split; c++) flowerRange.push(c);
  const nonFlowerRange = [];
  for (let c = best.split; c < bodyEnd; c++) nonFlowerRange.push(c);

  return {
    flowerCols: nameColumns(flowerRange, labels, 'flower'),
    nonFlowerCols: nameColumns(nonFlowerRange, labels, 'nonFlower'),
    statedFlowerCol,
    statedNonFlowerCol,
    split: best.split,
    hits: best.hits,
    tested: best.tested,
    confidence: best.tested > 0 ? best.hits / best.tested : null,
  };
}

/**
 * ตั้งชื่อคอลัมน์ในกลุ่ม — ใช้ป้ายจากหัวตารางก่อน ถ้าไม่มีก็เติมตามลำดับมาตรฐาน
 * @returns {Record<string, number|number[]>} ชื่อ → index (array ถ้ามีหลายคอลัมน์รวมกัน เช่น S1+S2)
 */
function nameColumns(indexes, labels, kind) {
  const fallback =
    kind === 'flower'
      ? FLOWER_ORDER_BY_COUNT[indexes.length]
      : NON_FLOWER_ORDER_BY_COUNT[indexes.length];

  const valid =
    kind === 'flower'
      ? new Set(['XXL', 'XL', 'L', 'M', 'S', 'S1', 'S2', 'XS'])
      : new Set(['shake', 'shake2', 'sugarleaf', 'kief', 'dokPan', 'dokRon', 'sesDok']);

  const names = indexes.map((c, i) => {
    const label = labels[c];
    if (label && valid.has(label)) return label;
    return fallback?.[i] ?? null;
  });

  // กันชื่อซ้ำ (เช่นหัวตารางเขียน XS สองช่อง) ให้ช่องหลังใช้ชื่อสำรองตามลำดับแทน
  const used = new Set();
  for (let i = 0; i < names.length; i++) {
    if (names[i] && used.has(names[i])) names[i] = fallback?.[i] ?? null;
    if (names[i]) used.add(names[i]);
  }

  const out = {};
  for (let i = 0; i < indexes.length; i++) {
    let name = names[i];
    if (!name) continue;
    // S1/S2 เป็นการแบ่งเกรด S สองระดับ — รวมเป็น S ตัวเดียวในโมเดลกลาง
    if (name === 'S1' || name === 'S2') name = 'S';
    if (out[name] === undefined) out[name] = indexes[i];
    else if (Array.isArray(out[name])) out[name].push(indexes[i]);
    else out[name] = [out[name], indexes[i]];
  }
  return out;
}

/** ดึงค่าจากคอลัมน์เดียวหรือหลายคอลัมน์รวมกัน */
export function pickValue(row, index) {
  if (index === undefined || index === null) return null;
  if (Array.isArray(index)) {
    const values = index.map((i) => num(row[i])).filter((v) => v !== null);
    return values.length ? sum(values) : null;
  }
  return num(row[index]);
}

/** แปลง map ชื่อ→index เป็น object ค่าจริงของแถวนั้น */
export function readGroup(row, cols) {
  const out = {};
  for (const [name, index] of Object.entries(cols)) out[name] = pickValue(row, index);
  return out;
}
