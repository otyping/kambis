/**
 * parsers/perCrop.js — แบบฟอร์มน้ำหนักดอกทริมต่อครอป
 *
 * ใช้เฉพาะ tab "SUMMARY SHEET" เพราะเป็นตารางเดียวที่มีครบทุกครอป
 * พร้อมรอบปลูก (Clone/Veg/Flower/Harvest/Dry) จำนวนต้น และน้ำหนักต่อต้น
 *
 * โครงคอลัมน์ (ยืนยันจากข้อมูลจริง):
 *   0 Note · 1 Quarter · 2 Crop · 3 Clone 3WK · 4 Veg 3WK · 5 Flower 10WK · 6 Harvest · 7 Dry Ready
 *   10 XXL · 11 XL · 12 L · 13 M · 14 >M Total · 15 >M %
 *   17 S · 18 S % · 19 XS · 20 XS % · 21 Total
 *   23 จำนวนต้นทำดอก · 24 ยอดน้ำหนักรวม · 25 น้ำหนักต่อต้น
 */
import { isEmptyRow } from '../csv.js';
import { num, parseSheetDate, makeRecord, canonicalCrop, findHeaderRow } from '../normalize.js';

const COL = {
  note: 0,
  quarter: 1,
  crop: 2,
  clone: 3,
  veg: 4,
  flower: 5,
  harvest: 6,
  dryReady: 7,
  notes: 9,
  XXL: 10,
  XL: 11,
  L: 12,
  M: 13,
  premiumTotal: 14,
  premiumPct: 15,
  S: 17,
  sPct: 18,
  XS: 19,
  xsPct: 20,
  total: 21,
  plants: 23,
  statedGrandTotal: 24,
  gramsPerPlant: 25,
};

const SUMMARY_TAB = /summary\s*sheet/i;

export function parse({ tabs, sourceKey = 'perCrop' }) {
  const records = [];
  const tabSummaries = [];
  const warnings = [];

  const summaryTab = tabs.find((t) => SUMMARY_TAB.test(t.name));
  if (!summaryTab) {
    warnings.push({ tab: null, message: 'ไม่พบ tab "SUMMARY SHEET"' });
    return { rows: [], tabs: [], warnings };
  }

  const rows = summaryTab.rows || [];
  const headerIdx = findHeaderRow(rows, ['Crop', 'Quarter', 'Harvest'], 2);
  if (headerIdx === -1) {
    warnings.push({ tab: summaryTab.name, message: 'ไม่พบแถวหัวตาราง' });
    return { rows: [], tabs: [], warnings };
  }

  let currentQuarter = null;
  let rowCount = 0;

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (isEmptyRow(row)) continue;

    // ไตรมาสเขียนแค่แถวแรกของกลุ่ม (merged cell) → carry ต่อ
    const q = String(row[COL.quarter] ?? '').trim();
    if (q) currentQuarter = q;

    const cropText = String(row[COL.crop] ?? '').trim();
    if (!cropText || cropText === '-') continue;

    const cycle = {
      clone: parseSheetDate(row[COL.clone]),
      veg: parseSheetDate(row[COL.veg]),
      flower: parseSheetDate(row[COL.flower]),
      harvest: parseSheetDate(row[COL.harvest]),
      dryReady: parseSheetDate(row[COL.dryReady]),
    };

    const sizes = {
      XXL: num(row[COL.XXL]),
      XL: num(row[COL.XL]),
      L: num(row[COL.L]),
      M: num(row[COL.M]),
      S: num(row[COL.S]),
      XS: num(row[COL.XS]),
    };

    const hasYield = Object.values(sizes).some((v) => v !== null);
    const plants = num(row[COL.plants]);

    records.push(
      makeRecord({
        // ใช้วันเก็บเกี่ยวเป็นวันอ้างอิงของครอป ถ้าไม่มีก็ใช้วันดอกพร้อม
        date: cycle.harvest || cycle.dryReady || cycle.flower || null,
        crop: canonicalCrop(cropText),
        strain: null,
        sizes,
        source: sourceKey,
        tab: summaryTab.name,
        rowIndex: r,
        raw: {
          cropText,
          statedFlowerTotal: num(row[COL.total]),
          statedGrandTotal: num(row[COL.statedGrandTotal]),
          statedGramsPerPlant: num(row[COL.gramsPerPlant]),
          statedPremiumTotal: num(row[COL.premiumTotal]),
          statedPct: {
            premium: num(row[COL.premiumPct]),
            S: num(row[COL.sPct]),
            XS: num(row[COL.xsPct]),
          },
          cycleText: {
            clone: String(row[COL.clone] ?? '').trim(),
            veg: String(row[COL.veg] ?? '').trim(),
            flower: String(row[COL.flower] ?? '').trim(),
            harvest: String(row[COL.harvest] ?? '').trim(),
            dryReady: String(row[COL.dryReady] ?? '').trim(),
          },
          note: String(row[COL.note] ?? '').trim() || null,
          notes: String(row[COL.notes] ?? '').trim() || null,
        },
        extra: {
          quarter: currentQuarter,
          cycle,
          plants,
          // คำนวณเองจาก sizes ที่รวมใหม่ ไม่ใช้ค่าที่ชีตบอก
          hasYield,
          status: hasYield ? 'harvested' : 'planned',
        },
      })
    );
    rowCount++;
  }

  // เติม gramsPerPlant จากค่าที่คำนวณเอง
  for (const rec of records) {
    rec.gramsPerPlant =
      rec.plants && rec.plants > 0 && rec.flowerTotal !== null
        ? rec.flowerTotal / rec.plants
        : null;
  }

  tabSummaries.push({
    gid: summaryTab.gid,
    name: summaryTab.name,
    rowCount,
    statedTotal: null,
  });

  // tab รายครอปมีอยู่แต่เป็นรายละเอียดซ้ำกับ dailyTrim — บันทึกไว้เฉย ๆ
  for (const t of tabs) {
    if (t === summaryTab) continue;
    tabSummaries.push({
      gid: t.gid,
      name: t.name,
      rowCount: 0,
      detailOnly: true,
      statedTotal: null,
    });
  }

  return { rows: records, tabs: tabSummaries, warnings };
}
