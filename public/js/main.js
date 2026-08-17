/**
 * main.js — จุดเริ่มต้นของ Dashboard
 *
 * ลำดับการทำงาน:
 *   1. เริ่มฉากหลัง Three.js (ถ้าใช้ได้)
 *   2. เปิด SSE รับความคืบหน้า → ขับ loading screen
 *   3. ดึงข้อมูลจาก /api/reports (server รัน Data Analysis ให้แล้ว)
 *   4. วาด KPI + การ์ด 8 ใบ
 */
import { initLang, getLang, setLang, onLangChange, t } from './i18n.js';
import { dateTime, ago, n, esc } from './format.js';
import { fetchReports, fetchReport, subscribeProgress } from './api.js';
import { initBackground, refreshBackground } from './bg/three-bg.js';
import { initTheme, getTheme, toggleTheme, onThemeChange } from './theme.js';
import { LoadingScreen } from './ui/loader.js';
import { qualityLevel, runDeferred } from './ui/cards.js';
import { initModal, openCard, close as closeModal } from './ui/modal.js';
import { initChat, resetChat } from './ui/chat.js';
import { initRouter, onRoute, currentRoute, replaceParams } from './router.js';
import { renderNav } from './ui/nav.js';
import { collectNotices } from './ui/notices.js';
import { getPage } from './pages/index.js';
import { buildStrainScale } from './pages/production.js';
import {
  readFilters,
  writeFilters,
  resolveFilters,
  filterSources,
  filterOptions,
  filterBar,
  closeFilterPopup,
  isFiltered,
} from './ui/filters.js';
import { closePopover } from './ui/popover.js';
import { buildKpi } from './shared/kpi.js';
import { releaseCharts } from './charts/core.js';

const el = {
  loader: document.getElementById('loader'),
  page: document.getElementById('page-host'),
  filters: document.getElementById('filter-host'),
  refresh: document.getElementById('btn-refresh'),
  lang: document.getElementById('lang-toggle'),
  theme: document.getElementById('theme-toggle'),
  health: document.getElementById('health-badge'),
  updated: document.getElementById('updated-at'),
  notice: document.getElementById('notice'),
  footerMeta: document.getElementById('footer-meta'),
  canvas: document.getElementById('three-canvas'),
  logout: document.getElementById('btn-logout'),
  userName: document.getElementById('user-name'),
};

let payload = null;
let loading = false;
let unsubscribe = null;
const screen = new LoadingScreen(el.loader);

/* ข้อมูลวัสดุสิ้นเปลืองโหลดแยกจาก payload หลัก เพราะมี 139 แท็บ
 * ถ้าโหลดพร้อมกัน หน้า Dryflower จะช้าขึ้นเกือบเท่าตัวทั้งที่ไม่ได้ใช้ข้อมูลนี้ */
let supply = null;
let supplyError = null;
let supplyLoading = false;
/** กดรีเฟรชมาระหว่างที่รอบเบื้องหลังยังไม่จบ — ต้องดึงซ้ำให้หลังจบรอบนี้ */
let supplyPendingForce = false;

/* ตัวจับสายพันธุ์ → ช่องสี สร้างจากข้อมูล "ทั้งชุด" ครั้งเดียว
 * ห้ามสร้างใหม่จากข้อมูลที่ผ่านตัวกรองแล้ว ไม่งั้นเปลี่ยนตัวกรองทีสีจะสลับกันทั้งกราฟ
 * (สีต้องผูกกับตัวสายพันธุ์ ไม่ใช่กับอันดับของมันในชุดที่กำลังดู) */
let strainScale = null;

/* ค่าที่เลือกได้ในตัวกรอง (สายพันธุ์ / ครอป / ปี / ช่วงวันที่)
 *
 * ต้องคิดจากข้อมูล **ทั้งชุด** ครั้งเดียวต่อการโหลดหนึ่งรอบ ด้วยเหตุผลเดียวกับ strainScale
 * ถ้าคิดใหม่จากข้อมูลที่กรองแล้ว พอเลือกปี 2026 รายการปีอื่นจะหายจากช่องเลือกทันที
 * แล้วผู้ใช้จะกลับไปปีเก่าไม่ได้อีกเลย */
let filterChoices = { strains: [], crops: [], years: [], minDate: null, maxDate: null };

/* KPI ของสิ่งที่กำลังดูอยู่ — คิดใหม่จากแถวที่กรองแล้ว ไม่ใช่ก้อนที่ server รวมมาจากทั้งชีต
 *
 * buildKpi() ถูกเรียกซ้ำทุกครั้งที่วาดหน้า (เปลี่ยนตัวกรอง · สลับหน้า · สลับธีม/ภาษา ·
 * ชีตวัสดุโหลดเสร็จ) ทั้งที่ผลลัพธ์ขึ้นกับ payload กับตัวกรองเท่านั้น จึงจำคำตอบล่าสุดไว้
 *
 * key ใช้ route.params ดิบ ๆ ไม่ใช่ตัว filters ที่ serialize แล้ว เพราะ filters มี Set
 * ซึ่งลำดับไม่แน่นอน — และ filters ก็ derive มาจาก route.params กับ filterChoices.years
 * ล้วน ๆ โดยมี resolvedYear เป็นที่เดียวที่ตัวหลังโผล่ */
let kpiMemo = { key: null, value: null };

function viewKpi(sources, route, filters) {
  const key = `${payload.meta.fetchedAt}|${route.params}|${filters.resolvedYear ?? ''}`;
  if (kpiMemo.key !== key) {
    kpiMemo = {
      key,
      value: buildKpi(sources, payload.analysis, { year: filters.resolvedYear }),
    };
  }
  return kpiMemo.value;
}

/** ─── header ─── */
function renderHeader() {
  if (!payload) return;
  const { analysis, meta } = payload;

  const level = qualityLevel(analysis.counts);
  el.health.dataset.level = level;
  el.health.innerHTML = `<span class="health-badge__dot" aria-hidden="true"></span>${t(
    'quality.score'
  )} ${analysis.score}/100`;
  el.health.title = `${analysis.counts.critical} ${t('quality.critical')} · ${
    analysis.counts.warning
  } ${t('quality.warning')} · ${analysis.counts.info} ${t('quality.info')}`;

  el.updated.textContent = `${t('meta.updated')} ${ago(meta.fetchedAt)}`;
  el.updated.title = dateTime(meta.fetchedAt);

  /* แถบแจ้งเตือน — ประกอบจาก **ทั้งสอง payload**
   *
   * ชีตวัสดุโหลดแยกจึงมี meta คนละก้อน ถ้าอ่านแต่ก้อนหลัก คำเตือนของชีตนั้น
   * (แท็บใหม่ / ค้นแท็บไม่สำเร็จ / เสิร์ฟชุดสำรอง) จะไม่มีวันขึ้นจอเลย
   * Set กันข้อความซ้ำ เพราะบางอย่างเช่น notice.stale โผล่ได้จากทั้งสองก้อน */
  const messages = [
    ...new Set([...collectNotices(meta), ...collectNotices(supply?.meta, { scope: 'supply' })]),
  ];

  if (messages.length) {
    el.notice.hidden = false;
    el.notice.innerHTML = `<span aria-hidden="true">⚠</span><span>${messages
      .map(esc)
      .join(' · ')}</span>`;
  } else {
    el.notice.hidden = true;
  }

  const totalTabs = meta.sources.reduce((sum, s) => sum + s.tabCount, 0);
  const totalRows = meta.sources.reduce((sum, s) => sum + s.rowCount, 0);
  el.footerMeta.textContent = `${meta.sources.length} ${t('label.records')} · ${n(totalTabs)} ${t(
    'meta.tabs'
  )} · ${n(totalRows)} ${t('meta.rows')}`;
}

/**
 * ─── โหลดข้อมูลวัสดุสิ้นเปลือง ───
 *
 * ชีตนี้มี 139 แท็บ ใช้เวลาราว 8 วินาที จึงไม่รวมอยู่ใน /api/reports
 * แต่ผู้ใช้ไม่ควรต้องมานั่งรอตอนกดเข้าหน้า Supply — จึง **ดึงต่อในเบื้องหลัง**
 * ทันทีที่ Dashboard หลักวาดเสร็จ (ดู load()) และดึงใหม่ทุกครั้งที่กดรีเฟรช
 *
 * ที่ไม่เอาไปรวมใน /api/reports เลยเพราะจะทำให้หน้าแรกช้าขึ้นเกือบเท่าตัว
 * ทั้งที่ข้อมูลชุดนี้ไม่ได้ใช้บนหน้า Dryflower — โหลดทีหลังแบบเงียบ ๆ ได้ผลเดียวกัน
 * โดยที่ผู้ใช้ไม่ต้องรอ
 *
 * @param {{force?:boolean, quiet?:boolean}} [opts]
 *   quiet — ไม่ต้องวาดหน้าใหม่ถ้าหน้าที่เปิดอยู่ไม่ได้ใช้ข้อมูลชุดนี้
 */
async function requestSupply({ force = false, quiet = false } = {}) {
  /* กดรีเฟรชระหว่างที่รอบเบื้องหลังยังไม่จบ — ต้องจำคำสั่งไว้ทำต่อ ไม่ใช่ทิ้งเงียบ
   * ไม่งั้นผู้ใช้กดปุ่มแล้วได้ข้อมูลเก่ากลับมาโดยไม่มีอะไรบอก */
  if (supplyLoading) {
    if (force) supplyPendingForce = true;
    return;
  }
  if (supply && !force) return;
  supplyLoading = true;
  supplyError = null;
  try {
    supply = await fetchReport('supplyLog', { refresh: force });
  } catch (err) {
    supplyError = err.message;
    console.error('[supply] โหลดข้อมูลวัสดุไม่สำเร็จ:', err);
  } finally {
    supplyLoading = false;

    /* แถบแจ้งเตือนเป็นของระดับเว็บ ไม่ใช่ของหน้าใดหน้าหนึ่ง — ต้องอัปเดตเสมอ
     * ไม่งั้นคนที่อยู่หน้าการผลิตตอนชีตวัสดุโหลดเสร็จจะไม่เห็นคำเตือนของชีตนั้นเลย
     * (ไม่กระตุกจอเพราะไม่ได้รื้อ DOM ของหน้า) */
    renderHeader();

    /* วาดใหม่เพื่อให้ตัวเลขที่เพิ่งได้ขึ้นจอ (หน้า Supply, หน้าต้นทุน และช่อง
     * "ต้นทุนวัสดุ" บนหน้าภาพรวม) — โหลดเบื้องหลังที่ล้มเหลวก็ต้องวาด
     * เพื่อให้ปุ่มลองใหม่ขึ้น แต่ถ้าหน้าที่เปิดอยู่ไม่เกี่ยวกับข้อมูลชุดนี้เลย
     * ก็ไม่ต้องกระตุกหน้าจอที่ผู้ใช้กำลังอ่านอยู่ */
    if (!quiet || usesSupply(currentRoute())) render();

    if (supplyPendingForce) {
      supplyPendingForce = false;
      requestSupply({ force: true, quiet });
    }
  }
}

/** หน้านี้ใช้ข้อมูลวัสดุสิ้นเปลืองไหม
 *
 * เหลือแค่รายงาน Supply แล้ว — หน้าภาพรวม (ช่อง "ต้นทุนวัสดุสิ้นเปลือง") และ
 * หน้าต้นทุน (แผง "มูลค่าวัสดุตามตารางสั่งซื้อ") ถูกเอาออกตามคำสั่งผู้ใช้
 *
 * ถ้ายังนับหน้าที่ไม่ได้ใช้ข้อมูลชุดนี้อยู่ หน้านั้นจะถูกวาดใหม่ทุกครั้งที่ชีตวัสดุ
 * โหลดเสร็จโดยไม่มีอะไรบนจอเปลี่ยน ซึ่งเป็นอาการที่ quiet: true มีไว้กันพอดี
 * เพิ่มช่องที่ใช้ข้อมูล Supply กลับเข้าหน้าไหน ต้องเติมหน้านั้นกลับเข้ามาที่นี่ด้วย */
function usesSupply(route) {
  return route.report === 'supply';
}

/** ─── วาดทั้งหน้า ─── */
function render() {
  if (!payload) return;
  renderHeader();

  const route = currentRoute();
  renderNav(route);
  renderFilters(route);
  renderActivePage(route);
}

/* สถานะที่แถบตัวกรองกำลังแสดงอยู่ ใช้ตัดสินว่าจะสร้างแถบใหม่ไหม
 *
 * ถ้าสร้างใหม่ทุกครั้งที่ค่าเปลี่ยน โฟกัสจะหลุดจากช่องที่ผู้ใช้กำลังเลือกอยู่ทันที
 * และ popup ตัวกรองจะปิดเองทุกครั้งที่ติ๊ก — จึงสร้างใหม่เฉพาะตอนที่ URL
 * ถูกเปลี่ยนจากทางอื่น (กดย้อนกลับ, เปิดลิงก์ที่มีตัวกรองติดมา) หรือสลับภาษา
 *
 * เมื่อไม่ต้องสร้างใหม่ จะสั่งให้แถบซิงก์ตัวเองผ่าน `__sync()` แทน
 * ซึ่งอัปเดตแค่ชิปสรุปกับปุ่มล้าง ไม่แตะ popup ที่ผู้ใช้กำลังเลือกอยู่ */
let filterBarParams = null;
let filterBarReport = null;

/** แถบตัวกรองกลาง — เฉพาะรายงาน Dryflower (Supply ใช้คนละมิติทั้งหมด) */
function renderFilters(route) {
  if (route.report !== 'dryflower') {
    /* popup แขวนอยู่ที่ body การล้าง #filter-host จึงไม่พามันไปด้วย ต้องสั่งปิดเอง
     * ล้างกล่องก่อนแล้วค่อยปิด เพื่อให้ popup รู้ว่าปุ่มเดิมหลุด DOM ไปแล้ว
     * จะได้ไม่ไปคืน focus ให้ปุ่มที่กำลังจะหายไป */
    el.filters.hidden = true;
    el.filters.innerHTML = '';
    closeFilterPopup();
    filterBarParams = null;
    filterBarReport = null;
    return;
  }
  el.filters.hidden = false;

  // ป้ายบนแถบเป็นข้อความแปล — สลับภาษาต้องสร้างใหม่ ไม่งั้นค้างภาษาเดิม
  const barKey = `${route.report}|${getLang()}`;
  const paramsText = String(route.params);
  const inSync = filterBarReport === barKey && filterBarParams === paramsText;
  const current = el.filters.firstElementChild;
  if (inSync && current) {
    current.__sync?.(readFilters(route.params));
    return;
  }

  el.filters.innerHTML = '';
  filterBarReport = barKey;
  filterBarParams = paramsText;

  el.filters.appendChild(
    filterBar({
      filters: readFilters(route.params),
      options: filterChoices,
      onChange: (next) => {
        const params = writeFilters(next);
        // จำไว้ก่อนว่าแถบสะท้อนค่าใหม่แล้ว จะได้ไม่ถูกสร้างใหม่จนโฟกัสหลุด
        filterBarParams = String(params);
        // เก็บลง hash ด้วย replaceState — ไม่ให้ทุกครั้งที่ขยับตัวกรองไปรกในประวัติ
        replaceParams(params);
      },
    })
  );
}

/**
 * แก้ค่าใน hash ของหน้าปัจจุบัน — ให้หน้าที่มีตัวเลือกของตัวเอง (เช่นปีบนหน้า Supply)
 * เก็บสถานะไว้ใน URL ได้เหมือนแถบตัวกรองกลาง จึงส่งลิงก์ต่อและกดรีเฟรชแล้วยังอยู่ที่เดิม
 *
 * ค่าว่างคือ "เอาออก" ไม่ใช่ "ตั้งเป็นค่าว่าง" — URL จะได้ไม่รกด้วยพารามิเตอร์เปล่า
 */
function setParams(patch, { silent = false } = {}) {
  const params = new URLSearchParams(currentRoute().params);
  for (const [key, value] of Object.entries(patch)) {
    if (value === '' || value === null || value === undefined) params.delete(key);
    else params.set(key, String(value));
  }
  replaceParams(params, { silent });
}

/**
 * วาดหน้าปัจจุบัน — ลำดับห้าขั้นนี้ห้ามสลับ
 *
 *   1. releaseCharts ก่อนทิ้ง DOM  ไม่งั้น ResizeObserver กับ canvas รั่วทุกครั้งที่สลับหน้า
 *   2. ล้างกล่อง
 *   3. สร้าง DOM ของหน้า (ยังลอยอยู่นอกหน้าจอ)
 *   4. ใส่ลงหน้า  ← ตรงนี้เท่านั้นที่เริ่มวัดความกว้างได้
 *   5. ค่อยวาดกราฟ
 *
 * เหตุผลของขั้น 4→5: setupCanvas() คืน null เมื่อกล่องกว้าง 0 แล้วกราฟจะ bail เงียบ ๆ
 * และ onResize ข้าม width === 0 จึงไม่มีวันแก้ตัวเองตอนแสดงผลทีหลัง
 * ด้วยเหตุผลเดียวกัน จึง **ห้ามเก็บทุกหน้าไว้ใน DOM แล้วสลับด้วย hidden**
 */
function renderActivePage(route) {
  /* ปฏิทินแขวนอยู่ที่ body เหมือน popup ตัวกรอง การล้าง el.page จึงไม่พามันไปด้วย
   * ถ้าไม่ปิดเอง จะได้ปฏิทินลอยค้างอยู่เหนือหน้าถัดไปโดยที่ปุ่มเปิดมันหายไปแล้ว
   * (ปิดไม่ได้ ไม่มีอะไรคืนโฟกัสให้ และ listener resize/scroll ยังทำงานอยู่) */
  closePopover();
  releaseCharts(el.page);
  el.page.innerHTML = '';

  const host = document.createElement('div');
  host.className = 'page';
  const drawLater = [];

  /* ปีที่ยังไม่ได้เลือกเองจะกลายเป็นปีล่าสุดที่มีข้อมูลตรงนี้
   * ต้อง resolve จาก filterChoices ซึ่งมาจากข้อมูลทั้งชุด ไม่ใช่จากข้อมูลที่กรองแล้ว */
  const filters = resolveFilters(readFilters(route.params), filterChoices);
  const dry = route.report === 'dryflower';
  const sources = dry ? filterSources(payload.sources, filters) : payload.sources;

  /* ── payload ที่ทุกหน้า ทุกการ์ด และทุก modal เห็น ──
   *
   * `kpi` ต้องคิดใหม่จาก rows ที่กรองแล้ว ไม่ใช่ก้อนที่ server รวมมาจากทั้งชีต
   * (shared/kpi.js ถูกวางไว้ใน public/ ตั้งแต่แรกเพื่อการนี้ — ดูหัวไฟล์)
   *
   * เดิม renderCards() destructure แค่ { kpi, analysis, meta } แล้วไม่เคยอ่าน sources เลย
   * การ์ดทุกใบจึงเป็นยอดตลอดกาลนั่งอยู่ใต้กราฟที่กรองปีแล้ว — ช่อง "ผลผลิตดอกแห้ง 2026"
   * ขึ้น 673 kg ส่วนการ์ดใบล่างขึ้น 1,530 kg ในหน้าจอเดียวกัน
   *
   * **ทำที่นี่ที่เดียว** แล้วส่ง view แทน payload ให้ทุกหน้า ถ้าปล่อยให้แต่ละหน้าคิดเอง
   * จะมีหน้าที่ลืม แล้วการ์ดใบเดียวกันจะได้เลขคนละชุดในแต่ละหน้า
   *
   * `analysis` กับ `meta` ส่งของเดิมไปตรง ๆ — คุณภาพข้อมูลเป็นเรื่องของ "ทั้งชีต"
   * ไม่ใช่ของสิ่งที่กรองไว้ (กฎเดียวกับการ์ดคุณภาพข้อมูลบนหน้า Supply) */
  const view = dry ? { ...payload, sources, kpi: viewKpi(sources, route, filters) } : payload;

  const page = getPage(route.report, route.page);
  try {
    page.render({
      host,
      payload: view,
      sources,
      filters,
      // พารามิเตอร์ดิบใน hash — หน้าที่มีตัวกรองของตัวเอง (Supply) อ่านเอง
      params: route.params,
      // รายงานที่มีหลายหน้าย่อยแต่ใช้ไฟล์เดียว (Supply) ต้องรู้ว่าตอนนี้อยู่หน้าไหน
      route,
      filtered: isFiltered(filters),
      years: filterChoices.years,
      strainScale,
      supply,
      supplyError,
      requestSupply,
      drawLater,
      setParams,
      /* หน้าที่มี payload ของตัวเอง (เช่น Supply ที่โหลดแยก) ส่ง payload มาแทนได้
       * ไม่งั้น modal คุณภาพข้อมูลของ Supply จะไปแสดงผลวิเคราะห์ของรายงาน Dryflower */
      onOpen: (key, trigger, override) => openCard(key, override ?? view, trigger),
    });
  } catch (err) {
    // หน้าหนึ่งพังต้องไม่ทำให้ทั้ง Dashboard ขาว
    console.error('[page] วาดหน้าไม่สำเร็จ:', err);
    host.innerHTML = `<p class="empty-note">${esc(t('page.renderFailed'))}</p>`;
  }

  el.page.appendChild(host);
  runDeferred(drawLater);
}

/** ─── โหลดข้อมูล (ทุกครั้งที่โหลด server จะรัน Data Analysis ให้) ─── */
async function load({ refresh = false } = {}) {
  if (loading) return;
  loading = true;
  el.refresh.classList.add('is-busy');
  el.refresh.disabled = true;
  closeModal();
  closeFilterPopup();
  closePopover();

  /* กดรีเฟรชระหว่างคูลดาวน์ = รู้ล่วงหน้าว่าจะได้ชุดเดิมกลับมาในพริบตา
   * ถ้าเปิดจอโหลดเต็มจอแล้วปิดใน 80 มิลลิวินาที จะดูเหมือนบั๊กมากกว่าไม่ทำอะไร
   * สปินเนอร์บนปุ่มยังหมุนตามปกติ และแถบเตือนจะบอกว่าทำไม (ดู collectNotices)
   *
   * ตัดสินจากข้อมูลที่มีอยู่แล้วในเครื่อง ไม่ต้องยิงถามเซิร์ฟเวอร์เพิ่ม */
  const cooldownMs = payload?.meta?.refresh?.cooldownMs ?? 0;
  const withinCooldown =
    refresh && payload && Date.now() - new Date(payload.meta.fetchedAt).getTime() < cooldownMs;

  if (!withinCooldown) {
    screen.reset(payload?.meta?.sources ?? null);
    screen.show();
    screen.startFallback();

    // SSE จะส่ง event ทันทีที่ server เริ่มดึง — ต้องต่อก่อนเรียก fetch
    unsubscribe?.();
    unsubscribe = subscribeProgress((event) => screen.handle(event));
  }

  try {
    const prevFetchedAt = payload?.meta?.fetchedAt ?? null;
    payload = await fetchReports({ refresh });

    /* ได้ชุดเดิมกลับมา (คูลดาวน์ยังไม่หมด หรือแคชยังสด) — ไม่มีอะไรเปลี่ยนจริง
     * จึงไม่ต้องล้างข้อมูลวัสดุและไม่ต้องรีเซ็ตบทสนทนาของผู้ช่วย AI */
    const changed = payload.meta.fetchedAt !== prevFetchedAt;

    // สร้างตัวจับสายพันธุ์→สีจากข้อมูลทั้งชุดครั้งเดียวต่อการโหลดหนึ่งรอบ
    strainScale = buildStrainScale(payload.sources);
    filterChoices = filterOptions(payload.sources);
    // รายชื่อสายพันธุ์/ครอปที่เลือกได้มาจากข้อมูลชุดใหม่ — บังคับสร้างแถบตัวกรองใหม่
    filterBarReport = null;
    if (refresh && changed) supply = null; // ข้อมูลวัสดุก็ต้องดึงใหม่ด้วยถ้าผู้ใช้กดรีเฟรช
    render();
    // ข้อมูลเปลี่ยนแล้ว บทสนทนาเดิมอ้างตัวเลขเก่า จึงต้องเริ่มใหม่
    if (refresh && changed) resetChat();
    screen.hide();

    /* ── ดึงข้อมูลวัสดุต่อในเบื้องหลัง ──
     *
     * "รีเฟรชข้อมูล" ต้องหมายถึงรีเฟรชทุกรายงาน ไม่ใช่เฉพาะรายงานดอก
     * ไม่งั้นผู้ใช้ที่กดรีเฟรชแล้วเข้าหน้า Supply ยังต้องรอโหลดอีกรอบอยู่ดี
     *
     * ไม่ await โดยตั้งใจ — Dashboard หลักวาดเสร็จแล้วและ loading screen ปิดไปแล้ว
     * ถ้ารอตรงนี้ ผู้ใช้จะเห็นหน้าจอโหลดนานขึ้นอีก 8 วินาทีทั้งที่ข้อมูลที่รออยู่
     * ไม่ได้ใช้บนหน้าที่กำลังเปิด */
    requestSupply({ force: refresh, quiet: true });
  } catch (err) {
    // หน้าจอโหลดโชว์ได้แค่ข้อความ — ทิ้ง stack ไว้ใน console ให้ตามหาต้นตอได้
    console.error('[load] วาดหน้าไม่สำเร็จ:', err);
    screen.fail(err.message, () => load({ refresh: true }));
  } finally {
    loading = false;
    el.refresh.classList.remove('is-busy');
    el.refresh.disabled = false;
    unsubscribe?.();
    unsubscribe = null;
  }
}

/** ─── ข้อความคงที่ที่ต้องเปลี่ยนตามภาษา ─── */
function applyStaticText() {
  document.title = `Kambis · ${t('app.title')}`;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  }
  el.lang.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang()));
  });

  // ปุ่มธีมบอกว่า "จะสลับไปโหมดอะไร" ไม่ใช่โหมดปัจจุบัน
  const dark = getTheme() === 'dark';
  el.theme.setAttribute('aria-pressed', String(dark));
  el.theme.title = dark ? t('action.themeLight') : t('action.themeDark');
}

/** ─── แสดงว่าใครล็อกอินอยู่ + ปุ่มออกจากระบบ ─── */
async function initAuthChrome() {
  let status;
  try {
    status = await fetch('/api/auth/status').then((r) => r.json());
  } catch {
    return; // ถามไม่ได้ก็ไม่ต้องแสดงอะไร ไม่ใช่ของจำเป็น
  }
  if (!status.enabled || !status.user) return;

  el.userName.textContent = status.user.name;
  el.logout.hidden = false;
  el.logout.title = `${status.user.username} · ${t('auth.logout')}`;

  // อยู่ในโหมดทดสอบ — ต้องเห็นชัดว่ายังไม่มีการตรวจรหัสจริง
  if (status.devLogin) {
    el.logout.classList.add('user-chip--dev');
    el.logout.title = `${t('auth.devMode')} · ${t('auth.logout')}`;
  }

  el.logout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/login.html');
  });
}

/** ─── เริ่มทำงาน ─── */
function start() {
  initLang();
  initTheme();
  applyStaticText();
  initModal();

  initRouter();
  onRoute(() => {
    // สลับหน้า/เปลี่ยนตัวกรอง — modal ที่เปิดค้างอยู่อ้างข้อมูลของหน้าเดิม
    closeModal();
    render();
  });

  initAuthChrome().catch(() => {});

  // ฉากหลังไม่ใช่ของจำเป็น — ล้มเหลวก็ใช้ gradient จาก CSS ต่อได้
  initBackground(el.canvas).catch(() => {});

  // ช่องแชทก็ไม่ใช่ของจำเป็น — ถ้าไม่มี API key จะแสดงวิธีตั้งค่าแทน
  initChat().catch(() => {});

  el.refresh.addEventListener('click', () => load({ refresh: true }));

  el.theme.addEventListener('click', () => toggleTheme());

  onThemeChange(() => {
    applyStaticText();
    // กราฟวาดลง canvas จึงไม่เปลี่ยนสีตาม CSS เอง ต้องวาดใหม่ทั้งหมด
    render();
    refreshBackground(el.canvas).catch(() => {});
  });

  el.lang.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-lang]');
    if (btn) setLang(btn.dataset.lang);
  });

  onLangChange(() => {
    applyStaticText();
    closeModal();
    resetChat();
    render();
  });

  // อัปเดตข้อความ "อัปเดตเมื่อ …" ให้เดินตามเวลาจริง
  setInterval(() => {
    if (payload && !loading) {
      el.updated.textContent = `${t('meta.updated')} ${ago(payload.meta.fetchedAt)}`;
    }
  }, 60000);

  load();
}

start();
