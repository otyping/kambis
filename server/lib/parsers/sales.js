/**
 * parsers/sales.js — แบบฟอร์มขายดอก
 *
 * หนึ่ง tab = หนึ่งเดือน (Feb-March, April, …)
 *   0 วันที่ขาย · 1 ลูกค้า · 2 ครอป · 3 สายพันธุ์ · 4.. บล็อกน้ำหนัก · ท้ายสุด Total Flower / Total Non-Flower
 *
 * บล็อกน้ำหนักไม่คงที่ทุกเดือน (บาง tab มีทั้ง S1 และ S2 บาง tab มีแค่ S2)
 * จึงใช้ detectLayout() หาโครงคอลัมน์ของแต่ละ tab เอง
 *
 * วันที่และลูกค้าเขียนแค่แถวแรกของกลุ่ม (merged cell) จึงต้อง forward-fill
 * แต่ห้าม fill ข้ามแถวหัวเดือน (เช่น "Mar-26") ที่ใช้คั่นบล็อก
 */
import { isEmptyRow } from '../csv.js';
import { num, makeRecord, canonicalStrain, canonicalCrop, parseSheetDate } from '../normalize.js';
import { detectLayout, readGroup } from './layout.js';

const COL = { date: 0, customer: 1, crop: 2, strain: 3 };
const BODY_START = 4;
const HEADER_ROWS = 3;

/** แถวหัวเดือน เช่น "Feb-26", "Mar-26" — ไม่ใช่รายการขาย */
const MONTH_HEADER_RE = /^[A-Za-z]{3,}-\d{2,4}$/;

/** แถวที่อาจเป็นรายการขาย (มีครอปหรือสายพันธุ์ หรือมีวันที่) */
function findBodyRows(rows) {
  const body = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (isEmptyRow(row)) continue;
    const dateText = String(row[COL.date] ?? '').trim();
    const customerText = String(row[COL.customer] ?? '').trim();
    if (MONTH_HEADER_RE.test(dateText)) continue;
    if (/วันที่ขาย/.test(dateText) || /^ลูกค้า/.test(customerText)) continue;
    if (row.length <= BODY_START) continue;
    body.push(r);
  }
  return body;
}

export function parse({ tabs, sourceKey = 'sales' }) {
  const records = [];
  const tabSummaries = [];
  const warnings = [];

  for (const tab of tabs) {
    const rows = tab.rows || [];
    const bodyRowIndexes = findBodyRows(rows);

    const layout = detectLayout(rows, {
      bodyStart: BODY_START,
      headerRowCount: HEADER_ROWS,
      dataRowIndexes: bodyRowIndexes,
    });

    if (layout.tested > 0 && layout.confidence < 0.6) {
      warnings.push({
        tab: tab.name,
        message: `โครงคอลัมน์ตรงกับยอดรวมเพียง ${Math.round(layout.confidence * 100)}% (${layout.hits}/${layout.tested} แถว)`,
      });
    }

    let carryDate = null;
    let carryCustomer = null;
    let rowCount = 0;
    const bodySet = new Set(bodyRowIndexes);

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (isEmptyRow(row)) continue;

      const dateText = String(row[COL.date] ?? '').trim();
      const customerText = String(row[COL.customer] ?? '').trim();

      // แถวหัวเดือน → รีเซ็ตการ carry ไม่ให้ลูกค้าเดือนก่อนหลุดมาเดือนใหม่
      if (MONTH_HEADER_RE.test(dateText)) {
        carryDate = null;
        carryCustomer = null;
        continue;
      }
      if (!bodySet.has(r)) continue;

      if (dateText) {
        const d = parseSheetDate(dateText);
        if (d) {
          carryDate = d;
          carryCustomer = null; // วันใหม่ → ลูกค้าต้องระบุใหม่
        }
      }
      if (customerText) carryCustomer = customerText;

      const sizes = readGroup(row, layout.flowerCols);
      const nonFlower = readGroup(row, layout.nonFlowerCols);

      const hasValue =
        Object.values(sizes).some((v) => v !== null) ||
        Object.values(nonFlower).some((v) => v !== null);
      if (!hasValue) continue;

      records.push(
        makeRecord({
          date: carryDate,
          crop: canonicalCrop(row[COL.crop]),
          strain: canonicalStrain(row[COL.strain]),
          sizes,
          nonFlower,
          source: sourceKey,
          tab: tab.name,
          rowIndex: r,
          raw: {
            dateText,
            cropText: String(row[COL.crop] ?? '').trim(),
            strainText: String(row[COL.strain] ?? '').trim(),
            statedFlowerTotal: num(row[layout.statedFlowerCol]),
            statedNonFlowerTotal: num(row[layout.statedNonFlowerCol]),
            customerFilled: !customerText && !!carryCustomer,
            dateFilled: !dateText && !!carryDate,
          },
          extra: {
            customer: carryCustomer || null,
            month: tab.name,
          },
        })
      );
      rowCount++;
    }

    if (rowCount === 0) warnings.push({ tab: tab.name, message: 'ไม่พบรายการขายใน tab นี้' });

    tabSummaries.push({
      gid: tab.gid,
      name: tab.name,
      rowCount,
      layout: {
        flower: Object.keys(layout.flowerCols),
        nonFlower: Object.keys(layout.nonFlowerCols),
        totalsAt: [layout.statedFlowerCol, layout.statedNonFlowerCol],
      },
      layoutConfidence: layout.confidence,
      statedTotal: null,
    });
  }

  return { rows: records, tabs: tabSummaries, warnings };
}
