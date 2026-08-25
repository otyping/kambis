/**
 * tests/server.js — ตรรกะฝั่งเซิร์ฟเวอร์ที่ไม่ต้องต่อเน็ตและไม่ต้องเปิดพอร์ต
 *
 *   node --test tests/server.js
 *
 * ตอนนี้มีสองเรื่อง ซึ่งทั้งคู่คือของที่ "พังแล้วรู้ตัวช้า" บนเซิร์ฟเวอร์จริง:
 *   1. คูลดาวน์ปุ่มรีเฟรช — กันยิง Google ถี่จนโดน 429
 *   2. เกณฑ์ payloadHealth — กันของว่างทับชุดสำรองที่ดี
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { createRefreshGate } from '../server/lib/refresh-gate.js';
import { payloadHealth } from '../server/lib/loader.js';
import { writeSnapshot, readSnapshot, CACHE_DIR } from '../server/lib/cache.js';
import { csvUrl } from '../server/lib/fetcher.js';
import { diffTabs, stripOrdinal } from '../server/lib/tabs.js';
import { sameUsername } from '../server/lib/auth.js';

describe('endpoint ที่ใช้ดึง CSV', () => {
  /* gviz/tq เป็น endpoint ของ Query API — มันเดาเองว่าแถวบน ๆ เป็นหัวตารางแล้วตัดทิ้ง
   * จำนวนแถวที่ตัดไม่เท่ากันในแต่ละแท็บ กริดที่ได้จึง **เลื่อนแถว** ไปจากของจริง
   *
   * เคสจริง ส.ค. 69: ราคาที่คนกรอกไว้ที่ H2 ของทุกแท็บในชีต Log Stock ถูก gviz
   * กลืนไปเป็นหัวตาราง หน้าเว็บจึงขึ้น "ยังไม่ใส่ราคา" ทั้งที่ในชีตมีเลขครบ
   * (ผู้ใช้เป็นคนจับได้ ไม่ใช่ระบบ — ไม่มี error อะไรเลย ข้อมูลแค่หายเงียบ ๆ)
   *
   * เทสต์นี้มีไว้กันคนเปลี่ยนกลับ เพราะคอมเมนต์อย่างเดียวเคยกันไม่อยู่มาแล้ว */
  test('ต้องเป็น /export?format=csv ไม่ใช่ gviz — gviz ตัดแถวหัวตารางทิ้ง', () => {
    const url = csvUrl('SHEET123', '456');
    assert.match(url, /\/export\?format=csv/, 'ต้องใช้ endpoint ที่คืนกริดดิบ');
    assert.ok(!url.includes('gviz'), 'ห้ามกลับไปใช้ gviz');
    assert.ok(url.includes('SHEET123') && url.includes('gid=456'));
  });

  test('ยังสลับกลับไปเทียบผลด้วย CSV_ENDPOINT=gviz ได้', () => {
    const prev = process.env.CSV_ENDPOINT;
    process.env.CSV_ENDPOINT = 'gviz';
    try {
      assert.match(csvUrl('S', '1'), /gviz/);
    } finally {
      if (prev === undefined) delete process.env.CSV_ENDPOINT;
      else process.env.CSV_ENDPOINT = prev;
    }
  });
});

describe('คูลดาวน์ปุ่มรีเฟรช', () => {
  /** นาฬิกาปลอม เพื่อไม่ต้องรอจริงในเทสต์ */
  const clock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms) => (t += ms) };
  };

  test('กดครั้งแรกผ่าน กดซ้ำทันทีไม่ผ่านและบอกเวลาที่ต้องรอ', () => {
    const c = clock();
    const gate = createRefreshGate({ cooldownMs: 120_000, now: c.now });

    assert.equal(gate.check('reports').allowed, true);
    gate.note('reports');

    const second = gate.check('reports');
    assert.equal(second.allowed, false);
    assert.equal(second.waitMs, 120_000);
    assert.equal(second.cooldownMs, 120_000);
  });

  test('พ้นคูลดาวน์แล้วกดได้อีกครั้ง', () => {
    const c = clock();
    const gate = createRefreshGate({ cooldownMs: 120_000, now: c.now });
    gate.note('reports');

    c.advance(119_000);
    assert.equal(gate.check('reports').allowed, false);
    assert.equal(gate.check('reports').waitMs, 1_000);

    c.advance(1_000);
    assert.equal(gate.check('reports').allowed, true);
  });

  test('check() เรียกซ้ำได้โดยไม่เปลี่ยนสถานะ — มีแต่ note() ที่จด', () => {
    const c = clock();
    const gate = createRefreshGate({ cooldownMs: 60_000, now: c.now });
    assert.equal(gate.check('reports').allowed, true);
    assert.equal(gate.check('reports').allowed, true);
    assert.equal(gate.check('reports').allowed, true);
  });

  /* ชีตวัสดุ (140 คำขอ) กับ payload หลัก (125 คำขอ) เป็นคนละชุดคำขอกัน
   * กดดูรายงานดอกแล้วต้องไม่ไปกินคูลดาวน์ของชีตวัสดุ */
  test('scope แยกกัน ไม่กินคูลดาวน์ของกันและกัน', () => {
    const c = clock();
    const gate = createRefreshGate({ cooldownMs: 120_000, now: c.now });

    gate.note('reports');
    assert.equal(gate.check('reports').allowed, false);
    assert.equal(gate.check('supplyLog').allowed, true, 'ชีตวัสดุต้องยังกดได้');
  });
});

describe('เกณฑ์ว่า payload ดีพอจะเก็บเป็นชุดสำรองไหม', () => {
  const src = (over = {}) => ({
    key: 'dailyTrim',
    status: 'ok',
    rowCount: 100,
    tabCount: 10,
    tabsOk: 10,
    tabsStale: 0,
    ...over,
  });
  const meta = (sources) => ({ meta: { sources } });

  test('ปกติครบทุกอย่าง = good', () => {
    const h = payloadHealth(meta([src(), src({ key: 'sales' })]));
    assert.equal(h.level, 'good');
    assert.deepEqual(h.failed, []);
  });

  /* เคสหลักที่ฟีเจอร์นี้มีไว้กัน: Google ตอบ 200 พร้อมหน้า login หรือ CSV ว่าง
   * ทุกรายงานจะได้ status 'ok' แต่ 0 แถว — ถ้าเชื่อ status อย่างเดียวจะปล่อยผ่าน
   * แล้วของว่างก้อนนี้จะไปทับชุดสำรองที่ดีจนกู้ไม่ได้ */
  test('status ok แต่ 0 แถวทุกรายงาน ต้องเป็น bad ไม่ใช่ good', () => {
    const h = payloadHealth(meta([src({ rowCount: 0 }), src({ key: 'sales', rowCount: 0 })]));
    assert.equal(h.level, 'bad');
    assert.equal(h.reason, 'all-sources-failed');
    assert.deepEqual(h.failed, ['dailyTrim', 'sales']);
  });

  test('พังบางรายงาน = partial (ยังส่งให้ผู้ใช้ดูได้ แต่ห้ามเก็บเป็นชุดสำรอง)', () => {
    const h = payloadHealth(meta([src(), src({ key: 'sales', status: 'error', rowCount: 0 })]));
    assert.equal(h.level, 'partial');
    assert.deepEqual(h.failed, ['sales']);
  });

  test('แท็บหายเกิน 10% = partial แม้ทุกรายงานยังมีแถว', () => {
    const h = payloadHealth(meta([src({ tabCount: 10, tabsOk: 5, tabsStale: 0 })]));
    assert.equal(h.level, 'partial');
    assert.equal(h.reason, 'tabs-missing');
  });

  test('แท็บ stale นับว่ายังใช้ได้ (มีข้อมูลจากแคช)', () => {
    const h = payloadHealth(meta([src({ tabCount: 10, tabsOk: 4, tabsStale: 6 })]));
    assert.equal(h.level, 'good');
  });

  test('ไม่มี meta.sources เลย = bad ไม่ใช่ crash', () => {
    assert.equal(payloadHealth(undefined).level, 'bad');
    assert.equal(payloadHealth({}).level, 'bad');
    assert.equal(payloadHealth(meta([])).level, 'bad');
  });
});

describe('ชุดสำรองบนดิสก์', () => {
  /* ชื่อต้องไม่มีจุด — safe() ใน cache.js แปลงอักขระนอก [A-Za-z0-9_-] เป็น `_`
   * ถ้าตั้งชื่อว่า 'snapshot.__test' ไฟล์จริงจะกลายเป็น snapshot___test.json
   * แล้วเทสต์จะไปล้างคนละไฟล์กับที่เขียน — เคยหลุดมาแล้วตอนเขียนเทสต์นี้ */
  const NAME = 'snapshot_test_tmp';
  const file = path.join(CACHE_DIR, `${NAME}.json`);
  const clean = () =>
    Promise.all([
      rm(file, { force: true }),
      rm(`${file}.prev`, { force: true }),
      rm(`${file}.tmp`, { force: true }),
    ]);

  const payload = (tag) => ({ meta: { fetchedAt: tag, sources: [] }, sources: {}, kpi: {} });

  test('เขียนสองรอบแล้วมีชุดก่อนหน้าเก็บไว้', async () => {
    await clean();
    assert.equal(await writeSnapshot(payload('รอบแรก'), NAME), true);
    assert.equal(await writeSnapshot(payload('รอบสอง'), NAME), true);

    assert.equal((await readSnapshot(NAME)).data.meta.fetchedAt, 'รอบสอง');
    await stat(`${file}.prev`); // ต้องมีอยู่จริง ไม่งั้นโยน
    await clean();
  });

  test('ไฟล์หลักพัง ต้องตกไปใช้ชุดก่อนหน้าแทนที่จะคืน null', async () => {
    await clean();
    await writeSnapshot(payload('ของดี'), NAME);
    await writeSnapshot(payload('ของดีกว่า'), NAME);

    await writeFile(file, '{"meta": ตรงนี้พัง', 'utf8');
    const got = await readSnapshot(NAME);
    assert.equal(got?.data.meta.fetchedAt, 'ของดี', 'ต้องได้ชุดก่อนหน้ากลับมา');
    await clean();
  });

  /* JSON ที่ parse ผ่านแต่ไม่ใช่ payload จริง เป็นกับดักที่แย่กว่าไฟล์พัง
   * เพราะมันผ่านด่านแรกไปแล้วค่อยพังตอนอ่าน meta.sources ซึ่งไล่ต้นตอยาก */
  test('ไฟล์ที่ parse ผ่านแต่รูปร่างไม่ใช่ payload ต้องไม่ถูกใช้', async () => {
    await clean();
    await writeFile(file, '{}', 'utf8');
    assert.equal(await readSnapshot(NAME), null);

    await writeFile(file, 'null', 'utf8');
    assert.equal(await readSnapshot(NAME), null);
    await clean();
  });

  test('payload ของรายงาน lazy ใช้ source เอกพจน์ — ต้องอ่านได้ด้วย', async () => {
    await clean();
    await writeSnapshot({ meta: { sources: [] }, source: { rows: [] }, kpi: {} }, NAME);
    assert.ok(await readSnapshot(NAME));
    await clean();
  });
});

/* ─────────────────────────────────────────────────────────────
 * เทียบรายชื่อแท็บ — แยก "เรียงเลขใหม่" ออกจาก "เปลี่ยนชื่อจริง"
 *
 * เคสจริง ส.ค. 69: มีคนแทรกรายการที่ตำแหน่ง 42 ในชีต Log Stock
 * แท็บ 43–53 จึงถูกเรียงเลขใหม่เป็น 44–54 รวด 11 อัน แถบเตือนบนหัวเว็บ
 * ลงรายละเอียดทีละคู่จนกินสามบรรทัด แล้วกลบคำเตือนข้ออื่นที่อยู่แถบเดียวกัน
 * ────────────────────────────────────────────────────────────── */
describe('เทียบรายชื่อแท็บ', () => {
  test('ตัดเลขลำดับหน้าชื่อได้ทุกแบบที่บริษัทเขียนจริง', () => {
    assert.equal(stripOrdinal('43.แปรงขัดโถห้องน้ำ'), 'แปรงขัดโถห้องน้ำ');
    assert.equal(stripOrdinal('1.Rockwool'), 'Rockwool');
    assert.equal(stripOrdinal('9.58 Stock หัวหิน'), 'Stock หัวหิน');
    // ไม่มีเลขนำหน้า = ต้องไม่ถูกแตะ
    assert.equal(stripOrdinal('SUMMARY SHEET'), 'SUMMARY SHEET');
    assert.equal(stripOrdinal('ต้นทุน ต่อ กรัม 2026'), 'ต้นทุน ต่อ กรัม 2026');
  });

  test('เปลี่ยนแค่เลขลำดับ ต้องติดธง renumbered', () => {
    const before = [
      { gid: 'a', name: '42.ชุดหมีพ่นยา (ฝรั่ง)' },
      { gid: 'b', name: '43.แปรงขัดโถห้องน้ำ' },
    ];
    const after = [
      { gid: 'a', name: '43.ชุดหมีพ่นยา (ฝรั่ง)' },
      { gid: 'b', name: '44.แปรงขัดโถห้องน้ำ' },
    ];
    const d = diffTabs(before, after);
    assert.equal(d.renamed.length, 2);
    assert.ok(d.renamed.every((x) => x.renumbered));
    // ยังต้องรายงานว่าเปลี่ยน ไม่ใช่กลืนหายไปเลย
    assert.equal(d.changed, true);
  });

  /* จุดที่ห้ามพลาด: เปลี่ยนชื่อจริงทำให้ตัวคัดชื่ออย่าง STOCK_TAB_RE พลาดได้
   * ข้อมูลหายทั้งรายงาน ถ้าเผลอเหมารวมเป็น "เรียงเลขใหม่" จะไม่มีใครรู้ */
  test('เปลี่ยนเนื้อชื่อจริง ห้ามถูกเหมาเป็นการเรียงเลขใหม่', () => {
    const d = diffTabs(
      [
        { gid: 'a', name: '43.แปรงขัดโถห้องน้ำ' },
        { gid: 'b', name: 'สำเนาของ สำเนาของ' },
        { gid: 'c', name: '9.58 Stock หัวหิน' },
      ],
      [
        // เลขเปลี่ยน **และ** เนื้อชื่อเปลี่ยน = ของจริง
        { gid: 'a', name: '44.แปรงขัดโถส้วม' },
        { gid: 'b', name: 'สำเนาของ' },
        { gid: 'c', name: '9.58 สต๊อกหัวหิน' },
      ]
    );
    assert.equal(d.renamed.length, 3);
    assert.ok(
      d.renamed.every((x) => !x.renumbered),
      'ทั้งสามอันเนื้อชื่อเปลี่ยน ต้องไม่ติดธง renumbered'
    );
  });

  test('ชื่อที่เป็นตัวเลขล้วน ตัดสินไม่ได้ ต้องถือว่าเปลี่ยนชื่อจริง', () => {
    const d = diffTabs([{ gid: 'a', name: '12' }], [{ gid: 'a', name: '13' }]);
    assert.equal(d.renamed[0].renumbered, false);
  });

  test('เพิ่ม/หายแท็บยังทำงานเหมือนเดิม', () => {
    const d = diffTabs([{ gid: 'a', name: 'เก่า' }], [{ gid: 'b', name: 'ใหม่' }]);
    assert.deepEqual(d.added.map((x) => x.gid), ['b']);
    assert.deepEqual(d.removed.map((x) => x.gid), ['a']);
    assert.equal(d.renamed.length, 0);
  });
});

/* ── ชื่อผู้ใช้ไม่สนตัวพิมพ์ใหญ่-เล็ก ─────────────────────────────
 *
 * ผู้ใช้สั่งว่าพิมพ์ Supakorn หรือ supakorn ต้องเข้าได้เหมือนกัน
 *
 * เทสต์ตัวเทียบตรง ๆ เพราะ verifyLogin ทั้งตัวต้องมี config/users.json จริง
 * ซึ่ง USERS_FILE เป็นค่าคงที่ inject ไม่ได้ — และของที่พังง่ายจริง ๆ คือมีคนเผลอ
 * เปลี่ยนกลับไปใช้ === ที่จุดใดจุดหนึ่งใน 5 จุด แล้วได้อาการ "ล็อกอินผ่าน
 * แต่รีเฟรชหน้าแล้วเด้งกลับ" ซึ่งไล่หาสาเหตุยากกว่าล็อกอินไม่ผ่านไปเลย */
describe('การเทียบชื่อผู้ใช้', () => {
  test('ตัวพิมพ์ใหญ่-เล็กต่างกันถือว่าเป็นคนเดียวกัน', () => {
    assert.equal(sameUsername('Supakorn', 'supakorn'), true);
    assert.equal(sameUsername('SUPAKORN', 'supakorn'), true);
    assert.equal(sameUsername('Supakorn', 'Supakorn'), true);
  });

  test('ช่องว่างหน้าหลังไม่นับ — คนก๊อปชื่อมาวางมักติดมาด้วย', () => {
    assert.equal(sameUsername('  supakorn  ', 'Supakorn'), true);
  });

  test('คนละชื่อยังต้องเป็นคนละคน', () => {
    assert.equal(sameUsername('supakorn', 'supakorn2'), false);
    assert.equal(sameUsername('supakorn', 'patira'), false);
  });

  test('ค่าว่าง/ไม่มีค่า ต้องไม่ไปตรงกับบัญชีจริง', () => {
    assert.equal(sameUsername('', 'supakorn'), false);
    assert.equal(sameUsername(null, 'supakorn'), false);
    assert.equal(sameUsername(undefined, 'supakorn'), false);
  });
});
