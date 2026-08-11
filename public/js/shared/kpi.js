/**
 * shared/kpi.js — สร้าง KPI และชุดข้อมูลกราฟทั้งหมด
 *
 * ไฟล์นี้อยู่ใน public/ เพราะ **ทั้งฝั่ง server และเบราว์เซอร์เรียกฟังก์ชันตัวเดียวกัน**
 *
 * ฝั่ง server เรียกตอนประกอบ payload ส่วนเบราว์เซอร์เรียกซ้ำทุกครั้งที่ผู้ใช้
 * เปลี่ยนแถบตัวกรองกลาง โดยส่ง record ที่กรองแล้วเข้าไป
 *
 * ถ้าแยกเป็นสองชุด ตัวเลขบนการ์ดเดียวกันจะเพี้ยนจากกันได้เงียบ ๆ เวลามีคนแก้สูตร
 * ที่เดียว — ซึ่งเป็นบั๊กที่หาเจอยากที่สุดประเภทหนึ่ง
 *
 * ข้อบังคับ: import ได้เฉพาะจาก agg-core.js เท่านั้น ห้ามแตะ DOM หรือโมดูลของ node
 */
import {
  sum,
  comparePeriod,
  sizeMix,
  nonFlowerMix,
  groupSum,
  premiumPct,
  monthlySeries,
  dailySeries,
  normalizeItemName,
} from './agg-core.js';

/**
 * สรุปข้อมูลวัสดุสิ้นเปลืองจากชีต Log Stock
 *
 * ต่างจากรายงานอื่นตรงที่ "ยอดปัจจุบัน" ไม่ได้มาจากการบวกแถว แต่มาจาก
 * แถวล่าสุดที่ยังไม่เลยวันนี้ของแต่ละรายการ ซึ่ง parser คำนวณมาให้แล้วใน tab.current
 * (ชีตมีแถวลงวันที่ล่วงหน้าที่ยอดถูก carry forward ไว้ — บวกทั้งคอลัมน์จะได้เลขมั่ว)
 */
function buildSupply(source) {
  const rows = source?.rows ?? [];
  const tabs = (source?.tabs ?? []).filter((t) => !t.skipped && t.role !== 'order');
  const logRows = rows.filter((r) => r.kind === 'log');
  const orderRows = rows.filter((r) => r.kind === 'order');

  // จับคู่ราคาในตารางจัดซื้อกับรายการในแท็บ log ด้วยชื่อที่ normalize แล้ว
  const priceByName = new Map();
  for (const o of orderRows) {
    const key = normalizeItemName(o.item);
    if (key) priceByName.set(key, o);
  }
  const lookupOrder = (itemName) => {
    const key = normalizeItemName(itemName);
    if (!key) return null;
    if (priceByName.has(key)) return priceByName.get(key);

    // ชื่อในสองที่เขียนไม่เท่ากันเสมอ เช่น "Scrog Net" กับ "Scrog Net ตาข่าย"
    // จึงยอมให้ฝั่งหนึ่งเป็นคำขึ้นต้นของอีกฝั่ง แต่ต้องยาวพอไม่ให้จับมั่ว
    //
    // ถ้าเข้าเค้ามากกว่าหนึ่งรายการ ถือว่าจับคู่ไม่ได้ — เดาผิดแล้วได้ราคาผิด
    // แย่กว่าไม่มีราคา เพราะใบขอซื้อจะมีตัวเลขที่ดูน่าเชื่อแต่ผิด
    // (เช่น "กระบอกตวง" เข้าได้ทั้งขนาด 1000 / 3000 / 5000 มล.)
    const candidates = [];
    for (const [k, v] of priceByName) {
      if (k.length >= 4 && (k.startsWith(key) || key.startsWith(k))) candidates.push(v);
    }
    return candidates.length === 1 ? candidates[0] : null;
  };

  /* log รายวันแบบย่อของแต่ละรายการ
   *
   * record มาตรฐานของระบบมีช่อง sizes/nonFlower/ผลรวม 16 ช่องที่เป็น null หมด
   * สำหรับข้อมูลวัสดุ — ส่งขึ้นเบราว์เซอร์ทั้ง 5,000 แถวคือ 2.8 MB ของค่าว่าง
   * จึงย่อเหลือเฉพาะช่องที่ใช้จริง แล้วตัด null ออกก่อนส่ง (เหลือ ~1 ใน 10) */
  const logByItem = new Map();
  for (const r of logRows) {
    if (!logByItem.has(r.item)) logByItem.set(r.item, []);
    const entry = { date: r.date };
    if (r.received !== null) entry.received = r.received;
    if (r.issued !== null) entry.issued = r.issued;
    if (r.balance !== null) entry.balance = r.balance;
    if (r.minimum !== null) entry.minimum = r.minimum;
    if (r.isFuture) entry.future = true;
    logByItem.get(r.item).push(entry);
  }

  const needsReorder = [];
  const items = [];
  for (const tab of tabs) {
    const cur = tab.current;
    const order = lookupOrder(tab.item);
    const entry = {
      item: tab.item,
      itemNo: tab.itemNo ?? null,
      group: tab.group ?? null,
      tab: tab.name,
      gid: tab.gid,
      unit: cur?.unit ?? tab.unit ?? null,
      balance: cur?.balance ?? null,
      minimum: cur?.minimum ?? null,
      index: cur?.index ?? null,
      date: cur?.date ?? null,
      note: tab.note ?? null,
      /* ระยะเวลารอของ — คนเขียนแทรกไว้ในหัวตารางของแท็บ ไม่ใช่คอลัมน์
       * มีแค่ราวครึ่งหนึ่งของรายการ ที่เหลือเป็น null และต้องคง null ไว้ ห้ามเดา */
      leadTimeDays: tab.leadTimeDays ?? null,
      unitPrice: order?.unitPrice ?? null,
      orderQty: order?.orderQty ?? null,
      lastOrderedText: order?.lastOrderedText ?? null,
      lifetimeText: order?.lifetimeText ?? null,
      matchedOrderRow: order ? order.item : null,
      log: logByItem.get(tab.item) ?? [],
    };
    items.push(entry);

    /* เกณฑ์ "ต้องสั่งซื้อ" = Index ≤ 0 (Index = คงเหลือ − ขั้นต่ำ)
     *
     * รวมของที่คงเหลือ "เท่าขั้นต่ำพอดี" เข้ามาด้วย ตามที่ผู้ใช้กำหนดไว้ล่าสุด
     * (เดิมใช้ < 0) เหตุผลคือระหว่างรอของ 5–7 วันตาม Lead Time ที่เขียนไว้ในชีต
     * ของจะถูกเบิกจนต่ำกว่าขั้นต่ำแน่นอน ถ้ารอให้ติดลบก่อนค่อยสั่งก็สายไปแล้ว
     *
     * คำนวณ Index ใหม่จาก คงเหลือ − ขั้นต่ำ เสมอ ไม่เชื่อช่อง Index ในชีต
     * เพราะเป็นสูตรที่คนพิมพ์ทับได้ (มีกฎ supply.indexMismatch คอยจับอยู่) */
    if (entry.index !== null && entry.index <= 0) {
      // จำนวนที่ควรสั่ง: ใช้ที่ฝ่ายจัดซื้อกำหนดไว้ก่อน ถ้าไม่มีค่อยคิดจากส่วนที่ขาด
      const shortfall = -entry.index;
      const qty = entry.orderQty ?? Math.max(shortfall, entry.minimum ?? 0, 1);
      // ไม่เอา log ติดไปด้วย ไม่งั้นข้อมูลชุดเดียวกันถูกส่งซ้ำสองรอบ
      const { log, ...withoutLog } = entry;
      needsReorder.push({
        ...withoutLog,
        shortfall,
        suggestedQty: qty,
        amount: entry.unitPrice !== null ? qty * entry.unitPrice : null,
      });
    }
  }

  // ขาดหนักสุดขึ้นก่อน — index ยิ่งติดลบยิ่งเร่งด่วน
  needsReorder.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

  const months = [...new Set(logRows.map((r) => r.month).filter(Boolean))].sort(comparePeriod);

  const matrix = (valueKey) => {
    const byItem = new Map();
    for (const r of logRows) {
      const v = r[valueKey];
      if (v === null || v === undefined) continue;
      if (!byItem.has(r.item)) {
        byItem.set(r.item, { item: r.item, unit: r.unit ?? null, byMonth: {}, total: 0 });
      }
      const e = byItem.get(r.item);
      e.byMonth[r.month] = (e.byMonth[r.month] ?? 0) + v;
      e.total += v;
    }
    return [...byItem.values()].filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
  };

  const asOf = items.reduce((max, i) => (i.date && i.date > max ? i.date : max), '');
  const usage = matrix('issued');

  return {
    itemCount: items.length,
    tabCount: (source?.tabs ?? []).length,
    asOf,
    items,
    needsReorder,
    months,
    usage,
    received: matrix('received'),
    usageAnomalies: findUsageAnomalies(usage, months, asOf),
    order: {
      items: orderRows.map((o) => ({
        item: o.item,
        unit: o.unit,
        balance: o.balance,
        qty: o.orderQty,
        unitPrice: o.unitPrice,
        amount: o.amount,
        orderDay: o.orderDay,
        lastOrderedText: o.lastOrderedText,
        lifetimeText: o.lifetimeText,
      })),
      totalAmount: sum(orderRows.map((o) => o.amount)),
    },
  };
}

/**
 * สรุปงบรายรับ-รายจ่ายจากชีต "แบบฟอร์มต้นทุน"
 *
 * **ยอดรวมทุกตัวมาจากแท็บ "สรุป" เท่านั้น ไม่ใช่จากการบวกแท็บรายละเอียด**
 *
 * เหตุผล: แท็บรายละเอียดมีแถวยอดรวมปนอยู่กับแถวรายการ และตอนนี้ผลรวมรายการจริง
 * ไม่เท่ากับที่งบสรุปบอกอยู่สามจุด (ตรวจแล้ว: ต้นทุนวัตถุดิบต่าง 906,854 บาท
 * เพราะสูตรผลรวมของแถวค่าไฟฟ้าไม่ครอบเดือนกรกฎาคม) ถ้าเอาผลรวมรายการมาโชว์
 * ตัวเลขบน Dashboard จะไม่ตรงกับงบที่ผู้บริหารถืออยู่ในมือ
 *
 * รายละเอียดใช้ทำ "อันดับรายการที่ใช้เงินมากสุด" อย่างเดียว ส่วนความไม่ตรงกัน
 * ถูกรายงานเป็น finding `finance.summaryMismatch` ให้ไปแก้ที่ต้นทาง
 */
/* ชื่อพารามิเตอร์ต้องไม่ใช่ `year` เพราะท้ายฟังก์ชันมี `const year` ของตัวเอง
 * (ปีที่อ่านได้จากข้อมูลจริง) ถ้าชนกันจะได้ ReferenceError จาก TDZ ตอน inYear ทำงาน */
function buildCost(source, yearFilter = null) {
  const rows = source?.rows ?? [];
  const allSummary = rows.filter((r) => r.kind === 'summary');

  /* ปีที่ชีตนี้มีข้อมูลจริง — ต้องรู้ก่อนกรอง เพื่อบอกผู้ใช้ได้ว่า "มีปีไหนให้ดูบ้าง"
   * ตอนที่เขาเลือกปีที่ชีตไม่มี */
  const years = [...new Set(allSummary.map((r) => String(r.month).slice(0, 4)))].sort();

  /* ตัวกรองปีของ Dashboard ส่งมาที่นี่ตรง ๆ ไม่ได้ผ่าน applyFilters()
   *
   * แถวงบมี `date` (parsers/cost.js ใส่ `${month}-01` ให้) จึงผ่านตัวกรองปีได้อยู่แล้ว
   * แต่ตัวกรองสายพันธุ์/ครอป/ขนาดดอกจะลบมันเกลี้ยงทั้งชีต (ไม่มีฟิลด์พวกนั้นเลย)
   * filterSources() จึงยกรายงานที่ kind !== 'flower' ออกทั้งก้อน แล้วส่ง
   * **ปีอย่างเดียว** มาที่นี่ — ซึ่งเป็นมิติเดียวที่มีความหมายกับงบรายเดือน */
  const inYear = (r) => !yearFilter || String(r.month).slice(0, 4) === yearFilter;
  const summary = allSummary.filter(inYear);
  const detail = rows.filter((r) => r.kind === 'expense' && inYear(r));

  if (!summary.length) {
    return {
      available: false,
      /* "ชีตอ่านได้ไหม" เป็นคนละคำถามกับ "ปีที่เลือกมีข้อมูลไหม"
       * ถ้าไม่แยกสองอย่างนี้ หน้าจะบอกว่าดึงชีตไม่สำเร็จทั้งที่ชีตปกติดี
       * แล้วคนจะไปไล่แก้ชีตที่ไม่ได้ผิด */
      sheetAvailable: allSummary.length > 0,
      requestedYear: yearFilter,
      years,
      year: null,
      months: [],
      byMonth: [],
      totals: {},
      totalsFullYear: {},
      lastActiveMonth: null,
      lastRevenueMonth: null,
      coverage: null,
      monthsWithValue: {},
      revenueByYear: null,
      revenueByMonth: null,
      costByYear: null,
      costByMonth: null,
      topItems: [],
      byGroup: [],
      detailTotals: {},
    };
  }

  const months = [...new Set(summary.map((r) => r.month))].sort(comparePeriod);
  const at = (line, month) =>
    summary.find((r) => r.line === line && r.month === month)?.amount ?? null;
  const lineTotal = (line) =>
    summary.filter((r) => r.line === line).reduce((a, r) => a + (r.amount ?? 0), 0);

  const LINES = [
    'revenue',
    'materialCost',
    'farmExpense',
    'officeExpense',
    // ยอดต้นทุนที่ชีตคำนวณเอง — เก็บไว้เทียบกับที่เราบวกจากสามบรรทัดข้างบน
    'growingCost',
    'ebitda',
    'depreciation',
    'ebit',
  ];

  /* เดือนสุดท้ายที่ธุรกิจ "เดินจริง"
   *
   * ดูเฉพาะรายได้กับต้นทุนวัตถุดิบ ไม่รวมค่าเสื่อมราคาและค่าใช้จ่าย Office
   * เพราะสองตัวนั้นถูกตั้งไว้ล่วงหน้าจนถึงสิ้นปี (ค่ารักษาความปลอดภัยเดือนละเท่ากันทุกเดือน)
   * ถ้านับรวมด้วย กราฟจะลากเส้นแบนที่ศูนย์ไปจนถึงธันวาคม ซึ่งอ่านผิดทันที
   * ว่าธุรกิจหยุดเดิน ทั้งที่ความจริงคือ "ยังไม่ถึงเดือนนั้น" */
  const OPERATING = ['revenue', 'materialCost'];
  const lastActive = months.reduce(
    (last, m) => (OPERATING.some((l) => at(l, m) !== null && at(l, m) !== 0) ? m : last),
    null
  );
  const lastRevenueMonth = months.reduce((last, m) => (at('revenue', m) ? m : last), null);

  const byMonth = months.map((month) => {
    const revenue = at('revenue', month);
    const cost = at('growingCost', month) ?? sumOrNullList([
      at('materialCost', month),
      at('farmExpense', month),
      at('officeExpense', month),
    ]);
    return {
      month,
      revenue,
      materialCost: at('materialCost', month),
      farmExpense: at('farmExpense', month),
      officeExpense: at('officeExpense', month),
      cost,
      ebitda: at('ebitda', month),
      depreciation: at('depreciation', month),
      ebit: at('ebit', month),
      // กำไรขั้นต้นคิดใหม่เองเสมอ ไม่เชื่อช่องในชีต (กฎข้อ 2 ของ CLAUDE.md)
      grossProfit: revenue !== null && cost !== null ? revenue - cost : null,
    };
  });

  /* ── ยอดรวมต้องคิดเฉพาะเดือนที่ "เกิดขึ้นจริง" ไม่ใช่ทั้ง 12 เดือน ──
   *
   * แต่ละบรรทัดในชีตกรอกมาไม่เท่ากัน (ตรวจกับข้อมูลจริงแล้ว):
   *   รายได้ 6 เดือน · ต้นทุนวัตถุดิบ/Farm 7 เดือน · Office 12 เดือน · ค่าเสื่อมราคา 12 เดือน
   *
   * Office กับค่าเสื่อมราคาถูกตั้งไว้ล่วงหน้าถึงสิ้นปี (ค่ารักษาความปลอดภัยเดือนละ 30,900
   * เท่ากันทุกเดือน และตารางค่าเสื่อมคำนวณไว้ล่วงหน้าทั้งปี)
   *
   * ถ้าบวกทั้ง 12 เดือนจะกลายเป็นเอา **รายได้ 6 เดือน ไปหักค่าเสื่อม 12 เดือน**
   * แล้วได้ EBIT −13.3 ล้าน ทั้งที่ยอดสะสมจริงถึงเดือนล่าสุดคือ −10.3 ล้าน
   * ส่วนต่าง 4.3 ล้านมาจากเดือนที่ยังไม่ถึง — เป็นตัวเลขที่ตั้งไว้ ไม่ใช่ผลประกอบการ
   *
   * `totals` จึงตัดที่เดือนล่าสุดที่มีความเคลื่อนไหวจริง ส่วนยอด 12 เดือนตามที่ชีตบอก
   * เก็บไว้ที่ `totalsFullYear` ไม่ได้ซ่อน — ตารางรายเดือนก็ยังโชว์ครบทุกเดือนเหมือนเดิม */
  const within = (m) => !lastActive || m <= lastActive;
  const activeTotal = (line) =>
    summary.filter((r) => r.line === line && within(r.month)).reduce((a, r) => a + (r.amount ?? 0), 0);

  const totals = Object.fromEntries(LINES.map((l) => [l, activeTotal(l)]));
  totals.cost = totals.materialCost + totals.farmExpense + totals.officeExpense;
  totals.grossProfit = totals.revenue - totals.cost;

  const totalsFullYear = Object.fromEntries(LINES.map((l) => [l, lineTotal(l)]));
  totalsFullYear.cost =
    totalsFullYear.materialCost + totalsFullYear.farmExpense + totalsFullYear.officeExpense;
  totalsFullYear.grossProfit = totalsFullYear.revenue - totalsFullYear.cost;

  /* จำนวนเดือนที่แต่ละบรรทัดมีตัวเลขจริง — เอาไปบอกผู้ใช้และให้ analysis ตรวจ
   * ว่าบรรทัดไหนครอบคลุมไม่เท่ากันจนเอามาเทียบกันตรง ๆ ไม่ได้ */
  const monthsWithValue = Object.fromEntries(
    LINES.map((l) => [l, summary.filter((r) => r.line === l && (r.amount ?? 0) !== 0).length])
  );

  // ── อันดับรายการที่ใช้เงินมากสุด (จากแท็บรายละเอียด) ──
  const byItem = new Map();
  for (const r of detail) {
    const key = `${r.group}|${r.item}`;
    const e = byItem.get(key) ?? {
      item: r.item,
      group: r.group,
      category: r.category ?? null,
      amount: 0,
    };
    e.amount += r.amount ?? 0;
    byItem.set(key, e);
  }
  const topItems = [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);

  const detailTotals = {};
  for (const r of detail) detailTotals[r.group] = (detailTotals[r.group] ?? 0) + (r.amount ?? 0);

  const byGroup = [
    { key: 'materialCost', amount: totals.materialCost },
    { key: 'farmExpense', amount: totals.farmExpense },
    { key: 'officeExpense', amount: totals.officeExpense },
  ].filter((g) => g.amount > 0);

  const year = months[0]?.slice(0, 4) ?? null;

  return {
    available: true,
    sheetAvailable: true,
    // ปีที่ถูกขอ (null = ไม่ได้กรอง) และปีที่ชีตมีทั้งหมด — UI ใช้ทั้งคู่ตอนเลือกปีที่ไม่มีข้อมูล
    requestedYear: yearFilter,
    years,
    year,
    months,
    lastActiveMonth: lastActive,
    // ช่วงที่ยอดใน `totals` ครอบคลุมจริง — UI ต้องเอาไปติดป้ายเสมอ ไม่ใช่เขียนว่า "ทั้งปี"
    coverage: months.length ? { from: months[0], to: lastActive ?? months[0] } : null,
    monthsWithValue,
    byMonth,
    totals,
    totalsFullYear,
    byGroup,
    topItems,
    detailTotals,
    // ช่องที่หน้าภาพรวมใช้ตรง ๆ — เดิมเป็น null เพราะยังไม่มีชีตไหนมีตัวเลขเงิน
    revenueByYear: totals.revenue,
    /* เดือนล่าสุดที่ **มีรายได้จริง** ไม่ใช่เดือนล่าสุดที่มีความเคลื่อนไหว
     * เดือนกรกฎาคมมีต้นทุนแต่ยังไม่มีรายได้ ถ้าใช้เดือนนั้นช่องรายได้จะขึ้น "—"
     * ทั้งที่เดือนก่อนหน้ามีตัวเลขอยู่ ซึ่งอ่านเหมือนระบบพัง */
    lastRevenueMonth,
    revenueByMonth: lastRevenueMonth ? at('revenue', lastRevenueMonth) : null,
    costByYear: totals.cost,
    costByMonth: lastActive
      ? sumOrNullList([
          at('materialCost', lastActive),
          at('farmExpense', lastActive),
          at('officeExpense', lastActive),
        ])
      : null,
  };
}

/** บวกโดยคืน null ถ้าไม่มีค่าที่ใช้ได้เลย — `0` กับ "ไม่มีข้อมูล" ต้องไม่ปนกัน */
function sumOrNullList(values) {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? usable.reduce((a, b) => a + b, 0) : null;
}

/** ต้องมีเดือนที่เบิกจบแล้วอย่างน้อยเท่านี้ ถึงจะพูดได้ว่าอะไรคือ "ปกติ" */
const MIN_BASELINE_MONTHS = 2;

/** เบิกมากกว่าปกติกี่เท่าถึงเรียกว่าผิดปกติ */
const HIGH_RATIO = 1.5;
const LOW_RATIO = 0.5;

/** ต่างจากที่คาดน้อยกว่านี้ถือว่าเป็นความผันผวนปกติ ไม่ต้องเตือน */
const MIN_ABS_DIFF = 2;

/**
 * หารายการที่เบิกผิดปกติในเดือนล่าสุด
 *
 * กับดักที่ต้องระวัง: **เดือนปัจจุบันยังไม่จบ** ถ้าเอายอดรวมของ 3 วันแรกของเดือน
 * ไปเทียบกับเดือนเต็ม ๆ ที่ผ่านมา ทุกอย่างจะดู "ต่ำผิดปกติ" หมดทั้งที่ยังไม่มีอะไรผิด
 * จึงเทียบเป็น **อัตราต่อวัน** แล้วบอกไปด้วยว่าเดือนนี้ผ่านมากี่วันแล้ว
 *
 * @param {{item:string, unit:string|null, byMonth:Record<string,number>}[]} usage
 * @param {string[]} months เดือนทั้งหมดที่ปรากฏในข้อมูล (รวมเดือนอนาคตที่ยังไม่มีการเบิก)
 * @param {string} asOf วันที่ล่าสุดที่มีข้อมูลจริง (YYYY-MM-DD)
 */
export function findUsageAnomalies(usage, months, asOf) {
  const currentMonth = (asOf || '').slice(0, 7);
  if (!currentMonth) {
    return { ready: false, monthsAvailable: 0, monthsNeeded: MIN_BASELINE_MONTHS + 1, items: [] };
  }

  // นับเฉพาะเดือนที่มีการเบิกจริง และไม่เลยวันที่ล่าสุดที่มีข้อมูล
  const withUsage = months
    .filter((m) => m <= currentMonth && usage.some((u) => (u.byMonth[m] ?? 0) > 0))
    .sort(comparePeriod);

  const baselineMonths = withUsage.filter((m) => m < currentMonth);
  const daysElapsed = Math.max(1, Number((asOf || '').slice(8, 10)) || 1);
  const isPartial = true; // เดือนล่าสุดคือเดือนที่ข้อมูลเดินมาถึง จึงยังไม่จบเสมอ

  if (baselineMonths.length < MIN_BASELINE_MONTHS) {
    return {
      ready: false,
      monthsAvailable: withUsage.length,
      monthsNeeded: MIN_BASELINE_MONTHS + 1,
      currentMonth,
      baselineMonths,
      items: [],
    };
  }

  const items = [];
  for (const row of usage) {
    const current = row.byMonth[currentMonth] ?? 0;
    const history = baselineMonths.map((m) => row.byMonth[m] ?? 0);
    const baseline = history.reduce((a, b) => a + b, 0) / history.length;
    if (baseline <= 0 && current <= 0) continue;

    /* เทียบเป็นอัตราต่อวัน เดือนก่อน ๆ คิดที่ 30 วัน ส่วนเดือนนี้คิดตามวันที่ผ่านมาจริง */
    const baselineRate = baseline / 30;
    const currentRate = current / daysElapsed;

    // คาดว่าถึงวันนี้ควรเบิกไปเท่าไร ถ้าใช้ในอัตราปกติ
    const expected = baselineRate * daysElapsed;
    const diff = current - expected;
    if (Math.abs(diff) < MIN_ABS_DIFF) continue;

    const ratio = baselineRate > 0 ? currentRate / baselineRate : null;
    let direction = null;
    if (ratio === null && current > 0) direction = 'new'; // ไม่เคยเบิกมาก่อน เพิ่งเริ่มเบิก
    else if (ratio !== null && ratio >= HIGH_RATIO) direction = 'high';
    else if (ratio !== null && ratio <= LOW_RATIO) direction = 'low';
    if (!direction) continue;

    items.push({
      item: row.item,
      unit: row.unit ?? null,
      current,
      expected: Math.round(expected * 10) / 10,
      baseline: Math.round(baseline * 10) / 10,
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      direction,
      byMonth: row.byMonth,
    });
  }

  // เรื่องที่ต้องรีบดูก่อนคือของที่เบิกพุ่งขึ้น เพราะแปลว่าของจะหมดเร็วกว่าที่วางแผนไว้
  const weight = { high: 0, new: 1, low: 2 };
  items.sort(
    (a, b) => weight[a.direction] - weight[b.direction] || (b.ratio ?? 99) - (a.ratio ?? 99)
  );

  return {
    ready: true,
    monthsAvailable: withUsage.length,
    monthsNeeded: MIN_BASELINE_MONTHS + 1,
    currentMonth,
    baselineMonths,
    daysElapsed,
    isPartial,
    items,
  };
}

/**
 * สร้าง KPI และชุดข้อมูลกราฟทั้งหมดที่ front-end ต้องใช้
 *
 * เบราว์เซอร์เรียกฟังก์ชันนี้ซ้ำทุกครั้งที่ตัวกรองเปลี่ยน โดยส่ง `sources` ที่กรองแล้วเข้ามา
 * (ดู viewKpi() ใน main.js) ตัวเลขบนการ์ดจึงตรงกับกราฟข้าง ๆ เสมอ
 *
 * @param {Record<string, object>} sources
 * @param {object} analysis
 * @param {{year?: string|null}} [options] ปีที่เลือกจากแถบตัวกรองกลาง — ส่งต่อให้ buildCost()
 *   เพราะรายงานการเงินไม่ผ่าน applyFilters() (ดูเหตุผลใน buildCost)
 *   **ฝั่ง server ไม่ส่ง options → ผลลัพธ์เหมือนเดิมทุกตัวอักษร**
 */
export function buildKpi(sources, analysis, options = {}) {
  const rowsOf = (key) => sources[key]?.rows ?? [];

  const daily = rowsOf('dailyTrim');
  const perCrop = rowsOf('perCrop');
  const outbound = rowsOf('outbound');
  const inbound = rowsOf('inbound');
  const sales = rowsOf('sales');
  const inventory = rowsOf('inventory');

  const harvested = perCrop.filter((r) => r.hasYield);
  const planned = perCrop.filter((r) => !r.hasYield);

  const cost = buildCost(sources.cost, options.year ?? null);

  const totalYield = sum(harvested.map((r) => r.flowerTotal));
  const totalPlants = sum(harvested.map((r) => r.plants));
  const gPerPlant = totalPlants > 0 ? totalYield / totalPlants : null;

  const stockByLocation = groupSum(inventory, (r) => r.location);
  const totalStock = sum(inventory.map((r) => r.flowerTotal));
  const totalStockNonFlower = sum(inventory.map((r) => r.nonFlowerTotal));

  const totalSold = sum(sales.map((r) => r.flowerTotal));
  const soldNonFlower = sum(sales.map((r) => r.nonFlowerTotal));
  const customers = new Set(sales.map((r) => r.customer).filter(Boolean));

  const headline = [
    {
      key: 'totalYield',
      labelTh: 'ผลผลิตดอกสะสม',
      labelEn: 'Total Flower Yield',
      value: totalYield,
      unit: 'g',
      hint: `${harvested.length} ครอปที่เก็บเกี่ยวแล้ว`,
      hintEn: `${harvested.length} harvested crops`,
    },
    {
      key: 'premiumPct',
      labelTh: 'สัดส่วนเกรด >M',
      labelEn: 'Premium Grade (>M)',
      value: premiumPct(harvested),
      unit: '%',
      hint: 'XXL + XL + L + M',
      hintEn: 'XXL + XL + L + M',
    },
    {
      key: 'gPerPlant',
      labelTh: 'ผลผลิตต่อต้น',
      labelEn: 'Yield per Plant',
      value: gPerPlant,
      unit: 'g',
      hint: `จาก ${totalPlants.toLocaleString('en-US')} ต้น`,
      hintEn: `across ${totalPlants.toLocaleString('en-US')} plants`,
    },
    {
      key: 'totalSold',
      labelTh: 'ยอดขายดอกสะสม',
      labelEn: 'Total Flower Sold',
      value: totalSold,
      unit: 'g',
      hint: `${customers.size} ลูกค้า`,
      hintEn: `${customers.size} customers`,
    },
    {
      key: 'totalStock',
      labelTh: 'สต็อกดอกคงเหลือ',
      labelEn: 'Flower in Stock',
      value: totalStock,
      unit: 'g',
      hint: stockByLocation.map((s) => s.key).join(' + ') || '—',
      hintEn: stockByLocation.map((s) => s.key).join(' + ') || '—',
    },
    {
      key: 'activeCrops',
      labelTh: 'ครอปที่กำลังปลูก',
      labelEn: 'Crops in Progress',
      value: planned.length,
      unit: '',
      hint: `รวมทั้งหมด ${perCrop.length} ครอป`,
      hintEn: `${perCrop.length} crops on record`,
    },
  ];

  // ครอปที่กำลังปลูก เรียงตามวันเก็บเกี่ยวที่ใกล้ที่สุด
  const upcoming = planned
    .filter((r) => r.cycle?.harvest)
    .sort((a, b) => a.cycle.harvest.localeCompare(b.cycle.harvest))
    .slice(0, 8)
    .map((r) => ({ crop: r.crop, quarter: r.quarter, cycle: r.cycle, plants: r.plants }));

  /* บล็อก exec = KPI 8 ตัวบนหน้า "ภาพรวมผู้บริหาร" ตามเอกสาร
   *
   * แยกจาก headline (ซึ่งคง 6 ตัวไว้เท่าเดิม) เพราะ headline เป็นแถบสรุปเดิม
   * ที่การ์ดและ test อ้างอิงอยู่ ส่วน exec เป็นชุดใหม่ที่ผูกกับเอกสารโดยตรง
   *
   * ผลผลิตรายปี/รายเดือนใช้ dailyTrim เพราะเป็นรายงานเดียวที่มีวันที่รายวันจริง
   * (perCrop เก็บเป็นไตรมาส/ครอป ไม่มีวันที่ของการทริมแต่ละครั้ง)
   */
  /* ปีของครอป: ใช้วันเก็บเกี่ยวก่อน ถ้าไม่มีค่อยถอยไปอ่านปีจากชื่อไตรมาส */
  const cropYear = (r) => r.cycle?.harvest?.slice(0, 4) ?? r.quarter?.match(/(\d{4})/)?.[1] ?? null;

  /* รายปีมาจาก perCrop เพราะเป็นบันทึกผลผลิตที่ครบที่สุด (ย้อนถึง Q2'2025)
   * ส่วนรายเดือนมาจาก dailyTrim เพราะเป็นรายงานเดียวที่มีวันที่รายวันจริง
   * — แต่เริ่มบันทึกแค่ มี.ค. 2026 เท่านั้น
   *
   * สองชุดนี้จึงมาจากคนละแหล่งและ **ยอดรวมไม่เท่ากัน** โดยธรรมชาติ
   * ต้องติด source/coverage ไปด้วยเสมอ เพื่อให้ UI บอกที่มาได้ ไม่ใช่ปล่อยให้
   * ผู้บริหารเข้าใจว่าเป็นตัวเลขชุดเดียวกันแล้วสงสัยว่าทำไมบวกไม่ลงตัว */
  const producedByYear = (() => {
    const map = new Map();
    for (const r of harvested) {
      const year = cropYear(r);
      if (!year) continue;
      const e = map.get(year) || { year, flower: 0, crops: 0 };
      e.flower += r.flowerTotal || 0;
      e.crops++;
      map.set(year, e);
    }
    return [...map.values()].sort((a, b) => comparePeriod(a.year, b.year));
  })();

  const monthly = monthlySeries(daily);
  const dailyDates = daily.map((r) => r.date).filter(Boolean).sort();

  const yieldPerPlantByYear = (() => {
    const map = new Map();
    for (const r of harvested) {
      const year = cropYear(r);
      if (!year) continue;
      const e = map.get(year) || { year, flower: 0, plants: 0 };
      e.flower += r.flowerTotal || 0;
      e.plants += r.plants || 0;
      map.set(year, e);
    }
    return [...map.values()]
      .map((e) => ({ ...e, gPerPlant: e.plants > 0 ? e.flower / e.plants : null }))
      .sort((a, b) => comparePeriod(a.year, b.year));
  })();

  return {
    headline,
    exec: {
      producedByYear,
      producedByYearSource: 'perCrop',
      producedByMonth: monthly,
      producedByMonthSource: 'dailyTrim',
      // ช่วงที่บันทึกรายวันครอบคลุมจริง — UI ต้องบอกผู้ใช้ ไม่ใช่ให้เดาเองว่าทำไมกราฟสั้น
      producedByMonthCoverage: dailyDates.length
        ? { from: dailyDates[0], to: dailyDates[dailyDates.length - 1] }
        : null,
      yieldPerPlantByYear,
      stockByLocation: stockByLocation.map((s) => ({
        location: s.key,
        flower: s.flower,
        nonFlower: s.nonFlower,
      })),
      totalStock,
      /* รายได้และต้นทุนมาจากชีต "แบบฟอร์มต้นทุน" (เพิ่มเข้ามาเป็นลิงก์ที่ 8)
       * ก่อนหน้านี้เป็น null เสมอเพราะไม่มีชีตไหนมีตัวเลขเงินเลย
       * ยังต้องเป็น null ได้อยู่ถ้าชีตโหลดไม่สำเร็จ — ห้ามใส่ 0 แทน
       * เพราะ 0 แปลว่า "ขายไม่ได้เลย" ซึ่งคนละความหมายกับ "ไม่มีข้อมูล" */
      revenueByYear: cost.revenueByYear,
      revenueByMonth: cost.revenueByMonth,
      costByYear: cost.costByYear,
      costByMonth: cost.costByMonth,
    },
    cost,
    supply: buildSupply(sources.supplyLog),
    dailyTrim: {
      totalFlower: sum(daily.map((r) => r.flowerTotal)),
      totalNonFlower: sum(daily.map((r) => r.nonFlowerTotal)),
      sizeMix: sizeMix(daily),
      nonFlowerMix: nonFlowerMix(daily),
      byCrop: groupSum(daily, (r) => r.crop).sort((a, b) => b.flower - a.flower),
      byStrain: groupSum(daily, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      series: dailySeries(daily),
      dayCount: new Set(daily.map((r) => r.date).filter(Boolean)).size,
    },
    perCrop: {
      totalFlower: totalYield,
      totalPlants,
      gPerPlant,
      harvestedCount: harvested.length,
      plannedCount: planned.length,
      sizeMix: sizeMix(harvested),
      byQuarter: groupSum(harvested, (r) => r.quarter)
        .map((q) => {
          const rows = harvested.filter((r) => r.quarter === q.key);
          const plants = sum(rows.map((r) => r.plants));
          return { ...q, plants, gPerPlant: plants > 0 ? q.flower / plants : null };
        })
        /* เรียงตามเวลาจริง ไม่ใช่ตามตัวอักษร
         * localeCompare จะได้ Q1'2026 มาก่อน Q2'2025 เพราะเทียบ "Q1" กับ "Q2" ก่อนถึงปี */
        .sort((a, b) => comparePeriod(a.key, b.key)),
      topCrops: harvested
        .filter((r) => r.gramsPerPlant !== null)
        .sort((a, b) => b.gramsPerPlant - a.gramsPerPlant)
        .slice(0, 10)
        .map((r) => ({
          crop: r.crop,
          quarter: r.quarter,
          flower: r.flowerTotal,
          plants: r.plants,
          gPerPlant: r.gramsPerPlant,
        })),
      upcoming,
    },
    outbound: {
      totalFlower: sum(outbound.map((r) => r.flowerTotal)),
      totalNonFlower: sum(outbound.map((r) => r.nonFlowerTotal)),
      sizeMix: sizeMix(outbound),
      byStrain: groupSum(outbound, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      byCrop: groupSum(outbound, (r) => r.crop).sort((a, b) => b.flower - a.flower),
      series: dailySeries(outbound),
      shipmentCount: new Set(outbound.map((r) => r.date).filter(Boolean)).size,
    },
    inbound: {
      totalFlower: sum(inbound.map((r) => r.flowerTotal)),
      totalNonFlower: sum(inbound.map((r) => r.nonFlowerTotal)),
      sizeMix: sizeMix(inbound),
      byStrain: groupSum(inbound, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      series: dailySeries(inbound),
      receiptCount: new Set(inbound.map((r) => r.date).filter(Boolean)).size,
      reconciliation: buildReconciliation(outbound, inbound),
    },
    sales: {
      totalFlower: totalSold,
      totalNonFlower: soldNonFlower,
      customerCount: customers.size,
      orderCount: new Set(sales.map((r) => `${r.date}|${r.customer}`).filter(Boolean)).size,
      sizeMix: sizeMix(sales),
      byCustomer: groupSum(sales, (r) => r.customer).sort((a, b) => b.flower - a.flower),
      byStrain: groupSum(sales, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      byMonth: monthlySeries(sales),
      series: dailySeries(sales),
    },
    inventory: {
      totalFlower: totalStock,
      totalNonFlower: totalStockNonFlower,
      byLocation: stockByLocation.sort((a, b) => b.flower - a.flower),
      byStrain: groupSum(inventory, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      sizeMix: sizeMix(inventory),
      nonFlowerMix: nonFlowerMix(inventory),
      updatedAt: [
        ...new Set(inventory.map((r) => r.updatedText).filter(Boolean)),
      ],
      locations: [...new Set(inventory.map((r) => r.location).filter(Boolean))],
    },
    quality: {
      score: analysis.score,
      counts: analysis.counts,
      total: analysis.total,
      bySource: analysis.bySource,
    },
  };
}

/** เทียบยอดขนออกกับยอดรับเข้ารายวัน สำหรับการ์ด "รับดอกเข้ากรุงเทพ" */
function buildReconciliation(outbound, inbound) {
  const collect = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.date) continue;
      m.set(r.date, (m.get(r.date) || 0) + (r.flowerTotal || 0));
    }
    return m;
  };
  const outMap = collect(outbound);
  const inMap = collect(inbound);
  const dates = [...new Set([...outMap.keys(), ...inMap.keys()])].sort();

  return dates.map((date) => {
    const shipped = outMap.get(date) ?? null;
    const received = inMap.get(date) ?? null;
    const diff = shipped !== null && received !== null ? received - shipped : null;
    return {
      date,
      shipped,
      received,
      diff,
      diffPct: shipped ? (diff / shipped) * 100 : null,
      matched: diff !== null && Math.abs(diff) < 0.5,
    };
  });
}
