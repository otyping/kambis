/**
 * tests/cost.js — ชีต "แบบฟอร์มต้นทุน" (ลิงก์ที่ 8)
 *
 *   node --test tests/cost.js
 *
 * ใช้ข้อมูลสังเคราะห์ที่จำลองกับดักจริงของชีตนี้ทั้งหมด จึงรันได้เร็วและไม่ต้องต่อเน็ต:
 *   • หัวคอลัมน์เดือนที่หกถูกชื่อรายงาน merge ทับ
 *   • แถวยอดรวมปนอยู่กับแถวรายการ
 *   • บรรทัดหมายเหตุใต้ยอดรวมใหญ่
 *   • แท็บที่เนื้อหาซ้ำกับอีกแท็บทั้งแท็บ
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parse } from '../server/lib/parsers/cost.js';
import { analyze } from '../server/lib/analysis.js';
import { buildKpi } from '../server/lib/aggregate.js';

/** หัวตารางแบบเดียวกับของจริง — ช่องเดือนที่หกเป็นชื่อรายงานที่ merge ทับ Jun-26 */
const head = (leadCols) => [
  ...Array(leadCols).fill(''),
  'Jan-26',
  'Feb-26',
  'Mar-26',
  'Apr-26',
  'May-26',
  'รายงานค่าใช้จ่าย ปี 2569 Jun',
  'Jul-26',
  'Aug-26',
  'Sep-26',
  'Oct-26',
  'Nov-26',
  'Dec-26',
  'Total',
];

/** แถวข้อมูล: ป้ายชื่อ + ค่ารายเดือน + ยอดรวมที่ชีตบอก */
const row = (lead, months, total) => [...lead, ...months.map((v) => (v === null ? '' : String(v))), total ?? ''];

const SUMMARY_TAB = {
  gid: '1',
  name: 'สรุป',
  rows: [
    head(1),
    row(['Revenue'], [100, 200, 300, null, null, null, null, null, null, null, null, null], '600'),
    row(['Cost'], [null, null, null, null, null, null, null, null, null, null, null, null], ''),
    row(['ต้นทุนวัตถุดิบ'], [40, 50, 60, null, null, null, null, null, null, null, null, null], '150'),
    row(['ค่าใช้จ่าย - Farm'], [10, 10, 10, null, null, null, null, null, null, null, null, null], '30'),
    row(['ค่าใช้จ่าย - Office'], [5, 5, 5, null, null, null, null, null, null, null, null, null], '15'),
    row(['รวมต้นทุนการปลูก'], [55, 65, 75, null, null, null, null, null, null, null, null, null], '195'),
    row(['EBITDA (กำไรขั้นต้น)'], [45, 135, 225, null, null, null, null, null, null, null, null, null], '405'),
    row(['ค่าเสื่อมราคา'], [20, 20, 20, null, null, null, null, null, null, null, null, null], '60'),
    row(['EBIT'], [25, 115, 205, null, null, null, null, null, null, null, null, null], '345'),
  ],
};

/** แท็บรายละเอียด: หมวด/หมวดย่อย/ชื่อรายการ แล้วค่อยถึงบล็อกเดือน */
const OFFICE_TAB = {
  gid: '2',
  name: 'Office',
  rows: [
    head(3),
    row(['ค่าใช้จ่าย - Office', '- Consumable', 'ค่ารักษาความปลอดภัย'], [3, 3, 3, null, null, null, null, null, null, null, null, null], '9'),
    row(['', '', 'InterNet'], [2, 2, 2, null, null, null, null, null, null, null, null, null], '6'),
    row(['', '', 'รวม'], [5, 5, 5, null, null, null, null, null, null, null, null, null], '15'),
    row(['รวมค่าใช้จ่าย - Office', '', ''], [5, 5, 5, null, null, null, null, null, null, null, null, null], '15'),
    // บรรทัดหมายเหตุใต้ยอดรวมใหญ่ — ห้ามนับเป็นรายการ ไม่งั้นยอดจะเกินเท่าตัว
    row(['', '', '- ค่าเบ็ดเตล็ด Office'], [5, 5, 5, null, null, null, null, null, null, null, null, null], '15'),
  ],
};

const GROWING_TAB = {
  gid: '3',
  name: 'ต้นทุน',
  rows: [
    head(2),
    row(['', '- เงินเดือน'], [30, 40, 50, null, null, null, null, null, null, null, null, null], '120'),
    row(['', 'รวม ค่าบุคลากร'], [30, 40, 50, null, null, null, null, null, null, null, null, null], '120'),
    // ค่าไฟ: ชีตกรอกเดือนที่ 4 แล้วแต่สูตร Total ยังไม่ครอบ — เคสจริงจากชีต
    row(['', 'ค่าไฟฟ้า'], [10, 10, 10, 10, null, null, null, null, null, null, null, null], '30'),
    row(['รวมต้นทุนการปลูก', ''], [40, 50, 60, null, null, null, null, null, null, null, null, null], '150'),
  ],
};

const build = (tabs) => parse({ tabs, sourceKey: 'cost' });

describe('parser ชีตต้นทุน', () => {
  test('อ่านเดือนจากตำแหน่ง ไม่ใช่จากหัวคอลัมน์ (ช่องที่หกถูกชื่อรายงานทับ)', () => {
    const out = build([SUMMARY_TAB]);
    const revenue = out.rows.filter((r) => r.line === 'revenue');
    assert.deepEqual(
      revenue.map((r) => r.month),
      ['2026-01', '2026-02', '2026-03']
    );
    assert.equal(revenue.reduce((a, r) => a + r.amount, 0), 600);

    // แท็บที่หัวคอลัมน์ตรงกับข้อมูลจริง → ต้องอ่านเดือนที่หกได้ด้วย
    const withJune = {
      gid: '9',
      name: 'สรุป',
      rows: [head(1), row(['Revenue'], [1, 1, 1, 1, 1, 7, null, null, null, null, null, null], '12')],
    };
    const june = build([withJune]).rows.find((r) => r.month === '2026-06');
    assert.equal(june?.amount, 7, 'ค่าใต้หัวคอลัมน์ที่ถูกทับต้องเป็นของเดือนมิถุนายน');
  });

  test('อ่านบรรทัดงบครบทุกบรรทัด และไม่เอาแถวยอดรวมมาเป็น record', () => {
    const out = build([SUMMARY_TAB]);
    const lines = [...new Set(out.rows.map((r) => r.line))].sort();
    assert.deepEqual(lines, [
      'depreciation',
      'ebit',
      'ebitda',
      'farmExpense',
      'materialCost',
      'officeExpense',
      'revenue',
    ]);
    // "รวมต้นทุนการปลูก" กับบรรทัดหัวข้อ "Cost" ต้องไม่กลายเป็น record
    assert.equal(out.rows.filter((r) => r.item === 'รวมต้นทุนการปลูก').length, 0);
    assert.equal(out.rows.filter((r) => r.item === 'Cost').length, 0);
  });

  /* กับดักที่แพงที่สุดของชีตนี้ — นับซ้ำแล้วตัวเลขบนจอสูงเกินจริงโดยไม่มีอะไรฟ้อง */
  test('ไม่นับแถวยอดรวมและบรรทัดหมายเหตุใต้ยอดรวมใหญ่', () => {
    const out = build([OFFICE_TAB]);
    const items = out.rows.filter((r) => r.group === 'office');
    const total = items.reduce((a, r) => a + r.amount, 0);
    assert.equal(total, 15, 'ต้องได้เท่ายอดรวมของแท็บ ไม่ใช่ 30 หรือ 45');
    const names = [...new Set(items.map((r) => r.item))].sort();
    assert.deepEqual(names, ['InterNet', 'ค่ารักษาความปลอดภัย']);
  });

  test('forward-fill หมวดที่เป็นเซลล์ merge', () => {
    const out = build([OFFICE_TAB]);
    const internet = out.rows.find((r) => r.item === 'InterNet');
    assert.equal(internet.category, 'ค่าใช้จ่าย - Office');
    assert.equal(internet.subCategory, '- Consumable');
  });

  test('จับแถวที่ผลรวม 12 เดือนไม่ตรงกับช่อง Total ของแถวนั้น', () => {
    const out = build([GROWING_TAB]);
    const tab = out.tabs.find((t) => t.name === 'ต้นทุน');
    assert.equal(tab.rowMismatches, 1, 'ค่าไฟฟ้าแถวเดียวที่ไม่ตรง');
  });

  test('แท็บที่เนื้อหาซ้ำทั้งแท็บถูกข้าม และแท็บที่ชื่อตรงหน้าที่ได้อ่านก่อน', () => {
    // สำเนาของ Office ที่ชื่อมีคำว่า "ต้นทุน" — ห้ามถูกอ่านเป็นแท็บต้นทุนการปลูก
    const copy = { ...OFFICE_TAB, gid: '99', name: 'ต้นทุน ต่อ กรัม 2026' };
    const out = build([copy, OFFICE_TAB]);

    const skipped = out.tabs.find((t) => t.name === 'ต้นทุน ต่อ กรัม 2026');
    assert.equal(skipped.skipped, 'duplicate-content');
    assert.equal(skipped.duplicateOf, 'Office');

    const office = out.tabs.find((t) => t.name === 'Office');
    assert.ok(office.rowCount > 0, 'แท็บ Office ตัวจริงต้องได้อ่าน');
    assert.equal(out.rows.filter((r) => r.group === 'growing').length, 0);
  });

  /* คนแก้ชื่อแท็บในชีตได้ตลอด และเกิดขึ้นจริงระหว่างทำฟีเจอร์นี้:
   * Farm → "ค่าใช้จ่าย-Farm" · Office → "ค่าใช้จ่าย-Office" · ต้นทุน → "ต้นทุนวัตถุดิบ"
   * ถ้าจับชื่อเป๊ะ ข้อมูลรายละเอียดจะหายทั้งก้อนแค่เพราะเปลี่ยนชื่อแท็บ */
  test('เปลี่ยนชื่อแท็บในชีตแล้วยังอ่านได้เหมือนเดิม', () => {
    const renamed = build([
      SUMMARY_TAB,
      { ...GROWING_TAB, name: 'ต้นทุนวัตถุดิบ' },
      { ...OFFICE_TAB, name: 'ค่าใช้จ่าย-Office' },
    ]);
    const groups = [...new Set(renamed.rows.filter((r) => r.group).map((r) => r.group))].sort();
    assert.deepEqual(groups, ['growing', 'office']);
    assert.equal(renamed.tabs.filter((t) => t.skipped === 'unknown-tab').length, 0);

    // ชื่อเดิมก็ต้องยังใช้ได้ ไม่ใช่ย้ายไปรองรับแบบใหม่แล้วแบบเก่าพัง
    const oldNames = build([SUMMARY_TAB, GROWING_TAB, OFFICE_TAB]);
    assert.deepEqual(
      [...new Set(oldNames.rows.filter((r) => r.group).map((r) => r.group))].sort(),
      ['growing', 'office']
    );
  });

  test('แท็บ "ต่อกรัม" ต้องไม่ถูกอ่านเป็นแท็บต้นทุน แม้ชื่อขึ้นต้นด้วยต้นทุน', () => {
    // เนื้อหาไม่ซ้ำกับใคร แต่ชื่อบอกว่าเป็นคนละรายงาน → ต้องข้ามพร้อมส่งเสียง
    const perGram = { gid: '77', name: 'ต้นทุน ต่อ กรัม 2026', rows: GROWING_TAB.rows };
    const out = build([SUMMARY_TAB, perGram]);
    assert.equal(out.tabs.find((t) => t.name === 'ต้นทุน ต่อ กรัม 2026').skipped, 'unknown-tab');
    assert.equal(out.rows.filter((r) => r.group === 'growing').length, 0);
  });

  test('แท็บค่าเสื่อมราคาถูกมาร์ก detailOnly (ยอดอยู่ในงบสรุปแล้ว)', () => {
    const out = build([{ gid: '4', name: 'ค่าเสื่อมราคา', rows: [['อะไรก็ได้']] }]);
    assert.equal(out.tabs[0].detailOnly, true);
    assert.equal(out.rows.length, 0);
  });
});

describe('KPI และกฎตรวจของงบต้นทุน', () => {
  const sourcesOf = (tabs) => {
    const out = build(tabs);
    return {
      cost: {
        key: 'cost',
        kind: 'finance',
        titleTh: 'ต้นทุนและรายได้',
        titleEn: 'Cost & Revenue',
        status: 'ok',
        rows: out.rows,
        tabs: out.tabs,
        rowCount: out.rows.length,
        tabCount: out.tabs.length,
        tabsOk: out.tabs.length,
      },
    };
  };

  test('ยอดทุกตัวมาจากงบสรุป และกำไรขั้นต้นคำนวณใหม่เอง', () => {
    const kpi = buildKpi(sourcesOf([SUMMARY_TAB, OFFICE_TAB]), { findings: [] });
    const c = kpi.cost;
    assert.equal(c.available, true);
    assert.equal(c.year, '2026');
    assert.equal(c.totals.revenue, 600);
    assert.equal(c.totals.cost, 195); // 150 + 30 + 15
    assert.equal(c.totals.grossProfit, 405);
    assert.equal(c.lastActiveMonth, '2026-03');

    const jan = c.byMonth.find((m) => m.month === '2026-01');
    assert.equal(jan.revenue, 100);
    assert.equal(jan.cost, 55);
    assert.equal(jan.grossProfit, 45);
  });

  test('ชีตอ่านไม่ได้ต้องได้ available:false และ null ไม่ใช่ 0', () => {
    const kpi = buildKpi({}, { findings: [] });
    assert.equal(kpi.cost.available, false);
    assert.equal(kpi.cost.revenueByYear, null);
    assert.equal(kpi.cost.costByYear, null);
    assert.equal(kpi.exec.revenueByYear, null);
  });

  test('งบสรุปไม่ตรงกับผลรวมรายการ → finding ระดับ critical', () => {
    // Office รายการรวมได้ 15 ตรงกับงบสรุปพอดี → ต้องไม่มี finding
    const clean = analyze(sourcesOf([SUMMARY_TAB, OFFICE_TAB]));
    assert.equal(
      clean.findings.filter((f) => f.id === 'finance.summaryMismatch' && f.field === 'officeExpense').length,
      0
    );

    // เพิ่มรายการที่งบสรุปไม่ได้นับ → ต้องฟ้อง
    const extra = {
      ...OFFICE_TAB,
      gid: '5',
      rows: [
        ...OFFICE_TAB.rows.slice(0, 3),
        row(['', '', 'ค่าอะไรสักอย่าง'], [7, null, null, null, null, null, null, null, null, null, null, null], '7'),
        ...OFFICE_TAB.rows.slice(3),
      ],
    };
    const dirty = analyze(sourcesOf([SUMMARY_TAB, extra]));
    const hit = dirty.findings.find(
      (f) => f.id === 'finance.summaryMismatch' && f.field === 'officeExpense'
    );
    assert.ok(hit, 'ต้องจับได้ว่างบสรุปกับรายการไม่ตรงกัน');
    assert.equal(hit.severity, 'critical');
    assert.equal(hit.expected, 15);
    assert.equal(hit.actual, 22);
  });

  test('EBIT ที่ไม่เท่ากับ EBITDA − ค่าเสื่อมราคา ต้องถูกจับ', () => {
    const broken = {
      ...SUMMARY_TAB,
      gid: '6',
      rows: SUMMARY_TAB.rows.map((r) =>
        r[0] === 'EBIT'
          ? row(['EBIT'], [999, 115, 205, null, null, null, null, null, null, null, null, null], '1319')
          : r
      ),
    };
    const findings = analyze(sourcesOf([broken])).findings.filter(
      (f) => f.id === 'finance.ebitMismatch'
    );
    assert.equal(findings.length, 1);
    assert.equal(findings[0].field, '2026-01');
    assert.equal(findings[0].expected, 25); // 45 − 20
    assert.equal(findings[0].actual, 999);
  });

  test('งบการเงินต้องไม่โดนกฎของดอกไม้ (ไม่มีสายพันธุ์/ขนาดให้ตรวจ)', () => {
    const findings = analyze(sourcesOf([SUMMARY_TAB, OFFICE_TAB])).findings;
    const flowerRules = findings.filter(
      (f) => f.source === 'cost' && !f.id.startsWith('finance.') && !f.id.startsWith('structural.')
    );
    assert.deepEqual(flowerRules, [], 'ต้องไม่มี finding เรื่องน้ำหนัก/ขนาด/สายพันธุ์');
    assert.equal(findings.filter((f) => f.id === 'complete.missingStrain').length, 0);
  });

  test('แท็บที่ซ้ำกันต้องขึ้น finding ให้คนไปแก้ ไม่ใช่เงียบ', () => {
    const copy = { ...OFFICE_TAB, gid: '99', name: 'ต้นทุน ต่อ กรัม 2026' };
    const findings = analyze(sourcesOf([SUMMARY_TAB, copy, OFFICE_TAB])).findings;
    const hit = findings.find((f) => f.id === 'finance.duplicateTab');
    assert.ok(hit);
    assert.equal(hit.severity, 'warning');
    assert.match(hit.messageTh, /Office/);
  });
});
