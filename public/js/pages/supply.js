/**
 * pages/supply.js — KAMBIS SUPPLY STOCK (หน้าเดียวจบ)
 *
 * ลำดับบนหน้าตามที่ผู้ใช้กำหนด:
 *   ① ของที่ต้องสั่งซื้อ  — บนสุด เพราะเป็นสิ่งเดียวที่ต้องลงมือทำต่อทันที
 *      พร้อมปุ่มออกใบขอซื้อเป็นไฟล์ .xlsx
 *   ② มูลค่าของที่เบิกต่อเดือน (กราฟแท่ง) แล้วตามด้วยจำนวนเบิกต่อเดือน (รายการ × เดือน)
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
/* `fmtDateFull` = ค.ศ. เต็ม (`31 ก.ค. 2026`) ใช้เฉพาะ **สายของ "ข้อมูล ณ วันที่"**
 * ให้เป็นศักราชเดียวกับปฏิทินบนแถบตัวกรองและช่อง "ปี 2026" ที่อยู่ข้าง ๆ กัน
 * ส่วน `fmtDate` (พ.ศ. `31 ก.ค. 69`) ยังใช้กับตารางและ log ตามเดิม เพราะอ้างอิงชีตต้นทาง */
import { n, esc, DASH, date as fmtDate, dateFull as fmtDateFull } from '../format.js';
import { sortableTable } from '../ui/table.js';
import { openDetail } from '../ui/modal.js';
import { tabUrl, sheetUrlOf } from '../ui/sheet-link.js';
import { pageHeader, panel, well, tiles, emptyNote, appendQualityCard } from './shared.js';
import { comparePeriod, sameUnit } from '../shared/agg-core.js';
import { stockAt, usageValueByMonth, usageEntries } from '../shared/kpi.js';
import * as charts from '../charts/index.js';
import { releaseCharts } from '../charts/core.js';
import {
  readSupplyFilters,
  supplyFilterParams,
  supplyFilterBar,
  supplyMatcher,
  supplyLookup,
  SUPPLY_GROUPS,
} from '../ui/supply-filters.js';

export const meta = { report: 'supply', pages: ['order', 'stock', 'usage'] };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * สั่งดาวน์โหลด blob ลงเครื่อง — ตัวเดียวใช้ทั้งตอนออกใบใหม่และตอนโหลดใบเดิม
 * ต้องคืน object URL ทุกครั้ง ไม่งั้นค้างในหน่วยความจำจนกว่าจะปิดแท็บ
 */
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * โหลดสำเนาใบขอซื้อที่เก็บไว้บนเซิร์ฟเวอร์กลับมา
 *
 * เลขที่เอกสารรันต่อไปเรื่อย ๆ ไม่เคยใช้ซ้ำ (เลขหนึ่งเลข = กระดาษหนึ่งใบที่อาจ
 * ส่งไปให้เซ็นแล้ว) "ทำไฟล์หาย" จึงต้องแก้ด้วยการเอาสำเนาเดิมกลับมาทางนี้
 * ไม่ใช่กดออกใบใหม่ ซึ่งจะได้เลขใหม่ที่ไม่ตรงกับใบที่ส่งไปแล้ว
 */
async function downloadRequest(docNo, onStatus) {
  onStatus?.('');
  try {
    const res = await fetch(`/api/supply/purchase-request/${encodeURIComponent(docNo)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // ไฟล์หายกับพิมพ์เลขผิดคนละเรื่อง — server แยกมาให้แล้ว ต้องส่งต่อให้ผู้ใช้เห็น
      throw new Error(
        err.code === 'FILE_MISSING'
          ? t('supply.prFileMissing').replace('{doc}', docNo)
          : err.error || `HTTP ${res.status}`
      );
    }
    downloadBlob(new Blob([await res.arrayBuffer()], { type: XLSX_MIME }), `${docNo}.xlsx`);
    onStatus?.(`${t('supply.prDownloaded')} ${docNo}`);
  } catch (err) {
    onStatus?.(`${t('supply.prDownloadFailed')}: ${err.message}`);
  }
}

/* ── หน้าย่อยของรายงาน Supply ──
 *
 * เดิมเป็นหน้าเดียวยาว 3,710px ≈ 4.1 หน้าจอ (ยาวที่สุดในเว็บ) แยกตาม **งานที่คนมาทำ**
 * ไม่ใช่ตามชนิดของตาราง — และที่สำคัญกว่าเรื่องความยาวคือ **ตัวกรอง 5 ตัวมีผลคนละตาราง**
 * พอแยกหน้าแล้ว แต่ละหน้าโชว์เฉพาะตัวกรองของตัวเอง แถบเตือน "แผงนี้ไม่เดินตามวันที่
 * ที่เลือก" จึงหายไปเลย เพราะช่องเลือกวันไม่ได้อยู่บนหน้าที่มีตารางสั่งซื้ออีกต่อไป
 *
 * ตัวกรองที่หน้าไหนไม่ได้โชว์ **ต้องไม่มีผลกับตัวเลขของหน้านั้น** (ดู `applied` ด้านล่าง)
 * ไม่งั้นค่าที่ค้างใน URL จากอีกหน้าจะกลายเป็นตัวกรองล่องหนที่ไม่มีอะไรบอก
 */
const PAGE_FILTERS = {
  order: { search: true, group: true, price: true },
  stock: { search: true, group: true, price: true, asOf: true },
  usage: { year: true, search: true, group: true },
};

export function render(ctx) {
  const { host, supply, requestSupply, supplyError, params, setParams, onOpen, drawLater, route } = ctx;
  const page = PAGE_FILTERS[route?.page] ? route.page : 'order';
  const show = PAGE_FILTERS[page];

  /* วันที่ของข้อมูลย้ายมาอยู่ใต้หัวเรื่อง — เดิมเป็นช่องตัวเลขที่ค่าเป็น "—" เสมอ
   * แล้วเอาวันที่ไปซ่อนในบรรทัดคำอธิบาย ซึ่งอ่านเหมือนช่องนั้นไม่มีข้อมูล
   * เป็นข้อมูลบอกความสดของชีต ไม่ใช่ตัวเลขที่ต้องเอาไปตัดสินใจ จึงไม่ควรกินช่องตัวเลข */
  const asOfSheet = supply?.kpi?.asOf;
  pageHeader(host, {
    title: `${t('page.supply.title')} · ${t(`nav.supply${page[0].toUpperCase()}${page.slice(1)}`)}`,
    sub: asOfSheet
      ? `${t('page.supply.sub')} · ${t('supply.asOf')} ${fmtDateFull(asOfSheet)}`
      : t('page.supply.sub'),
  });

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

  /* ขอบของช่องเลือกวันที่
   *   min = วันแรกที่ชีตมีข้อมูล · max = **วันนี้** ห้ามเลยไปกว่านี้
   * ชีตลงยอดล่วงหน้าไว้ถึงสิ้นปีซึ่งเป็นยอดยกมา ไม่ใช่ของที่นับได้จริง */
  const today = new Date().toISOString().slice(0, 10);
  const firstDate = items.reduce((min, i) => {
    const d = i.log?.[0]?.date;
    return d && (!min || d < min) ? d : min;
  }, '');
  const options = {
    years: [...new Set(monthsWithUsage.map((m) => m.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    groups: [...new Set(items.map((i) => i.group).filter(Boolean))],
    minDate: firstDate || '',
    maxDate: today,
  };

  /* ลิงก์ไปแท็บของแต่ละรายการในชีต — `kpi.items[]` มี `gid` ติดมาจาก parser อยู่แล้ว
   * ส่วน `sheetUrl` มาจาก meta ของ payload ก้อนนี้ (ชีตวัสดุโหลดแยก จึงมี meta ของตัวเอง)
   * จับคู่ด้วยชื่อที่แสดง เพราะตารางการเบิกก็ใช้ชื่อเดียวกันนี้เป็นคีย์ */
  const gidByItem = new Map(items.filter((i) => i.gid != null).map((i) => [i.item, i.gid]));
  const sheet = {
    sheetUrl: sheetUrlOf(supply.meta, 'supplyLog'),
    gidOf: (name) => gidByItem.get(name) ?? null,
  };

  let filters = readSupplyFilters(params);

  /* .stack ให้ระยะห่างระหว่างแผงเท่ากับหน้าอื่น — กล่องนี้เป็น div เปล่าที่หน้าวาดใหม่เอง
   * แผงข้างในจึงไม่ได้ gap ของ .page (เป็นหลานไม่ใช่ลูก) แล้วดูติดกันไปหมด */
  const dataHost = document.createElement('div');
  dataHost.className = 'stack';

  const bar = supplyFilterBar({
    filters,
    options: { ...options, show },
    onChange: (next) => {
      filters = next;
      // อัปเดต URL แบบไม่ยิง event — ถ้ายิง router จะวาดทั้งหน้าใหม่แล้วโฟกัสหลุด
      setParams?.(supplyFilterParams(next), { silent: true });
      draw();
    },
  });
  host.appendChild(bar);
  host.appendChild(dataHost);

  /* กราฟวาดได้ต่อเมื่อกล่องอยู่ใน DOM แล้วเท่านั้น — setupCanvas() คืน null เมื่อกว้าง 0
   * แล้วกราฟ bail เงียบ ๆ (ดูกฎ 5 ขั้นตอนใน CLAUDE.md §6.5)
   *
   * รอบแรกหน้ายังไม่ถูกใส่ลง DOM (main.js appendChild ทีหลัง) จึงต้องฝากไว้ใน drawLater
   * ส่วนรอบต่อ ๆ ไปที่มาจากการกดตัวกรอง กล่องอยู่ใน DOM แล้วและ **runDeferred ถูกรัน
   * ไปนานแล้ว** ฝากไว้อีกก็ไม่มีใครมารัน ต้องวาดทันที */
  const drawChart = (node, run) => {
    if (node.isConnected) run();
    else drawLater?.push({ node, run });
  };

  /** วาดเฉพาะแผงข้อมูล — แถบตัวกรองกับการ์ดคุณภาพข้อมูลอยู่นอกกล่องนี้ */
  const draw = () => {
    // ปล่อย ResizeObserver + bitmap ของกราฟรอบก่อนเสมอ ไม่งั้นรั่วทุกครั้งที่ขยับตัวกรอง
    releaseCharts(dataHost);
    dataHost.innerHTML = '';

    /* ตัวกรองที่หน้านี้ไม่ได้โชว์ ต้องไม่มีผลกับตัวเลข — แต่ยังเก็บไว้ใน URL
     * เพื่อให้กดกลับไปหน้าเดิมแล้วค่าที่เลือกไว้ยังอยู่ (เช่นวันที่ของหน้าสต๊อก) */
    const applied = {
      ...filters,
      year: show.year ? filters.year : '',
      price: show.price ? filters.price : 'all',
      asOf: show.asOf ? filters.asOf : '',
    };
    const match = supplyMatcher(applied, lookup);

    const reorder = (kpi.needsReorder ?? []).filter(match);
    const optional = (kpi.optionalReorder ?? []).filter(match);
    const usage = (kpi.usage ?? []).filter(match);
    const shownItems = asOfItems(items, applied.asOf).filter(match);
    bar.__setCount(shownItems.length, items.length);

    /* ── แถบเตือนตอนดูย้อนหลัง ──
     * มีเฉพาะหน้าสต๊อกซึ่งเป็นหน้าเดียวที่มีช่องเลือกวัน */
    if (applied.asOf) {
      const back = document.createElement('p');
      back.className = 'supply-warn';
      back.textContent = t('supply.asOfBanner').replace('{date}', fmtDateFull(applied.asOf));
      dataHost.appendChild(back);
    }

    /* ยอดบนแถบตัวเลขต้องเป็นของ "ที่กรองแล้ว" ให้ตรงกับตารางข้างล่าง
     *
     * ช่อง "มูลค่าตามตารางสั่งซื้อ" ถูกเอาออกแล้ว — ตีราคาทั้งตารางแผนสั่งซื้อ 60 แถว
     * รวมของที่ยังไม่ต้องสั่ง จึงไม่ได้ตอบคำถามที่ใครถามจริง ๆ และช่องราคาต้นทางก็เลิกใช้แล้ว
     * แทนด้วยเงินที่จมอยู่ในคลังจริง กับของที่ขอซื้อไปแล้วยังไม่มาถึง */
    const stockValue = shownItems.filter((r) => r.balance !== null && r.unitPrice !== null);
    const waiting = reorder.filter((r) => r.pending);
    const overdue = waiting.filter((r) => r.pending.overdue === true).length;
    const longest = waiting.reduce((max, r) => Math.max(max, r.pending.daysAgo ?? 0), 0);

    tiles(dataHost, [
      { label: t('supply.trackedItems'), value: shownItems.length, hint: t('supply.fromLog') },
      {
        label: t('supply.needReorder'),
        value: reorder.length,
        hint: applied.asOf ? t('supply.belowMinimumNow') : t('supply.belowMinimum'),
      },
      {
        label: t('supply.stockValue'),
        value: stockValue.reduce((s, r) => s + r.balance * r.unitPrice, 0),
        unit: '฿',
        // ต้องบอกว่าคิดจากกี่รายการ ตอนนี้มีราคาแค่ 28 จาก 138 ยอดจึงยังไม่ใช่ทั้งคลัง
        hint: t('supply.stockValueFrom')
          .replace('{n}', String(stockValue.length))
          .replace('{total}', String(shownItems.length)),
      },
      {
        label: t('supply.waitingDelivery'),
        value: waiting.length,
        hint: waiting.length
          ? t('supply.waitingHint')
              .replace('{overdue}', String(overdue))
              .replace('{days}', String(longest))
          : t('supply.waitingNone'),
      },
    ]);

    if (page === 'order') {
      /* หน้านี้ไม่มีช่องเลือกวันแล้ว จึงส่ง asOf เป็นค่าว่างเสมอ —
       * แถบเตือน "แผงนี้ยึดวันนี้เสมอ" ไม่จำเป็นอีกต่อไปเพราะไม่มีวันอื่นให้สับสน */
      renderReorder(dataHost, reorder, kpi, requestSupply, '', { sheet });

      /* ของที่ชีตตั้งขั้นต่ำไว้ 0 = ไม่ต้องเก็บสต๊อก หมดแล้วก็ยังไม่ต้องรีบสั่ง
       * แยกแผงออกมา ไม่ติ๊กไว้ให้ และไม่นับเข้าช่อง "ต้องสั่งซื้อ" ด้านบน
       * แต่ยังกดสั่งเองได้ถ้าจะซื้อจริง (ผู้ใช้เป็นคนตัดสิน ไม่ใช่ระบบ) */
      renderReorder(dataHost, optional, kpi, requestSupply, '', {
        title: t('supply.optionalTitle'),
        note: t('supply.optionalNote'),
        intro: t('supply.optionalIntro'),
        defaultOn: false,
        hideWhenEmpty: true,
        idPrefix: 'pr-opt',
        sheet,
      });
    }

    if (page === 'usage') {
      /* เดือนที่แสดง — คิดที่เดียวแล้วส่งให้ทั้งกราฟมูลค่าและตารางจำนวน
       * สองแผงนี้วางซ้อนกันอยู่ ถ้าต่างคนต่างคิดช่วงเวลาเอง วันหนึ่งกฎ resolve ปี
       * ถูกแก้ที่เดียวแล้วกราฟกับตารางจะนับคนละช่วงโดยไม่มีอะไรฟ้อง
       *
       * ยังไม่ได้เลือกปีเอง = ปีล่าสุดที่มีการเบิกจริง (ไม่ใช่ปีปฏิทินปัจจุบัน
       * เพราะต้นปีที่ยังไม่มีใครเบิกของ ตารางจะว่างเปล่าทั้งที่ปีก่อนมีข้อมูลอยู่) */
      const year = applied.year === 'all' ? null : applied.year || options.years[0] || null;
      const shownMonths = (
        year ? monthsWithUsage.filter((m) => m.startsWith(year)) : monthsWithUsage
      ).sort(comparePeriod);

      renderAnomalies(dataHost, kpi.usageAnomalies, match);
      renderUsageValue(dataHost, usage, shownMonths, lookup, drawChart, {
        // รายการที่กรองแล้วชุดเดียวกับที่กราฟใช้ — กล่องรายละเอียดต้องไม่โผล่ของนอกตัวกรอง
        items: items.filter(match),
        sheet,
      });
      renderUsage(dataHost, usage, shownMonths, year, sheet, lookup);
    }

    if (page === 'stock') {
      // ตารางสต๊อกใช้แถวจากแท็บ log (ยอดคงเหลือจริง) ไม่ใช่ orderItems ที่เป็นแผนสั่งซื้อ
      renderStockTable(dataHost, shownItems, applied.asOf, sheet);
    }
  };

  draw();

  /* ── ใบขอซื้อที่เคยออก ──
   * อยู่หน้าเดียวกับตารางสั่งซื้อโดยตั้งใจ ไม่ได้แยกเป็นเมนูของตัวเอง เพราะแท็ก
   * `PR-…` ในตารางด้านบนกดแล้วโหลดสำเนาใบเดิม — สองอย่างนี้ใช้ด้วยกันตลอด
   * ถ้าแยกคนละหน้า พอเห็นแท็กแล้วอยากดูรายละเอียดต้องสลับหน้า ซึ่งแย่กว่าเลื่อนลง
   *
   * อยู่นอก dataHost เหมือนการ์ดคุณภาพข้อมูล เพราะเป็นทะเบียนของ "ทั้งชีต"
   * ไม่ใช่ของที่กรองไว้ — คนเปิดดูเพื่อหาใบเดิมที่ทำหาย ซึ่งอาจเป็นรายการที่
   * ตัวกรองปัจจุบันซ่อนอยู่ก็ได้ */
  if (page !== 'order') return;
  renderHistory(host, kpi.purchaseRequests ?? [], kpi.needsReorder ?? []);

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
 * ลิงก์ไปแท็บของรายการนั้นในชีต — ใช้ร่วมกันระหว่างตารางการเบิกกับตารางสต๊อก
 *
 * สองตารางนี้มีคีย์เป็นชื่อรายการเหมือนกัน และตอบคำถามเดียวกันคือ "ของชิ้นนี้มี
 * ประวัติอะไรบ้าง" ซึ่งอยู่ในแท็บ log ของมัน กดจากตารางไปดูได้เลยจึงตัดขั้นตอน
 * "เปิดชีต → ไล่หาแท็บใน 138 อัน" ออกไปทั้งดุ้น
 *
 * `gidOf` คืน `null` ได้เมื่อจับคู่แท็บไม่เจอ — กรณีนั้นต้องเป็นข้อความธรรมดา
 * **ห้ามสร้างลิงก์หลอกที่กดแล้วไปโผล่แท็บแรก** (กฎเดียวกับ finding ใน §10)
 */
function sheetLinkOf(sheet, item) {
  return tabUrl(sheet?.sheetUrl, sheet?.gidOf?.(item));
}

/** ช่องชื่อรายการที่กดได้ — คืน render() ให้ sortableTable ใช้ */
function itemCell(sheet) {
  return (r) => {
    const href = sheetLinkOf(sheet, r.item);
    if (!href) return esc(r.item);
    return `<a class="sheet-link" href="${esc(href)}" target="_blank" rel="noopener"
      title="${esc(t('supply.openTab'))}">${esc(r.item)}<span class="sheet-link__arrow" aria-hidden="true">↗</span></a>`;
  };
}

/**
 * ทำให้ทั้งแถวกดได้ ไม่ต้องเล็งชื่อรายการ
 *
 * ผูกแบบ delegate ที่ตัวตาราง ไม่ใช่ทีละแถว เพราะ `sortableTable` วาด tbody ใหม่
 * ทุกครั้งที่เรียงคอลัมน์ใหม่ — listener ที่ผูกกับ <tr> เดิมจะหลุดไปพร้อมกัน
 *
 * ไม่ทำให้ทุกช่องเป็น `<a>` เพราะ screen reader จะอ่าน "ลิงก์ 480 ลิงก์ 199…"
 * ซ้ำหลายครั้งต่อแถว — ลิงก์จริงมีอันเดียวที่ชื่อรายการ ตรงนี้เป็นทางลัดของเมาส์
 */
function wireSheetRows(body, sheet) {
  const el = body.querySelector('.table-wrap');
  if (!el) return;
  el.classList.add('sheet-rows');
  el.addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // ลิงก์จริงทำงานของมันเอง
    const tr = e.target.closest('tbody tr[data-key]');
    if (!tr) return;
    // กำลังลากเลือกตัวเลขอยู่ ไม่ใช่ตั้งใจกด — อย่าเด้งออกไปกลางคัน
    if (String(window.getSelection?.() ?? '').length) return;
    const href = sheetLinkOf(sheet, tr.dataset.key);
    if (href) window.open(href, '_blank', 'noopener');
  });
}

/* ชั้นของแท่งในกราฟการเบิก = หมวดของวัสดุ ตามลำดับตายตัวของ `SUPPLY_GROUPS`
 * (ลำดับนั้นคือลำดับสี — เหตุผลอยู่ที่ ui/supply-filters.js)
 *
 * ต่อท้ายด้วย `''` = จับหมวดไม่ได้ ซึ่ง **ต้องมีช่องของตัวเอง** ห้ามยัดเข้าหมวดใดหมวดหนึ่ง
 * ไม่งั้นยอดของหมวดนั้นจะเกินจริงโดยไม่มีอะไรบอก และช่องนี้ไม่ได้อยู่ในตัวเลือกของ
 * ช่องกรองหมวด เพราะ "หมวดที่ระบบอ่านไม่ออก" ไม่ใช่หมวดที่คนจะตั้งใจเลือกดู */
const GROUP_ORDER = [...SUPPLY_GROUPS, { code: '', label: () => t('label.other') }];

/**
 * ② มูลค่าของที่เบิกต่อเดือน — แท่งซ้อนแยกตามหมวด
 *
 * ตอบคำถาม "เดือนที่แล้วเบิกของไปเป็นเงินเท่าไร" ซึ่งตารางจำนวนด้านล่างตอบไม่ได้
 * เพราะของคนละรายการคนละหน่วยเอามาบวกกันไม่ได้ (ถุง + แผ่น + ลัง) ต้องแปลงเป็นเงินก่อน
 *
 * **ไม่ใช่ยอดเงินที่จ่ายจริงในเดือนนั้น** — ชีตเก็บราคาไว้ช่องเดียวต่อรายการ (คอลัมน์ H
 * ของแท็บนั้น) ไม่มีประวัติราคา ตัวเลขนี้จึงเป็นของที่เบิกไปตีตามราคาวันนี้
 * และ **เงินก้อนนี้ห้ามเอาไปบวกกับงบในชีตต้นทุน** เพราะคนละขอบเขตกัน (CLAUDE.md §11)
 * ข้อความกำกับใต้หัวแผงจึงตัดออกไม่ได้
 *
 * รายการที่ยังไม่มีราคาถูกตัดออกจากยอด **ไม่ใช่คิดเป็น 0** แล้วบอกจำนวนที่ตัดออกไว้
 * ด้วยข้อความเดียวกับตารางสต๊อก ไม่งั้นคนจะอ่านแท่งเตี้ย ๆ ว่าเดือนนั้นใช้ของน้อย
 */
function renderUsageValue(host, usage, shown, lookup, drawChart, opts = {}) {
  /* ไม่มีการเบิกเลย หรือปีที่เลือกไม่มีเดือนไหนเลย — ปล่อยให้ตารางด้านล่างเป็นคนอธิบาย
   * ไม่ต้องขึ้นแผงว่างเปล่าซ้อนกันสองใบที่บอกเรื่องเดียวกัน */
  if (!usage.length || !shown.length) return;

  const { rows, total, priced, unpriced } = usageValueByMonth(usage, shown, lookup);

  const body = panel(host, t('supply.usageValueTitle'), `${t('label.total')} ${n(total)} ฿`, {
    wide: true,
  });

  const intro = document.createElement('p');
  intro.className = 'panel-intro';
  intro.textContent = unpriced.length
    ? `${t('supply.usageValueIntro')} ${t('supply.unpricedNote').replace(
        '{n}',
        String(unpriced.length)
      )}`
    : t('supply.usageValueIntro');
  body.appendChild(intro);

  // มีการเบิกอยู่ แต่ยังไม่มีรายการไหนใส่ราคาไว้เลย — บอกตรง ๆ ดีกว่ากราฟที่ทุกแท่งเป็น 0
  if (!priced.length) {
    emptyNote(body, t('supply.usageValueNoPrice'));
    return;
  }

  /* **ห้ามตัดหมวดที่ยังไม่มีข้อมูลออกจาก keys** สีของชั้นในแท่งมาจากตำแหน่งในลิสต์นี้
   * ถ้าตัด พอกรองเหลือเฉพาะปุ๋ย ปุ๋ยจะเลื่อนขึ้นมาเป็นช่องแรกแล้วเปลี่ยนเป็นสีของวัสดุทั่วไป
   * (กฎ "สีผูกกับหมวด ไม่ใช่กับอันดับในชุดที่กำลังดู" — CLAUDE.md §9)
   * ชั้นที่เป็น 0 ถูกข้ามอยู่แล้ว และ legend ก็ขึ้นเฉพาะหมวดที่มีข้อมูลจริง */
  const keys = GROUP_ORDER.map((g) => g.label());
  const thisMonth = new Date().toISOString().slice(0, 7);

  const data = rows.map((r) => ({
    key: r.month,
    /* เดือนที่ยังมาไม่ถึงต้องมีป้ายกำกับ ชีตลงยอดล่วงหน้าไว้ ถ้าปล่อยเปล่า ๆ แท่งเตี้ย ๆ
     * ของเดือนหน้าจะอ่านเหมือนแนวโน้มการใช้ของกำลังดิ่งลง ทั้งที่เดือนนั้นยังไม่เกิด */
    sub: r.month > thisMonth ? t('supply.usageValueFuture') : '',
    parts: Object.fromEntries(GROUP_ORDER.map((g) => [g.label(), r.byGroup[g.code] ?? 0])),
  }));

  /* กดแท่งแล้วเปิดรายการที่เบิกจริงของเดือนนั้น
   *
   * กราฟตอบได้แค่ "เดือนไหนใช้เงินไปเท่าไร" คำถามถัดไปที่ตามมาเสมอคือ
   * "แล้วมันไปกับอะไร" ซึ่งเดิมต้องไปไล่อ่านตารางจำนวนเบิกด้านล่างทีละคอลัมน์
   * แล้วเปิดชีตของแต่ละรายการเอง */
  const openMonth = (month, trigger) =>
    openUsageDetail(month, opts.items ?? [], lookup, opts.sheet ?? {}, trigger);

  const box = well(body);
  drawChart(box, () =>
    charts.stackedBars(box, data, {
      onSelect: (row) => openMonth(row.key, null),
      keys,
      height: 260,
      // unit: '฿' — ไม่ส่งแล้วทั้งแกน Y และ tooltip จะคิดว่าเป็นน้ำหนักแล้วขึ้นเป็น kg
      unit: '฿',
      /* ป้ายเดือนเป็นคีย์ดิบ (`2026-07`) ไม่ใช่ `ก.ค. 69` แบบกราฟอื่น เพราะกราฟนี้วางอยู่
       * เหนือตารางที่ใช้เดือนเป็นหัวคอลัมน์ในรูปแบบนั้นพอดี และแถบตัวกรองข้างบนก็เขียน
       * "ปี 2026" — ถ้าใช้ พ.ศ. เฉพาะกราฟ ผู้ใช้ต้องแปลงศักราชในหัวทุกครั้งที่กวาดตา
       * ระหว่างสองแผงที่พูดถึงเดือนเดียวกัน */
      labelFormat: 'raw',
      // ตัดท้ายไม่ได้ ต้องเท่ากับคอลัมน์ของตารางด้านล่างเสมอ ไม่งั้นสองแผงบอกคนละช่วง
      max: data.length,
    })
  );

  /* แถวปุ่มเดือน — **ไม่ใช่แค่ทางลัด แต่เป็นทางเดียวที่ใช้ได้จริงบนมือถือ**
   *
   * แท่งกราฟกว้าง ~15px บนจอ 375px แตะให้โดนแทบไม่ได้ และ canvas ไปถึงด้วย
   * คีย์บอร์ดไม่ได้เลย แถวนี้จึงทำสองหน้าที่พร้อมกัน: บอกว่ากราฟกดได้
   * (ไม่งั้นไม่มีใครรู้) และเป็นเป้ากดจริงที่ Tab ไปถึง */
  const drill = document.createElement('p');
  drill.className = 'usage-drill';
  const hint = document.createElement('span');
  hint.className = 'usage-drill__hint';
  hint.textContent = t('supply.usageDrillHint');
  drill.appendChild(hint);

  for (const r of rows) {
    // เดือนที่ไม่มีการเบิกเลยไม่ต้องมีปุ่ม — กดไปก็ได้กล่องเปล่า
    if (!r.total) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'usage-drill__btn';
    b.textContent = r.month;
    b.addEventListener('click', () => openMonth(r.month, b));
    drill.appendChild(b);
  }
  body.appendChild(drill);
}

/** กล่องรายละเอียดการเบิกของเดือนหนึ่ง — ตรรกะการเลือกแถวอยู่ที่ shared/kpi.js
 * เพราะมันต้องให้ยอดตรงกับ usageValueByMonth() ที่อยู่ไฟล์เดียวกันเป๊ะ */
function openUsageDetail(month, items, lookup, sheet, trigger) {
  const rows = usageEntries(items, month, lookup);
  const value = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const uniqueItems = new Set(rows.map((r) => r.item)).size;

  const sub = t('supply.usageDrillSub')
    .replace('{rows}', n(rows.length))
    .replace('{items}', n(uniqueItems))
    .replace('{value}', n(value));

  openDetail(t('supply.usageDrillTitle').replace('{month}', month), sub, (body) => {
    if (!rows.length) {
      emptyNote(body, t('supply.usageDrillEmpty'));
      return;
    }

    body.appendChild(
      sortableTable(
        [
          { label: t('supply.date'), get: (r) => r.date, render: (r) => fmtDateFull(r.date) },
          { label: t('supply.item'), get: (r) => r.item, render: itemCell(sheet) },
          { label: t('supply.issuedQty'), align: 'n', get: (r) => r.qty, render: (r) => n(r.qty) },
          { label: t('supply.unit'), get: (r) => r.unit },
          {
            label: t('supply.amount'),
            align: 'n',
            get: (r) => r.value,
            render: (r) =>
              r.value === null
                ? `<span class="cell-missing">${esc(t('supply.noPrice'))}</span>`
                : n(r.value),
          },
        ],
        rows,
        {
          // เรียงจากวันที่ล่าสุดตามที่ผู้ใช้สั่ง — คีย์ ISO เรียงแล้วตรงกับเวลาจริง
          sortIndex: 0,
          sortDir: 'desc',
          rowKey: (r) => `${r.date}|${r.item}`,
        }
      )
    );

    wireSheetRows(body, sheet);
  }, trigger);
}

/**
 * ③ ตารางจำนวนเบิกต่อเดือน — แถวคือรายการ คอลัมน์คือเดือน **แบ่งเป็นบล็อกตามหมวด**
 *
 * แสดงเฉพาะเดือนที่มีการเบิกจริง ชีตมีแถวลงวันที่ล่วงหน้าถึงสิ้นปี
 * ถ้าเอาทุกเดือนที่ปรากฏในข้อมูลมาทำคอลัมน์ จะได้คอลัมน์ว่างเปล่าอีกครึ่งตาราง
 *
 * **ตารางนี้เป็นจำนวนล้วนทั้งใบ เงินอยู่คนละแผง** (ผู้ใช้สั่ง ส.ค. 69)
 *
 * เคยมีคอลัมน์ `มูลค่า` อยู่ท้ายตาราง แต่มันตอบได้แค่ยอดรวมทั้งช่วง ไม่ได้แตกรายเดือน
 * — คำถามที่ตามมาคือ "แล้วเดือน 07 กับ 08 แต่ละเดือนเป็นเงินเท่าไร" ซึ่ง **แผงกราฟ
 * "มูลค่าของที่เบิกต่อเดือน" ที่อยู่เหนือมันพอดีตอบครบอยู่แล้ว** ทั้งแยกตามหมวด
 * แยกตามเดือน และกดที่แท่งแล้วเปิดรายการที่เบิกจริงพร้อมมูลค่ารายชิ้นได้ (`usageEntries()`)
 *
 * กติกาที่ได้มาคือ **หนึ่งแผง = หนึ่งหน่วย** ซึ่งแรงกว่ากฎเดิม (หนึ่งคอลัมน์ = หนึ่งหน่วย)
 * และทำให้ตารางแคบลง ~100px ซึ่งมีผลจริงตอนปีเต็ม 12 เดือน (ตารางกว้างเกินแผงอยู่แล้ว
 * แม้บนจอ 1920) **ห้ามเอาคอลัมน์เงินกลับเข้ามาโดยไม่ถามก่อน**
 *
 * **ยอดจำนวนของหมวดขึ้นเฉพาะหมวดที่ทุกรายการใช้หน่วยเดียวกัน** ที่เหลือเว้นว่าง
 * เพราะ `480 แผ่น + 199 ถุง` ไม่ใช่ `679` — วัสดุทั่วไปมี 17 หน่วย · สารเสริมธาตุมี
 * `ถัง` กับ `หลอด` ซึ่งเป็นเหตุผลเดียวกับที่กราฟด้านบนต้องแปลงเป็นเงินก่อน
 */
function renderUsage(host, usage, shown, year, sheet = {}, lookup = null) {
  const body = panel(host, t('supply.usageTitle'), t('supply.usageNote'), { wide: true });

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

  /* บล็อกตามหมวด — ต้องมี `lookup` ถึงจะรู้ว่ารายการไหนอยู่หมวดไหน
   * (แถว usage มาจาก server ซึ่งไม่รู้จักหมวด เหมือนกราฟมูลค่าที่ต้องพึ่ง lookup เช่นกัน) */
  const groups = lookup ? usageGroups(shown, lookup, totalOf) : undefined;
  if (groups) {
    const hint = document.createElement('p');
    hint.className = 'panel-intro';
    hint.textContent = t('supply.usageGroupNote');
    body.appendChild(hint);
  }

  body.appendChild(
    sortableTable(
      /* หน่วยอยู่ท้ายสุด ต่อจากคอลัมน์รวม — คอลัมน์เดือนคือของที่ต้องกวาดตาเทียบกัน
       * แทรกคอลัมน์ข้อความคั่นระหว่างชื่อรายการกับตัวเลขทำให้สายตาสะดุดทุกแถว */
      [
        { label: t('supply.item'), get: (r) => r.item, render: itemCell(sheet) },
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
          /* หนา 600 ไม่ใช่ `<b>` (700) — ยอดของหมวดบนแถวหัวบล็อกต้องหนักกว่านี้หนึ่งขั้น
           * ไม่งั้นยอดที่สรุปทุกรายการไว้แล้วจะดูเบากว่าลูกของตัวเอง */
          render: (r) => `<span class="cell-subtotal">${n(totalOf(r))}</span>`,
        },
        { label: t('supply.unit'), get: (r) => r.unit ?? '' },
      ],
      usage,
      // เรียงตามคอลัมน์รวม ซึ่งตอนนี้อยู่ถัดจากคอลัมน์เดือนสุดท้าย (ชื่อรายการ + เดือน)
      { sortIndex: 1 + shown.length, sortDir: 'desc', rowKey: (r) => r.item, groups }
    )
  );

  wireSheetRows(body, sheet);
}

/**
 * ตัวประกอบบล็อกหมวดให้ `sortableTable` — คืน `{of, order, head}`
 *
 * `order` ยึด `GROUP_ORDER` ตัวเดียวกับกราฟ ไม่ใช่ลำดับที่เจอในข้อมูล เพื่อให้บล็อก
 * ในตารางเรียงตรงกับชั้นในแท่งที่อยู่เหนือมันพอดี — กวาดตาลงมาแล้วเจอลำดับเดิม
 */
function usageGroups(shown, lookup, totalOf) {
  const labelOf = new Map(GROUP_ORDER.map((g) => [g.code, g.label]));
  return {
    of: (r) => lookup.groupOf(r.item) ?? '',
    order: GROUP_ORDER.map((g) => g.code),
    head: (code, rows) => {
      /* บวกจำนวนได้ต่อเมื่อ **ทั้งหมวดใช้หน่วยเดียวกัน** เท่านั้น
       * เทียบด้วย sameUnit() เพราะคนสะกดหน่วยเดียวกันไม่ตรงกันในชีต (`แพ็ค` · `แพค`)
       * — แต่ `ถัง` กับ `ถุง` เป็นคนละหน่วยจริง ๆ ต้องไม่ถูกจับรวม */
      const unit = rows[0]?.unit ?? null;
      const oneUnit = unit && rows.every((r) => sameUnit(r.unit, unit));

      /* **เหตุผลที่บวกไม่ได้ต้องอ่านออกโดยไม่ต้องชี้เมาส์**
       *
       * เคยทำเป็นขีดเปล่า ๆ + tooltip แล้วผู้ใช้ถามกลับมาว่า "ขีด คือไม่รวมหรอ" —
       * บนมือถือไม่มี hover ให้ชี้เลยด้วยซ้ำ ตอนนี้ช่องหน่วยเขียนจำนวนหน่วยที่เจอไว้ตรง ๆ
       * (`2 หน่วย`) แล้วค่อยมี tooltip บอกว่าหน่วยอะไรบ้าง — **ชิปนี้เป็นสิ่งเดียวที่เหลือ
       * อยู่ในแถวนั้น** หลังจากช่องตัวเลขถูกเว้นว่าง เอาออกเมื่อไรแถวจะกลายเป็นชื่อหมวด
       * ลอย ๆ ที่ไม่มีอะไรบอกว่าทำไมไม่มีตัวเลข
       * — กฎเดียวกับ `*ยังไม่ใส่ราคา` ในตารางสต๊อก: บอกด้วยข้อความ ไม่ใช่ด้วยความว่างเปล่า
       *
       * ใช้ "จำนวนหน่วย" ไม่ใช่ลิสต์ชื่อหน่วย เพราะวัสดุทั่วไปมี 17 หน่วย ลิสต์ทั้งหมด
       * จะดันตารางกว้างจนคอลัมน์เดือนถูกเบียด (เจอจริง ส.ค. 69: `Bloom A` ลงหน่วยเป็น
       * `ถุุง` ทั้งที่ปุ๋ยใช้ `ถัง` ปุ๋ยหลักจึงบวกไม่ได้ทั้งหมวดเพราะเซลล์เดียว) */
      const units = [...new Set(rows.map((r) => r.unit).filter(Boolean))];
      const tip = esc(t('supply.usageGroupMixed').replace('{units}', units.join(' · ')));

      /* หมวดที่บวกไม่ได้ **เว้นช่องตัวเลขว่าง ไม่ใช่ใส่ `—`**
       * ในโปรเจกต์นี้ `—` แปลว่า "ไม่มีข้อมูล" ซึ่งคนละความหมายกับ "มีข้อมูลแต่บวกกันไม่ได้"
       * ตัวที่อธิบายคือชิป `N หน่วย` ในคอลัมน์หน่วย ซึ่งอยู่ในแถวเดียวกันพอดี */
      const qty = (has, sum) => {
        if (!oneUnit) return '';
        // ไม่มีรายการไหนในหมวดเบิกเดือนนั้นเลย ≠ เบิกแล้วได้ 0 — ปีเต็มไม่งั้นได้ `0` เรียงเป็นตับ
        return has ? n(sum) : `<span class="muted">${DASH}</span>`;
      };

      const label = labelOf.get(code)?.() ?? t('label.other');
      const count = t('supply.usageGroupCount').replace('{n}', String(rows.length));
      return [
        `${esc(label)} <span class="muted">· ${esc(count)}</span>`,
        ...shown.map((m) =>
          qty(
            rows.some((r) => r.byMonth[m] !== undefined),
            rows.reduce((sum, r) => sum + (r.byMonth[m] ?? 0), 0)
          )
        ),
        qty(true, rows.reduce((sum, r) => sum + totalOf(r), 0)),
        oneUnit
          ? esc(unit)
          : `<span class="cell-assumed" title="${tip}">${esc(
              t('supply.usageGroupUnits').replace('{n}', String(units.length))
            )}</span>`,
      ];
    },
  };
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
function renderStockTable(host, items, asOf = '', sheet = {}) {
  /* หัวแผงต้องบอกวันที่เมื่อดูย้อนหลัง ไม่งั้นแคปหน้าจอส่งต่อแล้วไม่มีใครรู้ว่าเป็นของวันไหน */
  const title = asOf
    ? t('supply.stockTableAsOf').replace('{date}', fmtDateFull(asOf))
    : t('supply.stockTable');
  const body = panel(host, title, t('supply.stockTableNote'), { wide: true });
  if (!items.length) {
    emptyNote(body);
    return;
  }

  body.appendChild(stockExportBar(items, asOf));

  // มูลค่าคิดได้เฉพาะรายการที่มีทั้งยอดคงเหลือและราคา
  const valueOf = (r) =>
    r.balance !== null && r.unitPrice !== null ? r.balance * r.unitPrice : null;

  body.appendChild(
    sortableTable(
      [
        { label: t('supply.item'), get: (r) => r.item, render: itemCell(sheet) },
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
          /* ราคาที่ขึ้นตรงนี้เป็น "ต่อ 1 หน่วยสต๊อก" ซึ่งบางรายการ **ไม่ใช่เลขที่เขียนในชีต**
           * กระดาษทิชชู่: ชีตเขียน 799 ฿/ลัง แต่ตารางนับเป็นห่อ จึงขึ้น 33.29
           * ถ้าไม่บอกที่มา คนที่เปิดชีตเทียบจะคิดว่าระบบอ่านผิดแล้วเลิกเชื่อทั้งตาราง */
          render: (r) => {
            if (r.unitPrice === null)
              return `<span class="cell-missing">${esc(t('supply.noPrice'))}</span>`;
            const p = r.pack;
            if (p && p.sizeSource === 'note') {
              return (
                n(r.unitPrice, 2) +
                `<small class="cell-derived">${esc(
                  t('supply.priceFromPack')
                    .replace('{price}', n(p.price, 2))
                    .replace('{packUnit}', p.unit ?? '')
                    .replace('{size}', n(p.size))
                )}</small>`
              );
            }
            if (p && p.sizeSource === 'assumed') {
              /* มาร์กด้วย "สัญลักษณ์" ไม่ใช่สีอย่างเดียว — แคปหน้าจอขาวดำและตาบอดสี
               * ต้องยังเห็น (กฎเดียวกับตัวเลขติดลบใน §9 ของ CLAUDE.md) */
              return (
                n(r.unitPrice, 2) +
                `<span class="cell-assumed" title="${esc(
                  t('supply.priceUnitAssumedTip')
                    .replace('{packUnit}', p.unit ?? '')
                    .replace('{unit}', r.unit ?? '')
                )}">&nbsp;≈</span>`
              );
            }
            return n(r.unitPrice, 2);
          },
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
      ],
      items,
      {
        sortIndex: 4,
        sortDir: 'desc',
        rowKey: (r) => r.item,
        /* ยอดรวมมูลค่าสต๊อกท้ายตาราง
         *
         * **ต้องบอกด้วยว่ารวมมาจากกี่รายการ** เพราะรายการที่ยังไม่ใส่ราคาถูกข้ามไป
         * ถ้าโชว์แต่ตัวเลขเฉย ๆ คนจะอ่านว่านี่คือมูลค่าสต๊อกทั้งหมด ทั้งที่ยังขาดอยู่
         * ห้ามคิดรายการที่ไม่มีราคาเป็น 0 แล้วบวกรวมไปเงียบ ๆ */
        foot: (rows) => {
          const priced = rows.filter((r) => valueOf(r) !== null);
          const total = priced.reduce((s, r) => s + valueOf(r), 0);
          const missing = rows.length - priced.length;
          const cells = Array(5).fill('');
          cells[0] = `<b>${esc(t('supply.stockValueTotal'))}</b>`;
          cells[3] = missing
            ? `<span class="cell-missing">${esc(
                t('supply.stockValueMissing').replace('{n}', String(missing))
              )}</span>`
            : '';
          cells[4] = `<b>${n(total, 2)} ฿</b>`;
          return cells;
        },
      }
    )
  );

  wireSheetRows(body, sheet);
}

/**
 * แถบปุ่มดาวน์โหลด Excel เหนือตารางสต๊อก
 *
 * ส่งไปแค่ **ชื่อรายการที่กรองอยู่** กับวันที่ — ตัวเลขทุกช่องเซิร์ฟเวอร์เอาจากชีตเอง
 * (กฎเดียวกับใบขอซื้อ: ห้ามให้เบราว์เซอร์เป็นคนบอกราคา)
 *
 * ต้องผ่าน `fetch` แล้วแปลงเป็น blob ไม่ใช่ `<a href>` ธรรมดา เพราะเป็น POST
 * และเพราะต้องอ่าน `X-Skipped` เพื่อบอกผู้ใช้ว่ามีรายการตกหล่นไหม
 */
function stockExportBar(items, asOf) {
  const bar = document.createElement('div');
  bar.className = 'panel-actions';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--sm';
  btn.textContent = t('supply.exportXlsx');

  const hint = document.createElement('span');
  hint.className = 'panel-actions__hint';
  hint.textContent = t('supply.exportHint');

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = t('supply.exportBusy');
    hint.classList.remove('is-error');
    try {
      const res = await fetch('/api/supply/stock-export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: items.map((r) => r.item), asOf: asOf || '' }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || `${res.status}`);
      }
      const skipped = Number(res.headers.get('X-Skipped') ?? 0);
      const name =
        /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
        'kambis-stock.xlsx';
      const blob = await res.blob();

      /* ปล่อย object URL ทิ้งหลังกดแล้ว ไม่งั้นไฟล์ทั้งก้อนค้างในหน่วยความจำ
       * จนกว่าจะปิดแท็บ — กดดาวน์โหลดหลายรอบก็สะสมไปเรื่อย ๆ */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      hint.textContent = skipped
        ? `${t('supply.exportHint')} · ${t('supply.exportFailed')} ${skipped}`
        : t('supply.exportHint');
    } catch (err) {
      hint.textContent = `${t('supply.exportFailed')} — ${err.message}`;
      hint.classList.add('is-error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });

  bar.append(btn, hint);
  return bar;
}

/**
 * คิดยอดคงเหลือของทุกรายการใหม่ ณ วันที่ที่เลือก
 *
 * `asOf` ว่าง = ใช้ยอดที่ server คิดมาให้ตามเดิมทุกตัวอักษร ไม่แตะอะไรเลย
 * (สำคัญ: คนที่ไม่ได้เลือกวันต้องเห็นหน้าเดิมเป๊ะ ๆ)
 *
 * ทำได้ในเบราว์เซอร์เพราะ payload ส่ง `items[].log` มาให้อยู่แล้ว ทุกแถวมีทั้ง
 * คงเหลือและขั้นต่ำ — ใช้ `stockAt()` ตัวเดียวกับกฎที่ parser ใช้คิดยอดปัจจุบัน
 *
 * **ห้ามแก้ record เดิม** คัดลอกแบบตื้นแล้วทับเฉพาะช่องที่ขึ้นกับวันที่
 * เพราะ payload ถูกใช้ซ้ำทุกครั้งที่วาดใหม่
 */
function asOfItems(items, asOf) {
  if (!asOf) return items;
  return items.map((it) => {
    const at = stockAt(it.log ?? [], asOf);
    // ไม่มีแถวไหนก่อนวันนั้นเลย = ยังไม่มีข้อมูลของรายการนี้ ณ วันนั้น ต้องเป็น null ไม่ใช่ 0
    return {
      ...it,
      date: at?.date ?? null,
      balance: at?.balance ?? null,
      minimum: at?.minimum ?? null,
      index: at?.index ?? null,
    };
  });
}

/**
 * ทะเบียนใบขอซื้อที่เคยออก — กดเลขที่แล้วได้สำเนาเดิมกลับมา
 *
 * มีไว้เพื่อไม่ให้ "ทำไฟล์หาย" กลายเป็นการกดออกใบใหม่ ซึ่งได้เลขที่ใหม่
 * ที่ไม่ตรงกับใบที่ส่งไปให้เซ็นแล้ว และทำให้รายการนั้นติดสถานะรอของของใบใหม่แทน
 *
 * สถานะบอกได้แค่ "ยังมีรายการของใบนี้ค้างอยู่กี่รายการ" ตามที่ Log Sheet รู้
 * ขั้น "CEO อนุมัติ" ไม่ได้อยู่ในชีต จึงไม่มีสถานะนั้น (อย่าสร้างสถานะที่ไม่มีใครอัปเดต)
 */
function renderHistory(host, requests, needsReorder) {
  const body = panel(host, t('supply.prHistory'), t('supply.prHistoryNote'), { wide: true });
  if (!requests.length) {
    emptyNote(body, t('supply.prHistoryEmpty'));
    return;
  }

  const status = document.createElement('p');
  status.className = 'pr-status';
  status.setAttribute('role', 'status');

  // นับเฉพาะรายการที่ยังติดสถานะรอของ "ของใบนี้" จริง ๆ ไม่ใช่ทุกรายการในใบ
  const waitingOf = (docNo) => needsReorder.filter((r) => r.pending?.docNo === docNo).length;
  const formLabel = { general: t('supply.prFormGeneral'), nutrient: t('supply.prFormNutrient') };

  body.appendChild(
    sortableTable(
      [
        {
          label: t('supply.prDocNo'),
          get: (r) => r.docNo,
          render: (r) =>
            `<button type="button" class="link-btn" data-doc="${esc(r.docNo)}"
                     title="${esc(t('supply.prDownload'))}">${esc(r.docNo)}</button>`,
        },
        { label: t('supply.date'), get: (r) => r.createdAt ?? '', render: (r) => esc(fmtDate(String(r.createdAt ?? '').slice(0, 10))) },
        { label: t('supply.prForm'), get: (r) => formLabel[r.form] ?? r.form },
        {
          label: t('supply.prItemCount'),
          align: 'n',
          get: (r) => r.items?.length ?? 0,
          render: (r) => n(r.items?.length ?? 0),
        },
        {
          label: t('supply.amount'),
          align: 'n',
          get: (r) => r.totalAmount,
          render: (r) => (r.totalAmount === null ? `<span class="muted">${DASH}</span>` : n(r.totalAmount, 2)),
        },
        {
          label: t('supply.prState'),
          get: (r) => waitingOf(r.docNo),
          render: (r) => {
            const w = waitingOf(r.docNo);
            return w
              ? `<span class="quality-chip" data-level="warn">${esc(t('supply.prStateWaiting').replace('{n}', String(w)))}</span>`
              : `<span class="muted">${esc(t('supply.prStateDone'))}</span>`;
          },
        },
      ],
      requests,
      { sortIndex: 1, sortDir: 'desc' }
    )
  );

  body.appendChild(status);
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-doc]');
    if (!btn) return;
    downloadRequest(btn.dataset.doc, (msg) => {
      status.textContent = msg;
    });
  });
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

/**
 * ตารางของที่ต้องสั่งซื้อ พร้อมช่องเลือกและปุ่มออกเอกสาร
 *
 * **แผงนี้ยึด "วันนี้" เสมอ ไม่เดินตามช่องดูสต๊อกย้อนหลัง** เพราะออกใบขอซื้อ
 * ย้อนหลังไม่ได้ ถ้าปล่อยให้เดินตามวันที่ที่เลือก คนจะกดขอซื้อจากยอดขาดของเมื่อเดือนที่แล้ว
 * ซึ่งของอาจเข้ามาแล้ว — และสถานะ "รอของ" ก็เป็นเรื่องของตอนนี้เช่นกัน
 */
function renderReorder(host, reorder, kpi, requestSupply, asOf = '', opts = {}) {
  const {
    /* กลุ่ม "ไม่บังคับ" ใช้โครงตารางเดียวกันทุกอย่าง ต่างแค่ข้อความกับค่าเริ่มต้น
     * ของช่องติ๊ก — แยกเป็นฟังก์ชันที่สองจะกลายเป็นโค้ดสองชุดที่ต้องแก้คู่กัน */
    title = t('supply.reorderTitle'),
    note = t('supply.reorderNote'),
    emptyText = t('supply.nothingToReorder'),
    intro = '',
    // ติ๊กไว้ให้ล่วงหน้าไหม — กลุ่มไม่บังคับต้องเป็นการตัดสินใจของคน ไม่ใช่ค่าเริ่มต้น
    defaultOn = true,
    // ว่างแล้วซ่อนทั้งแผงไปเลย ไม่ต้องขึ้นกล่องเปล่า
    hideWhenEmpty = false,
    idPrefix = 'pr',
    /* ลิงก์ไปแท็บของรายการในชีต — ตารางนี้ให้กด **เฉพาะชื่อรายการ** ไม่ใช่ทั้งแถว
     * ต่างจากตารางการเบิกกับตารางสต๊อก เพราะแถวนี้มีช่องติ๊กกับช่องจำนวนอยู่ด้วย
     * ถ้าทั้งแถวกดได้ การติ๊กเลือกหรือแก้จำนวนจะเด้งออกไปเปิดชีตแทน */
    sheet = {},
  } = opts;

  if (hideWhenEmpty && !reorder.length) return;

  const body = panel(host, title, note, { wide: true });
  // ป้ายกำกับให้ตัวตรวจอัตโนมัติเล็งถูกแผง — สองแผงนี้หน้าตาเหมือนกันจนแยกด้วย CSS ไม่ได้
  body.parentElement?.classList.add(`panel--${idPrefix}`);

  // ดูย้อนหลังอยู่ ต้องบอกว่าแผงนี้ไม่ได้เดินตามวันที่ที่เลือก
  if (asOf) {
    const warn = document.createElement('p');
    warn.className = 'supply-warn';
    warn.textContent = t('supply.reorderAlwaysNow').replace('{date}', fmtDateFull(asOf));
    body.appendChild(warn);
  }

  if (intro) {
    const p = document.createElement('p');
    p.className = 'panel-intro';
    p.textContent = intro;
    body.appendChild(p);
  }

  if (!reorder.length) {
    emptyNote(body, emptyText);
    return;
  }

  /* เริ่มต้นติ๊กเฉพาะรายการที่ **ยังไม่ได้ขอซื้อ**
   *
   * ของที่ขอไปแล้วยังต่ำกว่าขั้นต่ำอยู่จนกว่าของจะมาถึง มันจึงยังอยู่ในตารางนี้
   * ถ้าติ๊กไว้ให้เหมือนเดิม ฝ่ายจัดซื้อที่กดขอเมื่อวานจะขอซ้ำโดยไม่รู้ตัว
   * — ยังติ๊กเองได้ถ้าตั้งใจจะขอเพิ่ม แต่ต้องเป็นการตัดสินใจ ไม่ใช่ค่าเริ่มต้น */
  const picked = new Map(
    reorder.map((r) => [r.item, { on: defaultOn && !r.pending, qty: r.suggestedQty }])
  );
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
            <input type="checkbox" id="${idPrefix}-all"${
              defaultOn && !waiting.length ? ' checked' : ''
            } aria-label="${esc(t('supply.selectAll'))}">
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
          <th scope="col" style="text-align:right">${esc(t('supply.purchaseUnitPrice'))}</th>
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
    /* แท็กเป็นปุ่ม ไม่ใช่ป้ายเฉย ๆ — กดแล้วได้สำเนาใบเดิมกลับมาทันที
     * เป็นทางที่ผู้ใช้จะไปถึงบ่อยที่สุดเวลาทำไฟล์หาย เพราะเห็นเลขที่ตรงหน้าอยู่แล้ว */
    return `<button type="button" class="quality-chip link-btn" data-level="${level}"
              data-doc="${esc(p.docNo)}" title="${esc(tip)} · ${esc(t('supply.prDownload'))}"
            >${esc(p.docNo)}${esc(days)}</button>`;
  };

  const tbody = table.querySelector('tbody');
  for (const r of reorder) {
    const tr = document.createElement('tr');
    tr.dataset.item = r.item;
    tr.innerHTML = `
      <td class="col-check"><input type="checkbox"${
        picked.get(r.item).on ? ' checked' : ''
      } data-role="pick" aria-label="${esc(r.item)}"></td>
      <td>${esc(fmtDate(r.date))}</td>
      <td>${itemCell(sheet)(r)}</td>
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
        ${
          /* หน่วยซื้อต่างจากหน่วยนับได้ (นับเป็นห่อ แต่ซื้อเป็นลัง) — ต้องบอกทั้งสองอย่าง
           * ไม่งั้นคนกรอก 24 เพราะคิดว่าเป็นห่อ แล้วได้ของมา 24 ลัง */
          r.purchasePackSize > 1
            ? `<small class="cell-derived" data-role="equiv">${esc(
                r.purchaseUnit ?? ''
              )} ${esc(
                t('supply.packEquiv')
                  .replace('{qty}', n(r.orderStockQty))
                  .replace('{unit}', r.unit ?? '')
              )}</small>`
            : ''
        }
      </td>
      <td style="text-align:right" class="num">${
        r.purchaseUnitPrice === null || r.purchaseUnitPrice === undefined
          ? `<span class="muted" title="${esc(t('supply.noPriceTip'))}">${DASH}</span>`
          : n(r.purchaseUnitPrice, 2) +
            (r.purchasePackSize > 1
              ? `<small class="cell-derived">${esc(
                  t('supply.perStockUnit')
                    .replace('{price}', n(r.unitPrice, 2))
                    .replace('{unit}', r.unit ?? '')
                )}</small>`
              : '')
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

  /* เก็บทั้งชุดไม่ใช่แค่ราคา เพราะยอดต้องคิดจาก "จำนวนหน่วยซื้อ × ราคาต่อหน่วยซื้อ"
   * ให้ตรงกับที่เขียนในใบขอซื้อและกับที่ server คิดใหม่ */
  const packOf = new Map(
    reorder.map((r) => [
      r.item,
      {
        price: r.purchaseUnitPrice ?? null,
        size: r.purchasePackSize || 1,
        unit: r.unit ?? '',
        purchaseUnit: r.purchaseUnit ?? '',
      },
    ])
  );

  const refresh = () => {
    let count = 0;
    let total = 0;
    let unpriced = 0;
    for (const [item, state] of picked) {
      if (!state.on) continue;
      count++;
      const price = packOf.get(item)?.price;
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

  /* แท็กใบขอซื้อในตาราง กดแล้วโหลดสำเนาเดิม
   * stopPropagation เพราะปุ่มอยู่ในแถวที่มีช่องติ๊กและช่องจำนวน — การกดโหลดเอกสาร
   * ต้องไม่ไปเปลี่ยนสิ่งที่เลือกไว้ (กฎเดียวกับ <select> บนการ์ด) */
  tbody.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-doc]');
    if (!chip) return;
    e.stopPropagation();
    e.preventDefault();
    downloadRequest(chip.dataset.doc, (msg) => {
      status.textContent = msg;
    });
  });

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
      const meta = packOf.get(tr.dataset.item);
      const cell = tr.querySelector('[data-role="amount"]');
      cell.innerHTML =
        meta?.price === null || meta?.price === undefined
          ? `<span class="muted">${DASH}</span>`
          : n(meta.price * state.qty, 2);
      // อัปเดตบรรทัด "= N หน่วยสต๊อก" ให้เดินตามจำนวนที่เพิ่งพิมพ์
      const equiv = tr.querySelector('[data-role="equiv"]');
      if (equiv && meta) {
        equiv.textContent =
          `${meta.purchaseUnit} ` +
          t('supply.packEquiv')
            .replace('{qty}', n(state.qty * meta.size))
            .replace('{unit}', meta.unit);
      }
    }
    refresh();
  });

  table.querySelector(`#${idPrefix}-all`).addEventListener('change', (e) => {
    const on = e.target.checked;
    for (const state of picked.values()) state.on = on;
    for (const cb of tbody.querySelectorAll('[data-role="pick"]')) cb.checked = on;
    refresh();
  });

  button.addEventListener('click', async () => {
    const items = [...picked.entries()]
      .filter(([, s]) => s.on)
      // ส่งเป็น **หน่วยซื้อ** (packs) — server แปลงกลับเป็นหน่วยสต๊อกด้วยขนาดแพ็คจากชีตเอง
      // ห้ามส่ง qty คู่มาด้วย server จะปฏิเสธ เพราะบอกไม่ได้ว่าเลขนั้นเป็นหน่วยไหน
      .map(([item, s]) => ({ item, packs: s.qty }));
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

      for (const doc of docs) {
        const bytes = Uint8Array.from(atob(doc.base64), (c) => c.charCodeAt(0));
        downloadBlob(new Blob([bytes], { type: XLSX_MIME }), doc.fileName ?? `${doc.docNo}.xlsx`);
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
