/**
 * parsers/dailyTrim.js — แบบฟอร์มน้ำหนักดอกทริมรายวัน
 *
 * หนึ่ง tab = หนึ่งครอป แต่ละแถวคือการทริมหนึ่งวัน
 *
 * โครงคอลัมน์ (ยืนยันจากข้อมูลจริง):
 *   0 วันที่ · 1 สายพันธุ์ · 2 XXL · 3 XL · 4 L · 5 M · 6 รวม(>M) · 7 %
 *   8 S(สะสม) · 9 S · 10 % · 11 XS · 12 % · 13 รวมน้ำหนักดอก
 *   14 Shake · 15 % · 16 Sugarleaf · 17 % · 18 เศษดอก · 19 % · 20 ดอกปั่น · 21 % · 22 รวมที่ไม่ใช่ดอก
 */
import { isEmptyRow } from '../csv.js';
import {
  num,
  parseSheetDate,
  makeRecord,
  canonicalStrain,
  canonicalCrop,
  findHeaderRow,
} from '../normalize.js';

const COL = {
  date: 0,
  strain: 1,
  XXL: 2,
  XL: 3,
  L: 4,
  M: 5,
  premiumTotal: 6,
  premiumPct: 7,
  S: 9,
  sPct: 10,
  XS: 11,
  xsPct: 12,
  flowerTotal: 13,
  shake: 14,
  shakePct: 15,
  sugarleaf: 16,
  sugarleafPct: 17,
  sesDok: 18,
  sesDokPct: 19,
  dokPan: 20,
  dokPanPct: 21,
  nonFlowerTotal: 22,
};

const TOTAL_RE = /^\s*(total|รวม|ผลรวม)/i;

export function parse({ tabs, sourceKey = 'dailyTrim' }) {
  const records = [];
  const tabSummaries = [];
  const warnings = [];

  for (const tab of tabs) {
    const rows = tab.rows || [];
    const cropFromTabName = canonicalCrop(String(tab.name).replace(/^\s*ครอ[ปบ]\s*/, ''));
    const headerIdx = findHeaderRow(rows, ['วันที่', 'XXL', 'สายพันธุ์'], 2);

    if (headerIdx === -1) {
      warnings.push({ tab: tab.name, message: 'ไม่พบแถวหัวตาราง' });
      tabSummaries.push({ gid: tab.gid, name: tab.name, crop: cropFromTabName, rowCount: 0, statedTotal: null });
      continue;
    }

    let statedTotalRow = null;
    let rowCount = 0;

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (isEmptyRow(row)) continue;

      const first = String(row[COL.date] ?? '').trim();

      // แถว Total ของ tab — เก็บไว้ให้ analysis เทียบกับผลรวมที่เราคำนวณเอง
      if (TOTAL_RE.test(first)) {
        statedTotalRow = {
          premiumTotal: num(row[COL.premiumTotal]),
          flowerTotal: num(row[COL.flowerTotal]),
          nonFlowerTotal: num(row[COL.nonFlowerTotal]),
          rowIndex: r,
        };
        continue;
      }

      const date = parseSheetDate(first);
      if (!date) continue; // แถวหมายเหตุ/แถวคั่น

      records.push(
        makeRecord({
          date,
          crop: cropFromTabName,
          strain: canonicalStrain(row[COL.strain]),
          sizes: {
            XXL: num(row[COL.XXL]),
            XL: num(row[COL.XL]),
            L: num(row[COL.L]),
            M: num(row[COL.M]),
            S: num(row[COL.S]),
            XS: num(row[COL.XS]),
          },
          nonFlower: {
            shake: num(row[COL.shake]),
            sugarleaf: num(row[COL.sugarleaf]),
            sesDok: num(row[COL.sesDok]),
            dokPan: num(row[COL.dokPan]),
          },
          source: sourceKey,
          tab: tab.name,
          rowIndex: r,
          raw: {
            dateText: first,
            statedPremiumTotal: num(row[COL.premiumTotal]),
            statedFlowerTotal: num(row[COL.flowerTotal]),
            statedNonFlowerTotal: num(row[COL.nonFlowerTotal]),
            statedPct: {
              premium: num(row[COL.premiumPct]),
              S: num(row[COL.sPct]),
              XS: num(row[COL.xsPct]),
              shake: num(row[COL.shakePct]),
              sugarleaf: num(row[COL.sugarleafPct]),
              sesDok: num(row[COL.sesDokPct]),
              dokPan: num(row[COL.dokPanPct]),
            },
          },
        })
      );
      rowCount++;
    }

    tabSummaries.push({
      gid: tab.gid,
      name: tab.name,
      crop: cropFromTabName,
      rowCount,
      statedTotal: statedTotalRow,
    });
  }

  return { rows: records, tabs: tabSummaries, warnings };
}
