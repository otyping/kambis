/**
 * tests/ui.js — ตรรกะฝั่งเบราว์เซอร์ที่ไม่แตะ DOM
 *
 *   node --test tests/ui.js
 *
 * ไฟล์ใน public/js/ui/ ส่วนใหญ่แตะ DOM จึงเทสต์ที่นี่ไม่ได้ แต่สามส่วนนี้เป็น
 * ตรรกะล้วนและเป็นจุดที่ผิดแล้วเห็นยาก: การกรองตามปี, ทะเบียนข้อมูลที่ยังขาด,
 * และกฎการเรียงคอลัมน์ช่วงเวลาของตาราง
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  readFilters,
  writeFilters,
  recordYear,
  resolveYear,
  resolveFilters,
  applyFilters,
  filterSources,
  filterOptions,
} from '../public/js/ui/filters.js';
import { dataGaps } from '../public/js/ui/gaps.js';
import {
  readSupplyFilters,
  supplyFilterParams,
  supplyMatcher,
  supplyLookup,
  SUPPLY_GROUPS,
} from '../public/js/ui/supply-filters.js';
import { looksLikePeriod, comparePeriod } from '../public/js/shared/agg-core.js';
import { parseHash, toHash } from '../public/js/router.js';
import { tabUrl, sheetUrlOf } from '../public/js/ui/sheet-link.js';
import { collectNotices } from '../public/js/ui/notices.js';
import { t, setLang } from '../public/js/i18n.js';
import { countdown, monthLong, dateFull } from '../public/js/format.js';
import {
  monthGrid,
  addDays,
  addMonths,
  isDisabled,
  clampISO,
  keyTarget,
  nextEnabled,
  defaultPresets,
  defaultRangePresets,
  weekdayNames,
} from '../public/js/ui/datepicker.js';

/** record ย่อ ๆ พอให้ตัวกรองทำงานได้ */
const rec = (extra) => ({ sizes: {}, nonFlower: {}, flowerTotal: 100, ...extra });

describe('ตัวกรองปี — ค่าเริ่มต้นต้องเป็นปีล่าสุดที่มีข้อมูล', () => {
  test('อ่านปีของ record ได้จากวันที่ รอบปลูก และไตรมาส', () => {
    assert.equal(recordYear(rec({ date: '2026-07-15' })), '2026');
    // รายงานต่อครอปบางแถวไม่มี date แต่มีวันเก็บเกี่ยวในรอบปลูก
    assert.equal(recordYear(rec({ cycle: { harvest: '2025-11-02' } })), '2025');
    // แถวที่เหลือมีแต่ป้ายไตรมาส
    assert.equal(recordYear(rec({ quarter: "Q2'2025" })), '2025');
    // สินค้าคงเหลือเป็นภาพนิ่งของ "ตอนนี้" ไม่ผูกกับปีใดปีหนึ่ง
    assert.equal(recordYear(rec({ location: 'Stock กรุงเทพ' })), null);
  });

  test('ไม่ได้เลือกเอง = ปีล่าสุด · เลือก all = ทุกปี · เลือกปีไหนได้ปีนั้น', () => {
    const years = ['2026', '2025'];
    assert.equal(resolveYear({ year: '' }, years), '2026');
    assert.equal(resolveYear({ year: 'all' }, years), null);
    assert.equal(resolveYear({ year: '2025' }, years), '2025');
    // ยังไม่มีข้อมูลเลยก็ต้องไม่พัง และต้องไม่ไปกรองอะไรทิ้ง
    assert.equal(resolveYear({ year: '' }, []), null);
  });

  test('URL แยก "ยังไม่ได้เลือก" ออกจาก "เลือกทุกปี" ได้', () => {
    // ไม่มี year ใน URL = ค่าเริ่มต้น (ปีล่าสุด)
    assert.equal(readFilters(new URLSearchParams('')).year, '');
    // 'all' ต้องถูกเขียนลง URL ไม่งั้นกดรีเฟรชแล้วเด้งกลับไปปีล่าสุด
    assert.equal(String(writeFilters({ ...readFilters(new URLSearchParams('')), year: 'all' })), 'year=all');
    assert.equal(readFilters(new URLSearchParams('year=all')).year, 'all');
    assert.equal(readFilters(new URLSearchParams('year=2025')).year, '2025');
  });

  test('กรองปีแล้วเหลือเฉพาะปีนั้น แต่แถวที่ไม่มีปีต้องไม่หาย', () => {
    const rows = [
      rec({ date: '2026-07-01' }),
      rec({ date: '2025-07-01' }),
      rec({ quarter: "Q2'2025" }),
      rec({ location: 'Stock หัวหิน' }), // ไม่มีปี — เป็นภาพนิ่งของตอนนี้
    ];
    const options = filterOptions({ x: { rows } });
    assert.deepEqual(options.years, ['2026', '2025']); // ใหม่→เก่า

    const base = readFilters(new URLSearchParams(''));
    const latest = applyFilters(rows, resolveFilters(base, options), 'dailyTrim');
    assert.equal(latest.length, 2, 'ต้องเหลือแถวปี 2026 กับแถวที่ไม่มีปี');
    assert.ok(latest.some((r) => r.date === '2026-07-01'));
    assert.ok(latest.some((r) => r.location === 'Stock หัวหิน'));

    const old = applyFilters(rows, resolveFilters({ ...base, year: '2025' }, options), 'dailyTrim');
    assert.equal(old.length, 3, '2025 มีสองแถว บวกแถวที่ไม่มีปี');

    const all = applyFilters(rows, resolveFilters({ ...base, year: 'all' }, options), 'dailyTrim');
    assert.equal(all.length, 4);
  });

  test('ตัวกรองปีทำงานร่วมกับตัวกรองอื่นแบบ AND', () => {
    const rows = [
      rec({ date: '2026-07-01', strain: 'Shogun' }),
      rec({ date: '2026-07-02', strain: 'Gelato' }),
      rec({ date: '2025-07-01', strain: 'Shogun' }),
    ];
    const f = resolveFilters(
      { ...readFilters(new URLSearchParams('')), strains: new Set(['Shogun']) },
      filterOptions({ x: { rows } })
    );
    const out = applyFilters(rows, f, 'dailyTrim');
    assert.equal(out.length, 1);
    assert.equal(out[0].date, '2026-07-01');
  });
});

describe('แถบตัวกรองกลางกับรายงานที่ไม่ใช่ข้อมูลดอก', () => {
  /* แถวงบการเงินไม่มี strain / crop / sizes เลย ถ้าปล่อยให้ผ่าน applyFilters
   * ตัวกรองสายพันธุ์จะเทียบ has('') ได้ false และตัวกรองขนาดจะตัดทิ้งเพราะ
   * flowerTotal เป็น null — ทั้งชีตหายเกลี้ยงโดยไม่มีอะไรฟ้อง แล้วงบทั้งหน้า
   * ต้นทุนจะกลายเป็นศูนย์ นี่คือ regression ที่ราคาแพงที่สุดของงานนี้ */
  const financeRow = {
    date: '2026-01-01',
    month: '2026-01',
    kind: 'summary',
    line: 'revenue',
    amount: 100,
    strain: null,
    crop: null,
    sizes: {},
    nonFlower: {},
    flowerTotal: null,
  };

  /** ตัวกรองที่ "ควรจะ" ลบแถวงบทิ้งทั้งหมดถ้าไม่มีการ์ดกัน */
  const harshFilters = () =>
    resolveFilters(
      {
        ...readFilters(new URLSearchParams('')),
        strains: new Set(['Gelato']),
        sizes: new Set(['XXL']),
      },
      { years: ['2026'] }
    );

  const build = (kind) => ({
    dailyTrim: {
      kind: 'flower',
      rowCount: 1,
      rows: [rec({ date: '2026-07-01', strain: 'Shogun', sizes: { L: 100 } })],
    },
    cost: { kind, rowCount: 1, rows: [financeRow] },
  });

  test('แถวการเงินรอดจากตัวกรองที่ควรจะลบมันเกลี้ยง — และเป็น object เดิม', () => {
    const src = build('finance');
    const out = filterSources(src, harshFilters());

    assert.equal(out.dailyTrim.rows.length, 0, 'ฝั่งดอกต้องถูกกรองตามปกติ');
    assert.equal(out.cost.rows.length, 1, 'ฝั่งการเงินต้องไม่ถูกแตะ');
    // identity — พิสูจน์ว่าไม่ได้ก๊อปแล้วคำนวณใหม่ และไม่ได้แก้ของเดิม
    assert.equal(out.cost, src.cost);
    assert.equal(out.cost.rows[0], src.cost.rows[0]);
  });

  test('รายงานวัสดุสิ้นเปลืองก็ผ่านไปทั้งก้อนเหมือนกัน', () => {
    const out = filterSources(build('supply'), harshFilters());
    assert.equal(out.cost.rows.length, 1);
  });

  test('source ที่ไม่มี kind ยังถูกกรอง (กัน payload เก่าจากแคช)', () => {
    const src = { dailyTrim: { rowCount: 2, rows: [rec({ date: '2026-07-01', strain: 'Shogun' })] } };
    const out = filterSources(src, harshFilters());
    assert.equal(out.dailyTrim.rows.length, 0);
  });

  test('rowCount เดินตามแถวที่กรองแล้ว ส่วนยอดทั้งชีตอยู่ที่ rowCountAll', () => {
    const src = {
      dailyTrim: {
        kind: 'flower',
        rowCount: 3,
        rows: [
          rec({ date: '2026-07-01', strain: 'Shogun' }),
          rec({ date: '2025-07-01', strain: 'Shogun' }),
          rec({ date: '2025-08-01', strain: 'Shogun' }),
        ],
      },
      cost: { kind: 'finance', rowCount: 9, rows: [financeRow] },
    };
    const f = resolveFilters(readFilters(new URLSearchParams('year=2026')), { years: ['2026', '2025'] });
    const out = filterSources(src, f);

    assert.equal(out.dailyTrim.rows.length, 1);
    assert.equal(out.dailyTrim.rowCount, 1, 'ต้องเป็นจำนวนแถวที่เห็นจริง');
    assert.equal(out.dailyTrim.rowCountAll, 3, 'ยอดทั้งชีตต้องยังอ่านได้');
    // รายงานที่ถูกข้ามต้องไม่ถูกแตะเลย แม้แต่ฟิลด์นับแถว
    assert.equal(out.cost.rowCount, 9);
    assert.equal(out.cost.rowCountAll, undefined);
  });

  test('ปีเริ่มต้นต้องมาจากผลผลิตจริง ไม่ใช่จากงบที่ตั้งไว้ล่วงหน้า', () => {
    /* ชีตต้นทุนกรอกค่าเสื่อมกับ Office ล่วงหน้าถึงสิ้นปีเสมอ วันที่มีคนตั้งงบปีหน้า
     * ถ้านับปีจากชีตนั้นด้วย ปีเริ่มต้นจะเด้งไปปีที่ยังไม่มีผลผลิตสักแถว
     * แล้ว Dashboard ทั้งอันจะเปิดมาว่างเปล่า */
    const options = filterOptions({
      perCrop: { kind: 'flower', rows: [rec({ quarter: "Q2'2025" })] },
      cost: { kind: 'finance', rows: [rec({ date: '2027-01-01' })] },
    });
    assert.deepEqual(options.years, ['2025']);
    assert.equal(resolveYear({ year: '' }, options.years), '2025');
  });
});

describe('ทะเบียนข้อมูลที่ยังขาด', () => {
  const meta = {
    sources: [
      { key: 'sales', titleTh: 'การขายดอก', sheetUrl: 'https://example.test/sales' },
      { key: 'inventory', titleTh: 'สินค้าคงเหลือ', sheetUrl: 'https://example.test/inv' },
      { key: 'perCrop', titleTh: 'ต่อครอป', sheetUrl: 'https://example.test/crop' },
      { key: 'supplyLog', titleTh: 'Log Stock', sheetUrl: 'https://example.test/supply' },
    ],
  };

  test('ทุกข้อต้องบอกได้ว่าไปเพิ่มที่ชีตไหน (กฎข้อ 10)', () => {
    for (const report of ['dryflower', 'supply']) {
      const gaps = dataGaps(report, { meta });
      assert.ok(gaps.length > 0, `${report} ต้องมีรายการที่ขาดอย่างน้อยหนึ่งข้อ`);
      for (const gap of gaps) {
        assert.ok(gap.title, 'ต้องมีหัวข้อ');
        assert.ok(gap.why, 'ต้องบอกเหตุผล');
        assert.ok(gap.sheet, `${gap.id} ไม่ได้บอกว่าต้องไปเพิ่มที่ชีตไหน`);
        assert.ok(gap.columns.length > 0, `${gap.id} ไม่ได้บอกว่าต้องเพิ่มคอลัมน์อะไร`);
      }
    }
  });

  test('รายงาน Dryflower กับ Supply ต้องไม่ปนกัน', () => {
    const dry = dataGaps('dryflower', { meta }).map((g) => g.id);
    const sup = dataGaps('supply', { meta }).map((g) => g.id);
    // ชีตต้นทุนให้รายได้รวมมาแล้ว ที่ยังขาดคือการแยกว่ารายได้มาจากใคร
    assert.ok(dry.includes('revenueSplit'));
    assert.ok(!dry.includes('revenue'), 'รายได้รวมมีข้อมูลแล้ว ต้องไม่ค้างอยู่ในรายการที่ขาด');
    assert.ok(!dry.includes('prodCost'), 'ต้นทุนการผลิตมีข้อมูลแล้ว ต้องไม่ค้างอยู่');
    assert.ok(!dry.some((id) => sup.includes(id)));
    assert.ok(sup.includes('supplyPrice'));
  });

  test('ข้อที่ข้อมูลครบแล้วต้องหายไป ไม่ค้างให้คนเข้าใจผิด', () => {
    const withGaps = dataGaps('supply', {
      meta,
      kpi: {
        needsReorder: [{ unitPrice: null }, { unitPrice: 12 }],
        order: { items: [{}] },
        usageAnomalies: { ready: false, monthsAvailable: 1, monthsNeeded: 3 },
      },
    });
    assert.ok(withGaps.some((g) => g.id === 'supplyPrice'));
    assert.match(withGaps.find((g) => g.id === 'supplyPrice').detail, /1 จาก 2/);
    assert.ok(withGaps.some((g) => g.id === 'supplyBaseline'));

    const filled = dataGaps('supply', {
      meta,
      kpi: {
        needsReorder: [{ unitPrice: 5 }],
        order: { items: [{}] },
        usageAnomalies: { ready: true, items: [] },
      },
    });
    assert.ok(!filled.some((g) => g.id === 'supplyPrice'), 'ราคาครบแล้วต้องไม่ขึ้นว่าขาดราคา');
    assert.ok(!filled.some((g) => g.id === 'supplyBaseline'), 'เดือนพอแล้วต้องไม่ขึ้นว่ารอเดือน');
  });
});

describe('ตัวกรองของรายงาน Supply', () => {
  const items = [
    { item: 'ถุงมือไนไตรสีดำ Size M', group: 'item', unitPrice: 120, matchedOrderRow: 'ถุงมือ-ไนไตร สีดำ (M)' },
    { item: 'ป้ายแท็กสีน้ำเงิน', group: 'item', unitPrice: null, matchedOrderRow: null },
    { item: 'COCO', group: 'coco', unitPrice: 350, matchedOrderRow: 'COCO' },
    { item: 'Cuts', group: 'additive', unitPrice: null, matchedOrderRow: null },
  ];
  const lookup = supplyLookup(items);
  const run = (patch) =>
    items.filter(supplyMatcher({ q: '', group: 'all', price: 'all', ...patch }, lookup)).map((i) => i.item);

  test('ค้นหาชื่อได้ทั้งแบบพิมพ์ตรงและแบบเขียนต่างกันในสองที่', () => {
    assert.deepEqual(run({ q: 'ถุงมือ' }), ['ถุงมือไนไตรสีดำ Size M']);
    // ชื่อในตารางสั่งของเขียน "ป้ายแท็ก-สีน้ำเงิน" ส่วนแท็บเขียน "ป้ายแท็กสีน้ำเงิน"
    assert.deepEqual(run({ q: 'ป้ายแท็ก-สีน้ำเงิน' }), ['ป้ายแท็กสีน้ำเงิน']);
    assert.deepEqual(run({ q: 'coco' }), ['COCO']);
    assert.deepEqual(run({ q: 'ไม่มีของชิ้นนี้' }), []);
  });

  test('กรองตามหมวดและตามการมีราคา', () => {
    /* ปุ๋ยแยกเป็น 4 หมวดแล้ว (ส.ค. 69) — เลือก COCO ต้องได้ COCO อย่างเดียว
     * ไม่ใช่ได้สารเสริมติดมาด้วยเหมือนตอนที่ปุ๋ยทั้งหมดเป็นหมวดเดียวกัน */
    assert.deepEqual(run({ group: 'coco' }), ['COCO']);
    assert.deepEqual(run({ group: 'additive' }), ['Cuts']);
    assert.deepEqual(run({ group: 'item' }), ['ถุงมือไนไตรสีดำ Size M', 'ป้ายแท็กสีน้ำเงิน']);
    assert.deepEqual(run({ price: 'without' }), ['ป้ายแท็กสีน้ำเงิน', 'Cuts']);
    assert.deepEqual(run({ group: 'coco', price: 'with' }), ['COCO']);
    assert.deepEqual(run({ group: 'additive', price: 'with' }), []);
  });

  test('ตารางสั่งของที่ใช้ชื่อคนละแบบ ต้องกรองตามหมวดได้ด้วย', () => {
    // แถวจากตารางสั่งของรายเดือนไม่มีช่อง group ของตัวเอง ต้องหาจากชื่อที่จับคู่ไว้
    const orderRow = { item: 'ถุงมือ-ไนไตร สีดำ (M)', unitPrice: 120 };
    assert.ok(supplyMatcher({ q: '', group: 'item', price: 'all' }, lookup)(orderRow));
    assert.ok(!supplyMatcher({ q: '', group: 'coco', price: 'all' }, lookup)(orderRow));
  });

  /* หมวดที่ไม่รู้จักใน URL = ไม่ได้เลือก
   *
   * `group=nutrient` คือลิงก์ที่คนบุ๊กมาร์กไว้ก่อนแยกปุ๋ยเป็น 4 หมวด ถ้าปล่อยผ่าน
   * ตารางจะว่างทั้งหน้าทั้งที่ช่องเลือกหมวดโชว์ว่า "ทั้งหมด" (เพราะไม่มี option ค่านั้น
   * ให้ <select> เลือก) — อาการที่ไม่มีทางเดาสาเหตุถูกเลย */
  test('หมวดที่ไม่รู้จักใน URL ต้องตกกลับเป็นทั้งหมด', () => {
    assert.equal(readSupplyFilters(new URLSearchParams('group=nutrient')).group, 'all');
    assert.equal(readSupplyFilters(new URLSearchParams('group=<script>')).group, 'all');
    for (const g of SUPPLY_GROUPS) {
      assert.equal(readSupplyFilters(new URLSearchParams(`group=${g.code}`)).group, g.code);
    }
  });

  test('URL เก็บเฉพาะค่าที่ไม่ใช่ค่าเริ่มต้น', () => {
    assert.deepEqual(readSupplyFilters(new URLSearchParams('')), {
      year: '',
      q: '',
      group: 'all',
      price: 'all',
      asOf: '',
    });
    assert.deepEqual(supplyFilterParams({ year: '', q: '  ', group: 'all', price: 'all' }), {
      year: '',
      q: '',
      group: '',
      price: '',
      asOf: '',
    });
    assert.deepEqual(
      supplyFilterParams({
        year: '2025',
        q: ' ถุงมือ ',
        group: 'additive',
        price: 'with',
        asOf: '2026-07-31',
      }),
      {
        year: '2025',
        q: 'ถุงมือ',
        group: 'additive',
        price: 'with',
        asOf: '2026-07-31',
      }
    );
  });
});

/* ปฏิทินเลือกวันที่ — เทสต์เฉพาะชั้นคำนวณ ชั้น DOM อยู่นอกขอบเขตของไฟล์นี้
 *
 * ของที่ต้องกันให้ได้คือ **ค่าที่ไม่ใช่ YYYY-MM-DD หลุดออกไป** เพราะ `stockAt()`
 * เทียบวันที่ด้วยการเทียบสตริงตรง ๆ ไม่เคย parse — `13/08/2026` จะมากกว่าทุกแถวใน log
 * แล้วคืนแถวสุดท้ายซึ่งเป็นยอดยกมาของอนาคต โดยไม่มี error อะไรให้เห็นเลย */
describe('ลิงก์ที่เปิดตรงไปยังแท็บของ Google Sheet', () => {
  /* **ต้องมี gid ทั้งใน query และ fragment** ใส่อย่างใดอย่างหนึ่งจะเปิดที่แท็บแรกเสมอ
   * ซึ่งดูเหมือนใช้ได้ (หน้าเปิดขึ้นมา) แต่ไปผิดแท็บ — พลาดแล้วจับยาก
   * เดิมสูตรนี้ฝังอยู่ใน modal.js ที่เดียว ตอนนี้ตารางการเบิกใช้ด้วย จึงต้องมีตัวคุม */
  test('มี gid ครบทั้งสองที่', () => {
    assert.equal(tabUrl('https://x/edit', 123), 'https://x/edit?gid=123#gid=123');
    assert.equal(tabUrl('https://x/edit', '456'), 'https://x/edit?gid=456#gid=456');
  });

  test('ไม่รู้แท็บ = ลิงก์ไปที่ไฟล์เฉย ๆ ไม่ใช่ลิงก์เสีย', () => {
    // finding ระดับทั้งชีต (เช่นงบสรุปไม่ตรง) ไม่ได้ผูกกับแท็บใดแท็บหนึ่ง
    for (const gid of [null, undefined, '']) {
      assert.equal(tabUrl('https://x/edit', gid), 'https://x/edit', `gid=${String(gid)}`);
    }
  });

  test('ไม่มี sheetUrl = ต้องคืน null ห้ามสร้างลิงก์หลอก', () => {
    assert.equal(tabUrl(null, 123), null);
    assert.equal(tabUrl('', 123), null);
    assert.equal(tabUrl(undefined, undefined), null);
  });

  test('หา sheetUrl ของรายงานจาก meta ได้ และไม่พังเมื่อ meta ว่าง', () => {
    const meta = { sources: [{ key: 'supplyLog', sheetUrl: 'https://s/edit' }, { key: 'sales' }] };
    assert.equal(sheetUrlOf(meta, 'supplyLog'), 'https://s/edit');
    assert.equal(sheetUrlOf(meta, 'sales'), null, 'มี key แต่ไม่มีลิงก์ = null');
    assert.equal(sheetUrlOf(meta, 'ไม่มีจริง'), null);
    assert.equal(sheetUrlOf(null, 'supplyLog'), null);
    assert.equal(sheetUrlOf({}, 'supplyLog'), null);
  });
});

describe('เส้นทางของรายงาน Supply หลังแยกเป็นสามหน้า', () => {
  test('ลิงก์เก่า #/supply ต้องยังใช้ได้ ไม่ใช่เด้งไปหน้าแรกของ Dryflower', () => {
    /* ตอน Supply เป็นหน้าเดียว URL คือ `#/supply` เฉย ๆ ลิงก์ที่คนส่งต่อกันไว้
     * หรือ bookmark ไว้ต้องยังพาไปที่รายงานเดิม ไม่ใช่ถูกมองว่าเป็น route ผิด */
    const r = parseHash('#/supply');
    assert.equal(r.report, 'supply');
    assert.equal(r.page, 'order', 'ไม่ระบุหน้า = หน้าแรกของรายงาน');
    assert.ok(!r.unknown);
  });

  test('ทั้งสามหน้าย่อยเข้าถึงได้และประกอบ hash กลับได้ตรง', () => {
    for (const page of ['order', 'stock', 'usage']) {
      const r = parseHash(`#/supply/${page}`);
      assert.equal(r.report, 'supply');
      assert.equal(r.page, page);
      assert.equal(toHash(r), `#/supply/${page}`);
    }
  });

  test('ชื่อหน้าซ้ำกันสองรายงานต้องไม่ปนกัน', () => {
    // `stock` มีทั้งสองรายงาน — เคยเป็นเหตุให้เมนูไฮไลต์ผิดฝั่ง
    assert.equal(parseHash('#/supply/stock').report, 'supply');
    assert.equal(parseHash('#/dryflower/stock').report, 'dryflower');
  });

  test('ตัวกรองติดไปกับ hash ของหน้าย่อยได้', () => {
    const params = new URLSearchParams('q=ถุงมือ&asOf=2026-07-31');
    assert.equal(
      toHash({ report: 'supply', page: 'stock', params }),
      `#/supply/stock?${params}`
    );
  });
});

describe('ปฏิทินเลือกวันที่', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  test('ตารางเดือนมี 42 ช่องเสมอ และวันที่ 1 ตกคอลัมน์ถูก', () => {
    const aug = monthGrid('2026-08');
    assert.equal(aug.length, 42, '6 แถวคงที่ ไม่งั้นกล่องกระตุกตอนเปลี่ยนเดือน');
    assert.ok(aug.every((c) => ISO.test(c.iso)));
    // 1 ส.ค. 2026 เป็นวันเสาร์ → สัปดาห์เริ่มวันอาทิตย์ จึงมีวันเดือนก่อน 6 ช่อง
    assert.equal(aug.findIndex((c) => c.iso === '2026-08-01'), 6);
    const inMonth = aug.filter((c) => c.inMonth).map((c) => c.iso);
    assert.equal(inMonth.length, 31);
    assert.equal(inMonth[0], '2026-08-01');
    assert.equal(inMonth.at(-1), '2026-08-31');
  });

  test('เดือนกุมภาพันธ์ปีอธิกสุรทินมี 29 วัน', () => {
    assert.equal(monthGrid('2024-02').filter((c) => c.inMonth).length, 29);
    assert.equal(monthGrid('2026-02').filter((c) => c.inMonth).length, 28);
  });

  test('บวกลบวันข้ามเดือนและข้ามปีได้', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  });

  test('บวกเดือนต้องหนีบวันที่ให้อยู่ในเดือนปลายทาง', () => {
    // 31 ส.ค. + 1 เดือน ต้องเป็น 30 ก.ย. ไม่ใช่ 1 ต.ค.
    assert.equal(addMonths('2026-08-31', 1), '2026-09-30');
    assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
    assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
  });

  test('ขอบเขตรวมปลายทั้งสองข้าง — วันนี้ต้องเลือกได้ พรุ่งนี้ต้องไม่ได้', () => {
    const max = '2026-08-13';
    assert.equal(isDisabled('2026-08-13', '', max), false, 'max ต้องเลือกได้');
    assert.equal(isDisabled('2026-08-14', '', max), true, 'เลย max ไปหนึ่งวันต้องกดไม่ได้');
    assert.equal(isDisabled('2026-01-05', '2026-01-05', max), false, 'min ต้องเลือกได้');
    assert.equal(isDisabled('2026-01-04', '2026-01-05', max), true);
    assert.equal(isDisabled('', '', max), true, 'ค่าว่างไม่ใช่วันที่');
  });

  test('หนีบค่าเข้าช่วง และคืนค่าว่างเมื่อไม่ได้เลือก', () => {
    assert.equal(clampISO('2026-12-31', '', '2026-08-13'), '2026-08-13');
    assert.equal(clampISO('2025-01-01', '2026-01-05', ''), '2026-01-05');
    assert.equal(clampISO('2026-07-31', '2026-01-05', '2026-08-13'), '2026-07-31');
    assert.equal(clampISO('', '2026-01-05', '2026-08-13'), '');
  });

  test('ปุ่มลูกศรและ PageUp/PageDown ไปถูกช่อง', () => {
    assert.equal(keyTarget('2026-08-13', 'ArrowRight'), '2026-08-14');
    assert.equal(keyTarget('2026-08-13', 'ArrowLeft'), '2026-08-12');
    assert.equal(keyTarget('2026-08-01', 'ArrowUp'), '2026-07-25');
    assert.equal(keyTarget('2026-08-13', 'ArrowDown'), '2026-08-20');
    assert.equal(keyTarget('2026-08-31', 'PageDown'), '2026-09-30');
    assert.equal(keyTarget('2026-03-31', 'PageUp'), '2026-02-28');
    assert.equal(keyTarget('2026-08-13', 'PageUp', true), '2025-08-13');
    // 13 ส.ค. 2026 เป็นวันพฤหัส → ต้นสัปดาห์คืออาทิตย์ที่ 9
    assert.equal(keyTarget('2026-08-13', 'Home'), '2026-08-09');
    assert.equal(keyTarget('2026-08-13', 'End'), '2026-08-15');
    assert.equal(keyTarget('2026-08-13', 'Enter'), null, 'ปุ่มที่ไม่เกี่ยวต้องคืน null');
  });

  test('ลูกศรต้องไม่พาไปตกวันที่กดไม่ได้ และต้องไม่วนไม่รู้จบ', () => {
    const min = '2026-01-05';
    const max = '2026-08-13';
    assert.equal(nextEnabled('2026-08-20', 1, min, max), max, 'เลยขอบบนแล้วหยุดที่ max');
    assert.equal(nextEnabled('2025-12-01', -1, min, max), min, 'เลยขอบล่างแล้วหยุดที่ min');
    assert.equal(nextEnabled('2026-07-31', 1, min, max), '2026-07-31', 'อยู่ในช่วงอยู่แล้ว');
    // ช่วงที่ปิดทั้งหมด (min > max) ต้องคืน null ไม่ใช่ค้าง
    assert.equal(nextEnabled('2026-05-01', 1, '2026-09-01', '2026-01-01'), null);
  });

  test('ปุ่มลัดทุกตัวคืน YYYY-MM-DD และไม่มีตัวไหนเกิน max', () => {
    const today = '2026-08-13';
    const max = today;
    const presets = defaultPresets({ today, min: '2026-01-05', max });
    assert.ok(presets.length >= 5);
    for (const p of presets) {
      assert.ok(p.id && p.labelKey, 'ทุกปุ่มต้องมี id และคีย์ข้อความ');
      if (p.iso === null) continue;
      assert.match(p.iso, ISO, `${p.id} ต้องเป็น YYYY-MM-DD`);
      assert.ok(p.iso <= max, `${p.id} ต้องไม่เกิน max`);
      assert.ok(p.iso >= '2026-01-05', `${p.id} ต้องไม่ต่ำกว่า min`);
    }
    const byId = Object.fromEntries(presets.map((p) => [p.id, p.iso]));
    assert.equal(byId.today, '2026-08-13');
    assert.equal(byId.yesterday, '2026-08-12');
    assert.equal(byId.endLastMonth, '2026-07-31');
    assert.equal(byId.days7, '2026-08-06');
    assert.equal(byId.firstRecord, '2026-01-05');
  });

  test('ปุ่มลัดที่ตกนอกช่วงต้องเป็น null — ห้ามหนีบเข้าช่วงเงียบ ๆ', () => {
    /* วันที่ 5 ม.ค. ซึ่งเป็นวันแรกที่ชีตมีข้อมูลด้วย — "สิ้นเดือนที่แล้ว" คือ 31 ธ.ค.
     * ซึ่งอยู่ก่อนวันแรกที่มีข้อมูล การหนีบให้เป็น 5 ม.ค. = ตอบคำถามคนละข้อกับที่กด */
    const presets = defaultPresets({ today: '2026-01-05', min: '2026-01-05', max: '2026-01-05' });
    const byId = Object.fromEntries(presets.map((p) => [p.id, p.iso]));
    assert.equal(byId.today, '2026-01-05');
    assert.equal(byId.endLastMonth, null);
    assert.equal(byId.days7, null);
    assert.equal(byId.yesterday, null);
  });

  test('ปุ่มลัดของช่วงวันที่ต้องไม่หลุดไปอนาคต แม้ชีตจะมีแถวลงวันที่ล่วงหน้า', () => {
    /* เคสจริง: ชีต Dryflower มีแถวลงวันที่ถึงเดือนธันวาคม ถ้ายึดปุ่มลัดกับ "วันล่าสุด
     * ที่มีข้อมูล" จะได้ "เดือนที่แล้ว" = พฤศจิกายน 2026 ซึ่งยังไม่มาถึง */
    const today = '2026-08-13';
    const byId = (o) => Object.fromEntries(defaultRangePresets(o).map((p) => [p.id, [p.from, p.to]]));

    const future = byId({ today, min: '2025-11-01', max: '2026-12-31' });
    assert.deepEqual(future.lastMonth, ['2026-07-01', '2026-07-31'], 'เดือนที่แล้ว = ก.ค. ไม่ใช่ พ.ย.');
    assert.deepEqual(future.thisMonth, ['2026-08-01', '2026-08-13']);
    assert.deepEqual(future.last7, ['2026-08-07', '2026-08-13']);

    // ชีตหยุดอัปเดตไปแล้ว — ต้องยึดวันล่าสุดที่มีข้อมูล ไม่งั้นได้ช่วงที่ว่างเปล่า
    const stale = byId({ today, min: '2025-11-01', max: '2026-06-20' });
    assert.deepEqual(stale.last7, ['2026-06-14', '2026-06-20']);
    assert.deepEqual(stale.lastMonth, ['2026-05-01', '2026-05-31']);

    // ไม่เหลื่อมกับช่วงข้อมูลเลย = กดไม่ได้ ห้ามคืนช่วงว่าง
    const narrow = byId({ today, min: '2026-08-10', max: '2026-08-13' });
    assert.deepEqual(narrow.lastMonth, [null, null]);
    assert.deepEqual(narrow.last7, ['2026-08-10', '2026-08-13'], 'ช่วงที่เหลื่อมบางส่วนหนีบเข้าช่วงข้อมูล');
  });

  test('ชื่อวันบนหัวตารางต้องไม่ซ้ำกัน ทั้งไทยและอังกฤษ', () => {
    /* ไทยใช้ narrow ได้ (อา จ อ พ พฤ ศ ส) แต่อังกฤษ narrow ได้ S M T W T F S
     * ซึ่งซ้ำสองคู่ — ถ้าเผลอไปใช้ชุดเดียวกันทั้งสองภาษา หัวตารางฝั่ง EN จะอ่านไม่ออก */
    for (const lang of ['th', 'en']) {
      setLang(lang);
      const names = weekdayNames();
      assert.equal(names.length, 7);
      assert.equal(new Set(names).size, 7, `ชื่อวันภาษา ${lang} ต้องไม่ซ้ำกัน`);
      assert.ok(names.every((s) => s.trim().length > 0));
    }
    setLang('th');
  });

  test('หัวปฏิทินเขียนปีเป็น ค.ศ. ทั้งสองภาษา', () => {
    /* ป้ายนี้อยู่ในกล่องที่เปิดจากแถบเดียวกับช่อง "ปี 2026" ถ้าเขียน 2569
     * ผู้ใช้จะไม่แน่ใจว่ากำลังดูปีไหน (กฎเดียวกับ monthYear() ใน format.js) */
    setLang('th');
    assert.match(monthLong('2026-08'), /2026$/);
    assert.ok(!monthLong('2026-08').includes('2569'));
    assert.equal(dateFull('2026-07-31').slice(-4), '2026');
    setLang('en');
    assert.match(monthLong('2026-08'), /^August 2026$/);
    assert.equal(dateFull('2026-07-31'), '31 Jul 2026');
    setLang('th');
  });
});

describe('แถบแจ้งเตือนบนหัวเว็บ', () => {
  const src = (over = {}) => ({
    key: 'dailyTrim',
    titleTh: 'ทริมรายวัน',
    titleEn: 'Daily trim',
    status: 'ok',
    discovery: 'live',
    ...over,
  });

  test('ปกติแล้วไม่มีอะไรต้องเตือน', () => {
    assert.deepEqual(collectNotices({ sources: [src()] }), []);
    // ไม่มี meta เลย (ชีตวัสดุยังโหลดไม่เสร็จ) ต้องไม่พัง
    assert.deepEqual(collectNotices(undefined), []);
    assert.deepEqual(collectNotices(null), []);
  });

  /* เคสจริง: สต็อกหัวหิน/กรุงเทพ หายทั้งรายงานเพราะชีตเปลี่ยนชื่อแท็บ
   * health เป็น partial (ดึงสดสำเร็จแต่ได้ 0 แถว) ซึ่งไม่ได้ตั้ง failedSources
   * เดิมจึงไม่มีแถบเตือนเลย ผู้ใช้เห็นแค่สต็อก 0 kg แล้วเข้าใจว่าเป็นคำตอบจริง */
  test('รายงานที่อ่านไม่ได้เลยต้องขึ้นแถบเตือน แม้ยังไม่ถึงขั้นเสิร์ฟชุดสำรอง', () => {
    const out = collectNotices({
      sources: [src()],
      health: { level: 'partial', reason: 'source-failed', failed: ['inventory'] },
    });
    assert.equal(out.length, 1, 'ต้องมีคำเตือนหนึ่งข้อ');
    assert.match(out[0], /inventory/);

    // health ปกติต้องไม่เตือน
    assert.deepEqual(
      collectNotices({ sources: [src()], health: { level: 'good', failed: [] } }),
      []
    );
  });

  /* ค่านี้ server ส่งมาตั้งแต่แรกแล้วแต่ไม่เคยมีใครอ่าน — แท็บใหม่จึงถูกมองข้ามเงียบ */
  test('ค้นรายชื่อแท็บสดไม่สำเร็จ ต้องเตือนพร้อมบอกว่าชีตไหน', () => {
    const out = collectNotices({
      sources: [src(), src({ key: 'sales', titleTh: 'การขายดอก', discovery: 'config' })],
    });
    assert.equal(out.length, 1);
    assert.match(out[0], /การขายดอก/);
  });

  /* ชีตวัสดุอยู่คนละ payload — เดิม renderHeader() อ่านแต่ก้อนหลัก คำเตือนจึงไม่เคยขึ้น */
  test('meta ของรายงาน lazy ใช้ได้ และติดป้ายบอกว่าเป็นของชีตไหน', () => {
    const out = collectNotices(
      {
        sources: [src({ key: 'supplyLog' })],
        tabChanges: [{ titleTh: 'Log Stock', titleEn: 'Log Stock', added: [{ name: '139.ถุงมือใหม่' }] }],
      },
      { scope: 'supply' }
    );
    assert.equal(out.length, 1);
    assert.match(out[0], /139\.ถุงมือใหม่/);

    const stale = collectNotices({ sources: [src({ status: 'stale' })] }, { scope: 'supply' });
    assert.match(stale[0], /ชีตวัสดุสิ้นเปลือง/);
  });

  /* เคสจริง ส.ค. 69 — แทรกรายการที่ตำแหน่ง 42 ในชีต Log Stock แท็บ 43–53
   * ถูกเรียงเลขใหม่รวด 11 อัน แถบเตือนลงรายละเอียดทีละคู่จนยาวสามบรรทัด
   * แล้วกลบคำเตือน "ค้นรายชื่อแท็บไม่สำเร็จ" ที่อยู่ข้างหน้าในแถบเดียวกัน */
  test('เรียงเลขใหม่ทั้งแถว ต้องยุบเหลือบรรทัดเดียวพร้อมจำนวน', () => {
    const renamed = Array.from({ length: 11 }, (_, i) => ({
      gid: String(i),
      from: `${43 + i}.ของ${i}`,
      to: `${44 + i}.ของ${i}`,
      renumbered: true,
    }));
    const out = collectNotices({
      sources: [src({ key: 'supplyLog' })],
      tabChanges: [{ titleTh: 'Log Stock', titleEn: 'Log Stock', renamed }],
    });

    assert.equal(out.length, 1, 'สิบเอ็ดอันต้องเหลือข้อความเดียว');
    assert.match(out[0], /11/, 'ต้องบอกจำนวนที่ถูกเรียงเลขใหม่');
    // ยังต้องเห็นตัวอย่างหนึ่งคู่ ไม่ใช่ยุบจนไม่รู้ว่าเกิดอะไร
    assert.match(out[0], /43\.ของ0 → 44\.ของ0/);
    // แต่ห้ามลากมาทั้งสิบเอ็ดคู่
    assert.ok(!out[0].includes('53.ของ10'), `ยังยาวเกินไป: ${out[0]}`);
  });

  /* จุดที่ห้ามเงียบ: เปลี่ยนชื่อจริงทำให้ STOCK_TAB_RE พลาดแล้วข้อมูลหายทั้งรายงาน
   * ถ้ายุบรวมกับกองเรียงเลขใหม่ อันที่ต้องรีบดูจะจมหายไป */
  test('เปลี่ยนชื่อจริงต้องแยกบรรทัดและแสดงเต็ม แม้ปนมากับการเรียงเลขใหม่', () => {
    const out = collectNotices({
      sources: [src({ key: 'supplyLog' })],
      tabChanges: [
        {
          titleTh: 'Log Stock',
          titleEn: 'Log Stock',
          renamed: [
            { gid: '1', from: '43.ของเดิม', to: '44.ของเดิม', renumbered: true },
            { gid: '2', from: '44.ของเดิม2', to: '45.ของเดิม2', renumbered: true },
            { gid: '3', from: 'สำเนาของ สำเนาของ', to: 'สำเนาของ', renumbered: false },
          ],
        },
      ],
    });

    assert.equal(out.length, 2, 'ของจริงกับการเรียงเลขใหม่ต้องคนละบรรทัด');
    const real = out.find((x) => x.includes('สำเนาของ สำเนาของ'));
    assert.ok(real, 'การเปลี่ยนชื่อจริงต้องยังอยู่ครบ');
    assert.match(real, /สำเนาของ สำเนาของ → สำเนาของ/);
  });

  test('เปลี่ยนชื่อเพราะเรียงเลขอันเดียว บอกตรง ๆ ไม่ต้องยุบ', () => {
    const out = collectNotices({
      sources: [src({ key: 'supplyLog' })],
      tabChanges: [
        {
          titleTh: 'Log Stock',
          titleEn: 'Log Stock',
          renamed: [{ gid: '1', from: '43.ของ', to: '44.ของ', renumbered: true }],
        },
      ],
    });
    assert.equal(out.length, 1);
    assert.match(out[0], /43\.ของ → 44\.ของ/);
  });

  /* แท็บใหม่ก็ยาวได้ไม่จำกัดเหมือนกัน — เดือนใหม่/ครอปใหม่มาทีเป็นสิบ */
  test('รายชื่อแท็บใหม่ที่ยาวเกินต้องตัดท้ายพร้อมบอกจำนวนที่เหลือ', () => {
    const added = Array.from({ length: 9 }, (_, i) => ({ name: `แท็บ${i}` }));
    const out = collectNotices({
      sources: [src()],
      tabChanges: [{ titleTh: 'Log Stock', titleEn: 'Log Stock', added }],
    });
    assert.equal(out.length, 1);
    assert.match(out[0], /แท็บ0/);
    assert.match(out[0], /5/, 'ต้องบอกว่าเหลืออีกกี่อัน');
    assert.ok(!out[0].includes('แท็บ8'), `ไม่ควรลากมาครบทุกอัน: ${out[0]}`);
  });

  test('กดรีเฟรชระหว่างคูลดาวน์ ต้องบอกเวลาที่รออยู่', () => {
    const out = collectNotices({
      sources: [src()],
      fetchedAt: new Date().toISOString(),
      refresh: { requested: true, applied: false, waitMs: 65_000, cooldownMs: 120_000 },
    });
    assert.equal(out.length, 1);
    assert.match(out[0], /2 นาที/);

    // กดแล้วได้ดึงจริง = ไม่ต้องเตือนอะไร
    const applied = collectNotices({
      sources: [src()],
      refresh: { requested: true, applied: true, waitMs: 0, cooldownMs: 120_000 },
    });
    assert.deepEqual(applied, []);
  });

  test('เสิร์ฟชุดสำรองต้องบอกตรง ๆ พร้อมชื่อรายงานที่ดึงไม่ได้', () => {
    const out = collectNotices({
      sources: [src()],
      degraded: true,
      failedSources: ['dailyTrim', 'sales'],
    });
    assert.equal(out.length, 2);
    assert.match(out.join(' '), /dailyTrim, sales/);
  });

  /* กันคีย์ที่ลืมใส่ภาษาอังกฤษ — t() คืนตัวคีย์เองเมื่อไม่เจอ ซึ่งดูเหมือนทำงานได้ */
  test('สลับเป็น EN แล้วต้องไม่มีตัวอักษรไทยหลงเหลือ', () => {
    setLang('en');
    try {
      const out = collectNotices({
        sources: [src({ discovery: 'config' })],
        degraded: true,
        failedSources: ['sales'],
        configOutdated: true,
        unmatchedLabels: ['รายงานใหม่'],
        fetchedAt: new Date().toISOString(),
        refresh: { requested: true, applied: false, waitMs: 30_000, cooldownMs: 120_000 },
      });
      assert.ok(out.length >= 5);
      // ยกเว้นชื่อรายงาน/ชื่อชีตที่มาจากข้อมูลจริง ซึ่งเป็นภาษาไทยโดยธรรมชาติ
      const chrome = out.filter((s) => !/ทริมรายวัน|รายงานใหม่/.test(s));
      for (const line of chrome) {
        assert.ok(!/[฀-๿]/.test(line), `ยังมีข้อความไทยหลุดมา: ${line}`);
      }
    } finally {
      setLang('th');
    }
  });
});

describe('เครื่องมือแปลข้อความ', () => {
  test('t() แทรกค่าลงในช่อง {name} ได้ และไม่ส่ง vars = พฤติกรรมเดิม', () => {
    assert.equal(t('notice.scopeSupply'), 'ชีตวัสดุสิ้นเปลือง');
    assert.match(t('notice.refreshCooldown', { ago: 'เมื่อสักครู่', wait: '2 นาที' }), /2 นาที/);
    // ช่องที่ไม่ได้ส่งค่ามาต้องคงไว้ ไม่กลายเป็น undefined
    assert.match(t('notice.refreshCooldown', { wait: '1 นาที' }), /\{ago\}/);
    assert.equal(t('คีย์ที่ไม่มีจริง'), 'คีย์ที่ไม่มีจริง');
  });

  test('countdown() ปัดขึ้นเสมอ', () => {
    assert.equal(countdown(0), '0 วินาที');
    assert.equal(countdown(1), '1 วินาที');
    assert.equal(countdown(59_000), '59 วินาที');
    assert.equal(countdown(60_000), '1 นาที');
    // 61 วิ ต้องเป็น "2 นาที" ไม่ใช่ "1 นาที" — บอกน้อยกว่าจริงแล้วกดไม่ได้ = ปุ่มดูเสีย
    assert.equal(countdown(61_000), '2 นาที');
    assert.equal(countdown(-5), '0 วินาที');
  });
});

describe('คอลัมน์ช่วงเวลาในตารางต้องเรียงตามเวลา', () => {
  /* ตารางเรียงด้วย comparePeriod เมื่อทั้งคอลัมน์เป็นช่วงเวลา (ดู ui/table.js)
   * ตรงนี้ทดสอบเงื่อนไขที่ตารางใช้ตัดสินใจ ไม่ใช่ตัว DOM */
  test('ป้ายไตรมาสของชีตนี้ถูกมองว่าเป็นช่วงเวลา', () => {
    for (const label of ["Q1'2026", "Q2'2025", '2026-07', '2026']) {
      assert.ok(looksLikePeriod(label), `${label} ควรถูกมองว่าเป็นช่วงเวลา`);
    }
    for (const label of ['G1/1-17NOV25', 'Shogun', 'ถุงมือไนไตร']) {
      assert.ok(!looksLikePeriod(label), `${label} ไม่ควรถูกมองว่าเป็นช่วงเวลา`);
    }
  });

  test("เรียง Q1'2026 หลัง Q2'2025 ไม่ใช่ก่อน", () => {
    const sorted = ["Q1'2026", "Q2'2025", "Q2'2026", "Q4'2025"].sort(comparePeriod);
    assert.deepEqual(sorted, ["Q2'2025", "Q4'2025", "Q1'2026", "Q2'2026"]);
    // ตัวเทียบตามตัวอักษรที่เคยใช้ให้ผลผิด — คุมไว้กันมีใครเผลอกลับไปใช้
    const wrong = ["Q1'2026", "Q2'2025"].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(wrong, ["Q1'2026", "Q2'2025"]);
  });
});
