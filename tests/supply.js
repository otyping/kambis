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
import { analyze } from '../server/lib/analysis.js';
import { buildKpi } from '../server/lib/aggregate.js';
import { comparePeriod, parseSheetDate } from '../server/lib/normalize.js';
import { buildXlsx, columnLetter, escapeXml } from '../server/lib/xlsx.js';
import { validateItems } from '../server/lib/purchase-request.js';

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
