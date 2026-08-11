/**
 * pages/shared.js — ชิ้นส่วนที่ทุกหน้าใช้ร่วมกัน
 *
 * กฎการวาดกราฟที่ทุกหน้าต้องทำตาม (เคยพังมาแล้วสองอาการ):
 *   สร้าง DOM → appendChild → **ค่อยวาด**
 * `setupCanvas()` คืน null เมื่อกล่องยังกว้าง 0 แล้วกราฟจะ bail เงียบ ๆ
 * และ onResize ข้าม width === 0 จึงไม่มีวันแก้ตัวเองตอนแสดงผลทีหลัง
 */
import { t, getLang } from '../i18n.js';
import { esc, grams, n, valueLen, DASH } from '../format.js';
import { qualityCard } from '../ui/cards.js';

/** ชื่อเดือนแบบสั้นโดยไม่มีปี — `2026-07` → `ก.ค.` / `Jul` */
function shortMonth(ym) {
  const d = new Date(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * เดือนเดียวพร้อมปี — `2026-08` → `ส.ค. 2026` / `Aug 2026`
 *
 * ป้ายบนหน้าเว็บห้ามโชว์สตริงดิบ `2026-08` และ **ปีเป็น ค.ศ. เหมือน `costSpan()`**
 * ด้วยเหตุผลเดียวกัน (แถบตัวกรองเขียนว่า 2026 ถ้าป้ายเขียน 69 จะงงว่าดูปีไหน)
 */
export function monthYear(ym) {
  if (!ym) return '';
  return `${shortMonth(ym)} ${String(ym).slice(0, 4)}`;
}

/**
 * ช่วงเวลาที่ยอดในงบต้นทุนครอบคลุมจริง — `2026-01` + `2026-07` → `ม.ค.–ก.ค. 2026`
 *
 * **ป้ายบนการ์ดต้องบอกช่วงเวลาจริง ห้ามเขียนแค่ปี** (CLAUDE.md §6)
 * ชีตกรอกค่าเสื่อมราคากับค่าใช้จ่าย Office ไว้ล่วงหน้าครบ 12 เดือน แต่รายได้มีถึงมิถุนายน
 * `totals` จึงถูกตัดที่ `lastActiveMonth` — ถ้าเขียนว่า "(2026)" ผู้บริหารจะอ่านว่าเป็น
 * ผลทั้งปี แล้วเข้าใจว่าขาดทุนมากกว่าความจริง
 *
 * **ปีเขียนเป็น ค.ศ. ไม่ใช่ พ.ศ.** ต่างจาก `format.month()` ที่ใช้ locale ไทยแล้วได้ "ก.ค. 69"
 * เพราะป้ายนี้อยู่ใต้แถบตัวกรองที่เขียนว่า "2026" ถ้าสองที่ใช้คนละศักราช
 * ผู้ใช้จะไม่แน่ใจว่ากำลังดูปีไหนอยู่ — และปีเขียนครั้งเดียวท้ายช่วงก็สั้นกว่าด้วย
 *
 * อยู่ที่นี่เพราะทั้งหน้าภาพรวมและหน้าต้นทุนต้องได้ข้อความเดียวกันเป๊ะ
 */
export function costSpan(cost, fallback = '') {
  const cov = cost?.coverage;
  if (!cov) return cost?.year ?? cost?.requestedYear ?? fallback;

  const fromYear = cov.from.slice(0, 4);
  // ช่วงข้ามปีต้องบอกปีทั้งสองฝั่ง ไม่งั้นจะอ่านเป็นช่วงในปีเดียว
  return fromYear === cov.to.slice(0, 4)
    ? `${shortMonth(cov.from)}–${shortMonth(cov.to)} ${fromYear}`
    : `${monthYear(cov.from)}–${monthYear(cov.to)}`;
}

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
 * `tone: 'signed'` = ช่องนี้เครื่องหมายมีความหมาย (กำไร/ขาดทุน) ให้ย้อมสีตามเครื่องหมาย
 * **ผู้เรียกเป็นคนประกาศว่าช่องไหนเป็นแบบนี้ ห้ามให้ tiles() เดาเอาจากค่าติดลบ**
 * เพราะติดลบไม่ได้แปลว่าแย่เสมอไป — หน้า Supply มีรายการที่ "เบิกลดลง" ซึ่งติดลบแล้วดี
 * (`usage-row[data-level="good"]` ใน pages/supply.js) ถ้าเดาจากเครื่องหมายจะย้อมผิดทันที
 *
 * @param {{label:string, value:number|null, unit?:string, hint?:string,
 *          awaiting?:boolean, decimals?:number, tone?:'signed'}[]} items
 */
/**
 * เติมคำว่า "ขาดทุน" ให้ช่องที่ติดลบ ต่อหน้าข้อความเดิมที่มีอยู่
 * ใช้คู่กับ `tone: 'signed'` เสมอ — สีแดงอย่างเดียวไม่รอดตาบอดสีแดง-เขียว
 * และไม่รอดการแคปหน้าจอส่งต่อแบบขาวดำ
 */
export function lossHint(value, base = '') {
  if (!Number.isFinite(value) || value >= 0) return base;
  return base ? `${t('cost.loss')} · ${base}` : t('cost.loss');
}

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
      /* ช่องที่รอข้อมูลก็ยังบอกเหตุผลได้ ถ้าผู้เรียกส่ง hint มา
       * เดิมทับด้วย "รอข้อมูล" เสมอ ข้อความอย่าง "ชีตต้นทุนไม่มีข้อมูลปี 2025"
       * จึงไม่มีวันขึ้นจอ — ผู้ใช้เห็นแต่ "—" โดยไม่รู้ว่าทำไม */
      const hint = item.awaiting ? item.hint || t('awaiting.badge') : (item.hint ?? '');
      // ช่องที่ประกาศ tone: 'signed' และมีค่าจริงเท่านั้น — "—" ต้องเป็นสีเทาเหมือนเดิม
      const signed = item.tone === 'signed' && !item.awaiting && Number.isFinite(item.value);
      const tone = signed ? ` ${item.value < 0 ? 'money-neg' : 'money-pos'}` : '';
      // "—" ต้องไม่ถูกสูตร fit-to-width ดันจนใหญ่กว่าตัวเลขจริงที่อยู่ข้าง ๆ
      const empty = value === DASH ? ' kpi__value--empty' : '';
      return `<div class="glass kpi${cls}" style="--val-len:${valueLen(value, unit)}">
        <span class="kpi__label">${esc(item.label)}</span>
        <div class="kpi__value num${tone}${empty}">${value}${unit ? `<span class="kpi__unit">${esc(unit)}</span>` : ''}</div>
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
