/**
 * ui/datepicker.js — ตัวเลือกวันที่ของ Kambis
 *
 * **ทำไมไม่ใช้ `<input type="date">`:** มันขึ้น `mm/dd/yyyy` ตามภาษาของเครื่อง
 * (บังคับเป็นไทยไม่ได้เลย ไม่ว่าจะ CSS หรือ JS) ปฏิทินที่เด้งขึ้นมาเป็นของเบราว์เซอร์
 * ขัดผิวไม่ได้ ไม่ตามธีมสว่าง/มืด และไม่มีที่ให้ใส่ปุ่มลัดอย่าง "สิ้นเดือนที่แล้ว"
 * ซึ่งเป็นคำถามที่ฟีเจอร์นี้มีไว้ตอบพอดี
 *
 * **ทำไมไม่ใช้ไลบรารี:** โปรเจกต์นี้ zero dependency และตัวที่ผู้ใช้ดูไว้ (Mobiscroll)
 * เป็นของเชิงพาณิชย์ ~$995 — ของที่แพงจริงในงานนี้คือเปลือกกล่องลอยกับกับดักโฟกัส
 * ซึ่งมีอยู่แล้วใน `ui/popover.js` ที่เหลือคือตาราง 7×6 กับเลขคณิตวัน
 *
 * **สัญญาที่ห้ามผิด:** รับและคืนเป็น `YYYY-MM-DD` เท่านั้น
 * `stockAt()` ใน `shared/kpi.js` เทียบวันที่ด้วยการเทียบสตริงตรง ๆ ไม่เคย parse
 * ถ้าหลุด `13/08/2026` เข้าไป มันจะมากกว่าทุกแถวใน log แล้วคืนแถวสุดท้ายซึ่งเป็น
 * **ยอดยกมาของอนาคต** โดยไม่มี error อะไรเลย
 *
 * คำนวณวันด้วย `Date.UTC` ล้วน — ห้ามใช้เวลาท้องถิ่น ไม่งั้นวันเลื่อนข้ามเขตเวลา
 * (กฎเดียวกับ `format.js` ที่ตรึง `timeZone: 'UTC'` ทุกที่)
 */
import { t, getLang } from '../i18n.js';
import { dateFull, monthLong } from '../format.js';
import { openPopover, closePopover } from './popover.js';

/** สัปดาห์เริ่มวันอาทิตย์ — ตามปฏิทินไทยที่คนแขวนไว้ข้างฝาและใช้เทียบกัน */
const WEEK_START = 0;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

let seq = 0;
const nextId = (prefix) => `${prefix}-${++seq}`;

/* ════════════════ ชั้นคำนวณล้วน — ไม่แตะ DOM จึงเทสต์ได้ตรง ๆ ════════════════ */

/** @param {number} m เดือนแบบ 0-based (รับค่าล้นได้ เช่น 12 = ม.ค. ปีถัดไป) */
export function toISO(y, m, d) {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

const parts = (iso) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))];

export function addDays(iso, n) {
  const [y, m, d] = parts(iso);
  return toISO(y, m, d + n);
}

/** บวกเดือนโดยหนีบวันที่ให้อยู่ในเดือนปลายทาง — `31 ส.ค.` + 1 เดือน = `30 ก.ย.` */
export function addMonths(iso, n) {
  const [y, m, d] = parts(iso);
  const lastDay = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return toISO(y, m + n, Math.min(d, lastDay));
}

/** วันสุดท้ายของเดือนก่อนหน้าเดือนของ `iso` */
export function endOfPrevMonth(iso) {
  const [y, m] = parts(iso);
  return toISO(y, m, 0);
}

export function startOfMonth(iso) {
  const [y, m] = parts(iso);
  return toISO(y, m, 1);
}

export function endOfMonth(iso) {
  const [y, m] = parts(iso);
  return toISO(y, m + 1, 0);
}

/** วันนี้ตามเวลาเครื่อง — **ไม่ใช่** `toISOString()` ซึ่งเป็นวันนี้แบบ UTC */
export function localToday() {
  const now = new Date();
  return toISO(now.getFullYear(), now.getMonth(), now.getDate());
}

export function isDisabled(iso, min, max) {
  if (!iso) return true;
  return Boolean((min && iso < min) || (max && iso > max));
}

export function clampISO(iso, min, max) {
  if (!iso) return '';
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/**
 * ตาราง 42 ช่องของเดือน `YYYY-MM` — **6 แถวคงที่เสมอ**
 * ถ้าปล่อยให้ยืดหด 5/6 แถว กล่องจะกระตุกทุกครั้งที่เปลี่ยนเดือน
 * วันของเดือนข้างเคียงเป็นวันจริง กดได้ (ถ้าอยู่ในช่วง) ตามแบบปฏิทินทั่วไป
 */
export function monthGrid(ym) {
  const y = Number(String(ym).slice(0, 4));
  const m = Number(String(ym).slice(5, 7)) - 1;
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const lead = (firstDow - WEEK_START + 7) % 7;
  const start = toISO(y, m, 1 - lead);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const iso = addDays(start, i);
    cells.push({ iso, inMonth: iso.slice(0, 7) === String(ym).slice(0, 7) });
  }
  return cells;
}

/** ปลายทางของปุ่มลูกศร/PageUp/PageDown — คืน `null` ถ้าปุ่มนั้นไม่เกี่ยวกับปฏิทิน */
export function keyTarget(iso, key, shiftKey = false) {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  switch (key) {
    case 'ArrowLeft':
      return addDays(iso, -1);
    case 'ArrowRight':
      return addDays(iso, 1);
    case 'ArrowUp':
      return addDays(iso, -7);
    case 'ArrowDown':
      return addDays(iso, 7);
    case 'Home':
      return addDays(iso, -((dow - WEEK_START + 7) % 7));
    case 'End':
      return addDays(iso, 6 - ((dow - WEEK_START + 7) % 7));
    case 'PageUp':
      return shiftKey ? addMonths(iso, -12) : addMonths(iso, -1);
    case 'PageDown':
      return shiftKey ? addMonths(iso, 12) : addMonths(iso, 1);
    default:
      return null;
  }
}

/**
 * วันที่เลือกได้ตัวถัดไปในทิศทาง `dir` — ห้ามให้ลูกศรพาไปตกวันที่กดไม่ได้
 * วนไม่เกิน 62 รอบ (สองเดือนเต็ม) แล้วยอมแพ้ ป้องกันลูปไม่รู้จบเมื่อทั้งช่วงถูกปิด
 */
export function nextEnabled(iso, dir, min, max) {
  let cur = iso;
  for (let i = 0; i <= 62; i++) {
    if (min && cur < min) return isDisabled(min, min, max) ? null : min;
    if (max && cur > max) return isDisabled(max, min, max) ? null : max;
    if (!isDisabled(cur, min, max)) return cur;
    cur = addDays(cur, dir >= 0 ? 1 : -1);
  }
  return null;
}

/**
 * ปุ่มลัดมาตรฐาน — **วันเดียว ไม่ใช่ช่วง** เพราะ `stockAt()` ตอบคำถาม ณ วันหนึ่ง
 * ("7 วันล่าสุด" ไม่มีความหมายกับคำถาม "ตอนนั้นมีของเท่าไร")
 *
 * ตัวที่ตกนอกช่วงคืน `iso: null` → แสดงเป็นปุ่มที่กดไม่ได้ **ห้ามหนีบเข้าช่วง**
 * เพราะการหนีบคือการเงียบ ๆ ตอบคำถามคนละข้อกับที่ผู้ใช้กด
 */
export function defaultPresets({ today, min = '', max = '' }) {
  const raw = [
    { id: 'today', labelKey: 'date.today', iso: today },
    { id: 'yesterday', labelKey: 'date.yesterday', iso: addDays(today, -1) },
    { id: 'endLastMonth', labelKey: 'date.endOfLastMonth', iso: endOfPrevMonth(today) },
    { id: 'days7', labelKey: 'date.days7', iso: addDays(today, -7) },
    { id: 'days30', labelKey: 'date.days30', iso: addDays(today, -30) },
    { id: 'firstRecord', labelKey: 'date.firstRecord', iso: min || null },
  ];
  return raw.map((p) => ({ ...p, iso: p.iso && !isDisabled(p.iso, min, max) ? p.iso : null }));
}

/**
 * ปุ่มลัดของโหมดช่วงวันที่
 *
 * **จุดอ้างอิงคือ `min(วันนี้, วันล่าสุดที่มีข้อมูล)`** — สองกรณีที่ต้องรอดทั้งคู่:
 *
 * - ชีตหยุดอัปเดตไปหนึ่งสัปดาห์ → ยึดวันนี้แล้ว "7 วันล่าสุด" จะได้ช่วงที่ไม่มีข้อมูลเลย
 * - **ชีตมีแถวลงวันที่ล่วงหน้า** (ของจริงในโปรเจกต์นี้ — แท็บวันที่ในอนาคตกับรอบปลูก
 *   ที่วางแผนไว้) → ยึด `max` แล้ว "เดือนที่แล้ว" กลายเป็นเดือนพฤศจิกายนที่ยังไม่มาถึง
 *
 * ต่างจากปุ่มลัดวันเดียวตรงที่ **หนีบเข้าช่วงข้อมูลได้** เพราะช่วงเวลาโดยธรรมชาติ
 * แปลว่า "เท่าที่มี" อยู่แล้ว (ต่างจากวันเดียวที่การหนีบ = ตอบคำถามคนละข้อ)
 * แต่ถ้าไม่เหลื่อมกับช่วงข้อมูลเลย ต้องเป็น `null` = กดไม่ได้ ห้ามคืนช่วงว่าง
 */
export function defaultRangePresets({ today, min = '', max = '' }) {
  const anchor = max && max < today ? max : today;
  const prev = addMonths(anchor, -1);
  const raw = [
    { id: 'last7', labelKey: 'date.last7', from: addDays(anchor, -6), to: anchor },
    { id: 'last30', labelKey: 'date.last30', from: addDays(anchor, -29), to: anchor },
    { id: 'thisMonth', labelKey: 'date.thisMonth', from: startOfMonth(anchor), to: anchor },
    { id: 'lastMonth', labelKey: 'date.lastMonth', from: startOfMonth(prev), to: endOfMonth(prev) },
  ];
  return raw.map((p) => {
    const from = min && p.from < min ? min : p.from;
    const to = max && p.to > max ? max : p.to;
    const usable = from <= to && !isDisabled(from, min, max) && !isDisabled(to, min, max);
    return { ...p, from: usable ? from : null, to: usable ? to : null };
  });
}

/**
 * ชื่อวันบนหัวตาราง เรียงตาม `WEEK_START`
 *
 * ไทยใช้ `narrow` ได้ (`อา จ อ พ พฤ ศ ส` — 7 ตัวไม่ซ้ำกัน สั้นพอดีช่อง)
 * แต่อังกฤษ `narrow` ได้ `S M T W T F S` ซึ่งซ้ำกันสองคู่จนแยกไม่ออก จึงใช้ `short`
 */
export function weekdayNames(style = null) {
  const en = getLang() === 'en';
  const lang = en ? 'en-GB' : 'th-TH';
  const use = style ?? (en ? 'short' : 'narrow');
  const out = [];
  for (let i = 0; i < 7; i++) {
    // 4 ม.ค. 1970 เป็นวันอาทิตย์ — ยึดวันที่รู้แน่ ไม่ให้ลำดับเพี้ยนตามวันที่รัน
    const d = new Date(Date.UTC(1970, 0, 4 + WEEK_START + i));
    out.push(d.toLocaleDateString(lang, { weekday: use, timeZone: 'UTC' }));
  }
  return out;
}

/* ════════════════ ชั้น DOM ════════════════ */

/**
 * ปฏิทินเปล่า ๆ ที่ไม่รู้จักกล่องลอย — โหมด inline ในอนาคต (ช่วงวันที่ของ Dryflower
 * ที่อยู่ใน `.filter-pop` อยู่แล้ว จึงซ้อน popup ไม่ได้) เรียกตัวนี้ตรง ๆ ได้เลย
 */
function buildCalendar({ value, min, max, today, mode = 'single', onPick }) {
  const el = document.createElement('div');
  el.className = 'dp__cal';

  const range = mode === 'range';
  /* โหมดช่วง: `start` ที่มีแต่ `end` ยังว่าง = กำลังเลือกอยู่ (คลิกแรกลงไปแล้ว)
   * `hover` คือปลายทางชั่วคราวที่ใช้ระบายสีตอนเมาส์ลากผ่าน ยังไม่ใช่ค่าจริง */
  let start = range ? value?.[0] || '' : value || '';
  let end = range ? value?.[1] || '' : '';
  let picking = false;
  let hover = '';

  const monthId = nextId('dp-month');
  const anchorDay = start || clampISO(today, min, max) || today;
  let view = anchorDay.slice(0, 7);
  let cursor = anchorDay;

  const nav = document.createElement('div');
  nav.className = 'dp__nav';
  nav.innerHTML = `
    <button type="button" class="dp__navbtn" data-step="-1" aria-label="${t('date.prevMonth')}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <div class="dp__month" id="${monthId}" aria-live="polite"></div>
    <button type="button" class="dp__navbtn" data-step="1" aria-label="${t('date.nextMonth')}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    </button>`;
  el.appendChild(nav);

  const grid = document.createElement('div');
  grid.className = 'dp__grid';
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-labelledby', monthId);
  el.appendChild(grid);

  const monthLabel = nav.querySelector('.dp__month');
  const prevBtn = nav.querySelector('[data-step="-1"]');
  const nextBtn = nav.querySelector('[data-step="1"]');

  const longDay = (iso) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH', {
      weekday: 'long',
      timeZone: 'UTC',
    });

  const draw = () => {
    monthLabel.textContent = monthLong(view);

    // ปิดปุ่มเลื่อนเดือนเมื่อทั้งเดือนปลายทางอยู่นอกช่วง — กดแล้วไม่มีอะไรให้เลือกก็ไม่ต้องให้กด
    const firstOfView = `${view}-01`;
    const lastOfView = endOfPrevMonth(addMonths(firstOfView, 1));
    prevBtn.disabled = Boolean(min && addDays(firstOfView, -1) < min);
    nextBtn.disabled = Boolean(max && addDays(lastOfView, 1) > max);

    grid.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'dp__row dp__row--head';
    head.setAttribute('role', 'row');
    const names = weekdayNames();
    for (let i = 0; i < 7; i++) {
      const th = document.createElement('span');
      th.className = 'dp__dow';
      th.setAttribute('role', 'columnheader');
      th.textContent = names[i];
      th.setAttribute('aria-label', longDay(toISO(1970, 0, 4 + WEEK_START + i)));
      head.appendChild(th);
    }
    grid.appendChild(head);

    const cells = monthGrid(view);
    for (let r = 0; r < 6; r++) {
      const row = document.createElement('div');
      row.className = 'dp__row';
      row.setAttribute('role', 'row');
      for (let c = 0; c < 7; c++) {
        const { iso, inMonth } = cells[r * 7 + c];
        const day = document.createElement('button');
        day.type = 'button';
        day.className = 'dp__day';
        day.setAttribute('role', 'gridcell');
        day.dataset.iso = iso;
        day.textContent = String(Number(iso.slice(8, 10)));

        const off = isDisabled(iso, min, max);
        if (!inMonth) day.classList.add('is-out');
        if (off) {
          day.disabled = true;
          day.setAttribute('aria-disabled', 'true');
        }

        // ปลายทางชั่วคราวตอนลากเมาส์ — ให้เห็นว่ากำลังจะได้ช่วงไหนก่อนคลิกที่สอง
        const tail = end || (picking && hover) || '';
        const isEdge = iso === start || (Boolean(tail) && iso === tail);
        const lo = start && tail ? (start < tail ? start : tail) : '';
        const hi = start && tail ? (start < tail ? tail : start) : '';
        const inside = Boolean(lo) && iso > lo && iso < hi;

        if (isEdge) {
          day.classList.add('is-sel');
          day.setAttribute('aria-selected', 'true');
          if (range && lo && hi && lo !== hi) day.classList.add(iso === lo ? 'is-start' : 'is-end');
        } else {
          day.setAttribute('aria-selected', 'false');
        }
        if (range && inside) day.classList.add('is-range');
        if (iso === today) {
          day.classList.add('is-today');
          day.setAttribute('aria-current', 'date');
        }
        // roving tabindex — ทั้งตารางเป็น Tab stop เดียว ไม่งั้นต้องกด Tab 42 ครั้งจึงจะออก
        day.tabIndex = iso === cursor ? 0 : -1;
        day.setAttribute(
          'aria-label',
          `${longDay(iso)} ${dateFull(iso)}${iso === today ? ` (${t('date.today')})` : ''}`
        );
        row.appendChild(day);
      }
      grid.appendChild(row);
    }
  };

  /** ย้ายเคอร์เซอร์ไปวันหนึ่ง เปลี่ยนเดือนที่แสดงถ้าจำเป็น แล้ววางโฟกัส */
  const moveTo = (iso, dir) => {
    const target = nextEnabled(iso, dir, min, max);
    if (!target) return;
    cursor = target;
    if (target.slice(0, 7) !== view) view = target.slice(0, 7);
    draw();
    grid.querySelector(`[data-iso="${cursor}"]`)?.focus();
  };

  const stepMonth = (n) => {
    view = addMonths(`${view}-01`, n).slice(0, 7);
    draw();
  };

  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (btn) stepMonth(Number(btn.dataset.step));
  });

  grid.addEventListener('click', (e) => {
    const day = e.target.closest('.dp__day');
    if (!day || day.disabled) return;
    const iso = day.dataset.iso;

    if (!range) {
      onPick(iso);
      return;
    }

    /* คลิกแรกตั้งต้นทาง คลิกที่สองปิดช่วง — คลิกที่สองก่อนต้นทางถือว่าสลับหัวท้ายให้
     * ไม่ใช่ error เพราะคนเลือกจากขวาไปซ้ายเป็นเรื่องปกติ */
    if (!picking) {
      start = iso;
      end = '';
      picking = true;
      cursor = iso;
      draw();
      return;
    }
    const from = iso < start ? iso : start;
    const to = iso < start ? start : iso;
    start = from;
    end = to;
    picking = false;
    hover = '';
    cursor = to;
    draw();
    onPick([from, to]);
  });

  if (range) {
    grid.addEventListener('mouseover', (e) => {
      if (!picking) return;
      const day = e.target.closest('.dp__day');
      if (!day || day.disabled || day.dataset.iso === hover) return;
      hover = day.dataset.iso;
      draw();
    });
  }

  grid.addEventListener('keydown', (e) => {
    if (!e.target.closest('.dp__day')) return;
    const target = keyTarget(cursor, e.key, e.shiftKey);
    if (!target) return;
    e.preventDefault();
    // ทิศทางของการค้นหาวันที่เลือกได้ = ทิศที่ผู้ใช้กำลังเดินไป
    moveTo(target, target > cursor ? 1 : -1);
  });

  draw();

  return {
    el,
    focus: () => grid.querySelector(`[data-iso="${cursor}"]`)?.focus(),
    setValue(next) {
      start = range ? next?.[0] || '' : next || '';
      end = range ? next?.[1] || '' : '';
      picking = false;
      hover = '';
      if (start) {
        cursor = start;
        view = start.slice(0, 7);
      }
      draw();
    },
  };
}

/**
 * ปฏิทินแบบฝังในกล่องที่มีอยู่แล้ว — ไม่มีกล่องลอย ไม่มีกรอบเป็นของตัวเอง
 *
 * ใช้กับช่วงวันที่ของรายงาน Dryflower ซึ่งอยู่ใน `.filter-pop` อยู่แล้ว
 * **ห้ามเปิดเป็น popup ซ้อน popup** ที่นั่น (กฎเดียวกับ multiDropdown ใน filters.js:358)
 *
 * @returns {{el:HTMLElement, setValue:(v:any)=>void}}
 */
export function inlineDatePicker({
  value,
  mode = 'range',
  min = '',
  max = '',
  today = '',
  presets = null,
  onChange,
}) {
  const now = today || localToday();
  const wrap = document.createElement('div');
  wrap.className = 'dp dp--inline';

  const list =
    presets ?? (mode === 'range' ? defaultRangePresets({ today: now, min, max }) : defaultPresets({ today: now, min, max }));

  const cal = buildCalendar({
    value,
    mode,
    min,
    max,
    today: now,
    onPick: (next) => onChange?.(next),
  });

  if (list.length) {
    const col = document.createElement('div');
    col.className = 'dp__presets';
    col.setAttribute('role', 'group');
    col.setAttribute('aria-label', t('date.shortcuts'));
    for (const p of list) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'dp__preset';
      chip.textContent = t(p.labelKey);
      const picked = mode === 'range' ? p.from && p.to : p.iso;
      if (!picked) {
        chip.disabled = true;
        chip.title = t('date.outOfRange');
      } else {
        chip.addEventListener('click', () => {
          const next = mode === 'range' ? [p.from, p.to] : p.iso;
          cal.setValue(next);
          onChange?.(next);
        });
      }
      col.appendChild(chip);
    }
    wrap.appendChild(col);
  }

  wrap.appendChild(cal.el);
  return { el: wrap, setValue: (v) => cal.setValue(v) };
}

/**
 * ปุ่มเปิดตัวเลือกวันที่ — คืน `<button>` ที่มี `__setValue(iso)` และ `__close()`
 *
 * @param {object} o
 * @param {string} o.value            `YYYY-MM-DD` หรือ `''` (= ยังไม่ได้เลือก)
 * @param {string} [o.min] [o.max]    ขอบเขตที่เลือกได้ (รวมปลายทั้งสองข้าง)
 * @param {string} [o.today]          วันที่ถือว่าเป็น "วันนี้" — ดูหมายเหตุที่ผู้เรียก
 * @param {string} [o.label]          ป้ายกำกับที่อยู่ในปุ่มเอง (เช่น "ดูสต๊อก ณ วันที่")
 * @param {string} [o.className]      คลาสเพิ่มของปุ่ม — ปุ่มนี้ *เป็น* ตัวควบคุมทั้งชิ้น
 * @param {string} [o.placeholder]    ข้อความตอนยังไม่ได้เลือก
 * @param {Array|null} [o.presets]    `null` = ชุดมาตรฐาน · `[]` = ไม่มีปุ่มลัด
 * @param {(iso:string)=>void} o.onChange  ได้ `''` หรือ `YYYY-MM-DD` เท่านั้น
 */
export function datePicker({
  value = '',
  min = '',
  max = '',
  today = '',
  label: labelText = '',
  className = '',
  placeholder = '',
  presets = null,
  clearable = true,
  /* ข้อความใต้ปฏิทินที่อธิบายว่าทำไมบางวันเลือกไม่ได้ — **ผู้เรียกเป็นคนเขียน**
   * เหตุผลของขอบเขตต่างกันตามที่ใช้: หน้า Supply คือ "ยอดหลังวันนี้เป็นยอดยกมา"
   * ส่วนตารางดิบใน modal คือ "ชีตมีข้อมูลแค่ช่วงนี้" — ข้อความเดียวใช้ทั้งสองที่ไม่ได้ */
  note = '',
  // ผู้เรียกที่อยู่ใน modal ต้องส่งคลาสที่ยก z-index ให้ลอยเหนือ modal เอง
  rootClass = 'filter-pop-root',
  onChange,
}) {
  const now = today || localToday();
  let current = value && ISO_RE.test(value) ? value : '';

  /* ปุ่มนี้เป็นตัวควบคุมทั้งชิ้น — ป้ายกำกับอยู่ **ใน** ปุ่ม ไม่ใช่ข้าง ๆ
   * เพราะป้ายที่อยู่นอกปุ่มคือพื้นที่ตายที่กดแล้วไม่เกิดอะไร ทั้งที่ตาเห็นเป็นชิ้นเดียวกัน
   * (และได้ชื่อที่ screen reader อ่านฟรีจากข้อความในปุ่ม ไม่ต้องพึ่ง aria-labelledby) */
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className ? `dp-trigger ${className}` : 'dp-trigger';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');

  if (labelText) {
    const cap = document.createElement('span');
    cap.className = 'filter-year__label';
    cap.textContent = labelText;
    btn.appendChild(cap);
  }

  const label = document.createElement('span');
  label.className = 'dp-trigger__value';
  btn.appendChild(label);

  const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  caret.setAttribute('class', 'dp-trigger__icon');
  caret.setAttribute('viewBox', '0 0 24 24');
  caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML =
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  btn.appendChild(caret);

  const paint = () => {
    label.textContent = current ? dateFull(current) : placeholder || t('date.notSelected');
    btn.classList.toggle('is-empty', !current);
  };
  paint();

  /** ส่งค่าออก — ด่านสุดท้ายก่อนถึง `stockAt()` ที่เทียบสตริงตรง ๆ */
  const commit = (iso) => {
    const next = iso ? clampISO(iso, min, max) : '';
    if (next && !ISO_RE.test(next)) return;
    current = next;
    paint();
    closePopover();
    onChange?.(next);
  };

  btn.addEventListener('click', () => {
    const titleId = nextId('dp-title');
    openPopover({
      anchor: btn,
      width: 480,
      rootClass,
      labelledBy: titleId,
      onClosed: () => btn.setAttribute('aria-expanded', 'false'),
      build(panel) {
        /* หัว / เนื้อ / ท้าย แยกกันแบบเดียวกับ popup ตัวกรอง — ปุ่มกับคำอธิบายต้องอยู่
         * **นอก** กล่องที่เลื่อนได้ ไม่งั้นพอปฏิทินสูงกว่าที่ว่างบนจอ ปุ่ม "ล้างวันที่"
         * จะเลื่อนหายไปใต้ขอบล่างโดยที่ไม่มีอะไรบอกว่ามันมีอยู่ */
        panel.innerHTML = `
          <div class="filter-pop__head">
            <h2 class="filter-pop__title" id="${titleId}"></h2>
            <button type="button" class="filter-pop__close"></button>
          </div>
          <div class="filter-pop__body"></div>`;
        panel.querySelector('.filter-pop__title').textContent = t('date.pick');
        const closeBtn = panel.querySelector('.filter-pop__close');
        closeBtn.setAttribute('aria-label', t('action.close'));
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => closePopover());

        const body = panel.querySelector('.filter-pop__body');
        const wrap = document.createElement('div');
        wrap.className = 'dp';
        body.appendChild(wrap);

        const list = presets ?? defaultPresets({ today: now, min, max });
        // ไม่มีปุ่มลัด = ไม่ต้องกันคอลัมน์ซ้ายไว้ ไม่งั้นปฏิทินถูกบีบไปครึ่งเดียวของกล่อง
        if (!list.length) wrap.classList.add('dp--nopresets');
        if (list.length) {
          const col = document.createElement('div');
          col.className = 'dp__presets';
          col.setAttribute('role', 'group');
          col.setAttribute('aria-label', t('date.shortcuts'));
          for (const p of list) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'dp__preset';
            chip.textContent = t(p.labelKey);
            if (!p.iso) {
              chip.disabled = true;
              chip.title = t('date.outOfRange');
            } else {
              if (p.iso === current) chip.classList.add('is-on');
              chip.addEventListener('click', () => commit(p.iso));
            }
            col.appendChild(chip);
          }
          wrap.appendChild(col);
        }

        const cal = buildCalendar({ value: current, min, max, today: now, onPick: commit });
        wrap.appendChild(cal.el);

        const foot = document.createElement('div');
        foot.className = 'filter-pop__foot dp__foot';
        if (note) {
          // ตอบคำถาม "ทำไมกดวันนั้นไม่ได้" ตรงจุดที่คนกำลังสงสัย
          const p = document.createElement('p');
          p.className = 'dp__note';
          p.textContent = note;
          foot.appendChild(p);
        }
        if (clearable) {
          const clear = document.createElement('button');
          clear.type = 'button';
          clear.className = 'btn btn--sm dp__clear';
          clear.textContent = t('date.clear');
          clear.disabled = !current;
          clear.addEventListener('click', () => commit(''));
          foot.appendChild(clear);
        }
        if (foot.childElementCount) panel.appendChild(foot);

        // โฟกัสเข้าปฏิทินเลย ไม่ใช่ที่ปุ่มปิด — คนเปิดปฏิทินมาเพื่อเลือกวัน
        queueMicrotask(() => cal.focus());
      },
    });
    btn.setAttribute('aria-expanded', 'true');
  });

  btn.__setValue = (iso) => {
    current = iso && ISO_RE.test(iso) ? iso : '';
    paint();
  };
  btn.__close = () => closePopover();

  return btn;
}
