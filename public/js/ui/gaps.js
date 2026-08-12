/**
 * ui/gaps.js — ทะเบียน "ข้อมูลที่ชีตยังไม่มี" ของทั้งสองรายงาน
 *
 * ทำไมต้องมีที่เดียว:
 *
 * เดิมเรื่องนี้กระจายอยู่ตามหน้าในรูปการ์ด "รอข้อมูล" (ui/placeholder.js) ซึ่งดีตรงที่
 * เห็นตอนกำลังดูหน้านั้นอยู่ แต่ผู้ใช้ที่เปิดแค่หน้าเดียวจะไม่มีทางรู้ว่าทั้ง Dashboard
 * ยังขาดอะไรอีกบ้าง — ผู้ใช้จึงขอให้การ์ด "คุณภาพข้อมูล" สรุปให้ครบในที่เดียวด้วย
 *
 * ไฟล์นี้เป็น **แหล่งความจริงของรายการที่ขาด** ส่วนการ์ด "รอข้อมูล" ตามหน้าต่าง ๆ
 * ยังอยู่เหมือนเดิม เพราะทำหน้าที่คนละอย่าง (ตรงจุดที่ควรมีตัวเลขแต่ไม่มี)
 *
 * กฎข้อ 10 ของ CLAUDE.md ใช้กับที่นี่ด้วย: ทุกบรรทัดต้องบอกว่าต้องไปเพิ่มอะไร
 * ที่ชีตไหน ไม่งั้นผู้ใช้ตามไปแก้ไม่ได้
 */
import { t, pick } from '../i18n.js';
import { esc } from '../format.js';

/**
 * รายการที่ขาดของรายงาน Dryflower
 *
 * `sheet` = key ของรายงานใน meta.sources (เอาไว้หาชื่อไฟล์กับลิงก์)
 * `newSheet` = ต้องสร้างชีตใหม่ ไม่มีของเดิมให้ลิงก์ไป
 */
const DRYFLOWER = [
  {
    /* รายได้รวมมีแล้วจากชีตต้นทุน — ที่ยังขาดคือการแยกว่ามาจากใคร/สายพันธุ์อะไร
     * ข้อนี้จะหายไปเองถ้าวันหนึ่งชีตขายดอกมีคอลัมน์ราคา */
    id: 'revenueSplit',
    titleKey: 'awaiting.revenueSplit.title',
    whyKey: 'awaiting.revenueSplit.why',
    pageKey: 'gap.page.sales',
    sheet: 'sales',
    columnKeys: ['awaiting.col.pricePerGram', 'awaiting.col.lineAmount'],
  },
  {
    id: 'asp',
    titleKey: 'awaiting.asp.title',
    whyKey: 'awaiting.asp.why',
    pageKey: 'gap.page.sales',
    sheet: 'sales',
    columnKeys: ['awaiting.col.pricePerGram', 'awaiting.col.pricePerSize'],
  },
  {
    /* ต้นทุนการผลิตมีครบแล้วจากชีตต้นทุน (ค่าแรง ปุ๋ย ค่าไฟ ค่าเสื่อม ฯลฯ)
     * ที่ยังทำไม่ได้คือ "ต้นทุนต่อกรัม" เพราะต้นทุนของเดือนหนึ่งเป็นของครอป
     * ที่เก็บเกี่ยวอีกเดือนหนึ่ง ต้องมีคนกำหนดกติกาผูกต้นทุนกับครอปก่อน */
    id: 'costPerGram',
    titleKey: 'awaiting.costPerGram.title',
    whyKey: 'awaiting.costPerGram.why',
    pageKey: 'gap.page.cost',
    sheet: 'cost',
    columnKeys: ['awaiting.col.gramsPerMonth'],
  },
  {
    id: 'stockHistory',
    titleKey: 'awaiting.stockHistory.title',
    whyKey: 'awaiting.stockHistory.why',
    pageKey: 'gap.page.stock',
    sheet: 'inventory',
    columnKeys: ['awaiting.col.snapshotDaily'],
  },
  {
    id: 'aging',
    titleKey: 'awaiting.aging.title',
    whyKey: 'awaiting.aging.why',
    pageKey: 'gap.page.stock',
    sheet: 'inventory',
    columnKeys: ['awaiting.col.receivedDate', 'awaiting.col.lot'],
  },
  {
    id: 'cropStrain',
    titleKey: 'awaiting.cropStrain.title',
    whyKey: 'awaiting.cropStrain.why',
    pageKey: 'gap.page.production',
    sheet: 'perCrop',
    columnKeys: ['awaiting.col.strain'],
  },
];

/** รายการที่ขาดของรายงาน Supply */
const SUPPLY = [
  {
    id: 'supplyPrice',
    titleKey: 'awaiting.supplyPrice.title',
    whyKey: 'awaiting.supplyPrice.why',
    pageKey: 'gap.page.supply',
    sheet: 'supplyLog',
    columnKeys: ['awaiting.col.priceEveryItem'],
  },
  {
    id: 'supplyIssueValue',
    titleKey: 'awaiting.supplyIssueValue.title',
    whyKey: 'awaiting.supplyIssueValue.why',
    pageKey: 'gap.page.supply',
    sheet: 'supplyLog',
    columnKeys: ['awaiting.col.issueValue'],
  },
  {
    id: 'supplyBaseline',
    titleKey: 'awaiting.supplyBaseline.title',
    whyKey: 'awaiting.supplyBaseline.why',
    pageKey: 'gap.page.supply',
    sheet: 'supplyLog',
    columnKeys: ['awaiting.col.moreMonths'],
  },
  {
    /* ระยะเวลารอของ "มีแล้ว" แต่มีไม่ครบ — คนเขียนแทรกไว้ในหัวตารางของแท็บ
     * (บรรทัด "Lead Time – N Days") ซึ่งเป็นข้อความอิสระ ไม่ใช่คอลัมน์
     * ข้อนี้จะหายไปเองเมื่อทุกแท็บเขียนครบ */
    id: 'supplyLeadTime',
    titleKey: 'awaiting.supplyLeadTime.title',
    whyKey: 'awaiting.supplyLeadTime.why',
    pageKey: 'gap.page.supply',
    sheet: 'supplyLog',
    columnKeys: ['awaiting.col.leadTime'],
  },
  {
    id: 'supplySupplier',
    titleKey: 'awaiting.supplySupplier.title',
    whyKey: 'awaiting.supplySupplier.why',
    pageKey: 'gap.page.supply',
    sheet: 'supplyLog',
    columnKeys: ['awaiting.col.supplier', 'awaiting.col.orderedAt'],
  },
];

/**
 * รายการที่ขาดของรายงานหนึ่ง พร้อมเติมรายละเอียดที่คำนวณได้จากข้อมูลจริง
 *
 * ข้อไหนที่ข้อมูลมาครบแล้วจะหายไปเอง (เช่นถ้าวันหนึ่งชีตมีเดือนที่เบิกจบแล้วครบ 2 เดือน
 * ข้อ "เทียบความผิดปกติยังไม่ได้" ก็ไม่ควรค้างอยู่ให้คนเข้าใจผิด)
 *
 * @param {'dryflower'|'supply'} report
 * @param {{meta?:object, kpi?:object}} payload
 * @returns {{id:string, title:string, why:string, page:string,
 *            sheet:string, sheetUrl:string|null, columns:string[], detail:string|null}[]}
 */
export function dataGaps(report, payload = {}) {
  const list = report === 'supply' ? SUPPLY : DRYFLOWER;
  const sourceOf = (key) => payload.meta?.sources?.find((s) => s.key === key) ?? null;

  return list
    .map((gap) => {
      const src = gap.sheet ? sourceOf(gap.sheet) : null;
      return {
        id: gap.id,
        title: t(gap.titleKey),
        why: t(gap.whyKey),
        page: t(gap.pageKey),
        sheet: gap.newSheetKey ? t(gap.newSheetKey) : pick(src, 'title') || gap.sheet || '',
        sheetUrl: src?.sheetUrl ?? null,
        columns: gap.columnKeys.map((k) => t(k)),
        detail: detailOf(gap.id, payload),
      };
    })
    .filter((gap) => gap.detail !== false);
}

/**
 * รายละเอียดที่ต้องคำนวณจากข้อมูลจริง — คืน `false` เมื่อข้อนั้นไม่ใช่ปัญหาแล้ว
 * @returns {string|null|false}
 */
function detailOf(id, payload) {
  const kpi = payload.kpi ?? {};

  /* ชีตต้นทุนโหลดไม่ได้ = ตัวเลขเงินหายทั้งกระดาน ซึ่งเป็นคนละเรื่องกับ "ยังไม่มีข้อมูล"
   * ต้องบอกด้วยข้อความคนละแบบ ไม่งั้นผู้ใช้จะไปตามแก้ชีตทั้งที่ชีตไม่ได้ผิด
   *
   * ต้องดู sheetAvailable ไม่ใช่ available เพราะ available ผูกกับ **ปีที่เลือกอยู่** แล้ว
   * เลือกปีที่ชีตไม่มีข้อมูลจะทำให้การ์ดนี้กล่าวหาว่าชีตล่มทั้งที่ชีตปกติดี */
  if (id === 'costPerGram' && kpi.cost && !kpi.cost.sheetAvailable) {
    return t('gap.detail.costSheetDown');
  }

  if (id === 'supplyPrice') {
    // ราคาอยู่ที่คอลัมน์ H ของแท็บรายการแล้ว ไม่ใช่ตารางสั่งของ — นับจากรายการจริง
    const items = kpi.items ?? [];
    const reorder = kpi.needsReorder ?? [];
    const noPrice = reorder.filter((r) => r.unitPrice === null).length;
    if (!items.length && !reorder.length) return null;
    if (!noPrice) return false; // ทุกรายการที่ต้องสั่งมีราคาครบแล้ว
    return t('gap.detail.noPrice')
      .replace('{n}', String(noPrice))
      .replace('{total}', String(reorder.length));
  }

  if (id === 'supplyLeadTime') {
    const items = kpi.items ?? [];
    if (!items.length) return null;
    const have = items.filter((i) => i.leadTimeDays !== null && i.leadTimeDays !== undefined).length;
    if (have === items.length) return false; // เขียนครบทุกแท็บแล้ว
    return t('gap.detail.leadTime')
      .replace('{have}', String(have))
      .replace('{total}', String(items.length));
  }

  if (id === 'supplyBaseline') {
    const a = kpi.usageAnomalies;
    if (!a) return null;
    if (a.ready) return false; // ข้อมูลพอแล้ว ไม่ใช่สิ่งที่ขาดอีกต่อไป
    return t('gap.detail.baseline')
      .replace('{have}', String(a.monthsAvailable ?? 0))
      .replace('{need}', String(a.monthsNeeded ?? 3));
  }

  return null;
}

/**
 * วาดรายการที่ขาดเป็นลิสต์ — ใช้ทั้งบนการ์ดและใน modal
 *
 * @param {HTMLElement} parent
 * @param {ReturnType<typeof dataGaps>} gaps
 * @param {{compact?:boolean}} [opts] compact = บนการ์ด (ตัดเหตุผลกับคอลัมน์ออก ที่ไม่พอ)
 */
export function gapList(parent, gaps, { compact = false } = {}) {
  if (!gaps.length) {
    parent.innerHTML = `<p class="card__sub">✓ ${esc(t('gap.none'))}</p>`;
    return parent;
  }

  const link = (gap) =>
    gap.sheetUrl
      ? `<a class="finding__sheet" href="${esc(gap.sheetUrl)}" target="_blank" rel="noopener"
          >📄 ${esc(gap.sheet)} ↗</a>`
      : `<span class="finding__sheet">📄 ${esc(gap.sheet)}</span>`;

  const list = document.createElement('div');
  list.className = `gaps${compact ? ' gaps--compact' : ''}`;
  list.innerHTML = gaps
    .map((gap) => {
      const cols = gap.columns.map((c) => `<code>${esc(c)}</code>`).join(' ');
      return `<div class="gap">
          <span class="gap__icon" aria-hidden="true">⏳</span>
          <div class="gap__text">
            <div class="gap__title">${esc(gap.title)}<span class="gap__page">${esc(gap.page)}</span></div>
            ${gap.detail ? `<div class="gap__detail">${esc(gap.detail)}</div>` : ''}
            ${compact ? '' : `<div class="gap__why">${esc(gap.why)}</div>`}
            <div class="gap__need">${link(gap)}${compact ? '' : `<span class="gap__cols">${cols}</span>`}</div>
          </div>
        </div>`;
    })
    .join('');

  parent.appendChild(list);
  return list;
}
