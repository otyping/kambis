/**
 * ui/nav.js — เมนู
 *
 *   จอใหญ่ (≥ 768px)  เมนูสองชั้น: เลือกรายงาน (บน) → เลือกหน้าย่อยของ Dryflower (ล่าง)
 *   จอเล็ก (< 768px)  ปุ่ม ☰ เปิดแผงเต็มจอที่เห็นทุกปลายทางพร้อมกัน
 *
 * ทำไมจอเล็กต้องเป็นแผง ไม่ใช่แถบที่เลื่อนแนวนอนได้:
 * แถบที่เลื่อนได้ "ดูเหมือน" แก้ปัญหาที่แคบ แต่จริง ๆ คือซ่อนเมนูข้อท้าย ๆ ไว้นอกจอ
 * โดยไม่มีอะไรบอกว่ามันมีอยู่ — บน 375px จะเห็นแค่ 2–3 หน้าแรก คนที่ไม่เคยใช้
 * จะไม่มีวันรู้ว่ามีหน้า "ต้นทุน" (ดู skill responsive-ui)
 *
 * ป้ายทั้งหมดเป็น markup นิ่งที่มี data-i18n อยู่ใน index.html แล้ว
 * applyStaticText() ใน main.js จึงเปลี่ยนภาษาให้เองโดยไม่ต้องมีสตริงใน JS
 *
 * ทุกปุ่มเป็น <a href="#/..."> จริง จึงได้ปุ่มย้อนกลับ คลิกกลาง และคีย์บอร์ดมาฟรี
 * หน้าที่ของ JS มีแค่ทำเครื่องหมายว่าอยู่หน้าไหน กับเปิด/ปิดแผง
 */
import { toHash, ROUTES } from '../router.js';
import { t } from '../i18n.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* 767px ต้องเป็นเส้นเดียวกับที่ CSS และ filters.js ใช้
 * ถ้าตั้งคนละค่าจะมีช่วงความกว้างที่ CSS คิดว่ามือถือแต่ JS คิดว่า PC */
const MOBILE = window.matchMedia('(max-width: 767px)');

/** ชื่อหน้าสำหรับป้ายใต้โลโก้ (จอเล็ก) — คีย์เดียวกับที่เมนูใช้ */
const PAGE_LABEL = {
  overview: 'nav.overview',
  production: 'nav.production',
  stock: 'nav.stock',
  sales: 'nav.sales',
  cost: 'nav.cost',
  main: 'nav.supply',
};

let wired = false;
let lastFocus = null;

/* หน้าที่วาดไปล่าสุด — ใช้แยก "เปลี่ยนหน้า" ออกจาก "วาดใหม่เพราะสลับธีม/ภาษา"
 * ถ้าไม่แยก การกดปุ่มธีมที่อยู่ในแผงเมนูจะทำให้แผงปิดตัวเองทันที ทั้งที่ยังไม่ได้เลือกหน้า */
let lastRouteKey = null;

/**
 * @param {{report:string, page:string, params:URLSearchParams}} route
 */
export function renderNav(route) {
  const reportNav = document.getElementById('report-nav');
  const subnav = document.getElementById('subnav');
  if (!reportNav || !subnav) return;

  wire();

  /* Supply เป็นรายงานหน้าเดียว จึงไม่มีเมนูย่อยบนจอใหญ่
   *
   * แต่ในแผงของจอเล็กหน้าย่อยทั้ง 5 ต้องโชว์เสมอ แม้ตอนอยู่รายงาน Supply
   * เพราะแผงคือเมนูรวมของทั้งเว็บ ถ้าซ่อนไว้ คนที่อยู่หน้า Supply จะต้องกด
   * DRYFLOWER ก่อนแล้วเปิดเมนูใหม่อีกรอบถึงจะไปหน้าสต็อกได้ — สองเที่ยวโดยไม่จำเป็น */
  subnav.hidden = route.report !== 'dryflower';

  /* ทำเครื่องหมาย + ตั้ง href ให้ลิงก์ "ทุกที่ในหน้า" ที่มี data-report / data-page
   * (เมนูบน, เมนูย่อย, และแผงของจอเล็ก) — ชุดเดียวกันหมด จึงไม่มีทางไม่ตรงกัน */
  for (const link of document.querySelectorAll('a[data-page]')) {
    const active = link.dataset.page === route.page && route.report === 'dryflower';
    link.setAttribute('aria-current', active ? 'page' : 'false');
    link.classList.toggle('is-active', active);

    /* พาตัวกรองติดไปด้วยตอนสลับหน้า
     * ผู้ใช้ที่เลือก "เฉพาะสายพันธุ์ Shogun" แล้วกดไปหน้าสต็อก ย่อมคาดหวังว่า
     * ยังกรอง Shogun อยู่ ไม่ใช่ถูกรีเซ็ตเงียบ ๆ */
    link.setAttribute(
      'href',
      toHash({ report: 'dryflower', page: link.dataset.page, params: route.params })
    );
  }

  for (const link of document.querySelectorAll('a[data-report]')) {
    const report = link.dataset.report;
    const active = report === route.report;
    link.setAttribute('aria-current', active ? 'page' : 'false');
    link.classList.toggle('is-active', active);

    /* กลับมาที่ Dryflower ให้ลงหน้าที่กำลังดูค้างไว้ ไม่ใช่เด้งกลับหน้าแรกเสมอ
     * ส่วน Supply ใช้ตัวกรองคนละชุด จึงไม่พาตัวกรองของ Dryflower ติดไป */
    const page =
      report === 'dryflower'
        ? // ถ้าตอนนี้อยู่รายงาน Supply หน้าปัจจุบันคือ 'main' ซึ่งไม่มีใน Dryflower
          (route.report === 'dryflower' && ROUTES.dryflower.includes(route.page)
            ? route.page
            : 'overview')
        : ROUTES[report][0];
    link.setAttribute(
      'href',
      toHash({ report, page, params: report === 'dryflower' ? route.params : null })
    );
  }

  // ป้ายบอกว่าอยู่หน้าไหน — บนจอเล็กเมนูถูกพับเก็บ ถ้าไม่บอกก็ไม่มีทางรู้
  const crumb = document.getElementById('brand-crumb');
  if (crumb) {
    const key = PAGE_LABEL[route.page];
    crumb.textContent = key ? t(key) : '';
  }

  /* สลับหน้าแล้วแผงต้องปิดเอง ไม่งั้นมันจะค้างทับหน้าที่เพิ่งเปิด
   * แต่การวาดใหม่เพราะสลับธีม/ภาษาไม่ใช่การเปลี่ยนหน้า — ปุ่มพวกนั้นอยู่ในแผง
   * ถ้าปิดด้วยจะกลายเป็นกดเปลี่ยนธีมทีแผงหายที */
  const routeKey = `${route.report}/${route.page}`;
  if (lastRouteKey !== null && lastRouteKey !== routeKey) closePanel();
  lastRouteKey = routeKey;

  placeTools();
}

/* ── แผงเมนูของจอเล็ก ───────────────────────────────────── */

const panel = () => document.getElementById('nav-panel');
const toggle = () => document.getElementById('nav-toggle');

export function isPanelOpen() {
  return Boolean(panel() && !panel().hidden);
}

export function openPanel() {
  const el = panel();
  if (!el || !el.hidden) return;
  lastFocus = document.activeElement;
  el.hidden = false;
  // ต้องรอเฟรมหนึ่งก่อนติดคลาส ไม่งั้น transition ไม่ทำงาน (element เพิ่งพ้น display:none)
  requestAnimationFrame(() => el.classList.add('is-open'));
  toggle()?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('has-nav-open');
  el.querySelector(FOCUSABLE)?.focus();
}

export function closePanel() {
  const el = panel();
  if (!el || el.hidden) return;
  el.classList.remove('is-open');
  el.hidden = true;
  toggle()?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('has-nav-open');
  // ปุ่มอาจหลุด DOM ไปแล้วถ้าหน้าเพิ่งถูกวาดใหม่ — คืน focus เฉพาะตอนที่ยังอยู่
  if (lastFocus?.isConnected) lastFocus.focus();
  lastFocus = null;
}

/**
 * ย้ายกลุ่มเครื่องมือของ header เข้า/ออกจากแผงตามความกว้างจอ
 *
 * **ย้าย element จริง ไม่ได้สร้างสำเนา** — ถ้าทำสำเนาจะได้ id ซ้ำสองตัวในหน้าเดียว
 * แล้ว listener ที่ main.js ผูกไว้ตอนเริ่มต้นจะทำงานแค่ตัวเดียว
 */
function placeTools() {
  const meta = document.getElementById('header-tools-meta');
  const home = document.getElementById('header-tools');
  const slot = document.getElementById('nav-panel-tools');
  if (!meta || !home || !slot) return;

  const target = MOBILE.matches ? slot : home;
  if (meta.parentElement === target) return;
  // บนจอใหญ่ต้องกลับไปอยู่หน้าปุ่มรีเฟรชเหมือนเดิม ไม่ใช่ต่อท้าย
  if (target === home) home.prepend(meta);
  else target.appendChild(meta);
}

/** ผูก event ครั้งเดียวตลอดอายุหน้า — renderNav ถูกเรียกซ้ำทุกครั้งที่สลับหน้า */
function wire() {
  if (wired) return;
  wired = true;

  toggle()?.addEventListener('click', () => {
    if (isPanelOpen()) closePanel();
    else openPanel();
  });

  const el = panel();
  if (!el) return;

  // กดพื้นหลังนอกแผ่นเมนู = ปิด
  el.addEventListener('click', (e) => {
    if (e.target === el) closePanel();
  });

  /* กดลิงก์แล้วปิด — ต้องดักที่นี่ด้วย ไม่ใช่พึ่ง renderNav อย่างเดียว
   * เพราะกดลิงก์ของหน้าที่เปิดอยู่แล้ว hash ไม่เปลี่ยน renderNav จึงไม่ถูกเรียก
   * แล้วแผงจะค้างเปิดอยู่เหมือนกดไม่ติด */
  el.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) closePanel();
  });

  /* ดักที่ document ไม่ใช่ที่ตัวแผง เพราะปุ่ม ☰ อยู่นอกแผง (บน header ที่ยังเห็นอยู่)
   * ถ้าผูกไว้ที่แผง พอโฟกัสอยู่ที่ ☰ แล้วกด Tab จะหลุดออกไปนอกวง — event bubble
   * ขึ้นอย่างเดียว ไม่ลงไปหาลูก */
  document.addEventListener('keydown', (e) => {
    if (!isPanelOpen()) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePanel();
      return;
    }
    if (e.key !== 'Tab') return;

    // ☰ ต้องอยู่ในวงโฟกัสด้วย ไม่งั้นคนใช้คีย์บอร์ดจะปิดแผงด้วยปุ่มเดิมไม่ได้
    const items = [toggle(), ...el.querySelectorAll(FOCUSABLE)].filter(
      (n) => n && n.offsetParent !== null
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ขยายจอจนพ้นช่วงมือถือระหว่างที่แผงเปิดอยู่ — ต้องปิดและย้ายของกลับ
   * ไม่งั้นเครื่องมือจะค้างอยู่ในแผงที่ CSS ซ่อนไว้ แล้วปุ่มธีม/ภาษาหายไปทั้งชุด */
  MOBILE.addEventListener('change', () => {
    closePanel();
    placeTools();
  });
}
