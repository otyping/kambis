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
  filterOptions,
} from '../public/js/ui/filters.js';
import { dataGaps } from '../public/js/ui/gaps.js';
import {
  readSupplyFilters,
  supplyFilterParams,
  supplyMatcher,
  supplyLookup,
} from '../public/js/ui/supply-filters.js';
import { looksLikePeriod, comparePeriod } from '../public/js/shared/agg-core.js';
import { collectNotices } from '../public/js/ui/notices.js';
import { t, setLang } from '../public/js/i18n.js';
import { countdown } from '../public/js/format.js';

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
    { item: 'COCO', group: 'nutrient', unitPrice: 350, matchedOrderRow: 'COCO' },
    { item: 'Cuts', group: 'nutrient', unitPrice: null, matchedOrderRow: null },
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
    assert.deepEqual(run({ group: 'nutrient' }), ['COCO', 'Cuts']);
    assert.deepEqual(run({ price: 'without' }), ['ป้ายแท็กสีน้ำเงิน', 'Cuts']);
    assert.deepEqual(run({ group: 'nutrient', price: 'with' }), ['COCO']);
  });

  test('ตารางสั่งของที่ใช้ชื่อคนละแบบ ต้องกรองตามหมวดได้ด้วย', () => {
    // แถวจากตารางสั่งของรายเดือนไม่มีช่อง group ของตัวเอง ต้องหาจากชื่อที่จับคู่ไว้
    const orderRow = { item: 'ถุงมือ-ไนไตร สีดำ (M)', unitPrice: 120 };
    assert.ok(supplyMatcher({ q: '', group: 'item', price: 'all' }, lookup)(orderRow));
    assert.ok(!supplyMatcher({ q: '', group: 'nutrient', price: 'all' }, lookup)(orderRow));
  });

  test('URL เก็บเฉพาะค่าที่ไม่ใช่ค่าเริ่มต้น', () => {
    assert.deepEqual(readSupplyFilters(new URLSearchParams('')), {
      year: '',
      q: '',
      group: 'all',
      price: 'all',
    });
    assert.deepEqual(supplyFilterParams({ year: '', q: '  ', group: 'all', price: 'all' }), {
      year: '',
      q: '',
      group: '',
      price: '',
    });
    assert.deepEqual(supplyFilterParams({ year: '2025', q: ' ถุงมือ ', group: 'nutrient', price: 'with' }), {
      year: '2025',
      q: 'ถุงมือ',
      group: 'nutrient',
      price: 'with',
    });
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
