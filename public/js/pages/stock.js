/**
 * pages/stock.js — 3. สต็อก
 *
 * ตามเอกสาร:
 *   (a) ภาพสต็อกปัจจุบัน หัวหิน vs กรุงเทพ — โดนัทคู่          ✔ มีข้อมูล
 *   (b) ยอดคงเหลือตามเวลา — กราฟเส้นสามเส้น                  ✖ ชีตเป็นภาพนิ่งวันเดียว
 *   (c) ตารางอายุสต็อกและสัดส่วนขนาด                          ◐ ได้ทุกคอลัมน์ยกเว้นอายุ
 *
 * สำหรับ (b) เลือกทำเส้นประ "ประมาณการ" จากการไหลของของ
 * (ผลผลิตสะสม − ขนออกสะสม สำหรับหัวหิน · รับเข้าสะสม − ขายสะสม สำหรับกรุงเทพ)
 * แล้วปรับให้ปลายเส้นตรงกับยอดจริงที่นับได้ล่าสุด
 *
 * ค่าประมาณต้องติดป้ายเสมอ — ค่าประมาณที่ไม่ติดป้ายคือการ "ซ่อมข้อมูลเงียบ ๆ"
 * ซึ่ง CLAUDE.md ข้อ 2 ห้ามไว้
 */
import { t, pick } from '../i18n.js';
import { n, esc, date as fmtDate, DASH } from '../format.js';
import * as charts from '../charts/index.js';
import { renderCards } from '../ui/cards.js';
import { sortableTable } from '../ui/table.js';
import { awaitingCard, estimateChip } from '../ui/placeholder.js';
import { pageHeader, panel, well, grid, emptyNote } from './shared.js';
import { sum, dailySeries, SIZE_KEYS } from '../shared/agg-core.js';

export const meta = { report: 'dryflower', page: 'stock' };

const isHuaHin = (rec) => /หัวหิน|hua\s*hin/i.test(rec.location ?? '');

export function render(ctx) {
  const { host, payload, sources, onOpen, drawLater } = ctx;

  pageHeader(host, { title: t('page.stock.title'), sub: t('page.stock.sub') });

  const inventory = sources.inventory?.rows ?? [];
  const huaHin = inventory.filter(isHuaHin);
  const bangkok = inventory.filter((r) => !isHuaHin(r));

  const g1 = grid(host, { cols: 2 });

  // ── (a) ภาพสต็อกปัจจุบัน ──
  {
    const totalHH = sum(huaHin.map((r) => r.flowerTotal));
    const totalBK = sum(bangkok.map((r) => r.flowerTotal));

    const body = panel(g1, t('stock.snapshot'), t('stock.snapshotNote'));
    if (!inventory.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.donut(
            box,
            { [t('filter.huahin')]: totalHH, [t('filter.bangkok')]: totalBK },
            { order: [t('filter.huahin'), t('filter.bangkok')], ramp: 'cat', height: 220 }
          ),
      });
    }

    for (const [label, rows] of [
      [t('filter.huahin'), huaHin],
      [t('filter.bangkok'), bangkok],
    ]) {
      const p = panel(g1, `${t('stock.sizeMix')} · ${label}`);
      if (!rows.length) {
        emptyNote(p);
        continue;
      }
      const mix = {};
      for (const key of SIZE_KEYS) mix[key] = sum(rows.map((r) => r.sizes?.[key]));
      const box = well(p);
      drawLater.push({ node: box, run: () => charts.donut(box, mix, { height: 210 }) });
    }
  }

  // ── (b) ยอดคงเหลือตามเวลา — ประมาณการจากการไหลของของ ──
  {
    /* หัวข้อกับคำกำกับช่วงเวลาสร้างทีหลัง เพราะต้องรู้ก่อนว่าตัดช่วงไหนมาแสดงจริง
     * (ตัดข้อมูลออกจากจอแล้วต้องบอกเสมอว่าเหลือช่วงไหน) */
    let rangeNote = null;
    const body = panel(host, t('stock.overTime'), null, { wide: true });

    const chip = estimateChip(t('stock.estimateNote'));
    body.appendChild(chip);

    const farmIn = dailySeries(sources.dailyTrim?.rows ?? []);
    const farmOut = dailySeries(sources.outbound?.rows ?? []);
    const bkkIn = dailySeries(sources.inbound?.rows ?? []);
    const bkkOut = dailySeries(sources.sales?.rows ?? []);

    const dates = [...new Set([...farmIn, ...farmOut, ...bkkIn, ...bkkOut].map((d) => d.date))].sort();

    if (dates.length < 2) {
      emptyNote(body, t('stock.notEnoughFlow'));
    } else {
      const at = (series) => {
        const m = new Map(series.map((d) => [d.date, d.flower]));
        return (date) => m.get(date) ?? 0;
      };
      const fi = at(farmIn);
      const fo = at(farmOut);
      const bi = at(bkkIn);
      const bo = at(bkkOut);

      let farm = 0;
      let bkk = 0;
      const farmPts = [];
      const bkkPts = [];
      const totalPts = [];
      for (const date of dates) {
        farm += fi(date) - fo(date);
        bkk += bi(date) - bo(date);
        farmPts.push({ date, value: farm });
        bkkPts.push({ date, value: bkk });
        totalPts.push({ date, value: farm + bkk });
      }

      /* เลื่อนทั้งเส้นให้ปลายตรงกับยอดที่นับได้จริงล่าสุด
       * เพราะการไหลสะสมเริ่มนับจากวันแรกที่มีบันทึก ไม่ได้เริ่มจากศูนย์จริง ๆ */
      const actualFarm = sum(huaHin.map((r) => r.flowerTotal));
      const actualBkk = sum(bangkok.map((r) => r.flowerTotal));
      const shift = (pts, actual) => {
        const delta = actual - (pts[pts.length - 1]?.value ?? 0);
        return pts.map((p) => ({ ...p, value: p.value + delta }));
      };
      const fp = shift(farmPts, actualFarm);
      const bp = shift(bkkPts, actualBkk);
      const tp = fp.map((p, i) => ({ date: p.date, value: p.value + bp[i].value }));

      /* แสดง 3 เดือนล่าสุดนับจากวันนี้ — ทั้งชุดมี 40+ วัน ป้ายวันที่จึงเบียดกันจนอ่านไม่ออก
       *
       * **ยอดสะสมต้องคำนวณจากทุกวันก่อน แล้วค่อยตัดช่วงที่จะแสดง** ถ้าตัดข้อมูลก่อนคำนวณ
       * จุดแรกของกราฟจะเริ่มนับใหม่จากศูนย์ แล้วเส้นทั้งเส้นผิดโดยที่หน้าตายังดูปกติ
       * (การตรึงปลายเส้นให้ตรงกับยอดที่นับได้จริงก็ต้องทำบนชุดเต็มด้วยเหตุผลเดียวกัน) */
      const WINDOW_MONTHS = 3;
      const monthsBack = (iso, months) => {
        const d = new Date(`${iso}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - months);
        return d.toISOString().slice(0, 10);
      };
      const today = new Date().toISOString().slice(0, 10);
      let cutoff = monthsBack(today, WINDOW_MONTHS);
      // ชีตที่หยุดอัปเดตไปนานกว่า 3 เดือนต้องไม่ได้กราฟเปล่า — ถอยไปนับจากวันสุดท้ายที่มีข้อมูลแทน
      if (fp.filter((p) => p.date >= cutoff).length < 2) {
        cutoff = monthsBack(fp[fp.length - 1].date, WINDOW_MONTHS);
      }
      const clip = (pts) => pts.filter((p) => p.date >= cutoff);
      const [fpShown, bpShown, tpShown] = [clip(fp), clip(bp), clip(tp)];

      if (fpShown.length < fp.length) {
        rangeNote = t('stock.overTimeWindow', {
          n: WINDOW_MONTHS,
          from: fmtDate(fpShown[0].date),
          to: fmtDate(fpShown[fpShown.length - 1].date),
        });
        // panel() รับ note ตอนสร้าง แต่ตอนนั้นยังไม่รู้ช่วงที่ตัดได้จริง จึงเติมทีหลัง
        const title = body.parentElement.querySelector('.panel__title');
        if (title) title.insertAdjacentHTML('beforeend', ` <span>${esc(rangeNote)}</span>`);
      }

      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.line(
            box,
            [
              { label: t('filter.huahin'), points: fpShown },
              { label: t('filter.bangkok'), points: bpShown },
              { label: t('label.total'), points: tpShown },
            ],
            // ทั้งสามเส้นเป็นค่าประมาณ จึงเป็นเส้นประหมด
            { height: 240, dashed: [0, 1, 2] }
          ),
      });
    }

    const invSheet = payload.meta.sources.find((s) => s.key === 'inventory') ?? {};
    body.appendChild(
      awaitingCard({
        title: t('awaiting.stockHistory.title'),
        why: t('awaiting.stockHistory.why'),
        needs: [
          {
            sheet: pick(invSheet, 'title') || 'แบบฟอร์มสินค้าคงเหลือ',
            sheetUrl: invSheet.sheetUrl,
            columns: [t('awaiting.col.snapshotDaily')],
          },
        ],
      })
    );
  }

  // ── (c) ตารางสัดส่วนขนาดและอายุสต็อก ──
  {
    const body = panel(host, t('stock.agingTable'), t('stock.agingNote'), { wide: true });

    /* ไล่ขนาดจากเล็กไปใหญ่ (XS → XXL) ตรงข้ามกับ SIZE_KEYS ที่ไล่ใหญ่ไปเล็ก
     * ลำดับนี้เป็นลำดับเริ่มต้นของตาราง ดูหมายเหตุที่ sortableTable ด้านล่าง */
    const SIZE_ASC = [...SIZE_KEYS].reverse();

    const rows = [];
    const strains = [...new Set(inventory.map((r) => r.strain).filter(Boolean))];
    for (const strain of strains) {
      for (const size of SIZE_ASC) {
        const hh = sum(huaHin.filter((r) => r.strain === strain).map((r) => r.sizes?.[size]));
        const bk = sum(bangkok.filter((r) => r.strain === strain).map((r) => r.sizes?.[size]));
        if (hh === 0 && bk === 0) continue;
        rows.push({ strain, size, huaHin: hh, bangkok: bk, total: hh + bk });
      }
    }

    if (!rows.length) {
      emptyNote(body);
    } else {
      body.appendChild(
        sortableTable(
          [
            { label: t('label.strain'), get: (r) => r.strain },
            /* เรียงตามขนาดจริง ไม่ใช่ตามตัวอักษร — get คืนอันดับเป็นตัวเลข
             * ถ้าคืนตัวอักษรจะได้ L · M · S · XL · XS · XXL ซึ่งไม่ใช่ลำดับขนาดเลย */
            {
              label: t('label.size'),
              get: (r) => SIZE_ASC.indexOf(r.size),
              render: (r) => esc(r.size),
            },
            { label: t('filter.huahin'), align: 'n', get: (r) => r.huaHin, render: (r) => n(r.huaHin) },
            { label: t('filter.bangkok'), align: 'n', get: (r) => r.bangkok, render: (r) => n(r.bangkok) },
            { label: t('label.total'), align: 'n', get: (r) => r.total, render: (r) => `<b>${n(r.total)}</b>` },
            {
              // ไม่มีวันที่รับเข้าราย lot ในชีต จึงคำนวณอายุไม่ได้จริง ๆ
              label: t('stock.daysInInventory'),
              align: 'n',
              get: () => null,
              render: () => `<span class="muted" title="${esc(t('awaiting.aging.why'))}">${DASH}</span>`,
            },
          ],
          rows,
          /* ค่าเริ่มต้น: เรียงตามสายพันธุ์ แล้วขนาดเล็กไปใหญ่ในแต่ละสายพันธุ์
           *
           * เรียงคีย์เดียวได้เพราะ Array.prototype.sort เสถียร (ES2019) — แถวถูกสร้าง
           * มาเรียงตามขนาดอยู่แล้ว พอเรียงทับด้วยสายพันธุ์ ลำดับขนาดในแต่ละกลุ่มจึงคงอยู่
           *
           * ของเดิมเรียงตามยอดรวมมากไปน้อย ซึ่งอ่านเป็นการจัดอันดับ ไม่ใช่ตารางไว้เทียบ
           * ว่าสายพันธุ์ไหนมีขนาดไหนเหลือเท่าไร */
          { sortIndex: 0, sortDir: 'asc' }
        )
      );

      const invSheet = payload.meta.sources.find((s) => s.key === 'inventory') ?? {};
      body.appendChild(
        awaitingCard({
          title: t('awaiting.aging.title'),
          why: t('awaiting.aging.why'),
          needs: [
            {
              sheet: pick(invSheet, 'title') || 'แบบฟอร์มสินค้าคงเหลือ',
              sheetUrl: invSheet.sheetUrl,
              columns: [t('awaiting.col.receivedDate'), t('awaiting.col.lot')],
            },
          ],
        })
      );
    }
  }

  const cardHost = document.createElement('div');
  cardHost.className = 'card-grid';
  host.appendChild(cardHost);
  renderCards(cardHost, { ...payload, sources }, onOpen, {
    only: ['inventory', 'outbound', 'inbound'], defer: drawLater });
}
