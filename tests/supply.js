/**
 * tests/supply.js — วัสดุสิ้นเปลือง (Log Stock) และใบขอซื้อ .xlsx
 *
 *   node --test tests/supply.js
 *
 * ใช้ข้อมูลสังเคราะห์ที่จำลองโครงจริงของชีต จึงรันได้เร็วและไม่ต้องต่อเน็ต
 * และคุมเคสขอบได้ครบ (แถวลงวันที่ล่วงหน้า, ขั้นต่ำเปลี่ยนกลางทาง, หัวตารางหลายแถว)
 */
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

import { loadFromSnapshot, loadAll } from '../server/lib/loader.js';
import {
  parse as parseSupplyLog,
  normalizeItemName,
  parseLeadTimeDays,
} from '../server/lib/parsers/supplyLog.js';
import { analyze, verifyPresentation } from '../server/lib/analysis.js';
import { buildKpi } from '../server/lib/aggregate.js';
import { comparePeriod, parseSheetDate } from '../server/lib/normalize.js';
import { buildXlsx, columnLetter, escapeXml } from '../server/lib/xlsx.js';
import { validateItems, splitByForm, requestFilePath } from '../server/lib/purchase-request.js';
import { recentRequests } from '../server/lib/loader.js';
import { stockAt } from '../public/js/shared/kpi.js';
import {
  readSupplyFilters,
  supplyFilterParams,
  isSupplyFiltered,
} from '../public/js/ui/supply-filters.js';

/** แท็บรายการจำลอง — หัวตาราง 1 แถว แล้วตามด้วยข้อมูล */
const ITEM_TAB = {
  gid: '100',
  name: '12.ถุงมือไนไตรสีดำ Size M',
  rows: [
    ['แบบฟอร์มเบิกของและของคงเหลือ ถุงมือ', 'จำนวน\nซื้อเพิ่ม', 'จำนวนเบิก', 'จำนวน\nคงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
    ['01/07/2569', '0', '', '47', 'กล่อง', '16', '31'],
    ['02/07/2569', '', '5', '42', 'กล่อง', '16', '26'],
    ['03/07/2569', '10', '', '52', 'กล่อง', '12', '40'], // ขั้นต่ำเปลี่ยนกลางทาง
    ['04/07/2569', '', '2', '50', 'กล่อง', '12', '38'],
    ['05/07/2569', '', '', '50', 'กล่อง', '12', '38'], // วันอนาคต (today = 04/07)
  ],
};

const TODAY = '2026-07-04';
const parseItem = () => parseSupplyLog({ tabs: [ITEM_TAB], today: TODAY });

describe('parser วัสดุสิ้นเปลือง', () => {
  test('อ่านคอลัมน์ตามตำแหน่งได้ถูก และแปลง พ.ศ. เป็น ค.ศ.', () => {
    const out = parseItem();
    assert.equal(out.rows.length, 5);
    assert.equal(out.rows[0].date, '2026-07-01', 'ปี พ.ศ. 2569 ต้องกลายเป็น ค.ศ. 2026');
    assert.equal(out.rows[1].issued, 5);
    assert.equal(out.rows[1].balance, 42);
    assert.equal(out.rows[2].received, 10);
    assert.equal(out.rows[0].item, 'ถุงมือไนไตรสีดำ Size M', 'ต้องตัดเลขลำดับนำหน้าออก');
    assert.equal(out.rows[0].itemNo, '12');
    assert.equal(out.rows[0].unit, 'กล่อง');
  });

  test('เส้นทางแปลงปี พ.ศ. ทำงานถูก (ไม่เคยมี test ครอบมาก่อน)', () => {
    assert.equal(parseSheetDate('01/07/2569'), '2026-07-01');
    assert.equal(parseSheetDate('31/12/2568'), '2025-12-31');
  });

  test('เลย์เอาต์ต้องผ่านการตรวจด้วยเลขคณิต ไม่ใช่การอ่านชื่อหัวคอลัมน์', () => {
    const tab = parseItem().tabs[0];
    assert.ok(
      tab.layoutConfidence >= 0.9,
      `layoutConfidence = ${tab.layoutConfidence} ต่ำเกินไป — อาจจับคอลัมน์ผิด`
    );
    assert.equal(tab.valueOffset, 1);
  });

  /* กับดักที่พลาดง่ายที่สุดของชีตนี้: มีแถวลงวันที่ล่วงหน้าที่ยอดถูก carry forward ไว้
   * ถ้าอ่าน "แถวสุดท้ายของแท็บ" จะได้ยอดของอนาคต ซึ่งผิดแบบดูสมเหตุสมผลจนไม่มีใครทันสังเกต */
  test('ยอดปัจจุบันมาจากแถวล่าสุดที่ไม่เกินวันนี้ ไม่ใช่แถวสุดท้ายของแท็บ', () => {
    const tab = parseItem().tabs[0];
    assert.equal(tab.current.date, TODAY, 'ต้องหยุดที่วันนี้ ไม่ใช่ 05/07 ซึ่งเป็นอนาคต');
    assert.equal(tab.current.balance, 50);
    assert.equal(tab.current.minimum, 12, 'ขั้นต่ำต้องเป็นค่าล่าสุด (12) ไม่ใช่ค่าแรกของแท็บ (16)');
    assert.equal(tab.futureCount, 1);
  });

  test('แถวอนาคตยังถูกเก็บไว้พร้อมติดธง — ไม่ทิ้งข้อมูลเงียบ ๆ', () => {
    const future = parseItem().rows.filter((r) => r.isFuture);
    assert.equal(future.length, 1);
    assert.equal(future[0].date, '2026-07-05');
  });

  test('แท็บชนิดที่ไม่รู้จักต้องถูกทำเครื่องหมายไว้ ไม่ใช่หายเงียบ', () => {
    const out = parseSupplyLog({
      tabs: [{ gid: '9', name: 'อะไรก็ไม่รู้', rows: [['a']] }],
      today: TODAY,
    });
    assert.equal(out.tabs[0].skipped, 'unknown-tab');
  });

  test('แท็บสั่งของรายเดือนต้องถูกอ่าน ไม่ใช่ถูก skip (เป็นแหล่งราคาแห่งเดียวของระบบ)', () => {
    const out = parseSupplyLog({
      tabs: [
        {
          gid: '1',
          name: 'สั่งของรายเดือน',
          rows: [
            ['', 'รายการสั่งของ', 'หน่วย', 'คงเหลือ', 'จำนวนสั่งซื้อ', 'ราคา / @', 'รวมจำนวนเงิน', 'สั่งซื้อวันที่', 'ล่าสุด', 'ระยะเวลา'],
            ['1', 'pH Up (9 กิโล/ถัง)', 'ถัง', '4', '1', '625.00', '625.00', '5', '', '1 เดือน'],
          ],
        },
      ],
      today: TODAY,
    });
    assert.equal(out.tabs[0].role, 'order');
    assert.equal(out.tabs[0].skipped, undefined, 'แท็บนี้ให้ข้อมูลจริง ห้าม skip');
    assert.equal(out.rows[0].unitPrice, 625);
    assert.equal(out.rows[0].kind, 'order');
  });

  test('จับคู่ชื่อรายการข้ามรูปแบบการเขียนที่ต่างกันได้', () => {
    // ของชิ้นเดียวกันแต่ชีตเขียนคนละแบบสองที่
    assert.equal(
      normalizeItemName('ป้ายแท็ก-สีน้ำเงิน (100 ชิ้น/ห่อ)'),
      normalizeItemName('7.ป้ายแท็กสีน้ำเงิน')
    );
    assert.equal(normalizeItemName('Rockwool (98 หลุม/แผง)'), normalizeItemName('1.Rockwool'));
  });
});

describe('KPI วัสดุสิ้นเปลือง', () => {
  const buildFrom = (tabs, today = '2026-08-03') => {
    const parsed = parseSupplyLog({ tabs, today });
    const source = {
      key: 'supplyLog',
      kind: 'supply',
      status: 'ok',
      rows: parsed.rows,
      tabs: parsed.tabs,
      rowCount: parsed.rows.length,
    };
    return buildKpi({ supplyLog: source }, { score: null, counts: {}, total: 0, bySource: {} });
  };

  test('เดือนของการเบิกต้องเรียงตามเวลา แม้ข้ามปี', () => {
    const kpi = buildFrom([
      {
        gid: '1',
        name: '1.ของ',
        rows: [
          ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
          ['15/12/2568', '', '1', '10', 'ชิ้น', '2', '8'],
          ['15/01/2569', '', '1', '9', 'ชิ้น', '2', '7'],
        ],
      },
    ]);
    assert.deepEqual(kpi.supply.months, ['2025-12', '2026-01']);
    assert.deepEqual([...kpi.supply.months].sort(comparePeriod), kpi.supply.months);
  });

  test('ของที่ต้องสั่งซื้อคือของที่คงเหลือ ≤ ขั้นต่ำ และเรียงขาดหนักสุดก่อน', () => {
    const kpi = buildFrom([
      { gid: '1', name: '1.ขาดนิดเดียว', rows: [
        ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/08/2569', '', '', '9', 'ชิ้น', '10', '-1'],
      ] },
      { gid: '2', name: '2.ขาดหนัก', rows: [
        ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/08/2569', '', '', '0', 'ชิ้น', '50', '-50'],
      ] },
      { gid: '3', name: '3.ของพอ', rows: [
        ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/08/2569', '', '', '99', 'ชิ้น', '10', '89'],
      ] },
    ]);
    assert.deepEqual(kpi.supply.needsReorder.map((r) => r.item), ['ขาดหนัก', 'ขาดนิดเดียว']);
    for (const r of kpi.supply.needsReorder) {
      assert.ok(r.index <= 0, `${r.item}: index ต้อง ≤ 0 จึงจะเข้ารายการของที่ต้องสั่ง`);
    }
  });

  test('ของที่หาราคาไม่เจอต้องได้ราคาเป็น null ไม่ใช่ 0', () => {
    const kpi = buildFrom([
      { gid: '1', name: '1.ของไม่มีในตารางสั่งซื้อ', rows: [
        ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/08/2569', '', '', '0', 'ชิ้น', '5', '-5'],
      ] },
    ]);
    const item = kpi.supply.needsReorder[0];
    assert.equal(item.unitPrice, null);
    assert.equal(item.amount, null, 'คิดเป็น 0 จะทำให้ยอดรวมในใบขอซื้อต่ำกว่าจริง');
  });

  test('ชื่อที่เข้าเค้าหลายรายการต้องไม่จับคู่มั่ว', () => {
    // "กระบอกตวง" เข้าได้ทั้ง 1000 และ 5000 มล. — เดาผิดแล้วได้ราคาผิดซึ่งแย่กว่าไม่มีราคา
    const kpi = buildFrom([
      { gid: '0', name: 'สั่งของรายเดือน', rows: [
        ['', 'รายการ', 'หน่วย', 'คงเหลือ', 'จำนวนสั่งซื้อ', 'ราคา / @', 'รวม', 'วันสั่ง', 'ล่าสุด', 'ระยะเวลา'],
        ['1', 'กระบอกตวง 1000 Ml.', 'อัน', '5', '2', '100', '200', '5', '', ''],
        ['2', 'กระบอกตวง 5000 Ml.', 'อัน', '5', '2', '300', '600', '5', '', ''],
      ] },
      { gid: '1', name: '1.กระบอกตวง', rows: [
        ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/08/2569', '', '', '0', 'อัน', '5', '-5'],
      ] },
    ]);
    assert.equal(kpi.supply.needsReorder[0].unitPrice, null, 'กำกวมแล้วต้องไม่เดา');
  });
});

describe('การตรวจข้อมูลของรายงานวัสดุ', () => {
  let payload;
  before(async () => {
    payload = (await loadFromSnapshot()) ?? (await loadAll());
  }, { timeout: 300000 });

  /* คะแนน = 100 − penalty/จำนวนแถว ถ้านับแถว log หลายพันแถวเข้าตัวหารด้วย
   * คะแนนจะพุ่งขึ้นทั้งที่ข้อมูลไม่ได้ดีขึ้นเลย — badge บนหัวเว็บจะกลายเป็นตัวเลขที่โกหก */
  test('แถววัสดุต้องไม่เข้าตัวหารของคะแนนคุณภาพ', () => {
    const before = analyze(payload.sources);
    const after = analyze({
      ...payload.sources,
      supplyLog: {
        key: 'supplyLog',
        kind: 'supply',
        status: 'ok',
        rows: [],
        tabs: [],
        rowCount: 5000,
      },
    });
    assert.equal(after.rowsChecked, before.rowsChecked, 'แถววัสดุต้องไม่เข้าตัวหาร');
    assert.equal(after.score, before.score, 'คะแนนต้องไม่ขยับเพราะเพิ่มรายงานวัสดุ');
  });

  test('วิเคราะห์เฉพาะรายงานวัสดุต้องได้คะแนนเป็น null ไม่ใช่ตัวเลขที่ไม่มีความหมาย', () => {
    const only = analyze({
      supplyLog: { key: 'supplyLog', kind: 'supply', status: 'ok', rows: [], tabs: [], rowCount: 100 },
    });
    assert.equal(only.score, null);
  });

  /* แบบเดียวกับที่ perCrop เคยได้ false alarm 37 อัน — ที่นี่มี 139 แท็บ
   * ถ้าจำแนกแท็บผิดจะได้ finding ขยะทีเดียว 138 อัน */
  test('ไม่มี false alarm จากแท็บของรายงานวัสดุ', () => {
    const parsed = parseSupplyLog({
      tabs: [ITEM_TAB, { gid: '2', name: 'COCO', rows: ITEM_TAB.rows }],
      today: TODAY,
    });
    const result = analyze({
      supplyLog: {
        key: 'supplyLog',
        kind: 'supply',
        status: 'ok',
        rows: parsed.rows,
        tabs: parsed.tabs,
        rowCount: parsed.rows.length,
      },
    });
    const empty = result.findings.filter((f) => f.id === 'structural.tabEmpty');
    const ignored = result.findings.filter(
      (f) => f.id === 'structural.tabIgnored' && f.severity === 'warning'
    );
    assert.equal(empty.length, 0, 'ไม่ควรมีแท็บที่อ่านไม่ได้');
    assert.equal(ignored.length, 0, 'ไม่ควรมีแท็บที่ถูกข้ามแบบผิดคาด');
    // กฎที่เป็นเรื่องดอกไม้ต้องไม่ทำงานกับรายงานนี้
    assert.equal(result.findings.filter((f) => f.id === 'complete.missingStrain').length, 0);
  });

  test('จับความไม่สอดคล้องของบัญชี รับ–เบิก–คงเหลือ ได้', () => {
    const parsed = parseSupplyLog({
      tabs: [
        { gid: '1', name: '1.ของ', rows: [
          ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
          ['01/07/2569', '', '', '10', 'ชิ้น', '2', '8'],
          ['02/07/2569', '', '1', '99', 'ชิ้น', '2', '97'], // ควรเป็น 9 ไม่ใช่ 99
        ] },
      ],
      today: '2026-08-03',
    });
    const result = analyze({
      supplyLog: {
        key: 'supplyLog',
        kind: 'supply',
        status: 'ok',
        rows: parsed.rows,
        tabs: parsed.tabs,
        rowCount: parsed.rows.length,
      },
    });
    assert.ok(
      result.findings.some((f) => f.id === 'supply.balanceDrift'),
      'ยอดยกมาไม่ต่อกันแล้วต้องมี finding'
    );
  });
});

/* ── สถานะ "ขอซื้อไปแล้ว รอของ" ──
 *
 * ของที่ขอไปแล้วยังต่ำกว่าขั้นต่ำอยู่จนกว่าของจะมาถึง มันจึงยังโผล่ในตาราง
 * "ของที่ต้องสั่งซื้อ" ทุกวัน ถ้าไม่มีสถานะกำกับ ฝ่ายจัดซื้อจะขอซ้ำ
 *
 * ระบบปิดสถานะเองจากคอลัมน์ "รับ" ใน Log Sheet — ไม่มีใครต้องมากดอัปเดต
 */
describe('สถานะใบขอซื้อที่รอของอยู่', () => {
  /** แท็บที่คงเหลือต่ำกว่าขั้นต่ำ (จึงอยู่ในรายการต้องสั่งซื้อ) พร้อมแถวรับของตามที่กำหนด */
  const tabWith = (rows) => ({
    gid: '1',
    name: '1.ถุงมือ',
    rows: [['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'], ...rows],
  });

  const kpiWith = (rows, requests, today = '2026-08-20') => {
    const parsed = parseSupplyLog({ tabs: [tabWith(rows)], today });
    const source = { key: 'supplyLog', kind: 'supply', status: 'ok', rows: parsed.rows, tabs: parsed.tabs };
    return buildKpi(
      { supplyLog: source },
      { score: null, counts: {}, total: 0, bySource: {} },
      // ส่ง today ให้ชัด — ไม่งั้นเทสต์จะขึ้นกับวันที่รันจริง
      { purchaseRequests: requests, today }
    ).supply;
  };

  const REQ = (day, item = 'ถุงมือ') => ({
    docNo: `PR-${day.replace(/-/g, '')}-001`,
    createdAt: `${day}T09:00:00.000Z`,
    items: [{ item, qty: 5 }],
  });

  test('ขอไปแล้วและของยังไม่เข้า → ติดสถานะรอของ พร้อมจำนวนวัน', () => {
    const kpi = kpiWith([['10/08/2569', '', '8', '2', 'ชิ้น', '10', '-8']], [REQ('2026-08-15')]);
    const row = kpi.needsReorder.find((r) => r.item === 'ถุงมือ');
    assert.ok(row, 'ของต่ำกว่าขั้นต่ำต้องอยู่ในรายการที่ต้องสั่งซื้อ');
    assert.equal(row.pending.docNo, 'PR-20260815-001');
    assert.equal(row.pending.daysAgo, 5, 'ขอวันที่ 15 ข้อมูลถึงวันที่ 20 = 5 วัน');
  });

  test('ของเข้าหลังวันที่ขอ → ปิดสถานะเอง ไม่ต้องมีใครมากด', () => {
    const kpi = kpiWith(
      [
        ['10/08/2569', '', '8', '2', 'ชิ้น', '10', '-8'],
        // รับของเข้าวันที่ 18 หลังใบขอวันที่ 15 — แต่ยังเบิกจนต่ำกว่าขั้นต่ำอยู่
        ['18/08/2569', '4', '5', '1', 'ชิ้น', '10', '-9'],
      ],
      [REQ('2026-08-15')]
    );
    assert.equal(kpi.needsReorder.find((r) => r.item === 'ถุงมือ').pending, null);
  });

  test('ของเข้า *ก่อน* วันที่ขอ ไม่ปิดใบ — เป็นของรอบก่อน', () => {
    const kpi = kpiWith(
      [
        ['10/08/2569', '4', '8', '2', 'ชิ้น', '10', '-8'],
        ['16/08/2569', '', '1', '1', 'ชิ้น', '10', '-9'],
      ],
      [REQ('2026-08-15')]
    );
    assert.equal(kpi.needsReorder.find((r) => r.item === 'ถุงมือ').pending.docNo, 'PR-20260815-001');
  });

  test('ขอหลายรอบ → เอาใบล่าสุด เพราะสิ่งที่ต้องรู้คือรอมากี่วันแล้ว', () => {
    const kpi = kpiWith(
      [['10/08/2569', '', '8', '2', 'ชิ้น', '10', '-8']],
      [REQ('2026-08-12'), REQ('2026-08-18')]
    );
    const p = kpi.needsReorder.find((r) => r.item === 'ถุงมือ').pending;
    assert.equal(p.docNo, 'PR-20260818-001');
    assert.equal(p.daysAgo, 2);
  });

  test('ไม่มีทะเบียนใบขอซื้อ = ไม่มีสถานะ ไม่ใช่พัง', () => {
    const kpi = kpiWith([['10/08/2569', '', '8', '2', 'ชิ้น', '10', '-8']], []);
    assert.equal(kpi.needsReorder.find((r) => r.item === 'ถุงมือ').pending, null);
  });

  /* ชีตเขียน Lead Time ไว้แค่ 65 จาก 138 แท็บ — แท็บที่ไม่มีต้องบอกว่าไม่รู้
   * ห้ามเดาว่าตรงเวลา ไม่งั้นของที่ค้างมานานจะดูเหมือนปกติ */
  test('ไม่มี Lead Time ในชีต → overdue เป็น null ห้ามเดา', () => {
    const kpi = kpiWith([['10/08/2569', '', '8', '2', 'ชิ้น', '10', '-8']], [REQ('2026-07-01')]);
    assert.equal(kpi.needsReorder.find((r) => r.item === 'ถุงมือ').pending.overdue, null);
  });

  test('มี Lead Time แล้วเลยกำหนด → ติดธง overdue', () => {
    // Lead Time เขียนอยู่ในเซลล์หัวตารางที่ merge หลายบรรทัด ไม่ใช่ในชื่อแท็บ
    const tab = {
      gid: '1',
      name: '1.ถุงมือ',
      rows: [
        ['ถุงมือ ใช้ 2 กล่อง/crop Lead Time - 5 Days', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['10/08/2569', '', '8', '2', 'ชิ้น', '10', '-8'],
      ],
    };
    const parsed = parseSupplyLog({ tabs: [tab], today: '2026-08-20' });
    const kpi = buildKpi(
      { supplyLog: { key: 'supplyLog', kind: 'supply', status: 'ok', rows: parsed.rows, tabs: parsed.tabs } },
      { score: null, counts: {}, total: 0, bySource: {} },
      { purchaseRequests: [REQ('2026-08-05')], today: '2026-08-20' }
    ).supply;
    const row = kpi.needsReorder.find((r) => r.item === 'ถุงมือ');
    assert.equal(row.leadTimeDays, 5);
    assert.equal(row.pending.daysAgo, 15);
    assert.equal(row.pending.overdue, true, 'ขอมา 15 วันแต่ Lead Time 5 วัน = เลยกำหนดแล้ว');
  });
});

/* ═══════════════════════════════════════════════════════════════
   ดาวน์โหลดใบขอซื้อเดิมกลับมา

   เลขที่เอกสารรันต่อไปเรื่อย ๆ ไม่เคยใช้ซ้ำ (เลขหนึ่งเลข = กระดาษหนึ่งใบ
   ที่อาจส่งไปให้เซ็นแล้ว) "ทำไฟล์หาย" จึงต้องแก้ด้วยการโหลดสำเนาเดิม
   ═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   ราคา/หน่วย มาจากคอลัมน์ H ของแท็บรายการเอง

   ผู้ใช้ย้ายราคามาไว้ที่หัวตารางของแต่ละแท็บ และเลิกใช้ช่องราคา
   ในแท็บ "สั่งของรายเดือน" แล้ว — เลขที่ค้างอยู่ตรงนั้นไม่ตรงกับของจริง
   (ใบมีดผ่าตัด 750 vs 7.5 · แผ่นกาวดักแมลง 65 vs 6.5)
   ═══════════════════════════════════════════════════════════════ */
describe('ราคาจากคอลัมน์ H ของแท็บรายการ', () => {
  /** แท็บรายการพร้อมคอลัมน์ H — head[] คือค่าที่จะใส่ในคอลัมน์ H ของแถวหัวตาราง */
  const tabWithPrice = (h1, h2, bodyH = []) => ({
    gid: '200',
    name: '12.ถุงมือไนไตรสีดำ Size M',
    rows: [
      ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index', h1],
      ['01/07/2569', '0', '', '47', 'กล่อง', '16', '31', h2],
      ['02/07/2569', '', '5', '42', 'กล่อง', '16', '26', bodyH[0] ?? ''],
      ['03/07/2569', '', '2', '40', 'กล่อง', '16', '24', bodyH[1] ?? ''],
    ],
  });
  const priceOf = (tab) =>
    parseSupplyLog({ tabs: [tab], today: '2026-07-04' }).tabs.find((t) => t.gid === '200');

  test('อ่านราคาจากใต้ป้าย "ราคา/…" ในหัวตาราง', () => {
    const t = priceOf(tabWithPrice('ราคา/กล่อง', '126'));
    assert.equal(t.unitPrice, 126);
    assert.equal(t.priceUnit, 'กล่อง');
    assert.equal(t.priceQty, null);
  });

  /* คอลัมน์ H ถูกใช้จดโน้ตในเนื้อ log ด้วย — เจอจริงในชีต: "3/2" · "1/3" · "3/1 3/3"
   * ถ้าไล่หาตัวเลขทั้งคอลัมน์ โน้ตพวกนี้จะกลายเป็นราคาไปเงียบ ๆ
   * กันสองชั้น: num() ไม่รับรูปแบบนี้อยู่แล้ว และค้นแค่ไม่กี่แถวใต้ป้าย */
  test('โน้ตในเนื้อ log ไม่ถูกอ่านเป็นราคา', () => {
    const t = priceOf(tabWithPrice('ราคา/กล่อง', '', ['3/2', '1/3']));
    assert.equal(t.unitPrice, null, 'ป้ายมีแต่ยังไม่กรอกตัวเลข = ไม่มีราคา');
    assert.equal(t.priceLabel, 'ราคา/กล่อง');
  });

  /* โน้ตที่อยู่ไกลลงไปในเนื้อ log ต้องไม่ถูกดึงมา ถึงจะเป็นตัวเลขล้วนก็ตาม
   * (ในชีตจริงโน้ตอยู่แถว 38–42 ห่างจากป้ายมาก) */
  test('ตัวเลขที่อยู่ไกลลงไปในคอลัมน์เดียวกัน ต้องไม่กลายเป็นราคา', () => {
    const tab = {
      gid: '200',
      name: '12.ถุงมือไนไตรสีดำ Size M',
      rows: [
        ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index', 'ราคา/กล่อง'],
        ...Array.from({ length: 8 }, (_, i) => [
          `0${i + 1}/07/2569`, '', '', '40', 'กล่อง', '16', '24', i === 6 ? '250' : '',
        ]),
      ],
    };
    const t = parseSupplyLog({ tabs: [tab], today: '2026-07-10' }).tabs.find((x) => x.gid === '200');
    assert.equal(t.unitPrice, null, '250 อยู่แถวที่ 7 ของ log ไม่ใช่ราคาในหัวตาราง');
  });

  test('ไม่มีป้ายราคา = ไม่มีราคา แม้จะมีตัวเลขอยู่ตรงนั้น', () => {
    const t = priceOf(tabWithPrice('สั่งซื้อวันที่', '5'));
    assert.equal(t.unitPrice, null);
    assert.equal(t.priceLabel, null);
  });

  test('ป้ายมีแต่ช่องว่าง → null ห้ามคิดเป็น 0', () => {
    const t = priceOf(tabWithPrice('ราคา/ถุง', ''));
    assert.equal(t.unitPrice, null);
    assert.notEqual(t.unitPrice, 0);
  });

  /* `ราคา/ 5 แพ็ค=5 กิโล` = 420 ในแท็บที่หน่วยนับเป็น "แพ็ค"
   * เอา 420 ไปคูณจำนวนแพ็คจะเกินจริง 5 เท่า ส่วนการหาร 5 เองก็เป็นการเดา
   * ความหมายจากข้อความไทยที่คนเขียนอิสระ → คืน null แล้วออก finding ให้คนไปแก้ */
  test('ป้ายที่บอกราคาของหลายหน่วย ต้องไม่ถูกใช้เป็นราคาต่อหน่วย', () => {
    const t = priceOf(tabWithPrice('ราคา/ 5 แพ็ค=5 กิโล', '420'));
    assert.equal(t.unitPrice, null, 'ราคาของ 5 หน่วย เอามาเป็นราคาต่อหน่วยไม่ได้');
    assert.equal(t.priceQty, 5);
    assert.equal(t.priceUnit, '5 แพ็ค=5 กิโล');
  });

  test('ทศนิยมอ่านได้ และหัวตารางหลายแถวก็ยังหาเจอ', () => {
    const tab = {
      gid: '200',
      name: '1.Rockwool',
      rows: [
        ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', '', 'ขั้นต่ำ', 'Index', 'ราคา/แผ่น 98 หลุม'],
        ['', '', '', '', 'หน่วย', '', '', ''],
        ['', '', '', '', '', '', '', '196.75'],
        ['01/07/2569', '0', '', '47', 'แผง', '16', '31', ''],
      ],
    };
    const t = parseSupplyLog({ tabs: [tab], today: '2026-07-04' }).tabs.find((x) => x.gid === '200');
    assert.equal(t.unitPrice, 196.75);
  });

  /* คอลัมน์ราคาคิดจาก "ถัดจาก Index" ไม่ได้ตรึงเป็นเลข 7 ตายตัว
   * แท็บที่คอลัมน์ตัวเลขเลื่อนไปหนึ่งช่อง ช่องราคาต้องเลื่อนตามด้วย */
  test('ช่องราคาเลื่อนตามเลย์เอาต์ ไม่ใช่ตรึงที่คอลัมน์ H', () => {
    const tab = {
      gid: '200',
      name: '9.ของทดสอบ',
      rows: [
        ['แบบฟอร์ม', '', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index', 'ราคา/ชิ้น'],
        ['01/07/2569', '', '0', '', '47', 'ชิ้น', '16', '31', '9.5'],
        ['02/07/2569', '', '', '5', '42', 'ชิ้น', '16', '26', ''],
        ['03/07/2569', '', '', '2', '40', 'ชิ้น', '16', '24', ''],
      ],
    };
    const t = parseSupplyLog({ tabs: [tab], today: '2026-07-04' }).tabs.find((x) => x.gid === '200');
    assert.equal(t.valueOffset, 2, 'คอลัมน์ตัวเลขเริ่มช้าไปหนึ่งช่อง');
    assert.equal(t.unitPrice, 9.5, 'ช่องราคาต้องเลื่อนตามไปอยู่คอลัมน์ I');
  });

  /* ห้ามตกไปใช้ราคาเก่าจากตารางสั่งของเมื่อคอลัมน์ H ว่าง
   * ไม่งั้นเลขชุดที่เลิกใช้แล้วจะปนกลับเข้ามาโดยไม่มีอะไรบอก */
  test('KPI ใช้ราคาจากแท็บรายการ ไม่ใช่จากตารางสั่งของรายเดือน', () => {
    const order = {
      gid: '1',
      name: 'สั่งของรายเดือน',
      rows: [
        ['ลำดับ', 'รายการ', 'หน่วย', 'คงเหลือ', 'จำนวนสั่งซื้อ', 'ราคา/@', 'รวม', 'วันที่'],
        ['1', 'ถุงมือไนไตรสีดำ Size M', 'กล่อง', '2', '4', '999', '3996', '5'],
        ['2', 'ไม้ถูพื้น', 'ด้าม', '0', '3', '149', '447', '5'],
      ],
    };
    // แท็บนี้มีราคา 126 ในคอลัมน์ H ส่วนตารางสั่งของเขียนไว้ 999 (เลขเก่าที่เลิกใช้)
    const gloves = tabWithPrice('ราคา/กล่อง', '126');
    // แท็บนี้ไม่มีป้ายราคาเลย ต้องเป็น null ไม่ใช่ 149 จากตารางสั่งของ
    const mop = {
      gid: '201',
      name: '30.ไม้ถูพื้น',
      rows: [
        ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/07/2569', '0', '', '1', 'ด้าม', '5', '-4'],
      ],
    };
    const parsed = parseSupplyLog({ tabs: [order, gloves, mop], today: '2026-07-04' });
    const kpi = buildKpi(
      { supplyLog: { key: 'supplyLog', kind: 'supply', status: 'ok', rows: parsed.rows, tabs: parsed.tabs } },
      { score: null, counts: {}, total: 0, bySource: {} },
      { today: '2026-07-04' }
    ).supply;

    const g = kpi.items.find((i) => i.item === 'ถุงมือไนไตรสีดำ Size M');
    assert.equal(g.unitPrice, 126, 'ต้องใช้ 126 จากคอลัมน์ H ไม่ใช่ 999 จากตารางสั่งของ');
    const m = kpi.items.find((i) => i.item === 'ไม้ถูพื้น');
    assert.equal(m.unitPrice, null, 'คอลัมน์ H ว่าง = ไม่มีราคา ห้ามตกไปใช้ 149 ของเก่า');
    assert.equal(m.orderQty, 3, 'จำนวนสั่งซื้อยังอ่านจากตารางสั่งของตามเดิม');

    // มูลค่าตามตารางสั่งซื้อต้องตีราคาใหม่ด้วย: 4 กล่อง × 126 = 504 (ไม้ถูพื้นไม่มีราคา = ไม่นับ)
    assert.equal(kpi.order.totalAmount, 504);
    assert.equal(kpi.order.items.find((o) => o.item === 'ไม้ถูพื้น').amount, null);
  });

  test('ของที่ต้องสั่งซื้อแต่ไม่มีราคา ต้องออก finding ที่ชี้ไปคอลัมน์ H', () => {
    const mop = {
      gid: '201',
      name: '30.ไม้ถูพื้น',
      rows: [
        ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/07/2569', '0', '', '1', 'ด้าม', '5', '-4'],
      ],
    };
    const parsed = parseSupplyLog({ tabs: [mop], today: '2026-07-04' });
    const sources = {
      supplyLog: { key: 'supplyLog', kind: 'supply', status: 'ok', rows: parsed.rows, tabs: parsed.tabs },
    };
    const analysis = analyze(sources);
    const kpi = buildKpi(sources, analysis, { today: '2026-07-04' });
    const f = verifyPresentation(analysis, kpi, sources).findings.find(
      (x) => x.id === 'supply.missingPrice'
    );
    assert.ok(f, 'ต้องมี finding เตือนว่ายังไม่มีราคา');
    assert.match(f.field, /คอลัมน์ H/, 'ต้องบอกว่าไปเติมที่ไหน');
    assert.doesNotMatch(f.messageTh, /สั่งของรายเดือน/, 'ห้ามชี้ไปแท็บเก่าที่เลิกใช้ราคาแล้ว');
  });

  test('ป้ายราคาของหลายหน่วย ต้องออก finding บอกให้ไปแก้ที่ชีต', () => {
    const bags = {
      gid: '202',
      name: '14.ถุงร้อนบรรจุสินค้า 18x28',
      rows: [
        ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index', 'ราคา/ 5 แพ็ค=5 กิโล'],
        ['01/07/2569', '0', '', '9', 'แพ็ค', '5', '4', '420'],
      ],
    };
    const parsed = parseSupplyLog({ tabs: [bags], today: '2026-07-04' });
    const sources = {
      supplyLog: { key: 'supplyLog', kind: 'supply', status: 'ok', rows: parsed.rows, tabs: parsed.tabs },
    };
    const analysis = analyze(sources);
    const kpi = buildKpi(sources, analysis, { today: '2026-07-04' });
    const f = verifyPresentation(analysis, kpi, sources).findings.find(
      (x) => x.id === 'supply.priceNotPerUnit'
    );
    assert.ok(f, 'ต้องเตือนว่าราคานี้เป็นของหลายหน่วย');
    assert.equal(f.actual, 5);
    assert.match(f.messageTh, /แพ็ค/, 'ต้องบอกหน่วยที่ชีตเขียนไว้');
    assert.equal(f.tab, '14.ถุงร้อนบรรจุสินค้า 18x28', 'ต้องชี้แท็บที่ต้องไปแก้');
  });
});

/* ═══════════════════════════════════════════════════════════════
   ดูสต๊อกย้อนหลัง ณ วันที่ที่เลือก

   คิดในเบราว์เซอร์จาก items[].log ที่ payload ส่งมาอยู่แล้ว
   ต้องใช้กฎเดียวกับที่ parser คิด "ยอดปัจจุบัน" เป๊ะ ๆ ไม่งั้นเลือกวันนี้
   แล้วได้เลขคนละตัวกับที่ server ส่งมา ซึ่งไม่มีทางอธิบายให้ผู้ใช้เข้าใจได้
   ═══════════════════════════════════════════════════════════════ */
describe('ยอดคงเหลือ ณ วันที่ที่เลือก', () => {
  const LOG = [
    { date: '2026-07-01', balance: 47, minimum: 16 },
    { date: '2026-07-02', issued: 5, balance: 42, minimum: 16 },
    { date: '2026-07-03', received: 10, balance: 52, minimum: 12 }, // ขั้นต่ำเปลี่ยนกลางทาง
    { date: '2026-07-10', issued: 2, balance: 50, minimum: 12 },
    { date: '2026-08-01', balance: 50, minimum: 12, future: true },
  ];

  test('เอาแถวล่าสุดที่วันที่ ≤ วันที่ที่ขอ ไม่ใช่แถวสุดท้ายของแท็บ', () => {
    assert.deepEqual(stockAt(LOG, '2026-07-02'), {
      date: '2026-07-02', balance: 42, minimum: 16, index: 26,
    });
  });

  test('วันที่ไม่มีแถวพอดี ต้องยกยอดของแถวก่อนหน้ามา', () => {
    assert.deepEqual(stockAt(LOG, '2026-07-07'), {
      date: '2026-07-03', balance: 52, minimum: 12, index: 40,
    });
  });

  /* ขั้นต่ำเปลี่ยนได้ระหว่างทาง (เจอจริง: COCO 85→38, Cuts 11→5)
   * ต้องอ่านจากแถวเดียวกับที่อ่านยอด ไม่ใช่แถวแรกของแท็บ */
  test('ขั้นต่ำต้องมาจากแถวเดียวกับยอด ไม่ใช่แถวแรก', () => {
    assert.equal(stockAt(LOG, '2026-07-01').minimum, 16);
    assert.equal(stockAt(LOG, '2026-07-31').minimum, 12, 'ขั้นต่ำเปลี่ยนเป็น 12 ตั้งแต่วันที่ 3');
  });

  test('ก่อนวันแรกของ log = ยังไม่มีข้อมูล ต้องเป็น null ไม่ใช่ 0', () => {
    assert.equal(stockAt(LOG, '2026-06-30'), null);
  });

  test('Index คำนวณใหม่เสมอ และไม่มีขั้นต่ำ = Index เป็น null ห้ามเดา', () => {
    const noMin = [{ date: '2026-07-01', balance: 9 }];
    const at = stockAt(noMin, '2026-07-05');
    assert.equal(at.balance, 9);
    assert.equal(at.minimum, null);
    assert.equal(at.index, null, 'ไม่รู้ขั้นต่ำ = บอกไม่ได้ว่าขาดหรือไม่');
  });

  test('log ว่างหรือไม่ส่งวันที่มา = null ไม่ใช่พัง', () => {
    assert.equal(stockAt([], '2026-07-01'), null);
    assert.equal(stockAt(null, '2026-07-01'), null);
    assert.equal(stockAt(LOG, ''), null);
  });

  /* **เทสต์ที่สำคัญที่สุดของชุดนี้** — เลือกวันเดียวกับที่ server ใช้ ต้องได้เลขเดียวกัน
   * ถ้าสองทางนี้แยกกันเมื่อไร ผู้ใช้จะเห็นตัวเลขเปลี่ยนตอนกดเลือกวันนี้เอง */
  test('เลือกวันเดียวกับที่ server ใช้ ต้องได้เลขเดียวกันทุกรายการ', () => {
    const tab = {
      gid: '1',
      name: '1.ถุงมือ',
      rows: [
        ['แบบฟอร์ม', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'],
        ['01/07/2569', '0', '', '47', 'กล่อง', '16', '31'],
        ['02/07/2569', '', '5', '42', 'กล่อง', '16', '26'],
        ['03/07/2569', '10', '', '52', 'กล่อง', '12', '40'],
        ['20/07/2569', '', '2', '50', 'กล่อง', '12', '38'], // อนาคตเทียบกับ today
      ],
    };
    const TODAY = '2026-07-04';
    const parsed = parseSupplyLog({ tabs: [tab], today: TODAY });
    const kpi = buildKpi(
      { supplyLog: { key: 'supplyLog', kind: 'supply', status: 'ok', rows: parsed.rows, tabs: parsed.tabs } },
      { score: null, counts: {}, total: 0, bySource: {} },
      { today: TODAY }
    ).supply;

    const item = kpi.items[0];
    const at = stockAt(item.log, TODAY);
    assert.equal(at.balance, item.balance);
    assert.equal(at.minimum, item.minimum);
    assert.equal(at.index, item.index);
    assert.equal(at.date, item.date);
    assert.equal(at.balance, 52, 'แถววันที่ 20 เป็นอนาคต ต้องไม่ถูกหยิบมา');
  });

  test('แถวลงวันที่ล่วงหน้าถูกนับเมื่อเลือกวันนั้น — จึงต้องล็อกไม่ให้เลือกวันอนาคต', () => {
    // ยืนยันพฤติกรรมของ stockAt เอง: มันไม่รู้จัก "วันนี้" การล็อกอยู่ที่ตัวช่องเลือกวัน
    assert.equal(stockAt(LOG, '2026-08-01').date, '2026-08-01');
    assert.equal(
      readSupplyFilters(new URLSearchParams('asOf=2026-12-31')).asOf,
      '2026-12-31',
      'ตัวอ่านไม่ตัดเอง — ช่องเลือกวันเป็นคนล็อกด้วย max'
    );
  });

  test('ค่า asOf ที่ไม่ใช่รูปแบบวันที่ ต้องถือว่าไม่ได้เลือก', () => {
    for (const bad of ['วันนี้', '2026-13', '2026/07/01', 'null', '../etc']) {
      assert.equal(readSupplyFilters(new URLSearchParams(`asOf=${encodeURIComponent(bad)}`)).asOf, '');
    }
    assert.equal(readSupplyFilters(new URLSearchParams('asOf=2026-07-31')).asOf, '2026-07-31');
  });

  test('เลือกวันแล้วนับเป็น "กรองอยู่" เพื่อให้ปุ่มล้างโผล่', () => {
    const base = readSupplyFilters(new URLSearchParams(''));
    assert.equal(isSupplyFiltered(base), false);
    assert.equal(isSupplyFiltered({ ...base, asOf: '2026-07-31' }), true);
    assert.equal(supplyFilterParams({ ...base, asOf: '2026-07-31' }).asOf, '2026-07-31');
  });
});

describe('เอาใบขอซื้อเดิมกลับมา', () => {
  /* **เทสต์ที่สำคัญที่สุดของชุดนี้** — เลขที่เอกสารเดินทางมาจาก URL ตรง ๆ
   * ถ้าหลุดชั้นนี้ไปได้ จะอ่านไฟล์อะไรบนดิสก์ก็ได้ผ่าน endpoint ดาวน์โหลด */
  test('เลขที่ที่ไม่ตรงรูปแบบต้องถูกปฏิเสธทั้งหมด', () => {
    const bad = [
      '../../config/users.json',
      '../../../etc/passwd',
      'PR-20260812-001/../../users',
      'PR-20260812-001/../PR-20260812-002',
      '..%2f..%2fconfig%2fusers.json',
      'PR-2026-1',
      'PR-20260812-1',
      'PR-20260812-0011',
      'pr-20260812-001',
      'PR-20260812-001.xlsx',
      'PR-20260812-001 ',
      '',
      null,
      undefined,
      42,
      {},
    ];
    for (const docNo of bad) {
      assert.equal(requestFilePath(docNo), null, `ต้องปฏิเสธ: ${JSON.stringify(docNo)}`);
    }
  });

  test('เลขที่ถูกรูปแบบ → ได้พาธที่อยู่ใน data/purchase-requests เท่านั้น', () => {
    const hit = requestFilePath('PR-20260812-003');
    assert.equal(hit.fileName, 'PR-20260812-003.xlsx');
    assert.ok(
      hit.fullPath.replace(/\\/g, '/').endsWith('/data/purchase-requests/PR-20260812-003.xlsx'),
      `พาธหลุดออกนอกโฟลเดอร์: ${hit.fullPath}`
    );
  });

  /* ทะเบียนโตขึ้นเรื่อย ๆ ไม่มีเพดาน ถ้าส่งทั้งก้อน payload จะใหญ่ขึ้นทุกวัน */
  test('ทะเบียนที่แนบไป payload เรียงใหม่ก่อนแล้วตัดที่ 50 ใบ', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({
      docNo: `PR-20260101-${String(i + 1).padStart(3, '0')}`,
      createdAt: `2026-01-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
      form: 'general',
      totalAmount: i,
      items: [{ item: 'x', qty: 1, unitPrice: 5, balanceAtRequest: 0 }],
    }));
    // สลับลำดับก่อน เพื่อพิสูจน์ว่าเรียงเอง ไม่ได้พึ่งลำดับที่มาในไฟล์
    const out = recentRequests([...many].reverse());
    assert.equal(out.length, 50);
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i - 1].createdAt >= out[i].createdAt, 'ต้องเรียงใหม่ก่อนเสมอ');
    }
    // ตัดช่องที่หน้าเว็บไม่ใช้ออก — ราคาต่อหน่วยกับยอดคงเหลือตอนขอไม่ได้ขึ้นบนแผงประวัติ
    assert.deepEqual(Object.keys(out[0].items[0]), ['item', 'qty']);
  });

  test('ทะเบียนว่างหรืออ่านไม่ได้ = ลิสต์ว่าง ไม่ใช่พัง', () => {
    assert.deepEqual(recentRequests([]), []);
    assert.deepEqual(recentRequests(null), []);
    assert.deepEqual(recentRequests(undefined), []);
  });

  test('ยอดรวมที่ไม่ใช่ตัวเลขต้องเป็น null ห้ามกลายเป็น 0', () => {
    const [row] = recentRequests([
      { docNo: 'PR-20260812-001', createdAt: '2026-08-12T00:00:00.000Z', totalAmount: null, items: [] },
    ]);
    assert.equal(row.totalAmount, null);
    assert.equal(row.form, 'general', 'ใบเก่าที่ไม่มีช่อง form ให้ถือเป็นฟอร์มวัสดุ');
  });
});

describe('ใบขอซื้อ (.xlsx)', () => {
  const known = [
    { item: 'รองเท้า', unit: 'คู่', unitPrice: 88, balance: 20, minimum: 30 },
    { item: 'ไม้รีดน้ำ', unit: 'ด้าม', unitPrice: null, balance: 4, minimum: 9 },
  ];

  test('ปฏิเสธข้อมูลที่เชื่อไม่ได้จากเบราว์เซอร์', () => {
    assert.equal(validateItems([{ item: 'รองเท้า', qty: -5 }], known).items.length, 0);
    assert.equal(validateItems([{ item: 'รองเท้า', qty: 0 }], known).items.length, 0);
    assert.equal(validateItems([{ item: 'รองเท้า', qty: 'abc' }], known).items.length, 0);
    assert.equal(validateItems([{ item: 'ของที่ไม่มีในชีต', qty: 1 }], known).items.length, 0);
    assert.equal(validateItems([], known).items.length, 0);
    assert.equal(validateItems(Array(301).fill({ item: 'รองเท้า', qty: 1 }), known).items.length, 0);
  });

  test('ราคามาจากชีตเสมอ ไม่ใช่จากที่เบราว์เซอร์ส่งมา', () => {
    const { items } = validateItems([{ item: 'รองเท้า', qty: 10, unitPrice: 99999 }], known);
    assert.equal(items[0].unitPrice, 88, 'ราคาที่ client ส่งมาต้องถูกทับด้วยราคาจริงจากชีต');
    assert.equal(items[0].amount, 880);
  });

  test('ของที่ไม่มีราคาในชีตต้องได้ยอดเป็น null ไม่ใช่ 0', () => {
    const { items } = validateItems([{ item: 'ไม้รีดน้ำ', qty: 9 }], known);
    assert.equal(items[0].amount, null, 'คิดเป็น 0 จะทำให้ยอดรวมในใบขอซื้อต่ำกว่าจริง');
  });

  /* บริษัทใช้แบบฟอร์มปุ๋ย (Athena/Coco/Co2) คนละแบบกับฟอร์มวัสดุทั่วไป
   * เลือกปนกันมาในครั้งเดียวจึงต้องออกสองใบ ไม่ใช่ยัดลงใบเดียว */
  test('แยกใบตามกลุ่ม — ปุ๋ยคนละใบกับวัสดุทั่วไป', () => {
    const mixed = [
      { item: 'รองเท้า', unit: 'คู่', unitPrice: 88, group: 'item' },
      { item: 'Pro Bloom', unit: 'ถุง', unitPrice: 4250, group: 'nutrient' },
      { item: 'COCO', unit: 'ถุง', unitPrice: 350, group: 'nutrient' },
    ];
    const groups = splitByForm(mixed);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].form, 'general', 'วัสดุทั่วไปต้องมาก่อน เลขที่เอกสารจะได้คาดเดาได้');
    assert.deepEqual(groups[0].items.map((i) => i.item), ['รองเท้า']);
    assert.equal(groups[1].form, 'nutrient');
    assert.deepEqual(groups[1].items.map((i) => i.item), ['Pro Bloom', 'COCO']);

    // เลือกกลุ่มเดียวต้องได้ใบเดียว ไม่ใช่ใบเปล่าพ่วงมาด้วย
    assert.equal(splitByForm([mixed[0]]).length, 1);
    assert.equal(splitByForm([mixed[1]]).length, 1);
    assert.equal(splitByForm([]).length, 0);
  });

  test('group มาจากชีตเสมอ ไม่ใช่จากที่เบราว์เซอร์ส่งมา', () => {
    const src = [{ item: 'รองเท้า', unit: 'คู่', unitPrice: 88, group: 'item' }];
    // client แกล้งส่ง group: 'nutrient' มาเพื่อให้ออกฟอร์มผิดแบบ
    const { items } = validateItems([{ item: 'รองเท้า', qty: 1, group: 'nutrient' }], src);
    assert.equal(items[0].group, 'item');
  });

  test('ไฟล์ที่สร้างเป็น ZIP ที่แกะกลับได้ และค่าในเซลล์ตรงกับที่ใส่ไป', () => {
    const buf = buildXlsx({
      sheetName: 'ทดสอบ',
      rows: [
        ['รายการ', 'จำนวน'],
        ['ถุงมือไนไตร "M" & L', 1234.5],
      ],
      modified: new Date(Date.UTC(2026, 7, 3)),
    });

    assert.equal(buf.readUInt32LE(0), 0x04034b50, 'ไม่ใช่ไฟล์ ZIP');

    const text = buf.toString('latin1');
    for (const name of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]) {
      assert.ok(text.includes(name), `ไฟล์ ${name} หายไป — Excel จะเปิดไม่ได้`);
    }

    // แกะ sheet1.xml ออกมาจริง แล้วอ่านค่ากลับ (จำลองสิ่งที่ Excel ทำ)
    const marker = 'xl/worksheets/sheet1.xml';
    const at = text.indexOf(marker);
    const compressedSize = buf.readUInt32LE(at - 30 + 18);
    const sheet = inflateRawSync(
      buf.subarray(at + marker.length, at + marker.length + compressedSize)
    ).toString('utf8');

    assert.ok(sheet.includes('ถุงมือไนไตร'), 'ข้อความไทยหายหรือเพี้ยน');
    assert.ok(sheet.includes('&quot;M&quot; &amp; L'), 'ต้อง escape อักขระ XML');
    assert.ok(sheet.includes('<v>1234.5</v>'), 'ตัวเลขต้องเก็บเป็นตัวเลข ไม่ใช่ข้อความ');
  });

  test('แปลงเลขคอลัมน์เป็นตัวอักษรแบบ Excel', () => {
    assert.equal(columnLetter(0), 'A');
    assert.equal(columnLetter(25), 'Z');
    assert.equal(columnLetter(26), 'AA');
    assert.equal(columnLetter(27), 'AB');
  });

  test('ตัดอักขระควบคุมที่ทำให้ Excel ฟ้องว่าไฟล์เสีย', () => {
    assert.equal(escapeXml(`a${String.fromCharCode(0)}b`), 'ab');
    assert.equal(escapeXml(`a${String.fromCharCode(7)}b`), 'ab');
    assert.equal(escapeXml('<x>'), '&lt;x&gt;');
  });
});

// ─────────────────────────────────────────────────────────────
describe('เกณฑ์ของที่ต้องสั่งซื้อ และการจับการเบิกผิดปกติ', () => {
  const tab = (name, rows) => ({ gid: name, name, rows });
  const head = ['h', 'รับ', 'เบิก', 'คงเหลือ', 'หน่วย', 'ขั้นต่ำ', 'Index'];

  const kpiFrom = (tabs, today = '2026-08-03') => {
    const parsed = parseSupplyLog({ tabs, today });
    return buildKpi(
      {
        supplyLog: {
          key: 'supplyLog',
          kind: 'supply',
          status: 'ok',
          rows: parsed.rows,
          tabs: parsed.tabs,
          rowCount: parsed.rows.length,
        },
      },
      { score: null, counts: {}, total: 0, bySource: {} }
    ).supply;
  };

  /* เกณฑ์คือ Index ≤ 0 — ของที่คงเหลือ "เท่าขั้นต่ำพอดี" ต้องเข้ารายการด้วย
   * เพราะระหว่างรอของตาม Lead Time (5–7 วันตามที่เขียนในชีต) ของจะถูกเบิกจน
   * ต่ำกว่าขั้นต่ำแน่นอน ถ้ารอให้ติดลบก่อนค่อยสั่งก็สายไปแล้ว (ผู้ใช้กำหนด) */
  test('เข้ารายการต้องสั่งซื้อเมื่อ Index ≤ 0 (เท่าขั้นต่ำพอดีก็ต้องสั่ง)', () => {
    const kpi = kpiFrom([
      tab('1.ขาด', [head, ['01/08/2569', '', '', '3', 'ชิ้น', '10', '-7']]),
      tab('2.พอดี', [head, ['01/08/2569', '', '', '10', 'ชิ้น', '10', '0']]),
      tab('3.เหลือเฟือ', [head, ['01/08/2569', '', '', '50', 'ชิ้น', '10', '40']]),
    ]);
    // ขาดหนักกว่าขึ้นก่อน
    assert.deepEqual(kpi.needsReorder.map((r) => r.item), ['ขาด', 'พอดี']);
    assert.equal(kpi.needsReorder[0].index, -7);
    assert.equal(kpi.needsReorder[0].shortfall, 7);
    assert.equal(kpi.needsReorder[1].index, 0);
    // ของที่พอดีขั้นต่ำยังไม่ได้ขาด จำนวนที่ควรสั่งจึงมาจากขั้นต่ำ ไม่ใช่ 0
    assert.ok(kpi.needsReorder[1].suggestedQty > 0);
  });

  /* ระยะเวลารอของถูกเขียนแทรกไว้ในหัวตาราง ไม่ใช่คอลัมน์
   * ในชีตจริงเขียนกันสามแบบ ต่างแค่ขีดกับตัวพิมพ์ใหญ่เล็ก — ต้องอ่านได้ทั้งหมด */
  test('อ่าน Lead Time จากหัวตารางได้ทุกแบบที่เขียนกันในชีต', () => {
    assert.equal(parseLeadTimeDays('… ใช้ 14 แผง/ crop Lead Time - 5 Days จะสั่งครั้งละ 2 ลัง'), 5);
    assert.equal(parseLeadTimeDays('สั่งครั้งละ 2 แพ็ค Lead time 7 days (ราคาแพ็คละ 155 บาท)'), 7);
    assert.equal(parseLeadTimeDays('lead time 14 days'), 14);
    assert.equal(parseLeadTimeDays('Lead Time 10 Days'), 10);
    assert.equal(parseLeadTimeDays('ระยะเวลารอของ lead time 3 วัน'), 3);
    // ไม่มีเขียนไว้ = null ห้ามเดาเป็น 0 เพราะเลขที่เดาจะถูกเอาไปคิดต่อแล้วผิดเงียบ ๆ
    assert.equal(parseLeadTimeDays('แบบฟอร์มเบิกของและของคงเหลือ ถุงมือ'), null);
    assert.equal(parseLeadTimeDays(''), null);
    assert.equal(parseLeadTimeDays(null), null);
  });

  test('Lead Time เดินทางจาก parser ไปถึง kpi ของแต่ละรายการ', () => {
    const withLead = ['แบบฟอร์มเบิกของและของคงเหลือ Rockwool Lead Time - 5 Days', ...head.slice(1)];
    const kpi = kpiFrom([
      tab('1.มีรอของ', [withLead, ['01/08/2569', '', '', '3', 'แผง', '10', '-7']]),
      tab('2.ไม่มีรอของ', [head, ['01/08/2569', '', '', '3', 'ชิ้น', '10', '-7']]),
    ]);
    const byItem = new Map(kpi.items.map((i) => [i.item, i]));
    assert.equal(byItem.get('มีรอของ').leadTimeDays, 5);
    assert.equal(byItem.get('ไม่มีรอของ').leadTimeDays, null);
    // ต้องติดไปกับรายการที่ต้องสั่งซื้อด้วย ไม่งั้นตารางสั่งของแสดงไม่ได้
    assert.equal(kpi.needsReorder.find((r) => r.item === 'มีรอของ').leadTimeDays, 5);
  });

  test('Index คำนวณใหม่จากคงเหลือ − ขั้นต่ำ ไม่เชื่อช่อง Index ในชีต', () => {
    // ชีตพิมพ์ Index เป็น 99 ทั้งที่ของขาด — ต้องยังเข้ารายการต้องสั่งซื้อ
    const kpi = kpiFrom([tab('1.ของ', [head, ['01/08/2569', '', '', '1', 'ชิ้น', '10', '99']])]);
    assert.equal(kpi.needsReorder.length, 1);
    assert.equal(kpi.needsReorder[0].index, -9);
  });

  test('ข้อมูลไม่พอต้องบอกตรง ๆ ว่ายังเทียบไม่ได้ ไม่ใช่เดา', () => {
    const kpi = kpiFrom([
      tab('1.ของ', [head, ['05/07/2569', '', '5', '20', 'ชิ้น', '2', '18']]),
    ]);
    assert.equal(kpi.usageAnomalies.ready, false);
    assert.equal(kpi.usageAnomalies.items.length, 0);
    assert.ok(kpi.usageAnomalies.monthsNeeded >= 3);
  });

  /* กับดักหลักของหน้านี้: เดือนล่าสุดยังไม่จบ
   * ถ้าเทียบยอดรวมดิบ ของที่เบิกปกติจะดู "ต่ำผิดปกติ" หมดทุกตัวตั้งแต่ต้นเดือน */
  test('เดือนที่ยังไม่จบต้องเทียบเป็นอัตราต่อวัน ไม่ใช่ยอดรวมดิบ', () => {
    const rows = [head];
    // มิ.ย. กับ ก.ค. เบิกเดือนละ 30 ชิ้น (วันละ 1)
    for (const m of ['06', '07']) {
      for (let d = 1; d <= 30; d++) {
        rows.push([`${String(d).padStart(2, '0')}/${m}/2569`, '', '1', '100', 'ชิ้น', '5', '95']);
      }
    }
    // ส.ค. ผ่านมา 3 วัน เบิกไป 3 ชิ้น = อัตราเดิมเป๊ะ ต้องไม่ถูกเตือน
    for (let d = 1; d <= 3; d++) {
      rows.push([`0${d}/08/2569`, '', '1', '100', 'ชิ้น', '5', '95']);
    }
    const kpi = kpiFrom([tab('1.ของปกติ', rows)], '2026-08-03');

    assert.equal(kpi.usageAnomalies.ready, true, 'มีสองเดือนเต็มแล้ว ควรเทียบได้');
    assert.equal(kpi.usageAnomalies.daysElapsed, 3);
    assert.equal(
      kpi.usageAnomalies.items.length,
      0,
      'เบิกในอัตราเดิม ต้องไม่ถูกเตือนแค่เพราะเดือนยังไม่จบ'
    );
  });

  test('จับได้เมื่อเดือนนี้เบิกในอัตราที่สูงกว่าปกติ', () => {
    const rows = [head];
    for (const m of ['06', '07']) {
      for (let d = 1; d <= 30; d++) {
        rows.push([`${String(d).padStart(2, '0')}/${m}/2569`, '', '1', '500', 'ชิ้น', '5', '495']);
      }
    }
    // ส.ค. 3 วันแรกเบิกไป 15 ชิ้น = วันละ 5 (สูงกว่าปกติ 5 เท่า)
    for (let d = 1; d <= 3; d++) {
      rows.push([`0${d}/08/2569`, '', '5', '500', 'ชิ้น', '5', '495']);
    }
    const kpi = kpiFrom([tab('1.ของพุ่ง', rows)], '2026-08-03');

    const hit = kpi.usageAnomalies.items.find((i) => i.item === 'ของพุ่ง');
    assert.ok(hit, 'ควรถูกจับว่าเบิกผิดปกติ');
    assert.equal(hit.direction, 'high');
    assert.equal(hit.current, 15);
    assert.ok(hit.ratio >= 4, `อัตราควรสูงกว่าปกติหลายเท่า (ได้ ${hit.ratio})`);
  });
});
