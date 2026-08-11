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
import {
  canonicalCrop,
  canonicalStrain,
  parseSheetDate,
  num,
  periodOrder,
  comparePeriod,
} from '../server/lib/normalize.js';
import { analyze, verifyPresentation } from '../server/lib/analysis.js';
import { STOCK_TAB_RE } from '../server/lib/parsers/inventory.js';
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
  /* ชีตคงเหลือเป็น "ภาพนิ่ง ณ วันที่อัปเดต" ที่ถูกเขียนทับทุกครั้งที่นับสต็อกใหม่
   * ตรึงตัวเลขไว้ตรง ๆ จึงพังทุกครั้งที่มีคนนับสต็อก ทั้งที่โค้ดไม่ได้ผิดอะไร
   * (เคยตรึงไว้ 146,295 g แล้วชีตขยับเป็น 157,015 g)
   *
   * สิ่งที่ต้องกันจริง ๆ คือ "โครงคอลัมน์เพี้ยนแล้วอ่านผิดช่อง" ซึ่งตรวจได้ด้วย
   * กฎข้อ 1 ของโปรเจกต์: sum เองจากคอลัมน์ขนาด แล้วเทียบกับยอดที่ชีตบอก
   * ความสัมพันธ์นี้เป็นจริงเสมอไม่ว่าตัวเลขจะเปลี่ยนไปแค่ไหน
   */
  test('inventory / ยอดที่คำนวณเองตรงกับแถว Total ของชีตทุกคลัง', () => {
    const tabs = (payload.sources.inventory.tabs || []).filter((t) => t.statedTotal);
    assert.ok(tabs.length >= 2, 'ควรมีอย่างน้อยสองคลัง (หัวหิน + กรุงเทพ)');

    for (const tab of tabs) {
      const rows = payload.sources.inventory.rows.filter((r) => r.tab === tab.name);
      assert.ok(rows.length > 0, `${tab.name}: ไม่มีแถวข้อมูล`);

      const flower = rows.reduce((t, r) => t + (r.flowerTotal || 0), 0);
      const nonFlower = rows.reduce((t, r) => t + (r.nonFlowerTotal || 0), 0);

      assert.ok(
        Math.abs(flower - tab.statedTotal.flowerTotal) <= 0.5,
        `${tab.name}: รวมดอกคำนวณได้ ${flower} แต่ชีตบอก ${tab.statedTotal.flowerTotal}`
      );
      assert.ok(
        Math.abs(nonFlower - tab.statedTotal.nonFlowerTotal) <= 0.5,
        `${tab.name}: รวมที่ไม่ใช่ดอกคำนวณได้ ${nonFlower} แต่ชีตบอก ${tab.statedTotal.nonFlowerTotal}`
      );
    }
  });

  test('inventory / คลังหัวหินยังมีของและอ่านค่าออกมาได้', () => {
    const rows = payload.sources.inventory.rows.filter((r) => /หัวหิน/.test(r.location || ''));
    assert.ok(rows.length > 0, 'ไม่พบข้อมูลคลังหัวหิน');
    const flower = rows.reduce((t, r) => t + (r.flowerTotal || 0), 0);
    // ขอบเขตกว้าง ๆ พอจับกรณี "อ่านผิดหน่วย" หรือ "อ่านไม่ออกเลย" โดยไม่ผูกกับยอดจริง
    assert.ok(flower > 1000, `รวมดอกหัวหิน = ${flower} ซึ่งน้อยผิดปกติ`);
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

// ─────────────────────────────────────────────────────────────
describe('การจัดลำดับช่วงเวลา', () => {
  test('periodOrder อ่านไตรมาสโดยดูปีก่อนไตรมาส', () => {
    // เคสที่เคยพัง: เรียงตามตัวอักษรแล้ว Q1'2026 มาก่อน Q2'2025 ทั้งที่เกิดทีหลังเป็นปี
    assert.ok(periodOrder("Q2'2025") < periodOrder("Q1'2026"));
    assert.ok(periodOrder("Q1'2026") < periodOrder("Q2'2026"));
    assert.equal(periodOrder("Q1'2026"), periodOrder('2026-Q1'));
    assert.equal(periodOrder('ไม่มีข้อมูล'), Number.MAX_SAFE_INTEGER);
  });

  test('comparePeriod เรียงไตรมาสข้ามปีได้ถูกต้อง', () => {
    const input = ["Q1'2026", "Q2'2025", "Q2'2026", "Q3'2025", "Q4'2025"];
    assert.deepEqual(
      [...input].sort(comparePeriod),
      ["Q2'2025", "Q3'2025", "Q4'2025", "Q1'2026", "Q2'2026"]
    );
  });

  test('ไตรมาสที่ส่งให้ UI เรียงตามเวลาจริง', () => {
    const keys = payload.kpi.perCrop.byQuarter.map((q) => q.key);
    const sorted = [...keys].sort(comparePeriod);
    assert.deepEqual(keys, sorted, `ลำดับไตรมาสผิด: ${keys.join(' → ')}`);
  });

  test('ยอดขายรายเดือนเรียงตามเวลาจริง', () => {
    const months = payload.kpi.sales.byMonth.map((m) => m.month);
    assert.deepEqual(months, [...months].sort(), `ลำดับเดือนผิด: ${months.join(' → ')}`);
  });

  test('verifyPresentation จับลำดับที่ผิดได้ และไม่ฟ้องเมื่อลำดับถูก', () => {
    const base = {
      findings: [],
      counts: { critical: 0, warning: 0, info: 0 },
      bySource: { perCrop: { critical: 0, warning: 0, info: 0, total: 0 } },
      rowsChecked: 600,
      score: 100,
      total: 0,
    };

    const ok = verifyPresentation(base, {
      perCrop: { byQuarter: [{ key: "Q2'2025" }, { key: "Q1'2026" }] },
    });
    assert.equal(ok.findings.length, 0, 'ลำดับถูกแต่ยังฟ้อง');

    const bad = verifyPresentation(base, {
      perCrop: { byQuarter: [{ key: "Q1'2026" }, { key: "Q2'2025" }] },
    });
    assert.equal(bad.findings.length, 1, 'ลำดับผิดแต่จับไม่ได้');
    assert.equal(bad.findings[0].id, 'order.notChronological');
    assert.equal(bad.findings[0].severity, 'critical');
    assert.ok(bad.findings[0].messageTh && bad.findings[0].messageEn, 'ขาดข้อความสองภาษา');
  });

  test('ผลวิเคราะห์จริงต้องไม่มี finding เรื่องลำดับหลงเหลือ', () => {
    const ordering = payload.analysis.findings.filter((f) => f.id === 'order.notChronological');
    assert.equal(ordering.length, 0, ordering.map((f) => f.messageTh).join(' | '));
  });
});

// ─────────────────────────────────────────────────────────────
describe('การตรวจรายแท็บ', () => {
  /* คำนวณผลวิเคราะห์ใหม่จากข้อมูลดิบ ไม่ใช้ค่าที่ติดมากับ snapshot
   * เพราะ snapshot ถูกเขียนตอนรันครั้งก่อน จึงยังเป็นผลของโค้ดเวอร์ชันเก่า
   * เทสต์ต้องตรวจโค้ดปัจจุบัน ไม่ใช่ผลที่บันทึกไว้ */
  let fresh;
  before(() => {
    fresh = analyze(payload.sources);
  });

  const tabFindings = (id) => fresh.findings.filter((f) => f.id === id);

  test('ไม่ฟ้องแท็บรายครอปของ perCrop ที่ตั้งใจไม่อ่าน', () => {
    // perCrop อ่านข้อมูลจริงจาก SUMMARY SHEET ส่วนแท็บรายครอปอีก ~37 อันมาร์ก detailOnly ไว้
    // ถ้ากรองพลาดจะได้ false alarm ทีเดียว 37 อัน คะแนนพังทั้งที่ข้อมูลถูกต้อง
    const wrong = tabFindings('structural.tabEmpty').filter((f) => f.source === 'perCrop');
    assert.equal(wrong.length, 0, `perCrop ไม่ควรมี tabEmpty แต่เจอ ${wrong.length} อัน`);
  });

  /* ค้นรายชื่อแท็บสดไม่สำเร็จ = แท็บที่เพิ่งเพิ่มในชีตจะถูกมองข้ามในรอบนั้น
   * ต้องมีร่องรอย ไม่ใช่หายเงียบ แต่ต้องไม่ฉุดคะแนนคุณภาพข้อมูล (เน็ตกระตุก ≠ ข้อมูลผิด) */
  test('ใช้รายชื่อแท็บเก่าเพราะค้นสดไม่สำเร็จ ต้องมี finding ระดับ info', () => {
    assert.equal(
      tabFindings('structural.tabDiscoveryFallback').length,
      0,
      'ข้อมูลจริงค้นแท็บสดสำเร็จทุกรายงาน จึงไม่ควรมี finding นี้'
    );

    const degraded = analyze({
      ...payload.sources,
      sales: { ...payload.sources.sales, discovery: 'config', discoveryError: 'เน็ตหลุด' },
    });
    const hit = degraded.findings.filter((f) => f.id === 'structural.tabDiscoveryFallback');
    assert.equal(hit.length, 1);
    assert.equal(hit[0].severity, 'info');
    assert.equal(hit[0].source, 'sales');
    assert.match(hit[0].messageTh, /เน็ตหลุด/);
  });

  test('แท็บที่ถูกข้ามเพราะชื่อไม่ตรงแพตเทิร์นต้องได้ระดับ warning', () => {
    // เคสที่ผู้ใช้ถาม: เพิ่มแท็บใหม่แล้วตั้งชื่อไม่เข้าแบบ ข้อมูลหายทั้งแท็บ
    const ignored = tabFindings('structural.tabIgnored');
    const unexpected = ignored.filter((f) => f.field !== 'template' && f.field !== 'summary');
    assert.ok(unexpected.length > 0, 'ควรจับแท็บที่ชื่อไม่ตรงแพตเทิร์นได้อย่างน้อยหนึ่งอัน');
    for (const f of unexpected) {
      assert.equal(f.severity, 'warning', `"${f.tab}" ควรเป็น warning ไม่ใช่ ${f.severity}`);
    }
  });

  test('แท็บที่ข้ามตามที่ตั้งใจไว้เป็นแค่ info ไม่ทำให้คะแนนตกโดยไม่จำเป็น', () => {
    const expected = tabFindings('structural.tabIgnored').filter(
      (f) => f.field === 'template' || f.field === 'summary'
    );
    for (const f of expected) {
      assert.equal(f.severity, 'info', `"${f.tab}" ควรเป็น info ไม่ใช่ ${f.severity}`);
    }
  });

  test('finding รายแท็บมีข้อความสองภาษาและลิงก์ไปแท็บได้', () => {
    const all = [...tabFindings('structural.tabEmpty'), ...tabFindings('structural.tabIgnored')];
    assert.ok(all.length > 0, 'ควรมี finding รายแท็บอย่างน้อยหนึ่งอัน');
    for (const f of all) {
      assert.ok(f.messageTh && f.messageEn, `finding ของ "${f.tab}" ขาดข้อความสองภาษา`);
      assert.ok(f.tab, 'finding รายแท็บต้องระบุชื่อแท็บ');
      // gid ถูกเติมตอนท้าย analyze() — ถ้าเป็น null แปลว่าลิงก์เปิดไปแท็บนั้นไม่ได้
      assert.notEqual(f.gid, null, `finding ของ "${f.tab}" ไม่มี gid จึงทำลิงก์ไม่ได้`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('การคัดแท็บของสินค้าคงเหลือ', () => {
  /* เคสจริง ส.ค. 69: มีคนเติมเลขลำดับเอกสารหน้าชื่อแท็บ (`9.58 Stock หัวหิน`)
   * ตามธรรมเนียมที่ชีต Log Stock ใช้อยู่แล้ว (`1.Rockwool`) แล้วสต็อกหายทั้งรายงาน
   * เทสต์นี้เป็น unit test ของ regex ตรง ๆ จึงจับได้แม้ snapshot จะเป็นของเก่า */
  test('รับชื่อแท็บที่มีเลขลำดับนำหน้า', () => {
    for (const name of [
      'Stock หัวหิน',
      'Stock กรุงเทพ',
      '9.58 Stock หัวหิน',
      '9.59 Stock กรุงเทพ',
      '10) Stock เชียงใหม่',
      'stock ภูเก็ต',
    ]) {
      assert.ok(STOCK_TAB_RE.test(name.trim()), `ควรรับ "${name}" แต่ถูกข้าม`);
    }
  });

  test('ยังต้องปฏิเสธแท็บที่มีคำว่า Stock อยู่กลางประโยค', () => {
    /* "ส่งของให้ ลค.  Stock กรุงเทพ" คือของที่ส่งออกไปแล้ว ไม่ใช่ของคงเหลือ
     * ถ้าผ่อน regex เป็น /stock/i เฉย ๆ แท็บนี้จะหลุดเข้ามาแล้วสต็อกเกินจริง */
    for (const name of ['ส่งของให้ ลค.  Stock กรุงเทพ', 'ยอดส่ง Stock', 'สรุป Stock รายเดือน']) {
      assert.ok(!STOCK_TAB_RE.test(name.trim()), `ควรข้าม "${name}" แต่กลับรับเข้ามา`);
    }
  });

  test('แท็บสต็อกทุกอันที่อ่านได้ต้องมีชื่อคลังที่ไม่ติดเลขลำดับมาด้วย', () => {
    const locations = [...new Set(payload.sources.inventory.rows.map((r) => r.location))];
    assert.ok(locations.length > 0, 'ไม่มีข้อมูลคลังเลย');
    for (const loc of locations) {
      assert.ok(!/^\s*\d/.test(String(loc)), `ชื่อคลัง "${loc}" ยังติดเลขลำดับมาด้วย`);
    }
  });
});
