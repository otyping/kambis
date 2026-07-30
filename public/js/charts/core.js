/**
 * charts/core.js — พื้นฐานร่วมของกราฟทุกชนิด (Canvas 2D เขียนเอง ไม่ใช้ไลบรารี)
 *
 * กติกาที่ทุกกราฟต้องทำตาม:
 *   - รองรับ HiDPI (คูณ devicePixelRatio จำกัดที่ 2)
 *   - null ไม่ใช่ 0 — ข้อมูลขาดต้องเป็นช่องว่าง ไม่ใช่จุดที่ศูนย์
 *   - มี empty state ที่อ่านรู้เรื่อง ไม่ใช่ canvas เปล่า
 *   - แกนและเส้นตารางต้องจาง ให้ข้อมูลเด่นกว่าเสมอ
 *   - tooltip ทำงานทั้ง hover และ tap
 */
import { t } from '../i18n.js';

const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * สีที่ใช้ในกราฟ — อ่านจาก CSS custom property ทุกครั้งที่วาด
 * ทำให้เปลี่ยนธีมสว่าง/มืดแล้วกราฟเปลี่ยนตามโดยไม่ต้องมีตารางสีซ้ำในโค้ด
 */
export function palette() {
  return {
    series1: css('--series-1') || '#93801a',
    series2: css('--series-2') || '#04724f',
    sizes: [
      css('--size-xxl') || '#b3aa55',
      css('--size-xl') || '#95973a',
      css('--size-l') || '#748a30',
      css('--size-m') || '#51792b',
      css('--size-s') || '#2e6927',
      css('--size-xs') || '#0d530e',
    ],
    ink: css('--ink') || '#0d2a0c',
    inkSoft: css('--ink-soft') || '#2f5a2b',
    inkMute: css('--ink-mute') || '#5d7a58',
    grid: css('--chart-grid') || 'rgba(13,42,12,0.11)',
    axis: css('--chart-axis') || 'rgba(13,42,12,0.22)',
    well: css('--chart-well') || '#fffdf4',
    fade: css('--series-1-fade') || 'rgba(147,128,26,0.24)',
    fade0: css('--series-1-fade0') || 'rgba(147,128,26,0)',
  };
}

const FONT = "12px 'Noto Sans Thai', system-ui, sans-serif";
const FONT_SM = "11px 'Noto Sans Thai', system-ui, sans-serif";

/**
 * เตรียม canvas ให้คมบนจอ HiDPI
 * @returns {{ctx:CanvasRenderingContext2D, w:number, h:number}|null}
 */
export function setupCanvas(canvas, height) {
  const width = canvas.parentElement?.clientWidth || canvas.clientWidth || 300;
  if (width <= 0) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, w: width, h: height };
}

/** แสดงข้อความเมื่อไม่มีข้อมูล แทนที่จะปล่อย canvas ว่าง */
export function drawEmpty(ctx, w, h, message) {
  const p = palette();
  ctx.fillStyle = p.inkMute;
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(message || t('label.noData'), w / 2, h / 2);
}

/** มีข้อมูลให้วาดไหม (null ทั้งหมด = ไม่มี) */
export function hasData(values) {
  return values.some((v) => v !== null && v !== undefined && Number.isFinite(v) && v !== 0);
}

/** หาค่าขั้นบันไดของแกนที่อ่านง่าย (1, 2, 5 × 10^n) */
export function niceStep(range, targetTicks = 4) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/** ย่อตัวเลขให้สั้นสำหรับป้ายแกน */
export function shortNum(value) {
  if (value === null || !Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/** วาดเส้นตารางแนวนอนพร้อมป้ายแกน Y */
export function drawYAxis(ctx, box, max, { ticks = 4 } = {}) {
  const p = palette();
  const step = niceStep(max, ticks);
  const top = Math.ceil(max / step) * step || step;

  ctx.font = FONT_SM;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = box.y + box.h - (v / top) * box.h;
    ctx.strokeStyle = p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(y) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
    ctx.stroke();

    ctx.fillStyle = p.inkMute;
    ctx.fillText(shortNum(v), box.x - 7, y);
  }
  return top;
}

/** สี่เหลี่ยมมุมมนด้านบน — ใช้กับแท่งกราฟ (ปลายข้อมูลมน 4px ฐานชิดแกน) */
export function roundedTopRect(ctx, x, y, w, h, r = 4) {
  const radius = Math.min(r, w / 2, Math.abs(h));
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

/** สี่เหลี่ยมมุมมนด้านขวา — ใช้กับแท่งกราฟแนวนอน */
export function roundedRightRect(ctx, x, y, w, h, r = 4) {
  const radius = Math.min(r, Math.abs(w), h / 2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}

/**
 * ผูก tooltip เข้ากับ canvas — ทำงานทั้ง hover และ tap
 * @param {HTMLElement} container กล่องที่มี position:relative
 * @param {HTMLCanvasElement} canvas
 * @param {(x:number, y:number) => ({html:string, x:number, y:number}|null)} hitTest
 */
export function attachTooltip(container, canvas, hitTest) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'status');
    container.appendChild(tip);
  }

  let lastHtml = '';
  let hideTimer = null;

  const hide = () => {
    clearTimeout(hideTimer);
    hideTimer = null;
    tip.classList.remove('is-on');
    lastHtml = '';
  };

  const move = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(clientX - rect.left, clientY - rect.top);

    /* ชี้ไปโดนช่องว่างระหว่างแท่ง → ไม่ซ่อน แต่คงอันเดิมไว้
     *
     * ถ้าซ่อนทันทีที่พลาด tooltip จะกระพริบตลอดเวลาที่เลื่อนเมาส์
     * เพราะระหว่างแท่งมีช่องว่าง 2px คั่นอยู่ ทำให้อ่านข้อมูลไม่ทัน
     * ให้ซ่อนเฉพาะตอนเมาส์ออกจากกราฟไปเลยเท่านั้น
     */
    if (!hit) return;

    // เขียน DOM เฉพาะตอนเนื้อหาเปลี่ยนจริง ลดการ reflow ระหว่างเลื่อนเมาส์
    if (hit.html !== lastHtml) {
      tip.innerHTML = hit.html;
      lastHtml = hit.html;
    }
    tip.classList.add('is-on');

    // จัดตำแหน่งไม่ให้ล้นขอบกล่อง
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = hit.x - tw / 2;
    left = Math.max(4, Math.min(container.clientWidth - tw - 4, left));
    let top = hit.y - th - 12;
    if (top < 0) top = hit.y + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  canvas.onpointermove = (e) => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    move(e.clientX, e.clientY);
  };
  canvas.onpointerleave = hide;
  canvas.onpointercancel = hide;
  canvas.onpointerdown = (e) => {
    if (e.pointerType !== 'mouse') move(e.clientX, e.clientY);
  };
  // แตะบนมือถือ: ค้างไว้สักพักแล้วค่อยซ่อนเอง
  canvas.onpointerup = (e) => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 3200);
  };

  return hide;
}

/** สร้าง legend เป็น HTML — บังคับมีเมื่อมีตั้งแต่ 2 ชุดข้อมูลขึ้นไป */
export function legendHtml(items) {
  if (!items || items.length < 2) return '';
  return `<div class="legend">${items
    .map(
      (it) =>
        `<span class="legend__item"><span class="legend__swatch" style="background:${it.color}"></span>${it.label}</span>`
    )
    .join('')}</div>`;
}

/**
 * วาดกราฟใหม่เมื่อ "ความกว้าง" ของกล่องเปลี่ยน
 *
 * มีสองกับดักที่ต้องระวัง และเคยทำให้หน้าเว็บค้างกับกิน RAM มาแล้ว:
 *
 * 1. หนึ่งกล่องต้องมี observer ตัวเดียวเสมอ
 *    การวาดใหม่จะสร้าง canvas ใหม่แล้วเรียกฟังก์ชันนี้อีกรอบ ถ้าไม่ปิดตัวเก่าก่อน
 *    observer จะสะสมทับกันไปเรื่อย ๆ พอ resize ทีเดียวจะวาดใหม่ N รอบ
 *    แล้วได้ observer เพิ่มอีก N ตัว — บานปลายแบบทวีคูณจนเบราว์เซอร์ค้าง
 *
 * 2. ต้องเทียบเฉพาะความกว้าง
 *    การวาดใหม่ไปตั้งความสูงของ canvas ซึ่งทำให้กล่องเปลี่ยนขนาด
 *    ถ้าดูทั้งสองด้านจะกลายเป็นวงจรป้อนกลับที่วาดใหม่ไม่หยุด
 */
export function onResize(canvas, redraw) {
  const box = canvas.parentElement;
  if (!box || typeof ResizeObserver === 'undefined') return () => {};

  // ปิดตัวเดิมของกล่องนี้ก่อนเสมอ ไม่ให้มีสองตัวทำงานพร้อมกัน
  releaseChart(box);

  let timer = null;
  let lastWidth = Math.round(box.clientWidth);

  const ro = new ResizeObserver(() => {
    const width = Math.round(box.clientWidth);
    if (width === lastWidth || width === 0) return;
    lastWidth = width;
    clearTimeout(timer);
    timer = setTimeout(redraw, 120);
  });
  ro.observe(box);

  const stop = () => {
    clearTimeout(timer);
    ro.disconnect();
  };
  box.__chartCleanup = stop;
  return stop;
}

/**
 * คืนทรัพยากรของกราฟในกล่องหนึ่ง
 * นอกจากปิด observer แล้วต้องล้างขนาด canvas ด้วย
 * เพราะ bitmap ของ canvas กินหน่วยความจำจริง (กว้าง × สูง × dpr² × 4 ไบต์)
 * ถ้าปล่อยทิ้งไว้แบบหลุดจาก DOM จะค้างอยู่ในเมมโมรีจนกว่าจะ GC
 */
export function releaseChart(box) {
  if (!box) return;
  if (typeof box.__chartCleanup === 'function') {
    box.__chartCleanup();
    box.__chartCleanup = null;
  }
  for (const canvas of box.querySelectorAll?.('canvas') ?? []) {
    canvas.onpointermove = null;
    canvas.onpointerleave = null;
    canvas.onpointercancel = null;
    canvas.onpointerdown = null;
    canvas.onpointerup = null;
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * คืนทรัพยากรของกราฟทั้งหมดใต้ element หนึ่ง
 * ต้องเรียกก่อนทิ้ง DOM ก้อนนั้น (ปิด modal, วาดการ์ดใหม่, สลับธีม)
 */
export function releaseCharts(root) {
  if (!root) return;
  for (const box of root.querySelectorAll?.('.chart') ?? []) releaseChart(box);
}

export { FONT, FONT_SM };
