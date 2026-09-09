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
 * ต้นทุนวัสดุสิ้นเปลือง (ชีต Log Stock) เป็นคนละก้อนและคนละขอบเขต ไม่อยู่บนหน้านี้
 * ดูได้ที่หน้า Supply ซึ่งเป็นเจ้าของข้อมูลชุดนั้น — ห้ามเอาไปบวกกับต้นทุนการปลูก
 */
import { t } from '../i18n.js';
import { n, esc, pct, monthSpan, DASH } from '../format.js';
import * as charts from '../charts/index.js';
import { sortableTable } from '../ui/table.js';
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
  const { host, payload, drawLater, onOpen } = ctx;

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

  /* แผง "มูลค่าวัสดุตามตารางสั่งซื้อ" ถูกเอาออกจากหน้านี้ตามคำสั่งผู้ใช้
   *
   * เป็นของคนละชีตและคนละขอบเขตกับงบด้านบน (วัสดุสิ้นเปลืองในฟาร์ม ห้ามเอาไปบวก
   * กับต้นทุนการปลูก) ดูได้ที่หน้า Supply ซึ่งเป็นเจ้าของข้อมูลชุดนั้นอยู่แล้ว
   *
   * ข้อ "ต้นทุนต่อกรัม" ที่เคยอยู่ในแผงนั้นไม่ได้หายไป — ยังอยู่ในทะเบียน
   * ข้อมูลที่ยังขาด (`gaps.js`) ซึ่งแสดงบนการ์ดคุณภาพข้อมูลท้ายหน้า */
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

  renderRevenueSplit(host, cost, span, drawLater);

  /* ต้นทุนการปลูกกับเบ็ดเตล็ดต้องอยู่แถวเดียวกัน — เป็นคู่ที่มีไว้เทียบกัน
   * ถ้าปล่อยให้โดนัทแทรกอยู่ข้างหน้า แผงเบ็ดเตล็ดจะตกไปอยู่แถวถัดไปตัวเดียว
   * แล้วสองกราฟที่ควรมองพร้อมกันจะอยู่คนละแถว */
  const g = grid(host, { cols: 2 });

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
   *
   * กราฟชนิดเดียวกับแผงบน เพื่อให้สองแผงอ่านเทียบกันได้ด้วยภาษาภาพเดียวกัน
   * ช่วงตัวเลขกว้างถึง 1,021 เท่า (ค่าเช่า 1.7 ล้าน ↔ ค่าเติมน้ำยาแอร์ 1,700)
   * แต่ barH ตรึงความกว้างขั้นต่ำไว้ 2px และพิมพ์ตัวเลขไว้ข้างแท่งเสมอ
   * รายการเล็กจึงยังอ่านค่าได้ ไม่หายไปจากกราฟ
   *
   * ส่ง max เท่าจำนวนรายการจริง ไม่ใช้ค่าเริ่มต้น 8 — ไม่งั้นรายการท้าย ๆ
   * จะถูกตัดทิ้งเงียบ ๆ ทั้งที่ยอดรวมบนหัวแผงนับมันไปแล้ว */
  {
    const bd = cost.breakdown ?? { misc: [] };
    const body = panel(g, t('cost.miscItems'), `${fmtBaht(bd.miscTotal ?? 0)} · ${span}`);
    const rows = bd.misc.map((x) => ({ key: x.label, flower: x.amount }));
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

  /* ── สัดส่วนต้นทุน ──
   * คนละคำถามกับสองแผงบน: อันนั้นถามว่าเงินหมดไปกับอะไร อันนี้ถามว่าอยู่ในงบก้อนไหน
   * (วัตถุดิบ / Farm / Office) จึงวางท้ายกริด ไม่แทรกกลางคู่ที่ต้องเทียบกัน */
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

  renderRevenueCustomers(host, cost, span);
  renderCostPerGram(host, cost, drawLater);

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

/** ต้นทุนต่อกรัม 2 ตำแหน่ง — หลักสิบบาท ปัดเป็นจำนวนเต็มแล้ว 22.02 กับ 22.49 จะดูเท่ากัน */
const perGramText = (v) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : `${n(v, 2)} ฿/g`);

/**
 * ต้นทุนต่อกรัม — ตามกติกาในแท็บ "ต้นทุนต่อกรัม" ของชีตต้นทุน (ผู้ใช้ตัดสิน ก.ย. 69)
 *
 * เดิมข้อนี้อยู่ในทะเบียน "ข้อมูลที่ยังขาด" เพราะไม่มีกติกาผูกต้นทุนกับครอป
 * ตอนนี้ชีตมีแถว `Gram (g)` รายเดือนที่คนกรอกเอง = กติกาที่รอ Dashboard จึงคิด
 * `รวม Cost ทั้งหมด ÷ Gram` ของเดือนเดียวกันตามนั้น ไม่อ่านช่อง `Cost / gram` ในชีต
 * (ดู buildCostPerGram) เดือนที่ยังไม่มีกรัมขึ้น — ไม่ใช่ 0 และไม่ถูกยกไปรวมกับเดือนอื่น
 *
 * เส้นงบประมาณเป็นเส้นประ — เป็นตัวเลขที่ตั้งไว้ ไม่ใช่ที่วัดได้จริง ต้องดูออกโดยไม่ต้องอ่าน legend
 */
function renderCostPerGram(host, cost, drawLater) {
  const pg = cost.perGram;
  const body = panel(host, t('cost.pg.title'), t('cost.pg.note'), { wide: true });

  if (!pg?.available) {
    emptyNote(body, t('cost.pg.noTab'));
    return;
  }

  const tot = pg.totals;
  const spanText = tot.from && tot.to ? monthSpan(tot.from, tot.to) : '';
  const tileItems = [
    {
      label: `${t('cost.pg.cumulative')} (${spanText})`,
      value: tot.costPerGram,
      unit: ' ฿/g',
      decimals: 2,
      hint: t('cost.pg.cumulativeHint', { n: tot.monthsWithGrams }),
    },
    { label: `${t('cost.pg.grams')} (${spanText})`, value: tot.grams, unit: 'g', hint: t('cost.pg.gramsHint') },
    { label: `${t('cost.pg.cost')} (${spanText})`, value: tot.cost, unit: '฿', hint: t('cost.pg.costHint') },
  ];
  if (pg.budget) {
    tileItems.push({
      label: `${t('cost.pg.budget')} (${pg.budget.label ?? ''})`,
      value: pg.budget.costPerGram,
      unit: ' ฿/g',
      decimals: 2,
      hint: `${fmtBaht(pg.budget.cost)} ÷ ${n(pg.budget.grams)} g`,
    });
  }
  tiles(body, tileItems);

  const box = well(body);
  const series = [
    {
      label: t('cost.pg.actual'),
      points: pg.months.map((m) => ({ date: m.month, value: m.costPerGram })),
    },
  ];
  if (pg.budget) {
    series.push({
      label: t('cost.pg.budget'),
      points: pg.months.map((m) => ({ date: m.month, value: pg.budget.costPerGram })),
    });
  }
  drawLater.push({
    node: box,
    run: () => charts.line(box, series, { height: 220, format: 'month', unit: '฿/g', dashed: [1] }),
  });

  body.appendChild(
    sortableTable(
      [
        { label: t('label.byMonth'), get: (r) => r.month },
        { label: t('cost.pg.grams'), align: 'n', get: (r) => r.grams, render: (r) => (r.grams === null ? DASH : `${n(r.grams)} g`) },
        { label: t('cost.pg.cost'), align: 'n', get: (r) => r.cost, render: (r) => baht(r.cost) },
        {
          label: t('cost.pg.actual'),
          align: 'n',
          get: (r) => r.costPerGram,
          render: (r) => `<b>${perGramText(r.costPerGram)}</b>`,
        },
        /* ช่องที่ชีตคิดไว้เอง — โชว์ไว้ข้าง ๆ ให้เทียบได้ ถ้าไม่ตรงมี finding กำกับอยู่แล้ว
         * ไม่ใช่ตัวเลขที่ Dashboard ใช้ */
        {
          label: t('cost.pg.stated'),
          align: 'n',
          get: (r) => r.statedCostPerGram,
          render: (r) => `<span class="muted">${perGramText(r.statedCostPerGram)}</span>`,
        },
      ],
      pg.months,
      { sortIndex: 0, sortDir: 'asc' }
    )
  );
}

/** ป้ายกลุ่มลูกค้า — รหัสที่รู้จักแปลผ่าน i18n · กลุ่มที่ชีตตั้งชื่อเองใช้ชื่อนั้นตรง ๆ */
function segmentLabel(seg) {
  if (seg.key === 'domestic') return t('cost.rev.domestic');
  if (seg.key === 'export') return t('cost.rev.export');
  if (seg.key === null || seg.key === '') return t('cost.rev.noSegment');
  return seg.label ?? String(seg.key);
}

/**
 * รายได้แยกในประเทศ / ต่างประเทศ รายเดือน (แท็บ "Revenue" ของชีตต้นทุน — เพิ่ม ก.ย. 69)
 *
 * วางใต้กราฟ P&L เพราะตอบคำถามที่ตามมาทันทีจากเส้นรายได้: "เดือนที่พุ่งขึ้นมาจากใคร"
 * (พ.ค.–มิ.ย. 69 รายได้ 5.6 / 3.5 ล้าน เป็นลูกค้าต่างประเทศรายเดียว 8.29 ล้าน = 73%)
 *
 * เดือนที่แสดงเป็นชุดเดียวกับกราฟ P&L (`byMonth` ถูกสร้างจาก months ที่ตัดที่ lastActive)
 * แกน X สองแผงจึงตรงกัน กวาดตาจากเส้นรายได้ลงมาที่แท่งของเดือนเดียวกันได้เลย
 */
function renderRevenueSplit(host, cost, span, drawLater) {
  const split = cost.revenueSplit;
  const body = panel(host, t('cost.rev.title'), t('cost.rev.note'), { wide: true });

  if (!split?.available) {
    emptyNote(body, t('cost.rev.noTab'));
    return;
  }

  /* ช่องสรุปของแต่ละกลุ่ม — จำนวนช่องตามกลุ่มที่ชีตมีจริง
   * `tiles()` รับกี่ช่องก็ได้ ไม่ต้องตรึงว่ามีสองกลุ่ม */
  tiles(
    body,
    split.segments.map((s) => ({
      label: `${segmentLabel(s)} (${span})`,
      value: s.amount,
      unit: '฿',
      hint: `${pct(s.share, 1)} ${t('cost.ofRevenue')} · ${s.customers} ${t('cost.rev.customerUnit')}`,
    }))
  );

  /* keys ส่งครบทุกกลุ่มเสมอตามลำดับใน segments — สีของชั้นในแท่งมาจากตำแหน่งในลิสต์
   * (กฎ "สีผูกกับหมวด ไม่ใช่กับอันดับในชุดที่กำลังดู" CLAUDE.md §9) */
  const keys = split.segments.map(segmentLabel);
  const data = split.byMonth.map((m) => ({
    key: m.month,
    parts: Object.fromEntries(split.segments.map((s) => [segmentLabel(s), m.bySegment[s.key ?? ''] ?? 0])),
  }));

  const box = well(body);
  drawLater.push({
    node: box,
    run: () =>
      charts.stackedBars(box, data, {
        keys,
        ramp: 'cat',
        height: 240,
        unit: '฿',
        labelFormat: 'month',
        max: data.length,
      }),
  });
}

/**
 * ตารางรายได้รายลูกค้า — เรียงมากไปน้อย พร้อมกลุ่มและสัดส่วน
 *
 * ไม่ทำเป็นกราฟแท่งนอนเพราะชื่อลูกค้ายาว (`บริษัท กรีนรูม ทีเอชซี จำกัด`) ถูกตัดที่ 150px
 * แล้วอ่านไม่ออกว่าเป็นใคร ตารางเรียงได้ทุกคอลัมน์และมีที่ให้ชื่อเต็ม
 * "เดือนที่มียอด" บอกว่าเป็นลูกค้าประจำหรือซื้อครั้งเดียว ซึ่งยอดรวมอย่างเดียวบอกไม่ได้
 */
function renderRevenueCustomers(host, cost, span) {
  const split = cost.revenueSplit;
  if (!split?.available) return;

  const body = panel(host, t('cost.rev.customers'), `${fmtBaht(split.total)} · ${span}`, { wide: true });
  const segLabel = (c) => segmentLabel({ key: c.segment, label: c.segmentLabel });

  body.appendChild(
    sortableTable(
      [
        { label: t('cost.rev.customer'), get: (r) => r.customer, render: (r) => esc(r.customer) },
        { label: t('cost.rev.segment'), get: (r) => segLabel(r), render: (r) => esc(segLabel(r)) },
        { label: t('cost.revenue'), align: 'n', get: (r) => r.amount, render: (r) => `<b>${baht(r.amount)}</b>` },
        { label: t('cost.rev.share'), align: 'n', get: (r) => r.share, render: (r) => pct(r.share, 1) },
        {
          label: t('cost.rev.monthsActive'),
          align: 'n',
          get: (r) => r.monthsWithValue,
          render: (r) => String(r.monthsWithValue),
        },
        { label: t('cost.rev.lastMonth'), get: (r) => r.lastMonth, render: (r) => r.lastMonth ?? DASH },
      ],
      split.customers,
      {
        sortIndex: 2,
        sortDir: 'desc',
        foot: (rows) => [
          t('label.total'),
          '',
          `<b>${baht(rows.reduce((a, r) => a + r.amount, 0))}</b>`,
          '',
          '',
          '',
        ],
      }
    )
  );
}
