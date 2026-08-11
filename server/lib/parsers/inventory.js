/**
 * parsers/inventory.js — แบบฟอร์มสินค้าคงเหลือ
 *
 * หนึ่ง tab = หนึ่งคลัง (Stock หัวหิน / Stock กรุงเทพ) เป็นภาพนิ่ง ณ วันที่อัปเดต
 *
 * โครงคอลัมน์ (ยืนยันจากข้อมูลจริงทั้งสอง tab):
 *   0 Strain · 1 XXL · 2 XL · 3 L · 4 M · 5 S · 6 XS
 *   7 Shake · 8 Shake2 · 9 Sugarleaf · 10 Kief · 11 ดอกปั่น · 12 ดอกร่อน · 13 เศษดอก
 *   14 รวมน้ำหนักดอก · 15 รวมน้ำหนักที่ไม่ใช่ดอก
 *
 * tab "Stock กรุงเทพ" หัวคอลัมน์ S/XS/Shake/Sugarleaf หายเพราะ merge
 * จึง map ตามตำแหน่งโดยอ้างโครงมาตรฐานของ "Stock หัวหิน" แทนการอ่านป้ายชื่อ
 */
import { isEmptyRow } from '../csv.js';
import { num, makeRecord, canonicalStrain } from '../normalize.js';

const COL = {
  strain: 0,
  XXL: 1,
  XL: 2,
  L: 3,
  M: 4,
  S: 5,
  XS: 6,
  shake: 7,
  shake2: 8,
  sugarleaf: 9,
  kief: 10,
  dokPan: 11,
  dokRon: 12,
  sesDok: 13,
  statedFlower: 14,
  statedNonFlower: 15,
};

const TOTAL_RE = /^\s*(total|รวม|ผลรวม)/i;

/**
 * แท็บไหนคือ "ภาพสต็อกคงเหลือ"
 *
 * ยอมให้มีเลขลำดับเอกสารคั่นหน้าได้ (`9.58 Stock หัวหิน`) เพราะบริษัทใช้ระบบเลข
 * นำหน้าชื่อแท็บอยู่แล้ว — ชีต Log Stock ก็ตั้งชื่อแบบ `1.Rockwool` มาตลอด
 * ของเดิมบังคับให้ขึ้นต้นด้วย "stock" เป๊ะ ๆ พอมีคนเติมเลขตามธรรมเนียมเมื่อ ส.ค. 69
 * สต็อกทั้งสองคลังจึงถูกข้ามหมด เหลือ 0 แถว โดยที่หน้าเว็บยังโชว์ 0 kg เฉย ๆ
 *
 * **ห้ามผ่อนเป็น /stock/i เด็ดขาด** เพราะแท็บ "ส่งของให้ ลค.  Stock กรุงเทพ"
 * ก็มีคำว่า Stock อยู่ แต่เป็นยอดที่ส่งออกไปให้ลูกค้าแล้ว ไม่ใช่ของที่เหลืออยู่
 * ถ้ารับเข้ามานับด้วยจะทำให้สต็อกเกินจริง — อนุญาตเฉพาะเลข/วงเล็บ/ขีด นำหน้าเท่านั้น
 */
export const STOCK_TAB_RE = /^[\d.\s()[\]:-]*stock\b/i;

/** หาชื่อคลังและวันที่อัปเดตจากสองแถวบนสุด */
function readLocationHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const first = String(rows[r][0] ?? '').trim();
    const second = String(rows[r][1] ?? '').trim();
    if (!first || /สถานที่|strain/i.test(first)) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(second)) {
      return { location: first, updatedText: second };
    }
  }
  return { location: null, updatedText: null };
}

export function parse({ tabs, sourceKey = 'inventory' }) {
  const records = [];
  const tabSummaries = [];
  const warnings = [];

  for (const tab of tabs) {
    const rows = tab.rows || [];

    // tab ที่ไม่ใช่ภาพสต็อก (เช่น "ส่งของให้ ลค.") ใช้คนละความหมาย — ข้ามแต่บันทึกไว้
    if (!STOCK_TAB_RE.test(String(tab.name).trim())) {
      tabSummaries.push({ gid: tab.gid, name: tab.name, skipped: 'not-a-stock-tab', rowCount: 0 });
      continue;
    }

    /* ชื่อคลังอ่านจากเนื้อในชีตเป็นหลัก (แถวที่ 2) ซึ่งเชื่อถือได้กว่าชื่อแท็บ
     * ที่คนเปลี่ยนเมื่อไหร่ก็ได้ — ชื่อแท็บใช้เป็นทางสำรองเท่านั้น
     * และต้องตัดเลขลำดับหน้าออกด้วย ไม่งั้นจะได้คลังชื่อ "9.58 หัวหิน" */
    const { location, updatedText } = readLocationHeader(rows);
    const locationName =
      location || String(tab.name).replace(/^[\d.\s()[\]:-]*stock\s*/i, '').trim();

    let statedTotalRow = null;
    let rowCount = 0;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (isEmptyRow(row)) continue;

      const strainText = String(row[COL.strain] ?? '').trim();
      if (!strainText) continue;
      if (/^strain$/i.test(strainText) || /สถานที่/.test(strainText)) continue;
      if (strainText === locationName) continue;

      if (TOTAL_RE.test(strainText)) {
        statedTotalRow = {
          flowerTotal: num(row[COL.statedFlower]),
          nonFlowerTotal: num(row[COL.statedNonFlower]),
          rowIndex: r,
        };
        continue;
      }

      const sizes = {
        XXL: num(row[COL.XXL]),
        XL: num(row[COL.XL]),
        L: num(row[COL.L]),
        M: num(row[COL.M]),
        S: num(row[COL.S]),
        XS: num(row[COL.XS]),
      };
      const nonFlower = {
        shake: num(row[COL.shake]),
        shake2: num(row[COL.shake2]),
        sugarleaf: num(row[COL.sugarleaf]),
        kief: num(row[COL.kief]),
        dokPan: num(row[COL.dokPan]),
        dokRon: num(row[COL.dokRon]),
        sesDok: num(row[COL.sesDok]),
      };

      records.push(
        makeRecord({
          date: null,
          crop: null,
          strain: canonicalStrain(strainText),
          sizes,
          nonFlower,
          source: sourceKey,
          tab: tab.name,
          rowIndex: r,
          raw: {
            strainText,
            statedFlowerTotal: num(row[COL.statedFlower]),
            statedNonFlowerTotal: num(row[COL.statedNonFlower]),
          },
          extra: { location: locationName, updatedText },
        })
      );
      rowCount++;
    }

    if (rowCount === 0) warnings.push({ tab: tab.name, message: 'ไม่พบรายการสต็อก' });

    tabSummaries.push({
      gid: tab.gid,
      name: tab.name,
      location: locationName,
      updatedText,
      rowCount,
      statedTotal: statedTotalRow,
    });
  }

  return { rows: records, tabs: tabSummaries, warnings };
}
