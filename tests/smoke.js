/**
 * tests/smoke.js — ตรวจว่า parser ยังอ่านข้อมูลได้ตรงกับค่าที่ยืนยันแล้ว
 *
 *   node --test tests/
 *
 * ใช้ข้อมูลจาก cache (data/cache/snapshot.json) ถ้ามี เพื่อให้รันได้แม้ออฟไลน์
 * ถ้ายังไม่มี cache จะดึงสดจาก Google Sheets หนึ่งครั้ง
 *
 * ทุกครั้งที่แก้ parser ต้องเพิ่ม assertion ที่นี่ (ดู .claude/agents/data-analyst.md)
 */
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadAll, loadFromSnapshot } from '../server/lib/loader.js';
import { canonicalCrop, canonicalStrain, parseSheetDate, num } from '../server/lib/normalize.js';
import { parseCsv } from '../server/lib/csv.js';

let payload;

before(async () => {
  payload = await loadFromSnapshot();
  if (!payload) payload = await loadAll();
}, { timeout: 300000 });

// ─────────────────────────────────────────────────────────────
describe('normalize', () => {
  test('num() ถือว่า "-" และค่าว่างเป็น null ไม่ใช่ 0', () => {
    assert.equal(num('-'), null);
    assert.equal(num(''), null);
    assert.equal(num('   '), null);
    assert.equal(num('1,695.00'), 1695);
    assert.equal(num('0.00'), 0);
  });

  test('parseSheetDate() รองรับทุกรูปแบบที่พบในชีต', () => {
    assert.equal(parseSheetDate('10/03/2026'), '2026-03-10');
    assert.equal(parseSheetDate('21/06/26'), '2026-06-21');
    assert.equal(parseSheetDate('4 Feb 26'), '2026-02-04');
    assert.equal(parseSheetDate('20-May-26'), '2026-05-20');
    assert.equal(parseSheetDate('Mar-26'), '2026-03-01');
    assert.equal(parseSheetDate('-'), null);
  });

  test('canonicalCrop() ยุบรหัสครอปที่สะกดต่างกันให้เหลือรูปเดียว', () => {
    assert.equal(canonicalCrop('G4/2 -7 NOV 25'), 'G4/2-07NOV25');
    assert.equal(canonicalCrop('G4/2-7NOV25'), 'G4/2-07NOV25');
    assert.equal(canonicalCrop('G 4/2 - 7 Nov 25'), 'G4/2-07NOV25');
    // ตัวเลขหลัง / ที่ตามด้วยชื่อเดือนทันที คือวันที่ ไม่ใช่เลขห้อง
    assert.equal(canonicalCrop('G1/06JAN25'), 'G1-06JAN25');
    assert.equal(canonicalCrop('G2/1ARP25'), 'G2-01ARP25');
    // รหัสรวมสองห้องต้องไม่ถูกตัดทิ้ง
    assert.equal(canonicalCrop('G1/1 & G1/3 - 17NOV25'), 'G1/1&G1/3-17NOV25');
  });

  test('canonicalStrain() ยุบชื่อสายพันธุ์ที่สะกดต่างกัน', () => {
    assert.equal(canonicalStrain("Cookie 's Gelato"), "Cookie's Gelato");
    assert.equal(canonicalStrain("Cookie's Gelato"), "Cookie's Gelato");
    assert.equal(canonicalStrain('Feisian Dew'), 'Frisian Dew');
    assert.equal(canonicalStrain('Sho gun ( SB )'), 'Shogun');
  });
});

describe('csv', () => {
  test('อ่านเซลล์ที่มี comma, quote ซ้อน และขึ้นบรรทัดใหม่ในเซลล์', () => {
    const rows = parseCsv('a,"1,695.00","x""y"\n"multi\nline",b,c');
    assert.deepEqual(rows[0], ['a', '1,695.00', 'x"y']);
    assert.deepEqual(rows[1], ['multi\nline', 'b', 'c']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('แหล่งข้อมูลทั้ง 6 รายงาน', () => {
  test('โหลดครบทุกรายงานและมีแถวข้อมูล', () => {
    for (const key of ['dailyTrim', 'perCrop', 'outbound', 'inbound', 'sales', 'inventory']) {
      const source = payload.sources[key];
      assert.ok(source, `ไม่พบรายงาน ${key}`);
      assert.notEqual(source.status, 'error', `รายงาน ${key} โหลดไม่สำเร็จ: ${source.error}`);
      assert.ok(source.rows.length > 0, `รายงาน ${key} ไม่มีแถวข้อมูล`);
    }
  });

  test('ทุก record มีโครงมาตรฐานครบ', () => {
    for (const source of Object.values(payload.sources)) {
      for (const rec of source.rows.slice(0, 20)) {
        assert.ok('sizes' in rec && 'nonFlower' in rec, 'record ขาด sizes/nonFlower');
        assert.ok('flowerTotal' in rec && 'raw' in rec, 'record ขาด flowerTotal/raw');
        assert.equal(typeof rec.source, 'string');
      }
    }
  });
});

describe('ค่าที่ยืนยันแล้วจากชีตจริง', () => {
  test('inventory / Stock หัวหิน รวมดอก 146,295 g และไม่ใช่ดอก 27,800 g', () => {
    const rows = payload.sources.inventory.rows.filter((r) => /หัวหิน/.test(r.location || ''));
    assert.ok(rows.length > 0, 'ไม่พบข้อมูลคลังหัวหิน');
    const flower = rows.reduce((t, r) => t + (r.flowerTotal || 0), 0);
    const nonFlower = rows.reduce((t, r) => t + (r.nonFlowerTotal || 0), 0);
    assert.equal(flower, 146295);
    assert.equal(nonFlower, 27800);
  });

  test('dailyTrim / ครอป G4/2-07NOV25 รวมดอก 39,280 g และเกรด >M 10,955 g', () => {
    const rows = payload.sources.dailyTrim.rows.filter((r) => r.crop === 'G4/2-07NOV25');
    assert.equal(rows.length, 5, 'จำนวนวันที่ทริมไม่ตรง');
    const flower = rows.reduce((t, r) => t + (r.flowerTotal || 0), 0);
    const premium = rows.reduce((t, r) => t + (r.premiumTotal || 0), 0);
    assert.equal(flower, 39280);
    assert.equal(premium, 10955);
  });

  test('perCrop / ครอป G1-06JAN25 รวม 69,290 g จาก 1,050 ต้น', () => {
    const rec = payload.sources.perCrop.rows.find((r) => r.crop === 'G1-06JAN25');
    assert.ok(rec, 'ไม่พบครอป G1-06JAN25');
    assert.equal(rec.flowerTotal, 69290);
    assert.equal(rec.plants, 1050);
    assert.ok(Math.abs(rec.gramsPerPlant - 65.99) < 0.01, 'น้ำหนักต่อต้นไม่ตรง');
  });

  test('ผลรวมที่คำนวณเองตรงกับที่ชีตระบุเกิน 95% ของแถว (ฟอร์มขนย้าย)', () => {
    for (const key of ['outbound', 'inbound']) {
      const rows = payload.sources[key].rows.filter(
        (r) => r.raw.statedFlowerTotal !== null && r.raw.statedFlowerTotal !== undefined
      );
      const matched = rows.filter((r) => Math.abs((r.flowerTotal || 0) - r.raw.statedFlowerTotal) <= 0.5);
      const ratio = matched.length / rows.length;
      assert.ok(
        ratio > 0.95,
        `${key}: ผลรวมตรงเพียง ${(ratio * 100).toFixed(1)}% (${matched.length}/${rows.length}) — โครงคอลัมน์อาจเพี้ยน`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('Data Analysis engine', () => {
  test('รันแล้วได้ผลลัพธ์ครบรูปแบบ', () => {
    const a = payload.analysis;
    assert.ok(typeof a.score === 'number' && a.score >= 0 && a.score <= 100);
    assert.ok(Array.isArray(a.findings));
    assert.ok(a.counts && 'critical' in a.counts && 'warning' in a.counts && 'info' in a.counts);
    assert.ok(a.ranAt, 'ไม่มีเวลาที่รันการวิเคราะห์');
  });

  test('ทุก finding มีข้อความครบสองภาษาและ severity ที่ถูกต้อง', () => {
    for (const f of payload.analysis.findings) {
      assert.ok(['critical', 'warning', 'info'].includes(f.severity), `severity ผิด: ${f.severity}`);
      assert.ok(f.messageTh && f.messageTh.length > 0, `finding ${f.id} ไม่มีข้อความไทย`);
      assert.ok(f.messageEn && f.messageEn.length > 0, `finding ${f.id} ไม่มีข้อความอังกฤษ`);
      assert.ok(f.id, 'finding ไม่มี id');
    }
  });

  const has = (id, pred = () => true) => payload.analysis.findings.some((f) => f.id === id && pred(f));

  test('จับความผิดพลาดที่รู้อยู่แล้วในชีตต้นทางได้ครบ', () => {
    // 1. ครอป G4/14FEB25 ยอดน้ำหนักรวมต่างจาก Total 10,000 g
    assert.ok(
      has('arith.grandTotal', (f) => Math.abs(f.delta + 10000) < 1),
      'ไม่พบความต่าง 10,000 g ของครอป G4-14FEB25'
    );

    // 2. คอลัมน์ % ที่เกิน 100 ในชีตทริมรายวัน
    assert.ok(
      has('range.percent', (f) => f.source === 'dailyTrim' && f.actual > 100),
      'ไม่พบเปอร์เซ็นต์ที่เกิน 100 ในชีตทริมรายวัน'
    );

    // 3. หัวตารางเขียนหน่วยเป็น kg แต่ค่าเป็นกรัม
    assert.ok(has('units.mismatch'), 'ไม่พบความไม่ตรงของหน่วย kg/g');

    // 4. วันที่ในอนาคตไกลเกินจริง (พิมพ์ปีผิดเป็น 28)
    assert.ok(has('date.tooFarFuture'), 'ไม่พบวันที่ที่พิมพ์ปีผิด');

    // 5. ชื่อ tab ไม่ตรงกับวันที่ในฟอร์ม
    assert.ok(has('date.tabHeaderMismatch'), 'ไม่พบความไม่ตรงของวันที่ tab กับในฟอร์ม');

    // 6. แถวที่มีน้ำหนักแต่ช่องผลรวมว่าง
    assert.ok(
      has('complete.missingTotal', (f) => f.source === 'sales'),
      'ไม่พบแถวขายที่ผลรวมถูกเว้นว่าง'
    );

    // 7. ยอดขนออกจากฟาร์มไม่ตรงกับยอดรับที่กรุงเทพ
    assert.ok(has('cross.shipmentMismatch'), 'ไม่พบความไม่ตรงระหว่างยอดขนออกกับยอดรับเข้า');
  });

  test('ไม่มี finding เรื่องผลรวมผิดจากฟอร์มขนย้ายและฟอร์มขาย (แปลว่า parser อ่านคอลัมน์ถูก)', () => {
    const bogus = payload.analysis.findings.filter(
      (f) => f.id === 'arith.flowerTotal' && ['outbound', 'inbound', 'sales'].includes(f.source)
    );
    assert.equal(
      bogus.length,
      0,
      `พบ ${bogus.length} แถวที่ผลรวมไม่ตรง — โครงคอลัมน์อาจอ่านผิด: ${bogus[0]?.messageTh ?? ''}`
    );
  });
});

describe('KPI', () => {
  test('มีตัวเลขหลักครบ 6 ตัวและเป็นค่าที่ใช้ได้', () => {
    assert.equal(payload.kpi.headline.length, 6);
    for (const h of payload.kpi.headline) {
      assert.ok(h.labelTh && h.labelEn, `KPI ${h.key} ขาดป้ายชื่อสองภาษา`);
      assert.ok(h.value === null || Number.isFinite(h.value), `KPI ${h.key} ค่าไม่ถูกต้อง`);
    }
  });

  test('สัดส่วนเกรด >M อยู่ในช่วง 0–100', () => {
    const premium = payload.kpi.headline.find((h) => h.key === 'premiumPct');
    assert.ok(premium.value > 0 && premium.value <= 100, `สัดส่วนเกรด >M = ${premium.value}`);
  });

  test('ยอดรวมของแต่ละรายงานตรงกับผลรวมของ record', () => {
    const sumFlower = (rows) => rows.reduce((t, r) => t + (r.flowerTotal || 0), 0);
    assert.equal(payload.kpi.sales.totalFlower, sumFlower(payload.sources.sales.rows));
    assert.equal(payload.kpi.inventory.totalFlower, sumFlower(payload.sources.inventory.rows));
    assert.equal(payload.kpi.outbound.totalFlower, sumFlower(payload.sources.outbound.rows));
  });
});
