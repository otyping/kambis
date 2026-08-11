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
    /* สีตามขนาดดอก — ไม่ใช่ไล่เฉดโทนเดียวแล้ว (ผู้ใช้สั่งให้แต่ละขนาดดูต่างกันชัด ๆ)
     * แต่ยังเรียงจากเข้มไปสว่างตามขนาด จึงยังนับเป็นข้อมูลที่มีลำดับอยู่
     * ค่าสำรองตรงนี้เป็นของโหมดสว่าง เผื่อ token หายไป */
    sizes: [
      css('--size-xxl') || '#00580d',
      css('--size-xl') || '#4b52b9',
      css('--size-l') || '#c04775',
      css('--size-m') || '#1f98ed',
      css('--size-s') || '#ff9a00',
      css('--size-xs') || '#ffd93d',
    ],
    /* ช่วงการปลูกบนไทม์ไลน์ครอป (Veg → Flower → Harvest → Dry)
     * เป็นลำดับเวลา จึงต้องเป็นไล่เฉดโทนเดียว ห้ามยืม sizes มาใช้เหมือนเดิม */
    stages: [
      css('--stage-1') || '#2e6927',
      css('--stage-2') || '#51792b',
      css('--stage-3') || '#748a30',
      css('--stage-4') || '#95973a',
    ],
    /* 3 กลุ่มขนาดดอก (ดอกใหญ่ · S · XS) — ผู้ใช้กำหนดรหัสสีมาเอง อยู่ที่ --bud-* ใน tokens.css
     * ไม่ได้อยู่ในไล่เฉด --size-* เพราะเป็นคนละชุดสีกันแล้ว (น้ำตาล/ส้ม/เหลือง)
     * ค่าสำรองตรงนี้เป็นของโหมดสว่าง เผื่อ token หายไป */
    sizes3: [
      css('--bud-big') || '#4f200d',
      css('--bud-s') || '#ff9a00',
      css('--bud-xs') || '#ffd93d',
    ],
    /* ชุดสีแยกหมวด — ใช้กับกราฟที่ซ้อนตามสายพันธุ์หรือรายการ
     * ต่างจาก sizes ตรงที่ sizes เป็นไล่เฉดที่มี "ลำดับ" (ขนาดดอก)
     * ส่วน cats ไม่มีลำดับ ทุกช่องต้องแยกออกจากกันได้เท่า ๆ กัน
     * ค่าสำรองคือค่าที่ผ่าน validator แล้ว เผื่อ token หายไปจาก tokens.css */
    cats: [
      css('--cat-1') || '#1e6c01',
      css('--cat-2') || '#f17bad',
      css('--cat-3') || '#744aaf',
      css('--cat-4') || '#02a2a3',
      css('--cat-5') || '#a15205',
      css('--cat-6') || '#cc71c5',
      css('--cat-7') || '#b23d2f',
      css('--cat-8') || '#419df4',
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

/* ตัวอักษรบน canvas ตั้งค่าที่นี่เท่านั้น — วาดลง canvas จึงไม่รับ --fs-* จาก CSS
 * ให้ล้อขนาดของ --fs-xs / --fs-3xs ไว้ ไม่งั้นป้ายกราฟจะเล็กกว่าตัวหนังสือรอบ ๆ จนดูหลุดชุด
 * ป้ายที่ใหญ่ขึ้นแล้วชนกันจะถูก drawXLabels() ข้ามให้เอง ไม่ต้องมาคุมระยะเอง
 *
 * **ต้องเดินตาม --fs-scale ด้วย** ไม่งั้นปรับสเกลตัวอักษรทั้งเว็บแล้วป้ายกราฟค้างขนาดเดิม
 * อ่าน --fs-* ตรง ๆ ไม่ได้เพราะเป็น calc() (getPropertyValue คืนสตริง "calc(...)" มา)
 * แต่ --fs-scale เป็นตัวเลขล้วน จึงคูณเองตรงนี้ได้ — และต้องอ่านใหม่ทุกครั้งที่วาด
 * เพราะสเกลของจอเล็กมาจาก media query */
const FACE = "'Noto Sans Thai', system-ui, sans-serif";

function fontScale() {
  const v = parseFloat(css('--fs-scale'));
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** ฟอนต์ของ canvas ที่คูณสเกลแล้ว */
export function chartFont(size, weight = '') {
  return `${weight ? `${weight} ` : ''}${(size * fontScale()).toFixed(1)}px ${FACE}`;
}

const FONT = () => chartFont(13);
const FONT_SM = () => chartFont(12);

/**
 * เตรียม canvas ให้คมบนจอ HiDPI
 * @returns {{ctx:CanvasRenderingContext2D, w:number, h:number}|null}
 */
export function setupCanvas(canvas, height) {
  /* ต้องวัดความกว้างของ "ช่องที่ canvas จะไปนั่งจริง" ให้ได้ ไม่งั้นภาพเพี้ยน
   *
   * canvas ตั้ง width:100% ไว้ใน CSS จึงกว้างเท่า content box ของกล่องแม่
   * แต่ clientWidth นับ padding รวมเข้าไปด้วย (.chart-well มี padding 12px สองข้าง)
   * ถ้าใช้ clientWidth ตรง ๆ backing store จะกว้างเกินจริง 24px แล้วเบราว์เซอร์
   * ย่อภาพลงมาใส่ช่องที่แคบกว่า — วงกลมกลายเป็นวงรี ป้ายชื่อเลื่อนไปทับแท่ง
   *
   * และถ้า canvas ยังไม่ได้อยู่ใน DOM จะวัดอะไรไม่ได้เลย ต้องคืน null
   * ให้ผู้เรียกไปวาดใหม่หลังใส่ลงหน้าแล้ว — ห้ามเดาเป็นค่าคงที่ 300
   * เพราะจะได้ภาพที่ถูกยืดหรือบีบตามอัตราส่วนที่ต่างกันไปในแต่ละการ์ด
   */
  const parent = canvas.parentElement;
  let width = 0;

  if (parent) {
    const cs = getComputedStyle(parent);
    width = Math.round(
      parent.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0)
    );
  }
  if (width <= 0) width = Math.round(canvas.getBoundingClientRect().width);

  if (!(width > 0)) return null;

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
  ctx.font = FONT();
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

/**
 * หน่วยของแกน Y — คืนตัวหารกับป้ายหน่วยที่จะเขียนกำกับ
 *
 * แกนที่มีแต่ตัวเลขเปล่า ๆ อ่านไม่ออกว่าเป็นหน่วยอะไร: "400k" บนกราฟยอดคงเหลือ
 * คือ 400,000 กรัม = 400 kg แต่คนอ่านเดาไม่ได้ และ tooltip ก็บอกเป็น kg อยู่แล้ว
 * จึงแปลงแกนเป็นหน่วยเดียวกับ tooltip แล้วเขียนหน่วยกำกับที่ป้ายบนสุดครั้งเดียว
 * (ทุกป้ายไม่ต้องมีหน่วย เปลืองที่ในช่องแกนที่กว้างแค่ ~45px)
 */
export function axisUnit(unit, max) {
  const abs = Math.abs(max);
  if (!unit || unit === 'g') return abs >= 1000 ? { div: 1000, label: 'kg' } : { div: 1, label: 'g' };
  return { div: 1, label: unit };
}

/** วาดเส้นตารางแนวนอนพร้อมป้ายแกน Y */
export function drawYAxis(ctx, box, max, { ticks = 4, div = 1, unitLabel = '' } = {}) {
  const p = palette();
  const step = niceStep(max, ticks);
  const top = Math.ceil(max / step) * step || step;

  ctx.font = FONT_SM();
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
    const isTop = v > top - step / 2;
    ctx.fillText(`${shortNum(v / div)}${isTop && unitLabel ? ` ${unitLabel}` : ''}`, box.x - 7, y);
  }
  return top;
}

/**
 * แกน Y ที่ลงต่ำกว่าศูนย์ได้ — ใช้กับกราฟเส้นที่มีค่าติดลบ (เช่น EBITDA/กำไรรายเดือน)
 *
 * `drawYAxis()` ข้างบนวนจาก 0 ขึ้นบนอย่างเดียว ค่าติดลบจึงถูกคำนวณเป็นพิกัด
 * ที่อยู่ **ใต้ผืนผ้าใบ** แล้วหายไปเลยโดยไม่มีอะไรเตือน — บนหน้าต้นทุนเคยทำให้
 * เส้น EBITDA ที่ขาดทุนสี่เดือนแรกดูเหมือน "ไม่มีข้อมูล" ทั้งที่ความจริงคือติดลบ
 *
 * คืน `{top, bottom, span}` ให้ผู้เรียกเอาไปทำ yAt() เอง และ **เส้นศูนย์วาดเข้มกว่า
 * เส้นตารางอื่น** เพราะเมื่อมีทั้งบวกและลบ เส้นนั้นคือเส้นแบ่งกำไร/ขาดทุน
 */
export function drawYAxisRange(ctx, box, min, max, { ticks = 4, div = 1, unitLabel = '' } = {}) {
  const p = palette();
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const step = niceStep(hi - lo || Math.abs(hi) || 1, ticks);
  const top = Math.ceil(hi / step) * step || step;
  const bottom = Math.floor(lo / step) * step;
  const span = top - bottom || step;

  ctx.font = FONT_SM();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let v = bottom; v <= top + 1e-9; v += step) {
    const y = box.y + box.h - ((v - bottom) / span) * box.h;
    const isZero = Math.abs(v) < step * 1e-6;
    ctx.strokeStyle = isZero && bottom < 0 ? p.axis : p.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(y) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(y) + 0.5);
    ctx.stroke();

    ctx.fillStyle = p.inkMute;
    const isTop = v > top - step / 2;
    ctx.fillText(`${shortNum(v / div)}${isTop && unitLabel ? ` ${unitLabel}` : ''}`, box.x - 7, y);
  }
  return { top, bottom, span };
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
    /* กล่องที่มีบรรทัดย่อยสูงกว่าเดิมมาก ถ้าไม่ดันกลับจะไหลลงไปทับกราฟใบถัดไป
     * (Math.max มาทีหลังเสมอ เพื่อให้ขอบบนชนะตอนกล่องสูงกว่าที่ว่างที่มี) */
    top = Math.max(4, Math.min(container.clientHeight - th - 4, top));
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

  /* ปิดเฉพาะ observer ตัวเดิม ห้ามเรียก releaseChart() ตรงนี้
   *
   * ฟังก์ชันนี้ถูกเรียกหลังวาดกราฟเสร็จแล้ว ถ้าไป releaseChart จะไปล้างขนาด
   * canvas ที่เพิ่งวาดเสร็จจนกลายเป็นกราฟเปล่า
   */
  disconnectObserver(box);

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

/** ปิด ResizeObserver ของกล่องนี้ โดยไม่แตะ canvas */
function disconnectObserver(box) {
  if (typeof box?.__chartCleanup === 'function') {
    box.__chartCleanup();
    box.__chartCleanup = null;
  }
}

/**
 * คืนทรัพยากรของกราฟในกล่องหนึ่ง
 * นอกจากปิด observer แล้วต้องล้างขนาด canvas ด้วย
 * เพราะ bitmap ของ canvas กินหน่วยความจำจริง (กว้าง × สูง × dpr² × 4 ไบต์)
 * ถ้าปล่อยทิ้งไว้แบบหลุดจาก DOM จะค้างอยู่ในเมมโมรีจนกว่าจะ GC
 */
export function releaseChart(box) {
  if (!box) return;
  disconnectObserver(box);
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

/**
 * วาดป้ายแกน X โดยไม่ให้ตัวหนังสือทับกัน
 *
 * วิธีเดิมคือเว้นระยะตามจำนวนข้อมูล (stride) แล้วบังคับวาดป้ายตัวสุดท้ายเสมอ
 * ซึ่งพังเมื่อป้ายสุดท้ายไปตกใกล้ป้ายที่ stride เลือกไว้พอดี — สองคำเขียนทับกันจนอ่านไม่ออก
 * ที่นี่จึงวัดความกว้างจริงด้วย measureText แล้วข้ามป้ายที่จะชนแทนการเดาระยะ
 *
 * ป้ายแรกกับป้ายสุดท้ายสำคัญที่สุด (บอกช่วงเวลาของกราฟ) จึงกันที่ไว้ให้ก่อน
 * แล้วค่อยแทรกป้ายตรงกลางเท่าที่ยังมีที่ว่างพอ
 *
 * **`center: true` สำหรับกราฟแท่ง** — ค่าเริ่มต้นดันป้ายแรกไปชิดซ้ายและป้ายสุดท้าย
 * ไปชิดขวาของกรอบ ซึ่งถูกสำหรับกราฟเส้น (จุดแรก/สุดท้ายอยู่ที่ขอบกรอบพอดี ถ้าวาง
 * กึ่งกลางจะล้นออกนอก canvas) แต่กับกราฟแท่ง จุดแรกอยู่ลึกเข้ามาครึ่งช่อง
 * การดันไปชิดขอบทำให้ป้ายยาว ๆ กินพื้นที่ของแท่งที่สอง **แล้วป้ายของแท่งที่สองหายไปเลย**
 * (เจอจริง: ชื่อครอปของแท่งที่ 2 กับที่ 9 หายทั้งที่ที่ว่างพอ ส่วนบรรทัดวันที่ซึ่งสั้นกว่าไม่หาย)
 * โหมดนี้จึงวางทุกป้ายไว้กึ่งกลางแท่งของตัวเอง แล้วหนีบไม่ให้ล้น canvas ด้วย `bounds`
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,w:number}} box กรอบพื้นที่วาดกราฟ
 * @param {{x:number,text:string}[]} items ตำแหน่งกึ่งกลางและข้อความของทุกจุด
 * @param {number} y ตำแหน่งบนสุดของบรรทัดป้าย
 * @param {number} [minGap] ช่องว่างขั้นต่ำระหว่างป้ายสองอัน
 * @param {{center?:boolean, bounds?:[number,number]}} [opts]
 */
export function drawXLabels(ctx, box, items, y, minGap = 10, opts = {}) {
  if (!items.length) return;
  const { center = false, bounds = null } = opts;

  const measured = items.map((it) => ({ ...it, w: ctx.measureText(it.text).width }));
  const last = measured[measured.length - 1];
  const first = measured[0];

  /* ป้ายหัวท้ายชิดขอบกรอบ ไม่ให้ล้นออกนอก canvas
   * เก็บเป็นช่วง [left, right] เพื่อเอาไปเช็คการชนได้ตรง ๆ */
  const placed = [];
  const draw = (item, align) => {
    ctx.textAlign = align;
    ctx.fillText(item.text, item.x, y);
    const left = align === 'left' ? item.x : align === 'right' ? item.x - item.w : item.x - item.w / 2;
    placed.push({ left, right: left + item.w });
  };

  const fits = (item) => {
    const left = item.x - item.w / 2;
    const right = item.x + item.w / 2;
    return placed.every((s) => right + minGap < s.left || left - minGap > s.right);
  };

  if (center) {
    // หนีบเฉพาะเท่าที่จำเป็นไม่ให้ตัวหนังสือล้นขอบ canvas ที่เหลือยังอยู่กึ่งกลางแท่งจริง ๆ
    const clamp = (item) =>
      bounds
        ? { ...item, x: Math.min(Math.max(item.x, bounds[0] + item.w / 2), bounds[1] - item.w / 2) }
        : item;
    // เรียงลำดับความสำคัญเหมือนโหมดปกติ: หัว → ท้าย → ที่เหลือจากซ้ายไปขวา
    const order = [0, measured.length - 1, ...measured.map((_, i) => i).slice(1, -1)];
    for (const i of new Set(order)) {
      const item = clamp(measured[i]);
      if (fits(item)) draw(item, 'center');
    }
    ctx.textAlign = 'center';
    return;
  }

  draw(first, measured.length === 1 ? 'center' : 'left');
  if (measured.length > 1) draw(last, 'right');

  // แทรกป้ายกลางจากซ้ายไปขวา เอาเท่าที่ไม่ชนกับที่วางไว้แล้ว
  for (let i = 1; i < measured.length - 1; i++) {
    if (fits(measured[i])) draw(measured[i], 'center');
  }

  ctx.textAlign = 'center';
}
