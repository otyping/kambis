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
import { pageHeader, panel, well, grid, tiles, emptyNote, appendQualityCard } from './shared.js';

export const meta = { report: 'dryflower', page: 'cost' };

/** จำนวนเงิน — ใช้ทศนิยม 0 เพราะหลักล้านที่มีสตางค์อ่านยากและไม่ช่วยตัดสินใจ */
const baht = (v) => (v === null || v === undefined || !Number.isFinite(v) ? DASH : n(v, 0));

export function render(ctx) {
  const { host, payload, supply, drawLater, requestSupply, onOpen, filters } = ctx;

  pageHeader(host, { title: t('page.cost.title'), sub: t('page.cost.sub') });

  const cost = payload.kpi?.cost;

  if (!cost?.available) {
    const box = panel(host, t('cost.noSheet'), null, { wide: true });
    emptyNote(box, t('cost.noSheetNote'));
  } else {
    renderFinance(host, cost, filters, drawLater);
  }

  // ── ต้นทุนวัสดุสิ้นเปลือง — คนละขอบเขต โหลดคนละก้อน ──
  renderSupplyCost(host, supply, requestSupply, drawLater);

  appendQualityCard(host, { ...payload, report: 'dryflower' }, onOpen, drawLater);
}

/** งบรายรับ-รายจ่ายจากชีตต้นทุน */
function renderFinance(host, cost, filters, drawLater) {
  /* ตัวกรองปีใช้ร่วมกับทั้งรายงาน — ชีตต้นทุนตอนนี้มีปีเดียว
   * ถ้าผู้ใช้เลือกปีอื่นต้องบอกตรง ๆ ว่าไม่มีข้อมูลปีนั้น ไม่ใช่โชว์ปีที่มีแล้วให้เข้าใจผิด */
  const wantYear = filters?.resolvedYear ?? null;
  if (wantYear && cost.year && wantYear !== cost.year) {
    const box = panel(host, t('cost.pnlTitle'), null, { wide: true });
    emptyNote(box, t('cost.otherYear').replace('{year}', wantYear).replace('{has}', cost.year));
    return;
  }

  const { totals } = cost;
  const margin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : null;

  tiles(host, [
    { label: `${t('cost.revenue')} (${cost.year})`, value: totals.revenue, unit: '฿' },
    { label: `${t('cost.totalCost')} (${cost.year})`, value: totals.cost, unit: '฿', hint: t('cost.growingOnly') },
    /* ชีตนิยาม EBITDA ว่า รายได้ − รวมต้นทุนการปลูก ซึ่งเท่ากับกำไรขั้นต้นพอดี
     * จึงเป็นช่องเดียว ไม่ใช่สองช่องที่โชว์เลขเดียวกันจนดูเหมือนบั๊ก
     * ค่าที่เอามาโชว์คำนวณใหม่เอง ส่วนของชีตถูกเทียบไว้แล้วใน checkFinance() */
    {
      label: t('cost.grossProfit'),
      value: totals.grossProfit,
      unit: '฿',
      hint: margin === null ? t('cost.ebitda') : `${n(margin, 1)}% ${t('cost.ofRevenue')} · EBITDA`,
    },
    { label: t('cost.depreciation'), value: totals.depreciation, unit: '฿' },
    { label: t('cost.ebit'), value: totals.ebit, unit: '฿' },
  ]);

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
              {
                label: t('cost.ebitda'),
                points: active.map((m) => ({ date: m.month, value: m.ebitda })),
              },
            ],
            { height: 260, format: 'month' }
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
        run: () => charts.donut(box, mix, { order, ramp: 'cat', height: 220 }),
      });
    }
  }

  // ── รายการที่ใช้เงินสูงสุด ──
  {
    const body = panel(g, t('cost.topItems'), t('cost.topItemsNote'));
    const rows = cost.topItems.map((i) => ({ key: i.item, flower: i.amount }));
    if (!rows.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({ node: box, run: () => charts.barH(box, rows, { max: 10, unit: '฿' }) });
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
          {
            label: t('cost.grossProfit'),
            align: 'n',
            get: (r) => r.grossProfit,
            // ขาดทุนต้องเห็นทันทีโดยไม่ต้องอ่านเครื่องหมายลบ
            render: (r) =>
              r.grossProfit === null
                ? `<span class="muted">${DASH}</span>`
                : `<b class="${r.grossProfit < 0 ? 'money-neg' : 'money-pos'}">${baht(r.grossProfit)}</b>`,
          },
          { label: t('cost.ebit'), align: 'n', get: (r) => r.ebit, render: (r) => baht(r.ebit) },
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
