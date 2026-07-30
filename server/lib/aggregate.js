/**
 * aggregate.js — รวมยอดเป็น KPI ระดับผู้บริหาร และชุดข้อมูลสำหรับกราฟ
 *
 * ทุกตัวเลขในนี้คำนวณจาก record ที่ parser ทำความสะอาดแล้ว
 * ไม่ได้หยิบมาจากคอลัมน์ Total ในชีตโดยตรง
 */
import { SIZE_KEYS, PREMIUM_SIZES, NON_FLOWER_KEYS, NON_FLOWER_LABELS, sum } from './normalize.js';

/** รวมน้ำหนักแยกตามขนาดจากชุด record */
export function sizeMix(rows) {
  const mix = {};
  for (const key of SIZE_KEYS) mix[key] = sum(rows.map((r) => r.sizes[key]));
  return mix;
}

/** รวมน้ำหนักของที่ไม่ใช่ดอกแยกตามประเภท */
export function nonFlowerMix(rows) {
  const mix = {};
  for (const key of NON_FLOWER_KEYS) {
    const total = sum(rows.map((r) => r.nonFlower[key]));
    if (total > 0) mix[NON_FLOWER_LABELS[key]] = total;
  }
  return mix;
}

/** จัดกลุ่มและรวมน้ำหนักดอกตาม key ที่กำหนด */
export function groupSum(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const key = keyFn(r);
    if (key === null || key === undefined || key === '') continue;
    const entry = map.get(key) || { key, flower: 0, nonFlower: 0, rows: 0, premium: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.premium += r.premiumTotal || 0;
    entry.rows++;
    map.set(key, entry);
  }
  return [...map.values()];
}

/** สัดส่วนเกรดพรีเมียม (>M) เทียบกับน้ำหนักดอกทั้งหมด */
function premiumPct(rows) {
  const total = sum(rows.map((r) => r.flowerTotal));
  if (!total) return null;
  const premium = sum(rows.map((r) => sum(PREMIUM_SIZES.map((k) => r.sizes[k]))));
  return (premium / total) * 100;
}

/** ชุดข้อมูลรายเดือน (YYYY-MM) เรียงตามเวลา */
export function monthlySeries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    const month = r.date.slice(0, 7);
    const entry = map.get(month) || { month, flower: 0, nonFlower: 0, rows: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.rows++;
    map.set(month, entry);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** ชุดข้อมูลรายวัน เรียงตามเวลา */
export function dailySeries(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.date) continue;
    const entry = map.get(r.date) || { date: r.date, flower: 0, nonFlower: 0, premium: 0, rows: 0 };
    entry.flower += r.flowerTotal || 0;
    entry.nonFlower += r.nonFlowerTotal || 0;
    entry.premium += r.premiumTotal || 0;
    entry.rows++;
    map.set(r.date, entry);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * สร้าง KPI และชุดข้อมูลกราฟทั้งหมดที่ front-end ต้องใช้
 * @param {Record<string, object>} sources
 * @param {object} analysis
 */
export function buildKpi(sources, analysis) {
  const rowsOf = (key) => sources[key]?.rows ?? [];

  const daily = rowsOf('dailyTrim');
  const perCrop = rowsOf('perCrop');
  const outbound = rowsOf('outbound');
  const inbound = rowsOf('inbound');
  const sales = rowsOf('sales');
  const inventory = rowsOf('inventory');

  const harvested = perCrop.filter((r) => r.hasYield);
  const planned = perCrop.filter((r) => !r.hasYield);

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

  return {
    headline,
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
        .sort((a, b) => String(a.key).localeCompare(String(b.key))),
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
