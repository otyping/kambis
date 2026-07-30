/**
 * parsers/transfer.js — ตัวแปลงร่วมของ "ขนย้ายออกจากฟาร์ม" และ "รับดอกถึงกรุงเทพ"
 *
 * ทั้งสองรายงานใช้ฟอร์มเดียวกัน หนึ่ง tab = การขนหนึ่งเที่ยว (ชื่อ tab คือวันที่)
 *
 * ฟอร์มนี้ถูกคัดลอกและแก้ต่อกันมาหลายรุ่น คอลัมน์จึงไม่อยู่ที่เดิมทุก tab
 * (บางรุ่นลบ Shake2 ออก บางรุ่นเพิ่ม S1/S2) จึงใช้ detectLayout() หาโครงคอลัมน์
 * ของแต่ละ tab เอง โดยยืนยันกับยอดรวมที่ชีตคำนวณไว้ ดูรายละเอียดใน layout.js
 */
import { isEmptyRow } from '../csv.js';
import { num, makeRecord, canonicalStrain, canonicalCrop, parseSheetDate } from '../normalize.js';
import { detectLayout, readGroup } from './layout.js';

const CROP_COL = 0;
const STRAIN_COL = 1;
const BODY_START = 2;
const HEADER_ROWS = 5;

const TOTAL_RE = /^\s*(total|รวม|ผลรวม)/i;

/** ดึงวันที่จากชื่อ tab และจากข้อความในหัวฟอร์ม (สองที่นี้ไม่ตรงกันเสมอไป) */
function extractDates(tab, rows) {
  const fromTabName = parseSheetDate(
    String(tab.name).replace(/\s*(ของ.*|for SGS|Summary.*)$/i, '').trim()
  );

  let fromHeader = null;
  let headerText = '';
  for (let r = 0; r < Math.min(rows.length, 4); r++) {
    for (const cell of rows[r]) {
      const m = String(cell ?? '').match(
        /วันที่(?:ขนของ|รับของ)\s*[:：]?\s*_*\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4})/
      );
      if (m) {
        headerText = m[1].replace(/\s/g, '');
        fromHeader = parseSheetDate(headerText);
        break;
      }
    }
    if (fromHeader) break;
  }

  return { fromTabName, fromHeader, headerText };
}

/** เลือกเฉพาะแถวที่เป็นรายการของจริง (ไม่ใช่หัวตาราง/แถวรวม/แถวว่าง) */
function findBodyRows(rows) {
  const body = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (isEmptyRow(row)) continue;
    const crop = String(row[CROP_COL] ?? '').trim();
    const strain = String(row[STRAIN_COL] ?? '').trim();
    if (TOTAL_RE.test(crop)) continue;
    if (/^ครอป/.test(crop) && /สายพันธุ์|แบบฟอร์ม/.test(strain)) continue;
    if (!crop && !strain) continue;
    if (row.length <= BODY_START) continue;
    body.push(r);
  }
  return body;
}

export function parse({ tabs, sourceKey }) {
  const records = [];
  const tabSummaries = [];
  const warnings = [];

  for (const tab of tabs) {
    const rows = tab.rows || [];
    const name = String(tab.name).trim();

    // ข้าม tab แม่แบบเปล่าและ tab สรุปที่ใช้คนละโครง
    if (/^ต้นฉบับ|^สำเนา|^แพรเช็ค/.test(name)) {
      tabSummaries.push({ gid: tab.gid, name: tab.name, skipped: 'template', rowCount: 0 });
      continue;
    }
    if (/summary/i.test(name)) {
      tabSummaries.push({ gid: tab.gid, name: tab.name, skipped: 'summary', rowCount: 0 });
      continue;
    }

    const { fromTabName, fromHeader, headerText } = extractDates(tab, rows);
    const shipDate = fromHeader || fromTabName;
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

    let rowCount = 0;
    for (const r of bodyRowIndexes) {
      const row = rows[r];
      const sizes = readGroup(row, layout.flowerCols);
      const nonFlower = readGroup(row, layout.nonFlowerCols);

      const hasValue =
        Object.values(sizes).some((v) => v !== null) ||
        Object.values(nonFlower).some((v) => v !== null);
      if (!hasValue) continue;

      records.push(
        makeRecord({
          date: shipDate,
          crop: canonicalCrop(row[CROP_COL]),
          strain: canonicalStrain(row[STRAIN_COL]),
          sizes,
          nonFlower,
          source: sourceKey,
          tab: tab.name,
          rowIndex: r,
          raw: {
            cropText: String(row[CROP_COL] ?? '').trim(),
            strainText: String(row[STRAIN_COL] ?? '').trim(),
            statedFlowerTotal: num(row[layout.statedFlowerCol]),
            statedNonFlowerTotal: num(row[layout.statedNonFlowerCol]),
          },
        })
      );
      rowCount++;
    }

    tabSummaries.push({
      gid: tab.gid,
      name: tab.name,
      date: shipDate,
      dateFromTabName: fromTabName,
      dateFromHeader: fromHeader,
      headerDateText: headerText,
      layout: {
        flower: Object.keys(layout.flowerCols),
        nonFlower: Object.keys(layout.nonFlowerCols),
        totalsAt: [layout.statedFlowerCol, layout.statedNonFlowerCol],
      },
      layoutConfidence: layout.confidence,
      rowCount,
      statedTotal: null,
    });
  }

  return { rows: records, tabs: tabSummaries, warnings };
}
