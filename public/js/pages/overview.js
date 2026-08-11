/**
 * pages/overview.js — 1. ภาพรวมผู้บริหาร (หน้าแรกของรายงาน Dryflower)
 *
 * เดิมช่องรายได้และต้นทุนเป็น "รอข้อมูล" ถาวร เพราะไม่มีชีตไหนมีตัวเลขเงินเลย
 * ตอนนี้ชีต "แบบฟอร์มต้นทุน" (ลิงก์ที่ 8) เข้ามาแล้ว ช่องเหล่านั้นจึงมีตัวเลขจริง
 *
 * ที่ยังเหลือเป็นช่องว่างคือ **ราคาขายต่อกรัม** ซึ่งชีตขายดอกยังไม่มีคอลัมน์ราคา
 * (รายได้รวมมีแล้วจากชีตต้นทุน แต่แยกรายลูกค้า/สายพันธุ์ยังทำไม่ได้)
 */
import { t, pick } from '../i18n.js';
import { n } from '../format.js';
import { renderCards } from '../ui/cards.js';
import { awaitingCard } from '../ui/placeholder.js';
import { pageHeader, tiles, lossHint, grid, appendQualityCard, costSpan, monthYear } from './shared.js';
import { monthlySeries, sum, comparePeriod } from '../shared/agg-core.js';

export const meta = { report: 'dryflower', page: 'overview' };

export function render(ctx) {
  const { host, payload, sources, filters, onOpen, drawLater } = ctx;

  pageHeader(host, { title: t('page.overview.title'), sub: t('page.overview.sub') });

  const daily = sources.dailyTrim?.rows ?? [];
  const perCrop = sources.perCrop?.rows ?? [];
  const inventory = sources.inventory?.rows ?? [];
  const harvested = perCrop.filter((r) => r.hasYield);

  /* ผลผลิตรายปีมาจาก perCrop เพราะเป็นบันทึกที่ครบที่สุด (ย้อนถึง Q2'2025)
   * ส่วนรายเดือนมาจาก dailyTrim เพราะเป็นรายงานเดียวที่มีวันที่รายวันจริง
   * สองชุดนี้คนละแหล่งกัน ยอดจึงไม่เท่ากันโดยธรรมชาติ — ระบุที่มาไว้ในคำอธิบายเสมอ */
  const byYear = new Map();
  for (const r of harvested) {
    const year = r.cycle?.harvest?.slice(0, 4) ?? r.quarter?.match(/(\d{4})/)?.[1] ?? null;
    if (!year) continue;
    const e = byYear.get(year) ?? { year, flower: 0, plants: 0 };
    e.flower += r.flowerTotal || 0;
    e.plants += r.plants || 0;
    byYear.set(year, e);
  }
  const years = [...byYear.values()].sort((a, b) => comparePeriod(a.year, b.year));
  const lastYear = years[years.length - 1] ?? null;

  const months = monthlySeries(daily);
  const lastMonth = months[months.length - 1] ?? null;

  const huaHin = inventory.filter((r) => /หัวหิน|hua\s*hin/i.test(r.location ?? ''));
  const bangkok = inventory.filter((r) => !/หัวหิน|hua\s*hin/i.test(r.location ?? ''));

  /* งบรายรับ-รายจ่ายจากชีต "แบบฟอร์มต้นทุน" (ลิงก์ที่ 8)
   *
   * ยอดถูกตัดที่เดือนล่าสุดที่มีความเคลื่อนไหวจริง (ค่าเสื่อมกับ Office ถูกกรอกล่วงหน้า
   * ครบ 12 เดือน) ป้ายจึงต้องบอกช่วงเวลาจริง ห้ามเขียนแค่ปี — ใช้ตัวสร้างข้อความ
   * ตัวเดียวกับหน้าต้นทุน ไม่งั้นสองหน้าจะบอกช่วงไม่ตรงกัน */
  const fin = payload.kpi?.cost;
  const finSpan = costSpan(fin, filters?.resolvedYear ?? t('label.byYear'));

  /* ชีตปกติดี แต่ปีที่เลือกไม่มีข้อมูล — คนละเรื่องกับชีตล่ม ต้องบอกให้ตรง
   * ไม่งั้นผู้ใช้จะเห็น "—" แล้วเข้าใจว่าระบบพัง หรือแย่กว่านั้นคือไปแก้ชีตที่ไม่ได้ผิด */
  const noCostYear = Boolean(fin?.sheetAvailable && !fin.available);
  const finHint = noCostYear
    ? t('exec.noCostYear', { year: fin.requestedYear ?? '' })
    : t('exec.fromCostSheet');

  /* ลำดับตามที่ผู้ใช้กำหนด: ผลผลิต → สต็อก → ประสิทธิภาพ → เงิน
   * (ตรงกับลำดับหน้าย่อยในเมนู) */
  tiles(host, [
    {
      label: `${t('exec.produced')} (${lastYear ? lastYear.year : t('label.byYear')})`,
      value: lastYear?.flower ?? null,
      unit: 'g',
      hint: t('exec.fromPerCrop'),
    },
    {
      /* ป้ายรายปีคงเป็น "(2026)" เฉย ๆ ตามที่ผู้ใช้เลือกไว้ — ไม่เขียนเป็นช่วงเดือน
       * เพราะ perCrop บางปีมีวันเก็บเกี่ยวไม่ครบ (2025 มีแค่ 28% ของน้ำหนัก ที่เหลือมีแต่ไตรมาส)
       * ช่วงเดือนที่คำนวณได้จึงจะบังผลผลิตที่ไม่มีวันที่หายไปโดยไม่มีอะไรบอก
       * ส่วนช่องรายเดือนมาจาก dailyTrim ซึ่งมีวันที่จริงทุกแถว เขียนเป็นชื่อเดือนได้ */
      label: `${t('exec.produced')} (${lastMonth ? monthYear(lastMonth.month) : t('label.byMonth')})`,
      value: lastMonth?.flower ?? null,
      unit: 'g',
      hint: t('exec.fromDailyTrim'),
    },
    {
      label: t('exec.stockHuaHin'),
      value: sum(huaHin.map((r) => r.flowerTotal)),
      unit: 'g',
      hint: t('filter.huahin'),
    },
    {
      label: t('exec.stockBangkok'),
      value: sum(bangkok.map((r) => r.flowerTotal)),
      unit: 'g',
      hint: t('filter.bangkok'),
    },
    {
      label: t('exec.yieldPerPlant'),
      value: lastYear && lastYear.plants > 0 ? lastYear.flower / lastYear.plants : null,
      unit: ' g/' + t('label.plantUnit'),
      decimals: 1,
      hint: lastYear ? `${n(lastYear.plants)} ${t('label.plants')}` : '',
    },
    /* รายได้กับต้นทุนมาจากชีต "แบบฟอร์มต้นทุน" ที่เพิ่งเพิ่มเข้ามาเป็นลิงก์ที่ 8
     * ก่อนหน้านี้เป็นช่อง "รอข้อมูล" ถาวรเพราะไม่มีชีตไหนมีตัวเลขเงินเลย
     * ยังต้องรองรับทั้งกรณีชีตโหลดไม่ได้และกรณีปีที่เลือกไม่มีข้อมูล — null ทั้งคู่
     * แต่ข้อความกำกับต่างกัน (ดู finHint) */
    {
      label: `${t('exec.revenue')} (${finSpan})`,
      value: fin?.revenueByYear ?? null,
      unit: '฿',
      hint: finHint,
      awaiting: !fin?.available,
    },
    {
      label: `${t('exec.cost')} (${finSpan})`,
      value: fin?.costByYear ?? null,
      unit: '฿',
      hint: noCostYear ? finHint : t('cost.growingOnly'),
      awaiting: !fin?.available,
    },
    {
      label: `${t('exec.grossProfit')} (${finSpan})`,
      value: fin?.totals?.grossProfit ?? null,
      unit: '฿',
      // ติดลบ = ขาดทุนจริง ย้อมสีตามเครื่องหมายพร้อมคำกำกับ (ดู tiles() ใน pages/shared.js)
      tone: 'signed',
      /* ตอนขาดทุนเขียนแค่ "ขาดทุน" ไม่ต่อท้ายสูตร — ช่อง hint เป็นบรรทัดเดียวตัดท้ายด้วย …
       * บนจอ 375px ข้อความรวมยาวเกินช่อง 15px แล้วสูตรจะโดนตัดกลางคำอยู่ดี
       * คำว่าขาดทุนสำคัญกว่าสูตร ส่วนสูตรยังอยู่ครบบนหน้าต้นทุน */
      hint:
        lossHint(fin?.totals?.grossProfit) ||
        (noCostYear ? finHint : t('exec.grossProfitHint')),
      awaiting: !fin?.available,
    },
  ]);

  // การ์ดภาพรวมของทั้งระบบ (การ์ดคุณภาพข้อมูลอยู่ท้ายหน้า ไม่ใช่ตรงนี้)
  const cardHost = document.createElement('div');
  cardHost.className = 'card-grid';
  host.appendChild(cardHost);
  renderCards(cardHost, { ...payload, sources }, onOpen, { only: ['overview'], defer: drawLater });

  /* ── สิ่งที่ยังขาดอยู่ ──
   *
   * การ์ด "รายได้" กับ "ต้นทุนการผลิต" ถูกเอาออกแล้ว เพราะชีตต้นทุนให้ข้อมูลครบ
   * เหลือแต่การแยกรายได้รายลูกค้า/สายพันธุ์ ซึ่งต้องใช้ราคาในชีตขายดอก */
  const sheetOf = (key) => payload.meta.sources.find((s) => s.key === key) ?? {};
  const salesSheet = sheetOf('sales');

  /* ดู sheetAvailable ไม่ใช่ available — available ผูกกับปีที่เลือกอยู่แล้ว
   * ถ้าใช้ตัวนั้น เลือกปีที่ชีตไม่มีข้อมูลจะขึ้นการ์ด "ไปแก้แท็บสรุป" ทั้งที่ชีตปกติดี */
  if (!payload.kpi?.cost?.sheetAvailable) {
    // ชีตต้นทุนโหลดไม่สำเร็จ — ต้องบอกว่าตัวเลขเงินหายไปเพราะอะไร
    const gaps = grid(host, { cols: 1 });
    gaps.appendChild(
      awaitingCard({
        title: t('awaiting.revenue.title'),
        why: t('cost.noSheetNote'),
        wide: true,
        needs: [
          {
            sheet: pick(sheetOf('cost'), 'title') || 'แบบฟอร์มต้นทุน',
            sheetUrl: sheetOf('cost').sheetUrl,
            columns: [t('awaiting.col.summaryTab')],
          },
        ],
      })
    );
  } else {
    const gaps = grid(host, { cols: 1 });
    gaps.appendChild(
      awaitingCard({
        title: t('awaiting.revenueSplit.title'),
        why: t('awaiting.revenueSplit.why'),
        wide: true,
        needs: [
          {
            sheet: pick(salesSheet, 'title') || 'แบบฟอร์มขายดอก',
            sheetUrl: salesSheet.sheetUrl,
            columns: [t('awaiting.col.pricePerGram'), t('awaiting.col.lineAmount')],
          },
        ],
      })
    );
  }

  /* ── การ์ดคุณภาพข้อมูล — ใบสุดท้ายของหน้าเสมอ (ผู้ใช้กำหนดไว้) ──
   * วางไว้ท้ายสุดเพราะเป็นบทสรุปว่าตัวเลขทุกอันที่เพิ่งดูไปเชื่อได้แค่ไหน
   * และยังขาดข้อมูลอะไรอยู่ ไม่ใช่สิ่งแรกที่ผู้บริหารต้องเห็นตอนเปิดหน้า */
  appendQualityCard(host, { ...payload, sources, report: 'dryflower' }, onOpen, drawLater);
}
