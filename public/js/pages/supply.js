/**
 * pages/supply.js — KAMBIS SUPPLY STOCK (หน้าเดียวจบ)
 *
 * ลำดับบนหน้าตามที่ผู้ใช้กำหนด:
 *   ① ของที่ต้องสั่งซื้อ  — บนสุด เพราะเป็นสิ่งเดียวที่ต้องลงมือทำต่อทันที
 *      พร้อมปุ่มออกใบขอซื้อเป็นไฟล์ .xlsx
 *   ② จำนวนเบิกต่อเดือน (รายการ × เดือน)
 *   ③ มูลค่าการสั่งซื้อ
 *   ④ คุณภาพข้อมูล — ใบสุดท้ายของหน้าเสมอ
 *
 * ข้อมูลชุดนี้โหลดแบบ lazy (มี 139 แท็บ) แต่ main.js ดึงต่อในเบื้องหลังให้แล้ว
 * ตั้งแต่ Dashboard หลักวาดเสร็จ ปกติจึงไม่เจอหน้าจอ "กำลังโหลด" ที่นี่
 *
 * **แถบตัวกรองวาดใหม่เฉพาะแผงข้อมูล ไม่ผ่าน router**
 * เพราะช่องค้นหาพิมพ์ทีละตัวอักษร ถ้าให้ router วาดทั้งหน้าใหม่ โฟกัสจะหลุด
 * จากช่องพิมพ์ทันทีที่กดตัวแรก — URL ยังถูกอัปเดตอยู่ แต่แบบไม่ยิง event
 */
import { t } from '../i18n.js';
import { n, esc, DASH, date as fmtDate } from '../format.js';
import { sortableTable } from '../ui/table.js';
import { pageHeader, panel, tiles, emptyNote, appendQualityCard } from './shared.js';
import { comparePeriod } from '../shared/agg-core.js';
import {
  readSupplyFilters,
  supplyFilterParams,
  supplyFilterBar,
  supplyMatcher,
  supplyLookup,
} from '../ui/supply-filters.js';

export const meta = { report: 'supply', page: 'main' };

export function render(ctx) {
  const { host, supply, requestSupply, supplyError, params, setParams, onOpen, drawLater } = ctx;

  pageHeader(host, { title: t('page.supply.title'), sub: t('page.supply.sub') });

  if (supplyError) {
    const box = panel(host, t('supply.loadFailed'), null, { wide: true });
    box.innerHTML = `<p class="empty-note">${esc(supplyError)}</p>`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn';
    retry.textContent = t('action.retry');
    retry.addEventListener('click', () => requestSupply({ force: true }));
    box.appendChild(retry);
    return;
  }

  if (!supply) {
    const box = panel(host, t('supply.loadingTitle'), null, { wide: true });
    box.innerHTML = `<p class="empty-note">${esc(t('supply.loading'))}</p>`;
    requestSupply();
    return;
  }

  const kpi = supply.kpi ?? {};
  const items = kpi.items ?? [];
  const months = kpi.months ?? [];
  const lookup = supplyLookup(items);

  /* ปีที่เลือกได้ = ปีที่มีการเบิกจริง ไม่ใช่ทุกปีที่ปรากฏในชีต
   * ชีตมีแถวลงวันที่ล่วงหน้าถึงสิ้นปี ถ้านับด้วยจะได้ปีที่เลือกแล้วตารางว่าง */
  const monthsWithUsage = months.filter((m) => (kpi.usage ?? []).some((r) => (r.byMonth[m] ?? 0) > 0));
  const options = {
    years: [...new Set(monthsWithUsage.map((m) => m.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    groups: [...new Set(items.map((i) => i.group).filter(Boolean))],
  };

  let filters = readSupplyFilters(params);

  /* .stack ให้ระยะห่างระหว่างแผงเท่ากับหน้าอื่น — กล่องนี้เป็น div เปล่าที่หน้าวาดใหม่เอง
   * แผงข้างในจึงไม่ได้ gap ของ .page (เป็นหลานไม่ใช่ลูก) แล้วดูติดกันไปหมด */
  const dataHost = document.createElement('div');
  dataHost.className = 'stack';

  const bar = supplyFilterBar({
    filters,
    options,
    onChange: (next) => {
      filters = next;
      // อัปเดต URL แบบไม่ยิง event — ถ้ายิง router จะวาดทั้งหน้าใหม่แล้วโฟกัสหลุด
      setParams?.(supplyFilterParams(next), { silent: true });
      draw();
    },
  });
  host.appendChild(bar);
  host.appendChild(dataHost);

  /** วาดเฉพาะแผงข้อมูล — แถบตัวกรองกับการ์ดคุณภาพข้อมูลอยู่นอกกล่องนี้ */
  const draw = () => {
    dataHost.innerHTML = '';
    const match = supplyMatcher(filters, lookup);

    const reorder = (kpi.needsReorder ?? []).filter(match);
    const usage = (kpi.usage ?? []).filter(match);
    const orderItems = (kpi.order?.items ?? []).filter(match);
    const shownItems = items.filter(match);
    bar.__setCount(shownItems.length, items.length);

    /* ยอดบนแถบตัวเลขต้องเป็นของ "ที่กรองแล้ว" ให้ตรงกับตารางข้างล่าง
     * ยกเว้นมูลค่าการสั่งซื้อที่คิดจากแถวที่เหลือจริง ๆ ไม่ใช่ยอดรวมทั้งชีต */
    tiles(dataHost, [
      { label: t('supply.trackedItems'), value: shownItems.length, hint: t('supply.fromLog') },
      { label: t('supply.needReorder'), value: reorder.length, hint: t('supply.belowMinimum') },
      {
        label: t('supply.orderValue'),
        value: orderItems.reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0),
        unit: '฿',
        hint: t('supply.fromOrderTab'),
      },
      { label: t('supply.asOf'), value: null, awaiting: false, hint: kpi.asOf || DASH },
    ]);

    renderReorder(dataHost, reorder, kpi, requestSupply);
    renderAnomalies(dataHost, kpi.usageAnomalies, match);
    renderUsage(dataHost, usage, monthsWithUsage, filters, options);
    // ตารางสต๊อกใช้แถวจากแท็บ log (ยอดคงเหลือจริง) ไม่ใช่ orderItems ที่เป็นแผนสั่งซื้อ
    renderStockTable(dataHost, shownItems);
  };

  draw();

  /* ── ④ คุณภาพข้อมูล — ใบสุดท้ายของหน้าเสมอ (ผู้ใช้กำหนดไว้) ──
   *
   * อยู่นอก dataHost เพราะไม่ขึ้นกับตัวกรอง (คุณภาพของ "ทั้งชีต" ไม่ใช่ของที่กรองไว้)
   * และการวาดใหม่จะทำให้กราฟบนการ์ดต้องวาดซ้ำโดยไม่จำเป็น
   *
   * ต้องส่ง payload ของรายงานนี้เข้าไป ไม่ใช่ของ Dashboard หลัก
   * เพราะชีตวัสดุโหลดแยกแบบ lazy จึงมี meta/analysis เป็นคนละก้อนกัน */
  appendQualityCard(
    host,
    { analysis: supply.analysis, meta: supply.meta, kpi, report: 'supply' },
    onOpen,
    drawLater,
    { wide: true }
  );
}

/**
 * ③ ตารางจำนวนเบิกต่อเดือน — แถวคือรายการ คอลัมน์คือเดือน
 *
 * แสดงเฉพาะเดือนที่มีการเบิกจริง ชีตมีแถวลงวันที่ล่วงหน้าถึงสิ้นปี
 * ถ้าเอาทุกเดือนที่ปรากฏในข้อมูลมาทำคอลัมน์ จะได้คอลัมน์ว่างเปล่าอีกครึ่งตาราง
 */
function renderUsage(host, usage, monthsWithUsage, filters, options) {
  const body = panel(host, t('supply.usageTitle'), t('supply.usageNote'), { wide: true });

  // ปีที่ดูอยู่ — ยังไม่ได้เลือกเอง = ปีล่าสุดที่มีการเบิกจริง (ไม่ใช่ปีปฏิทินปัจจุบัน
  // เพราะต้นปีที่ยังไม่มีใครเบิกของ ตารางจะว่างเปล่าทั้งที่ปีก่อนมีข้อมูลอยู่)
  const year = filters.year === 'all' ? null : filters.year || options.years[0] || null;
  const shown = (year ? monthsWithUsage.filter((m) => m.startsWith(year)) : monthsWithUsage).sort(
    comparePeriod
  );

  if (!usage.length) {
    emptyNote(body, t('supply.noUsage'));
    return;
  }
  if (!shown.length) {
    emptyNote(body, t('supply.noUsageInYear').replace('{year}', String(year)));
    return;
  }

  /* ยอดรวมต้องคิดใหม่จากเดือนที่แสดงอยู่จริง ห้ามใช้ `r.total` ที่ server รวมมา
   * เพราะนั่นเป็นยอดตลอดกาล พอกรองปีแล้วแถวจะรวมไม่ตรงกับคอลัมน์ที่เห็น */
  const totalOf = (r) => shown.reduce((sum, m) => sum + (r.byMonth[m] ?? 0), 0);

  body.appendChild(
    sortableTable(
      /* หน่วยอยู่ท้ายสุด ต่อจากคอลัมน์รวม — คอลัมน์เดือนคือของที่ต้องกวาดตาเทียบกัน
       * แทรกคอลัมน์ข้อความคั่นระหว่างชื่อรายการกับตัวเลขทำให้สายตาสะดุดทุกแถว */
      [
        { label: t('supply.item'), get: (r) => r.item },
        ...shown.map((m) => ({
          label: m,
          align: 'n',
          get: (r) => r.byMonth[m] ?? null,
          render: (r) =>
            r.byMonth[m] === undefined ? `<span class="muted">${DASH}</span>` : n(r.byMonth[m]),
        })),
        {
          label: t('label.total'),
          align: 'n',
          get: totalOf,
          render: (r) => `<b>${n(totalOf(r))}</b>`,
        },
        { label: t('supply.unit'), get: (r) => r.unit ?? '' },
      ],
      usage,
      // เรียงตามคอลัมน์รวม ซึ่งตอนนี้อยู่ถัดจากคอลัมน์เดือนสุดท้าย (ชื่อรายการ + เดือน)
      { sortIndex: 1 + shown.length, sortDir: 'desc' }
    )
  );
}

/**
 * ④ รายการสต๊อกปัจจุบัน
 *
 * แถวมาจาก **แท็บ log ของแต่ละรายการ** ไม่ใช่ตารางสั่งซื้อรายเดือน
 * "คงเหลือ" จึงเป็นยอดจริง ณ วันนี้ (แถวล่าสุดที่วันที่ ≤ วันนี้ — ชีตมีแถวลงวันที่
 * ล่วงหน้าที่ยอดถูก carry forward ไว้ ถ้าอ่านแถวสุดท้ายของแท็บจะได้ยอดของอนาคต)
 *
 * ราคาถูก join มาจากตารางสั่งซื้อซึ่งมีแค่ 60 รายการจาก 138 แท็บ ที่จับคู่ไม่ได้
 * ต้องขึ้นว่า "ยังไม่ใส่ราคา" ให้เห็นชัด **ห้ามเดาราคาหรือคิดเป็น 0**
 * ไม่งั้นมูลค่ารวมของสต๊อกจะต่ำกว่าความจริงโดยไม่มีอะไรบอก
 */
function renderStockTable(host, items) {
  const body = panel(host, t('supply.stockTable'), t('supply.stockTableNote'), { wide: true });
  if (!items.length) {
    emptyNote(body);
    return;
  }

  // มูลค่าคิดได้เฉพาะรายการที่มีทั้งยอดคงเหลือและราคา
  const valueOf = (r) =>
    r.balance !== null && r.unitPrice !== null ? r.balance * r.unitPrice : null;

  body.appendChild(
    sortableTable(
      [
        { label: t('supply.item'), get: (r) => r.item },
        {
          label: t('supply.balance'),
          align: 'n',
          get: (r) => r.balance,
          render: (r) => (r.balance === null ? `<span class="muted">${DASH}</span>` : n(r.balance)),
        },
        { label: t('supply.unit'), get: (r) => r.unit ?? '' },
        {
          label: t('supply.unitPrice'),
          align: 'n',
          get: (r) => r.unitPrice,
          render: (r) =>
            r.unitPrice === null
              ? `<span class="cell-missing">${esc(t('supply.noPrice'))}</span>`
              : n(r.unitPrice, 2),
        },
        {
          label: t('supply.amount'),
          align: 'n',
          get: valueOf,
          render: (r) => {
            const v = valueOf(r);
            return v === null ? `<span class="muted">${DASH}</span>` : `<b>${n(v, 2)}</b>`;
          },
        },
        { label: t('supply.lifetime'), get: (r) => r.lifetimeText ?? '' },
      ],
      items,
      { sortIndex: 4, sortDir: 'desc' }
    )
  );
}

/**
 * สรุปรายการที่เบิกผิดปกติในเดือนล่าสุด
 *
 * ตอนนี้ชีตมีข้อมูลการเบิกจริงแค่เดือนเดียว หน้านี้จึงยังบอกว่า "ข้อมูลยังไม่พอ"
 * และจะเริ่มทำงานเองเมื่อมีเดือนที่เบิกจบแล้วครบ 2 เดือน — ตั้งใจให้เป็นแบบนี้
 * ดีกว่าเดาจากข้อมูลเดือนเดียวแล้วเตือนผิด ๆ จนคนเลิกเชื่อ
 */
function renderAnomalies(host, anomalies, match = () => true) {
  const body = panel(host, t('supply.anomalyTitle'), t('supply.anomalyNote'), { wide: true });

  if (!anomalies?.ready) {
    const have = anomalies?.monthsAvailable ?? 0;
    const need = anomalies?.monthsNeeded ?? 3;
    emptyNote(body, t('supply.anomalyNotReady').replace('{have}', String(have)).replace('{need}', String(need)));
    return;
  }

  // บอกให้ชัดว่ากำลังเทียบอะไรกับอะไร ไม่งั้นตัวเลขที่เห็นตีความไม่ได้
  const scope = document.createElement('p');
  scope.className = 'supply-warn';
  scope.textContent = t('supply.anomalyScope')
    .replace('{month}', anomalies.currentMonth)
    .replace('{days}', String(anomalies.daysElapsed))
    .replace('{base}', anomalies.baselineMonths.join(', '));
  body.appendChild(scope);

  const rows = anomalies.items.filter(match);
  if (!rows.length) {
    emptyNote(body, t('supply.anomalyNone'));
    return;
  }

  const label = {
    high: t('supply.anomalyHigh'),
    low: t('supply.anomalyLow'),
    new: t('supply.anomalyNew'),
  };

  body.appendChild(
    sortableTable(
      [
        { label: t('supply.item'), get: (r) => r.item },
        { label: t('supply.unit'), get: (r) => r.unit ?? '' },
        {
          label: t('supply.anomalyStatus'),
          get: (r) => r.direction,
          render: (r) =>
            `<span class="quality-chip" data-level="${r.direction === 'low' ? 'good' : 'warn'}">${esc(label[r.direction])}</span>`,
        },
        {
          label: t('supply.anomalyCurrent'),
          align: 'n',
          get: (r) => r.current,
          render: (r) => `<b>${n(r.current)}</b>`,
        },
        {
          label: t('supply.anomalyExpected'),
          align: 'n',
          get: (r) => r.expected,
          render: (r) => n(r.expected, 1),
        },
        {
          label: t('supply.anomalyBaseline'),
          align: 'n',
          get: (r) => r.baseline,
          render: (r) => n(r.baseline, 1),
        },
        {
          label: t('supply.anomalyRatio'),
          align: 'n',
          get: (r) => r.ratio,
          render: (r) =>
            r.ratio === null ? `<span class="muted">${DASH}</span>` : `${n(r.ratio, 2)}×`,
        },
      ],
      rows,
      { sortIndex: 6, sortDir: 'desc' }
    )
  );
}

/** ตารางของที่ต้องสั่งซื้อ พร้อมช่องเลือกและปุ่มออกเอกสาร */
function renderReorder(host, reorder, kpi, requestSupply) {
  const body = panel(host, t('supply.reorderTitle'), t('supply.reorderNote'), { wide: true });

  if (!reorder.length) {
    emptyNote(body, t('supply.nothingToReorder'));
    return;
  }

  /* เริ่มต้นติ๊กเฉพาะรายการที่ **ยังไม่ได้ขอซื้อ**
   *
   * ของที่ขอไปแล้วยังต่ำกว่าขั้นต่ำอยู่จนกว่าของจะมาถึง มันจึงยังอยู่ในตารางนี้
   * ถ้าติ๊กไว้ให้เหมือนเดิม ฝ่ายจัดซื้อที่กดขอเมื่อวานจะขอซ้ำโดยไม่รู้ตัว
   * — ยังติ๊กเองได้ถ้าตั้งใจจะขอเพิ่ม แต่ต้องเป็นการตัดสินใจ ไม่ใช่ค่าเริ่มต้น */
  const picked = new Map(reorder.map((r) => [r.item, { on: !r.pending, qty: r.suggestedQty }]));
  const waiting = reorder.filter((r) => r.pending);
  if (waiting.length) {
    const note = document.createElement('p');
    note.className = 'supply-warn';
    note.textContent = t('supply.pendingNote').replace('{n}', String(waiting.length));
    body.appendChild(note);
  }

  const noPrice = reorder.filter((r) => r.unitPrice === null).length;
  if (noPrice > 0) {
    const warn = document.createElement('p');
    warn.className = 'supply-warn';
    warn.textContent = t('supply.missingPriceWarn').replace('{n}', String(noPrice));
    body.appendChild(warn);
  }

  const table = document.createElement('div');
  table.className = 'table-wrap';
  table.innerHTML = `
    <table class="data">
      <thead>
        <tr>
          <th scope="col" class="col-check">
            <input type="checkbox" id="pr-all"${waiting.length ? '' : ' checked'} aria-label="${esc(t('supply.selectAll'))}">
          </th>
          <th scope="col">${esc(t('supply.date'))}</th>
          <th scope="col">${esc(t('supply.item'))}</th>
          <th scope="col" title="${esc(t('supply.prStatusTip'))}">${esc(t('supply.prStatus'))}</th>
          <th scope="col" style="text-align:right">${esc(t('supply.balance'))}</th>
          <th scope="col">${esc(t('supply.unit'))}</th>
          <th scope="col" style="text-align:right">${esc(t('supply.minimum'))}</th>
          <th scope="col" style="text-align:right" title="${esc(t('supply.indexTip'))}">${esc(t('supply.index'))}</th>
          <th scope="col" style="text-align:right" title="${esc(t('supply.leadTimeTip'))}">${esc(t('supply.leadTime'))}</th>
          <th scope="col" style="text-align:right">${esc(t('supply.orderQtyEditable'))}</th>
          <th scope="col" style="text-align:right">${esc(t('supply.unitPrice'))}</th>
          <th scope="col" style="text-align:right">${esc(t('supply.amount'))}</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>`;

  /* ป้ายสถานะใบขอซื้อ — ระบบปิดสถานะเองเมื่อ Log Sheet มีของเข้าหลังวันที่ขอ
   * `overdue` เป็น null ได้ แปลว่าชีตไม่ได้เขียน Lead Time ไว้ จึงบอกไม่ได้ว่าช้าหรือยัง */
  const pendingCell = (r) => {
    if (!r.pending) return `<span class="muted">${DASH}</span>`;
    const p = r.pending;
    const days = p.daysAgo === null ? '' : ` · ${t('supply.daysAgo').replace('{n}', String(p.daysAgo))}`;
    const level = p.overdue ? 'bad' : 'warn';
    const tip = p.overdue
      ? t('supply.prOverdueTip').replace('{n}', String(r.leadTimeDays))
      : t('supply.prWaitingTip');
    return `<span class="quality-chip" data-level="${level}" title="${esc(tip)}">${esc(p.docNo)}${esc(days)}</span>`;
  };

  const tbody = table.querySelector('tbody');
  for (const r of reorder) {
    const tr = document.createElement('tr');
    tr.dataset.item = r.item;
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox"${r.pending ? '' : ' checked'} data-role="pick"
          aria-label="${esc(r.item)}"></td>
      <td>${esc(fmtDate(r.date))}</td>
      <td>${esc(r.item)}</td>
      <td>${pendingCell(r)}</td>
      <td style="text-align:right" class="num">${n(r.balance)}</td>
      <td>${esc(r.unit ?? '')}</td>
      <td style="text-align:right" class="num">${n(r.minimum)}</td>
      <td style="text-align:right" class="num">${n(r.index)}</td>
      <td style="text-align:right" class="num">${
        // ครึ่งหนึ่งของรายการไม่ได้เขียน Lead Time ไว้ในหัวตาราง — ต้องขึ้น — ห้ามเดาเป็น 0
        r.leadTimeDays === null || r.leadTimeDays === undefined
          ? `<span class="muted" title="${esc(t('supply.noLeadTimeTip'))}">${DASH}</span>`
          : n(r.leadTimeDays)
      }</td>
      <td style="text-align:right">
        <input type="number" class="qty-input" min="1" step="1" value="${r.suggestedQty}"
               data-role="qty" aria-label="${esc(t('supply.orderQtyEditable'))} ${esc(r.item)}">
      </td>
      <td style="text-align:right" class="num">${
        r.unitPrice === null ? `<span class="muted" title="${esc(t('supply.noPriceTip'))}">${DASH}</span>` : n(r.unitPrice, 2)
      }</td>
      <td style="text-align:right" class="num" data-role="amount">${
        r.amount === null ? `<span class="muted">${DASH}</span>` : n(r.amount, 2)
      }</td>`;
    tbody.appendChild(tr);
  }
  body.appendChild(table);

  const summary = document.createElement('div');
  summary.className = 'pr-summary';
  body.appendChild(summary);

  const actions = document.createElement('div');
  actions.className = 'pr-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--primary';
  button.textContent = t('supply.createPR');
  const status = document.createElement('span');
  status.className = 'pr-status';
  status.setAttribute('role', 'status');
  actions.append(button, status);
  body.appendChild(actions);

  const priceOf = new Map(reorder.map((r) => [r.item, r.unitPrice]));

  const refresh = () => {
    let count = 0;
    let total = 0;
    let unpriced = 0;
    for (const [item, state] of picked) {
      if (!state.on) continue;
      count++;
      const price = priceOf.get(item);
      if (price === null || price === undefined) unpriced++;
      else total += price * state.qty;
    }
    summary.innerHTML =
      `<span>${esc(t('supply.selected'))}: <b>${n(count)}</b> ${esc(t('supply.itemsUnit'))}</span>` +
      `<span>${esc(t('supply.estTotal'))}: <b class="num">${n(total, 2)}</b> ฿</span>` +
      (unpriced
        ? `<span class="muted">${esc(t('supply.unpricedNote').replace('{n}', String(unpriced)))}</span>`
        : '');
    button.disabled = count === 0;
  };

  tbody.addEventListener('change', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const state = picked.get(tr.dataset.item);
    if (!state) return;

    if (e.target.dataset.role === 'pick') state.on = e.target.checked;
    if (e.target.dataset.role === 'qty') {
      const v = Number(e.target.value);
      // จำนวนต้องเป็นบวกเสมอ — ค่าที่ไม่ถูกต้องดีดกลับทันที ไม่ปล่อยไปถึง server
      state.qty = Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
      e.target.value = String(state.qty);
      const price = priceOf.get(tr.dataset.item);
      const cell = tr.querySelector('[data-role="amount"]');
      cell.innerHTML =
        price === null || price === undefined
          ? `<span class="muted">${DASH}</span>`
          : n(price * state.qty, 2);
    }
    refresh();
  });

  table.querySelector('#pr-all').addEventListener('change', (e) => {
    const on = e.target.checked;
    for (const state of picked.values()) state.on = on;
    for (const cb of tbody.querySelectorAll('[data-role="pick"]')) cb.checked = on;
    refresh();
  });

  button.addEventListener('click', async () => {
    const items = [...picked.entries()]
      .filter(([, s]) => s.on)
      .map(([item, s]) => ({ item, qty: s.qty }));
    if (!items.length) return;

    button.disabled = true;
    status.textContent = t('supply.creating');
    try {
      const res = await fetch('/api/supply/purchase-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      /* ตอบเป็น JSON ที่มีได้หลายไฟล์ — เลือกทั้งวัสดุและปุ๋ยในครั้งเดียว
       * จะได้สองใบเพราะบริษัทใช้แบบฟอร์มคนละแบบ */
      const out = await res.json();
      const docs = out.documents ?? [];
      const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      for (const doc of docs) {
        const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
        // ต้องปล่อย object URL คืนหลังใช้ ไม่งั้นค้างในหน่วยความจำ
        const url = URL.createObjectURL(new Blob([bytes], { type: MIME }));
        const a = document.createElement('a');
        a.href = url;
        a.download = doc.fileName ?? `${doc.docNo}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      const parts = [`${t('supply.created')} ${docs.map((d) => d.docNo).join(' · ')}`];
      // รายการที่ตกหล่นเคยหายเงียบไปกับ header ที่ไม่มีใครอ่าน — ต้องบอกให้เห็น
      if (out.skipped?.length) parts.push(t('supply.prSkipped').replace('{n}', String(out.skipped.length)));
      if (out.indexed === false) parts.push(t('supply.prNotIndexed'));
      status.textContent = parts.join(' · ');

      // ตารางต้องรู้ทันทีว่ารายการเหล่านี้ขอไปแล้ว ไม่ต้องรอผู้ใช้กดรีเฟรชเอง
      requestSupply?.({ force: true });
    } catch (err) {
      status.textContent = `${t('supply.createFailed')}: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  });

  refresh();
}
