/**
 * pages/cost.js — 5. ต้นทุน
 *
 * เดิมหน้านี้แทบว่างเปล่า เพราะทั้งระบบมีตัวเลขเงินอยู่ชุดเดียวคือราคาวัสดุสิ้นเปลือง
 * ตอนนี้ชีต "แบบฟอร์มต้นทุน" (ลิงก์ที่ 8) เข้ามาแล้ว จึงมีงบรายรับ-รายจ่ายเต็มรูป
 *
 * **ยอดทุกตัวบนหน้านี้มาจากแท็บ "สรุป" ของชีตนั้น ไม่ใช่จากการบวกแท็บรายละเอียด**
 * เหตุผลอยู่ใน buildCost() — สรุปกับรายละเอียดในชีตยังไม่ตรงกันสามจุด
 * ถ้าเอาผลรวมรายการมาโชว์ ตัวเลขจะไม่ตรงกับงบที่ผู้บริหารถืออยู่ในมือ
 * ความไม่ตรงกันถูกรายงานเป็น finding `finance.summaryMismatch` แทน
 *
 * ต้นทุนวัสดุสิ้นเปลือง (ชีต Log Stock) เป็นคนละก้อนและคนละขอบเขต
 * จึงแยกแผงไว้ท้ายหน้า ห้ามเอาไปบวกกับต้นทุนการปลูก
 */
import { t } from '../i18n.js';
import { n, esc, DASH } from '../format.js';
import * as charts from '../charts/index.js';
import { sortableTable } from '../ui/table.js';
import { awaitingCard } from '../ui/placeholder.js';
import {
  pageHeader,
  panel,
  well,
  grid,
  tiles,
  lossHint,
  emptyNote,
  appendQualityCard,
  costSpan,
} from './shared.js';

export const meta = { report: 'dryflower', page: 'cost' };

/** จำนวนเงิน — ใช้ทศนิยม 0 เพราะหลักล้านที่มีสตางค์อ่านยากและไม่ช่วยตัดสินใจ */
const baht = (v) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : n(v, 0));
const fmtBaht = (v) => `${baht(v)} ฿`;

/** ตัวเลขเงินในตารางที่ติดลบแล้วมีความหมาย (กำไร/EBIT) — ห้ามใช้กับรายจ่ายที่เก็บเป็นเลขบวก */
const signedBaht = (v) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? `<span class="muted">${DASH}</span>`
    : `<b class="${v < 0 ? 'money-neg' : 'money-pos'}">${baht(v)}</b>`;

export function render(ctx) {
  const { host, payload, supply, drawLater, requestSupply, onOpen } = ctx;

  pageHeader(host, { title: t('page.cost.title'), sub: t('page.cost.sub') });

  const cost = payload.kpi?.cost;

  /* สามสถานะ ไม่ใช่สอง — "ชีตล่ม" กับ "ปีที่เลือกไม่มีข้อมูล" ต้องบอกคนละแบบ
   * ไม่งั้นผู้ใช้จะไปไล่แก้ชีตที่ไม่ได้ผิด */
  if (!cost?.sheetAvailable) {
    const box = panel(host, t('cost.noSheet'), null, { wide: true });
    emptyNote(box, t('cost.noSheetNote'));
  } else if (!cost.available) {
    const box = panel(host, t('cost.pnlTitle'), null, { wide: true });
    emptyNote(
      box,
      t('cost.otherYear', { year: cost.requestedYear ?? DASH, has: cost.years.join(', ') })
    );
  } else {
    renderFinance(host, cost, drawLater);
  }

  // ── ต้นทุนวัสดุสิ้นเปลือง — คนละขอบเขต โหลดคนละก้อน ──
  renderSupplyCost(host, supply, requestSupply, drawLater);

  appendQualityCard(host, { ...payload, report: 'dryflower' }, onOpen, drawLater);
}

/**
 * งบรายรับ-รายจ่ายจากชีตต้นทุน
 *
 * ไม่ต้องเช็คปีที่นี่แล้ว — `buildCost()` ตัดข้อมูลตามปีที่เลือกให้ตั้งแต่ต้นทาง
 * (ประตูเดิมที่เทียบ `filters.resolvedYear !== cost.year` เป็นการปิด/เปิดทั้งหน้า
 * ไม่ใช่การกรอง และพังทันทีที่ชีตข้ามปี เพราะ cost.year คือปีของเดือนแรกเท่านั้น)
 */
function renderFinance(host, cost, drawLater) {
  const { totals } = cost;
  const margin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : null;

  /* ป้ายต้องบอกช่วงเวลาจริง ห้ามเขียนแค่ปี
   *
   * ชีตกรอกค่าเสื่อมราคากับค่าใช้จ่าย Office ไว้ล่วงหน้าครบ 12 เดือน แต่รายได้มีถึงมิถุนายน
   * ถ้าเขียนว่า "(2026)" ผู้บริหารจะอ่านว่าเป็นผลทั้งปี แล้วเข้าใจว่าขาดทุนมากกว่าความจริง
   * ยอด 12 เดือนตามที่ชีตบอกยังดูได้ในตารางรายเดือนด้านล่าง ไม่ได้ซ่อน */
  const span = costSpan(cost);

  tiles(host, [
    { label: `${t('cost.revenue')} (${span})`, value: totals.revenue, unit: '฿' },
    { label: `${t('cost.totalCost')} (${span})`, value: totals.cost, unit: '฿', hint: t('cost.growingOnly') },
    /* กำไรขั้นต้นคำนวณใหม่จาก รายได้ − ต้นทุน เสมอ ไม่อ่านช่อง EBITDA ในชีต
     *
     * เคยเจอจริง: มีคนแก้แถวต้นทุนในงบสรุปแล้วไม่ได้คำนวณแถว EBITDA ใหม่
     * ทำให้ช่อง EBITDA ค้างค่าเก่าอยู่ 1.23 ล้าน ถ้าเชื่อช่องนั้นตัวเลขบนจอจะผิดตาม
     * ส่วนที่ชีตขัดกันเองถูกรายงานเป็น finding `finance.ebitdaMismatch` */
    /* สองช่องนี้ติด tone: 'signed' — เครื่องหมายมีความหมาย ติดลบ = ขาดทุนจริง
     * ส่วนค่าเสื่อมราคากับต้นทุนไม่ติด เพราะเก็บเป็นเลขบวกทั้งที่เป็นรายจ่าย
     * ถ้าย้อมตาม "เงินเข้า/เงินออก" หน้านี้จะแดงทั้งหน้าจนสีไม่เหลือความหมาย */
    {
      label: t('cost.grossProfit'),
      value: totals.grossProfit,
      unit: '฿',
      tone: 'signed',
      hint: lossHint(totals.grossProfit, margin === null ? '' : `${n(margin, 1)}% ${t('cost.ofRevenue')}`),
    },
    { label: t('cost.depreciation'), value: totals.depreciation, unit: '฿' },
    { label: t('cost.ebit'), value: totals.ebit, unit: '฿', tone: 'signed', hint: lossHint(totals.ebit) },
  ]);

  /* บอกให้ชัดว่าทำไมยอดถึงไม่ใช่ 12 เดือน — ไม่งั้นคนที่เปิดชีตเทียบเองจะงงว่าเลขไม่ตรง */
  if (cost.coverage && cost.coverage.to < cost.months[cost.months.length - 1]) {
    const note = document.createElement('p');
    note.className = 'supply-warn';
    note.textContent = t('cost.coverageNote', {
      span,
      full: fmtBaht(cost.totalsFullYear.ebit),
    });
    host.appendChild(note);
  }

  /* แสดงเฉพาะเดือนที่มีความเคลื่อนไหวจริง
   * ชีตกรอกล่วงหน้าถึงสิ้นปี ถ้าลากกราฟไปครบ 12 เดือนจะเห็นเส้นดิ่งลงศูนย์
   * ซึ่งอ่านผิดทันทีว่าธุรกิจหยุดเดิน */
  const active = cost.byMonth.filter((m) => m.month <= (cost.lastActiveMonth ?? '9999-99'));

  // ── รายได้ vs ต้นทุน รายเดือน ──
  {
    const body = panel(host, t('cost.pnlTitle'), t('cost.pnlNote'), { wide: true });
    if (!active.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.line(
            box,
            [
              {
                label: t('cost.revenue'),
                points: active.map((m) => ({ date: m.month, value: m.revenue })),
              },
              {
                label: t('cost.totalCost'),
                points: active.map((m) => ({ date: m.month, value: m.cost })),
              },
              /* เส้นที่สามคือกำไรขั้นต้นที่ **คำนวณใหม่** (รายได้ − ต้นทุน) ไม่ใช่ช่อง EBITDA ในชีต
               *
               * ช่อง EBITDA ในชีตขัดกับรายได้−ต้นทุนของตัวเองทั้ง 6 เดือนที่เทียบได้
               * (finding `finance.ebitdaMismatch` ระดับ critical ทุกเดือน) และ tile
               * ด้านบนก็คิดใหม่อยู่แล้ว การให้กราฟกับ tile คนละที่มาแปลว่ามีตัวเลข
               * สองชุดบนหน้าจอเดียวกัน — CLAUDE.md §6 ห้ามอ่านช่อง EBITDA มาแสดงตรง ๆ */
              {
                label: t('cost.grossProfit'),
                points: active.map((m) => ({ date: m.month, value: m.grossProfit })),
              },
            ],
            // unit: '฿' — ไม่ส่งแล้วทั้งแกน Y และ tooltip จะคิดว่าเป็นน้ำหนักแล้วขึ้นเป็น kg
            { height: 260, format: 'month', unit: '฿' }
          ),
      });
    }
  }

  const g = grid(host, { cols: 2 });

  // ── สัดส่วนต้นทุน ──
  {
    const body = panel(g, t('cost.split'), t('cost.splitNote'));
    const labels = {
      materialCost: t('cost.material'),
      farmExpense: t('cost.farm'),
      officeExpense: t('cost.office'),
    };
    const mix = {};
    for (const gp of cost.byGroup) mix[labels[gp.key]] = gp.amount;
    const order = cost.byGroup.map((gp) => labels[gp.key]);
    if (!order.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({
        node: box,
        // unit: '฿' จำเป็น ไม่งั้นยอด 17.3 ล้านบาทจะขึ้นกลางโดนัทว่า "17,299 kg"
        run: () => charts.donut(box, mix, { order, ramp: 'cat', height: 220, unit: '฿' }),
      });
    }
  }

  /* ── ต้นทุนการปลูก แยกเป็นหัวข้อ ──
   *
   * ของเดิมเป็นกราฟเรียงรายการทั้งหมดปนกัน ซึ่งเอาแถวยอดรวม (`1) รวม ค่าบุคลากร`)
   * ไปเรียงแข่งกับลูกของมันเอง (`- เงินเดือน`) ยอดจึงเกินจริง 6.85 ล้าน
   * ตอนนี้แยกตามโครงของชีต: หัวข้อที่มีเลขข้อ = ต้นทุนการปลูก · ที่เหลือ = เบ็ดเตล็ด */
  {
    const bd = cost.breakdown ?? { growing: [], misc: [] };
    const body = panel(g, t('cost.growingItems'), `${fmtBaht(bd.growingTotal ?? 0)} · ${span}`);
    const rows = bd.growing.map((x) => ({ key: x.label, flower: x.amount }));
    if (!rows.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({
        node: box,
        run: () => charts.barH(box, rows, { max: rows.length, unit: '฿' }),
      });
    }
  }

  /* ── ต้นทุนเบ็ดเตล็ด ──
   * รวมกันแค่ ~13% ของต้นทุนวัตถุดิบ ถ้าเอาไปเรียงแท่งปนกับหัวข้อหลักจะกินที่โดยเปล่า
   * แต่ต้องเห็นครบทุกรายการ จึงเป็นตารางที่กดเรียงได้แทน */
  {
    const bd = cost.breakdown ?? { misc: [] };
    const body = panel(g, t('cost.miscItems'), `${fmtBaht(bd.miscTotal ?? 0)} · ${span}`);
    if (!bd.misc.length) {
      emptyNote(body);
    } else {
      body.appendChild(
        sortableTable(
          [
            { label: t('cost.item'), get: (r) => r.label },
            {
              label: t('cost.amount'),
              align: 'n',
              get: (r) => r.amount,
              render: (r) => `<b>${baht(r.amount)}</b>`,
            },
          ],
          bd.misc,
          { sortIndex: 1, sortDir: 'desc' }
        )
      );
    }
  }

  // ── ตารางงบรายเดือน ──
  {
    const body = panel(host, t('cost.monthTable'), t('cost.monthTableNote'), { wide: true });
    body.appendChild(
      sortableTable(
        [
          { label: t('label.byMonth'), get: (r) => r.month },
          { label: t('cost.revenue'), align: 'n', get: (r) => r.revenue, render: (r) => baht(r.revenue) },
          {
            label: t('cost.material'),
            align: 'n',
            get: (r) => r.materialCost,
            render: (r) => baht(r.materialCost),
          },
          { label: t('cost.farm'), align: 'n', get: (r) => r.farmExpense, render: (r) => baht(r.farmExpense) },
          {
            label: t('cost.office'),
            align: 'n',
            get: (r) => r.officeExpense,
            render: (r) => baht(r.officeExpense),
          },
          {
            label: t('cost.totalCost'),
            align: 'n',
            get: (r) => r.cost,
            render: (r) => `<b>${baht(r.cost)}</b>`,
          },
          /* ขาดทุนต้องเห็นทันทีโดยไม่ต้องอ่านเครื่องหมายลบ — และต้องทำครบทั้งสองคอลัมน์
           * ถ้าย้อมแค่กำไรขั้นต้น แถวที่ EBIT ติดลบหนักกว่าจะเป็นสีปกติ
           * แล้วคนอ่านจะสรุปว่า "ไม่แดง = ไม่ติดลบ" ซึ่งผิดทั้งคอลัมน์ */
          {
            label: t('cost.grossProfit'),
            align: 'n',
            get: (r) => r.grossProfit,
            render: (r) => signedBaht(r.grossProfit),
          },
          { label: t('cost.ebit'), align: 'n', get: (r) => r.ebit, render: (r) => signedBaht(r.ebit) },
        ],
        cost.byMonth,
        { sortIndex: 0, sortDir: 'asc' }
      )
    );
  }
}

/** ต้นทุนวัสดุสิ้นเปลือง — คนละชีต คนละขอบเขต ห้ามเอาไปบวกกับต้นทุนการปลูก */
function renderSupplyCost(host, supply, requestSupply, drawLater) {
  const body = panel(host, t('cost.supplyTotal'), t('cost.supplyScopeNote'), { wide: true });

  if (!supply) {
    emptyNote(body, t('supply.loading'));
    requestSupply();
    return;
  }

  const order = supply.kpi?.order;
  const items = (order?.items ?? []).filter((i) => Number.isFinite(i.amount) && i.amount > 0);
  if (!items.length) {
    emptyNote(body);
    return;
  }

  const note = document.createElement('p');
  note.className = 'supply-warn';
  note.textContent = `${t('cost.supplyTotal')}: ${baht(order.totalAmount)} ฿ · ${n(items.length)} ${t('cost.itemsWithPrice')}`;
  body.appendChild(note);

  const box = well(body);
  const rows = items.map((i) => ({ key: i.item, flower: i.amount })).sort((a, b) => b.flower - a.flower);
  drawLater.push({ node: box, run: () => charts.barH(box, rows, { max: 10, unit: '฿' }) });

  // ยังขาดต้นทุนบางส่วนอยู่ — ต้องบอกไว้ ไม่ให้เข้าใจว่าตัวเลขข้างบนคือทั้งหมด
  const gaps = grid(body, { cols: 1 });
  gaps.appendChild(
    awaitingCard({
      title: t('awaiting.costPerGram.title'),
      why: t('awaiting.costPerGram.why'),
      wide: true,
      needs: [{ sheet: t('awaiting.costPerGram.sheet'), columns: [t('awaiting.col.gramsPerMonth')] }],
    })
  );
}
