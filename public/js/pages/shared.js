/**
 * pages/shared.js — ชิ้นส่วนที่ทุกหน้าใช้ร่วมกัน
 *
 * กฎการวาดกราฟที่ทุกหน้าต้องทำตาม (เคยพังมาแล้วสองอาการ):
 *   สร้าง DOM → appendChild → **ค่อยวาด**
 * `setupCanvas()` คืน null เมื่อกล่องยังกว้าง 0 แล้วกราฟจะ bail เงียบ ๆ
 * และ onResize ข้าม width === 0 จึงไม่มีวันแก้ตัวเองตอนแสดงผลทีหลัง
 */
import { t } from '../i18n.js';
import { esc, grams, n, DASH } from '../format.js';
import { qualityCard } from '../ui/cards.js';

/** กล่องหัวข้อของหน้า */
export function pageHeader(host, { title, sub }) {
  const head = document.createElement('header');
  head.className = 'page-head';
  head.innerHTML = `<h2 class="page-head__title">${esc(title)}</h2>${
    sub ? `<p class="page-head__sub">${esc(sub)}</p>` : ''
  }`;
  host.appendChild(head);
  return head;
}

/** แผงกระจกหนึ่งใบ พร้อมหัวข้อ — คืนกล่องเนื้อหาข้างใน */
export function panel(parent, title, note, { wide = false } = {}) {
  const box = document.createElement('section');
  box.className = `glass panel${wide ? ' panel--wide' : ''}`;
  box.innerHTML = `<h3 class="panel__title">${esc(title)}${
    note ? ` <span>${esc(note)}</span>` : ''
  }</h3>`;
  const body = document.createElement('div');
  box.appendChild(body);
  parent.appendChild(box);
  return body;
}

/** กล่องพื้นสำหรับวางกราฟ */
export function well(parent) {
  const box = document.createElement('div');
  box.className = 'chart-well';
  parent.appendChild(box);
  return box;
}

/** ตะแกรงวางแผง */
export function grid(host, { cols = 2 } = {}) {
  const g = document.createElement('div');
  g.className = `page-grid page-grid--${cols}`;
  host.appendChild(g);
  return g;
}

/**
 * แถบตัวเลขสำคัญ — ใช้แทน renderKpiStrip เดิม แต่รับจำนวนช่องเท่าไรก็ได้
 * `.kpi-strip` เดิมตั้ง grid ไว้ 6 คอลัมน์ตายตัว จึงส่งจำนวนจริงผ่าน custom property
 *
 * @param {{label:string, value:number|null, unit?:string, hint?:string,
 *          awaiting?:boolean, decimals?:number}[]} items
 */
export function tiles(host, items) {
  const strip = document.createElement('div');
  strip.className = 'kpi-strip';
  strip.style.setProperty('--tile-count', String(items.length));

  strip.innerHTML = items
    .map((item) => {
      let value = DASH;
      let unit = '';
      if (!item.awaiting && item.value !== null && Number.isFinite(item.value)) {
        if (item.unit === 'g') {
          const g = grams(item.value);
          value = g.value;
          unit = g.unit;
        } else {
          value = n(item.value, item.decimals ?? 0);
          unit = item.unit ?? '';
        }
      }
      const cls = item.awaiting ? ' kpi--awaiting' : '';
      const hint = item.awaiting ? t('awaiting.badge') : (item.hint ?? '');
      return `<div class="glass kpi${cls}">
        <span class="kpi__label">${esc(item.label)}</span>
        <div class="kpi__value num">${value}${unit ? `<span class="kpi__unit">${esc(unit)}</span>` : ''}</div>
        <div class="kpi__hint">${esc(hint)}</div>
      </div>`;
    })
    .join('');

  host.appendChild(strip);
  return strip;
}

/** ข้อความเมื่อไม่มีข้อมูลให้แสดง (เช่นกรองจนไม่เหลืออะไร) */
export function emptyNote(parent, message) {
  const p = document.createElement('p');
  p.className = 'empty-note';
  p.textContent = message ?? t('label.noData');
  parent.appendChild(p);
  return p;
}

/**
 * การ์ด "คุณภาพข้อมูล" ท้ายหน้า
 *
 * ทั้งสองรายงานต้องมีการ์ดนี้และต้องเป็น **ใบสุดท้ายของหน้า** ตามที่ผู้ใช้กำหนด
 * จึงเรียกจากหน้าโดยตรง ไม่ได้ปนอยู่ในชุดการ์ดของ renderCards() ที่ถูกวางไว้กลางหน้า
 *
 * @param {HTMLElement} host
 * @param {object} payload ต้องมี analysis + meta ของ **รายงานนั้น** (Supply โหลดแยกจึงคนละก้อน)
 * @param {(key:string, trigger:HTMLElement, override?:object)=>void} onOpen
 * @param {Array} drawLater
 */
export function appendQualityCard(host, payload, onOpen, drawLater, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'card-grid';
  const card = qualityCard(payload, drawLater, opts);
  // ส่ง payload ของรายงานนี้ไปด้วย ไม่งั้น modal จะไปหยิบผลวิเคราะห์ของอีกรายงานมาแสดง
  card.addEventListener('click', () => onOpen('quality', card, payload));
  wrap.appendChild(card);
  host.appendChild(wrap);
  return card;
}

/** ปีล่าสุด/เดือนล่าสุดที่มีข้อมูลจริง (ไม่ใช่ปีปฏิทินปัจจุบัน ซึ่งอาจยังไม่มีข้อมูล) */
export function latest(series, key) {
  if (!series?.length) return null;
  return series[series.length - 1][key] ?? null;
}
