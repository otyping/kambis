/**
 * ui/filters.js — แถบตัวกรองกลางของรายงาน Dryflower
 *
 * เอกสารกำหนดไว้ 5 ตัว: ช่วงเวลา · สายพันธุ์ · ครอป · สถานที่ · ขนาดดอก
 * กรองพร้อมกันทุกการ์ดและทุกกราฟในรายงาน
 *
 * หลักการสำคัญสองข้อ
 *
 * 1. **กรองที่ระดับ record ไม่ใช่ที่ระดับตัวเลขที่รวมมาแล้ว**
 *    ทุกหน้าคำนวณจาก payload.sources[key].rows ตัวกรองจึงเป็นแค่ rows.filter()
 *    ถ้าไปกรองบน kpi.* ที่ server รวมมาแล้ว จะกรองไม่ได้จริงและตัวเลขจะเพี้ยน
 *
 * 2. **ห้ามแก้ record เดิม** — คัดลอกแบบตื้นแล้วคำนวณยอดใหม่
 *    payload ถูกใช้ซ้ำทุกครั้งที่สลับหน้า/ธีม/ภาษา ถ้าแก้ของเดิมตัวเลขจะเพี้ยนสะสม
 *
 * สถานะเก็บใน hash (`#/dryflower/stock?strain=Shogun`) เพื่อให้ส่งลิงก์ต่อได้
 * และรีเฟรชแล้วตัวกรองยังอยู่
 *
 * ─── รูปแบบหน้าตา ───
 *
 * สิ่งที่เห็นตลอดเวลาเป็นแถวเดียวเตี้ย ๆ: ปุ่ม "ตัวกรอง" + ชิปสรุป + ปุ่มล้าง
 * ตัวเลือกทั้งหมดอยู่ใน popup ที่กดเปิด เพื่อไม่ให้กินพื้นที่จอตลอดเวลา
 *
 * **popup ถูกแขวนไว้ที่ `document.body` ไม่ใช่ใน `#filter-host`** เพราะทุกครั้งที่
 * ตัวกรองเปลี่ยน main.js จะวาดหน้าใหม่ ถ้า popup อยู่ในกล่องที่ถูกล้าง
 * มันจะปิดตัวเองทุกครั้งที่ติ๊กเลือก ซึ่งใช้งานไม่ได้
 * มี popup ได้ทีละอันเท่านั้น (ตัวแปร `live`) และตอนปิดต้องถอด listener
 * ของ window ให้ครบ ไม่งั้นจะค้างอยู่ทุกครั้งที่เปิด
 */
import { t } from '../i18n.js';
import { esc } from '../format.js';

export const SIZE_KEYS = ['XXL', 'XL', 'L', 'M', 'S', 'XS'];

/** รายงานไหนเป็นข้อมูลของสถานที่ใด — ใช้ตอนกรองตามสถานที่ */
const SOURCE_LOCATION = {
  dailyTrim: 'huahin',
  perCrop: 'huahin',
  outbound: 'huahin',
  inbound: 'bangkok',
  sales: 'bangkok',
  // inventory มีทั้งสองคลังในรายงานเดียว จึงดูจากฟิลด์ location ของแต่ละแถวแทน
};

/** อ่านตัวกรองจาก URLSearchParams */
export function readFilters(params) {
  const list = (key) => {
    const v = params.get(key);
    return v ? new Set(v.split('|').filter(Boolean)) : 'all';
  };
  return {
    /* '' = ยังไม่เลือกเอง → ใช้ปีล่าสุดที่มีข้อมูล (ดู resolveYear)
     * 'all' = ผู้ใช้เลือกดูย้อนหลังทั้งหมดเอง — ต้องแยกจาก '' ให้ได้
     * ไม่งั้นพอกดล้างตัวกรองแล้วมันจะเด้งกลับไปปีล่าสุดทันทีทั้งที่ตั้งใจดูทุกปี */
    year: params.get('year') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    granularity: params.get('by') || 'month',
    strains: list('strain'),
    crops: list('crop'),
    location: params.get('loc') || 'all',
    sizes: list('size'),
  };
}

/** เขียนตัวกรองกลับเป็น URLSearchParams (ตัวที่เป็นค่าเริ่มต้นจะไม่ใส่ ให้ URL สั้น) */
export function writeFilters(filters) {
  const params = new URLSearchParams();
  const put = (key, value) => {
    if (value && value !== 'all') params.set(key, value);
  };
  const putSet = (key, set) => {
    if (set !== 'all' && set.size) params.set(key, [...set].join('|'));
  };
  // ปีเขียนลง URL รวม 'all' ด้วย เพราะ 'all' คือการเลือกเอง ไม่ใช่ค่าเริ่มต้น
  if (filters.year) params.set('year', filters.year);
  put('from', filters.from);
  put('to', filters.to);
  if (filters.granularity && filters.granularity !== 'month') params.set('by', filters.granularity);
  putSet('strain', filters.strains);
  putSet('crop', filters.crops);
  put('loc', filters.location);
  putSet('size', filters.sizes);
  return params;
}

export function isFiltered(f) {
  return Boolean(
    f.year || f.from || f.to || f.strains !== 'all' || f.crops !== 'all' || f.location !== 'all' || f.sizes !== 'all'
  );
}

/**
 * ปีของหนึ่ง record
 *
 * ไม่ใช่ทุกรายงานที่มีคอลัมน์วันที่: รายงานต่อครอปอ้างอิงรอบปลูก (วันเก็บเกี่ยว)
 * และบางแถวมีแต่ไตรมาส ส่วนสินค้าคงเหลือเป็นภาพนิ่งของ "ตอนนี้" ไม่มีวันที่เลย
 *
 * @returns {string|null} 'YYYY' หรือ null เมื่อแถวนี้ไม่ผูกกับปีใดปีหนึ่ง
 */
export function recordYear(rec) {
  if (rec.date) return String(rec.date).slice(0, 4);
  if (rec.cycle?.harvest) return String(rec.cycle.harvest).slice(0, 4);
  const m = String(rec.quarter ?? '').match(/(\d{4})/);
  return m ? m[1] : null;
}

/**
 * ปีที่กำลังดูอยู่จริง
 *
 * @param {object} filters ค่าจาก readFilters
 * @param {string[]} years ปีที่มีข้อมูล เรียงใหม่→เก่า
 * @returns {string|null} null = ดูทุกปี
 */
export function resolveYear(filters, years = []) {
  if (filters.year === 'all') return null;
  if (filters.year) return filters.year;
  return years[0] ?? null;
}

/** เติมปีที่ resolve แล้วลงในชุดตัวกรอง เพื่อให้ applyFilters ใช้ได้ตรง ๆ */
export function resolveFilters(filters, options = {}) {
  return { ...filters, resolvedYear: resolveYear(filters, options.years ?? []) };
}

/**
 * กรองแถวของรายงานหนึ่ง
 * @param {Array} rows
 * @param {object} filters
 * @param {string} sourceKey
 * @returns {Array} array ใหม่ ไม่แตะของเดิม
 */
export function applyFilters(rows, filters, sourceKey) {
  if (!rows?.length) return [];

  // ตัดทั้งรายงานทิ้งถ้าไม่ใช่สถานที่ที่เลือก (ยกเว้น inventory ที่ดูรายแถว)
  if (filters.location !== 'all' && sourceKey !== 'inventory') {
    const belongs = SOURCE_LOCATION[sourceKey];
    if (belongs && belongs !== filters.location) return [];
  }

  const sizeFilterOn = filters.sizes !== 'all' && filters.sizes.size > 0;
  const year = filters.resolvedYear ?? null;
  const out = [];

  for (const rec of rows) {
    if (filters.location !== 'all' && sourceKey === 'inventory') {
      const isHuaHin = /หัวหิน|hua\s*hin/i.test(rec.location ?? '');
      if ((filters.location === 'huahin') !== isHuaHin) continue;
    }

    /* ปี — แถวที่ไม่ผูกกับปีใดปีหนึ่ง (สินค้าคงเหลือ ซึ่งเป็นภาพนิ่งของตอนนี้)
     * ต้องไม่ถูกตัดออก ใช้หลักเดียวกับตัวกรองช่วงวันที่ด้านล่าง */
    if (year) {
      const y = recordYear(rec);
      if (y && y !== year) continue;
    }
    if (filters.strains !== 'all' && !filters.strains.has(rec.strain ?? '')) continue;
    if (filters.crops !== 'all' && !filters.crops.has(rec.crop ?? '')) continue;

    // ช่วงวันที่ — แถวที่ไม่มีวันที่ (เช่น inventory) ไม่ถูกตัดออกด้วยตัวกรองนี้
    if (rec.date) {
      if (filters.from && rec.date < filters.from) continue;
      if (filters.to && rec.date > filters.to) continue;
    }

    if (!sizeFilterOn) {
      out.push(rec);
      continue;
    }

    /* กรองตามขนาด: เก็บเฉพาะขนาดที่เลือก แล้วคำนวณยอดใหม่จากที่เหลือ
     * ต้องคัดลอกก่อนเสมอ ห้ามแก้ record เดิมของ payload */
    const sizes = {};
    let flowerTotal = null;
    let premiumTotal = null;
    for (const key of SIZE_KEYS) {
      const keep = filters.sizes.has(key);
      const v = keep ? rec.sizes?.[key] ?? null : null;
      sizes[key] = v;
      if (v !== null) {
        flowerTotal = (flowerTotal ?? 0) + v;
        if (key !== 'S' && key !== 'XS') premiumTotal = (premiumTotal ?? 0) + v;
      }
    }
    // ไม่มีขนาดที่เลือกอยู่ในแถวนี้เลย → แถวนี้ไม่เกี่ยวกับสิ่งที่ผู้ใช้ถาม
    if (flowerTotal === null) continue;

    out.push({ ...rec, sizes, flowerTotal, premiumTotal });
  }

  return out;
}

/** กรองทุกรายงานในทีเดียว — คืน object รูปเดียวกับ payload.sources */
export function filterSources(sources, filters) {
  const out = {};
  for (const [key, source] of Object.entries(sources ?? {})) {
    out[key] = { ...source, rows: applyFilters(source.rows, filters, key) };
  }
  return out;
}

/** ค่าที่เลือกได้จริง ดึงจากข้อมูลที่โหลดมา ไม่ใช่รายการตายตัว */
export function filterOptions(sources) {
  const strains = new Set();
  const crops = new Set();
  const years = new Set();
  let minDate = null;
  let maxDate = null;

  for (const source of Object.values(sources ?? {})) {
    for (const rec of source.rows ?? []) {
      if (rec.strain) strains.add(rec.strain);
      if (rec.crop) crops.add(rec.crop);
      const year = recordYear(rec);
      if (year) years.add(year);
      if (rec.date) {
        if (!minDate || rec.date < minDate) minDate = rec.date;
        if (!maxDate || rec.date > maxDate) maxDate = rec.date;
      }
    }
  }
  return {
    strains: [...strains].sort((a, b) => a.localeCompare(b)),
    crops: [...crops].sort((a, b) => a.localeCompare(b)),
    // ใหม่→เก่า เพราะตัวแรกคือค่าเริ่มต้น และคนดูปีล่าสุดบ่อยที่สุด
    years: [...years].sort((a, b) => b.localeCompare(a)),
    minDate,
    maxDate,
  };
}

/* ═══════════════════════════════════════════════════════════════
   ส่วนหน้าตา
   ═══════════════════════════════════════════════════════════════ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/* ค่าที่ถือว่า "ไม่ได้กรองอะไรเลย"
 * `year: ''` ไม่ได้แปลว่าทุกปี แต่แปลว่ากลับไปใช้ค่าเริ่มต้น = ปีล่าสุดที่มีข้อมูล
 * ตามที่ผู้ใช้กำหนดไว้ว่า Dashboard ต้องเปิดมาที่ปีล่าสุดเสมอ */
const CLEARED = { year: '', from: '', to: '', strains: 'all', crops: 'all', location: 'all', sizes: 'all' };

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

/** เซ็ตว่าง = ดูทั้งหมด (ไม่ใช่ "ไม่แสดงอะไรเลย" ซึ่งไม่มีประโยชน์) */
const asSet = (v) => (v instanceof Set && v.size > 0 ? v : 'all');

/** บังคับรูปร่างของ object ตัวกรองให้ตรงสัญญาเสมอ ไม่ว่าจะถูกเรียกมาจากทางไหน */
function normalize(f) {
  return {
    year: f.year || '',
    from: f.from || '',
    to: f.to || '',
    granularity: f.granularity || 'month',
    strains: asSet(f.strains),
    crops: asSet(f.crops),
    location: f.location || 'all',
    sizes: asSet(f.sizes),
  };
}

const locationLabel = (v) =>
  v === 'huahin' ? t('filter.huahin') : v === 'bangkok' ? t('filter.bangkok') : t('filter.allLocations');

/** ย่อเซ็ตให้อ่านออกในที่แคบ — ไม่กี่ตัวบอกชื่อ มากกว่านั้นบอกจำนวน */
function setSummary(set, maxNames = 2) {
  if (set === 'all') return t('filter.all');
  const list = [...set];
  return list.length <= maxNames ? list.join(', ') : `${list.length} ${t('filter.items')}`;
}

/**
 * สรุปว่ากำลังกรองอะไรอยู่ → ชิปหนึ่งใบต่อหนึ่งรายการ
 * `clear` คือส่วนที่ต้อง patch ทับเพื่อลบตัวกรองนั้นออก
 */
function summarize(f) {
  const items = [];

  if (f.from || f.to) {
    const text =
      f.from && f.to
        ? `${f.from} – ${f.to}`
        : f.from
          ? `${t('filter.from')} ${f.from}`
          : `${t('filter.to')} ${f.to}`;
    items.push({ label: t('filter.dateRange'), text, clear: { from: '', to: '' } });
  }
  if (f.location !== 'all') {
    items.push({
      label: t('filter.location'),
      text: locationLabel(f.location),
      clear: { location: 'all' },
    });
  }
  for (const [key, labelKey] of [
    ['sizes', 'filter.size'],
    ['strains', 'filter.strain'],
    ['crops', 'filter.crop'],
  ]) {
    if (f[key] === 'all') continue;
    items.push({ label: t(labelKey), text: setSummary(f[key], 3), clear: { [key]: 'all' } });
  }
  return items;
}

/* ── popup ────────────────────────────────────────────────────
 * มีได้ทีละอันเท่านั้น — ตัวใหม่เกิดเมื่อไหร่ ตัวเก่าต้องตายก่อน
 */
let live = null;

/** ปิด popup ตัวกรองถ้าเปิดค้างอยู่ (main.js เรียกตอนออกจากรายงาน Dryflower) */
export function closeFilterPopup() {
  live?.close();
}

/**
 * dropdown เลือกได้หลายค่า — ปุ่มกดแล้วกางรายการ checkbox ออกมาในตัว popup เอง
 *
 * ไม่ทำเป็น popup ซ้อน popup เพราะจะต้องคุมตำแหน่งและ focus trap สองชั้น
 * แล้วบนจอเล็กจะไม่มีที่ให้กางเลย
 *
 * @returns {{el:HTMLElement, close:()=>void}}
 */
function multiDropdown({ name, values, selected, searchable, onOpen, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'fdrop';

  const panelId = nextId('fdrop');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fdrop__btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', panelId);
  btn.innerHTML =
    `<span class="fdrop__name">${esc(name)}</span>` +
    '<span class="fdrop__value"></span>' +
    '<span class="fdrop__caret" aria-hidden="true"></span>';
  const valueEl = btn.querySelector('.fdrop__value');

  const panel = document.createElement('div');
  panel.className = 'fdrop__panel';
  panel.id = panelId;
  panel.hidden = true;

  const list = document.createElement('div');
  list.className = 'fdrop__list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', name);

  for (const value of values) {
    const opt = document.createElement('label');
    opt.className = 'fdrop__opt';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = value;
    // 'all' = เลือกครบทุกตัว — ติ๊กไว้ทั้งหมดเหมือนตัวกรองในตารางที่ผู้ใช้คุ้นเคย
    box.checked = selected === 'all' || selected.has(value);
    const text = document.createElement('span');
    text.textContent = value;
    opt.append(box, text);
    list.appendChild(opt);
  }

  const boxes = () => [...list.querySelectorAll('input[type="checkbox"]')];

  /** ค่าที่เลือกอยู่จริง — ครบทุกตัวหรือไม่เลือกเลย ถือเป็น 'all' ทั้งคู่ */
  const read = () => {
    const picked = boxes()
      .filter((b) => b.checked)
      .map((b) => b.value);
    return picked.length === 0 || picked.length === values.length ? 'all' : new Set(picked);
  };

  const emit = () => {
    valueEl.textContent = setSummary(read());
    onChange(read());
  };
  valueEl.textContent = setSummary(selected);

  const empty = document.createElement('p');
  empty.className = 'fdrop__empty';
  empty.hidden = values.length > 0;
  empty.textContent = t('filter.noOptions');

  // ── ช่องค้นหา (เฉพาะรายการยาว เช่น ครอปมีเกือบ 40 อัน) ──
  let search = null;
  if (searchable) {
    search = document.createElement('input');
    search.type = 'search';
    search.className = 'fdrop__search';
    search.placeholder = t('filter.search');
    search.setAttribute('aria-label', `${t('filter.search')} · ${name}`);
    search.addEventListener('input', () => {
      const needle = search.value.trim().toLowerCase();
      let shown = 0;
      for (const opt of list.children) {
        const hit = !needle || opt.textContent.toLowerCase().includes(needle);
        opt.hidden = !hit;
        if (hit) shown += 1;
      }
      empty.hidden = shown > 0;
      empty.textContent = shown > 0 ? '' : t('filter.noMatch');
    });
    // Enter ในช่องค้นหาไม่ควรทำอะไร — กันไม่ให้ไปโดนปุ่มอื่น
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
  }

  // ── เลือกทั้งหมด / ล้าง (ทำกับรายการที่มองเห็นอยู่ เพื่อให้ใช้คู่กับช่องค้นหาได้) ──
  const acts = document.createElement('div');
  acts.className = 'fdrop__acts';
  const actBtn = (label, checked) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fdrop__act';
    b.textContent = label;
    b.addEventListener('click', () => {
      for (const opt of list.children) {
        if (!opt.hidden) opt.querySelector('input').checked = checked;
      }
      emit();
    });
    return b;
  };
  acts.append(actBtn(t('filter.selectAll'), true), actBtn(t('filter.clearSel'), false));

  const hint = document.createElement('p');
  hint.className = 'fdrop__hint';
  hint.textContent = t('filter.noneHint');

  list.addEventListener('change', emit);

  if (search) panel.appendChild(search);
  panel.append(acts, list, empty, hint);
  wrap.append(btn, panel);

  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('is-open');
  };

  btn.addEventListener('click', () => {
    const willOpen = panel.hidden;
    onOpen(); // ปิดตัวอื่นก่อน — กางทีละอันเดียว popup จะได้ไม่ยาวจนต้องเลื่อนหา
    if (!willOpen) return;
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    wrap.classList.add('is-open');
    (search ?? list.querySelector('input'))?.focus();
  });

  return { el: wrap, close };
}

/**
 * เปิด popup ตัวกรอง — แขวนไว้ที่ document.body จึงรอดจากการวาดหน้าใหม่
 *
 * @param {object} o
 * @param {HTMLElement} o.anchor       ปุ่มที่กดเปิด (ใช้วางตำแหน่ง + คืน focus)
 * @param {object} o.options           ค่าที่เลือกได้ (จาก filterOptions)
 * @param {()=>object} o.getState      อ่านตัวกรองล่าสุด (แถบเป็นเจ้าของสถานะ)
 * @param {(next:object)=>void} o.apply
 * @param {()=>void} o.onClosed
 */
function openPopup({ anchor, options, getState, apply, onClosed }) {
  const root = document.createElement('div');
  root.className = 'filter-pop-root';

  const panel = document.createElement('div');
  panel.className = 'filter-pop';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  const titleId = nextId('filter-pop-title');
  panel.setAttribute('aria-labelledby', titleId);
  panel.innerHTML = `
    <div class="filter-pop__head">
      <h2 class="filter-pop__title" id="${titleId}">${esc(t('filter.title'))}</h2>
      <button type="button" class="filter-pop__close" aria-label="${esc(t('action.close'))}">&times;</button>
    </div>
    <div class="filter-pop__body"></div>
    <div class="filter-pop__foot">
      <button type="button" class="btn btn--sm filter-pop__reset">${esc(t('filter.reset'))}</button>
      <button type="button" class="btn btn--sm btn--primary filter-pop__done">${esc(t('filter.done'))}</button>
    </div>`;
  root.appendChild(panel);

  const body = panel.querySelector('.filter-pop__body');
  const drops = [];

  /** ปิด dropdown ทุกอันที่กางอยู่ */
  const collapseAll = () => {
    for (const d of drops) d.close();
  };

  /** สร้างเนื้อใน popup ใหม่จากสถานะล่าสุด (ใช้ตอนเปิดและตอนกดล้างตัวกรอง) */
  const buildBody = () => {
    drops.length = 0;
    body.innerHTML = '';
    const f = getState();

    // ── ช่วงวันที่ ──
    const dates = document.createElement('div');
    dates.className = 'filter-field';
    dates.innerHTML = `
      <span class="filter-label">${esc(t('filter.dateRange'))}</span>
      <div class="filter-dates">
        <input type="date" class="filter-date" data-k="from" value="${esc(f.from)}"
               min="${esc(options.minDate ?? '')}" max="${esc(options.maxDate ?? '')}"
               aria-label="${esc(t('filter.from'))}">
        <span aria-hidden="true">–</span>
        <input type="date" class="filter-date" data-k="to" value="${esc(f.to)}"
               min="${esc(options.minDate ?? '')}" max="${esc(options.maxDate ?? '')}"
               aria-label="${esc(t('filter.to'))}">
      </div>`;
    dates.addEventListener('change', (e) => {
      const input = e.target.closest('.filter-date');
      if (input) apply({ ...getState(), [input.dataset.k]: input.value });
    });
    body.appendChild(dates);

    // ── สถานที่ ──
    const loc = document.createElement('div');
    loc.className = 'filter-field';
    const locId = nextId('f-loc');
    loc.innerHTML = `
      <label class="filter-label" for="${locId}">${esc(t('filter.location'))}</label>
      <select class="filter-pick" id="${locId}">
        <option value="all">${esc(t('filter.allLocations'))}</option>
        <option value="huahin">${esc(t('filter.huahin'))}</option>
        <option value="bangkok">${esc(t('filter.bangkok'))}</option>
      </select>`;
    const locSelect = loc.querySelector('select');
    locSelect.value = f.location;
    locSelect.addEventListener('change', () => apply({ ...getState(), location: locSelect.value }));
    body.appendChild(loc);

    // ── ขนาดดอก · สายพันธุ์ · ครอป ──
    for (const [key, labelKey, values] of [
      ['sizes', 'filter.size', SIZE_KEYS],
      ['strains', 'filter.strain', options.strains],
      ['crops', 'filter.crop', options.crops],
    ]) {
      const drop = multiDropdown({
        name: t(labelKey),
        values,
        selected: f[key],
        searchable: values.length > 8,
        onOpen: collapseAll,
        onChange: (value) => apply({ ...getState(), [key]: value }),
      });
      drops.push(drop);
      body.appendChild(drop.el);
    }
  };

  buildBody();

  // ── ตำแหน่ง ──
  // จอเล็กเป็น bottom sheet เต็มความกว้าง (คุมด้วยคลาส .is-sheet ใน CSS)
  // จอใหญ่ลอยใต้ปุ่ม — ต้องคำนวณใหม่เมื่อหน้าเลื่อนหรือขนาดจอเปลี่ยน
  const place = () => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      root.classList.add('is-sheet');
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.maxHeight = '';
      return;
    }
    root.classList.remove('is-sheet');
    const r = anchor.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - 12 - w));
    const top = Math.max(12, Math.min(r.bottom + 8, window.innerHeight - 220));
    panel.style.width = `${w}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.max(200, window.innerHeight - top - 16)}px`;
  };

  const api = {
    close() {
      if (live !== api) return;
      live = null;
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      root.remove();
      onClosed?.();
      // แถบอาจถูกสร้างใหม่ไปแล้ว (กดย้อนกลับ/สลับภาษา) — ปุ่มเดิมหลุด DOM ไปแล้ว
      if (anchor.isConnected) anchor.focus();
    },
  };

  // คลิกนอกกล่อง = ปิด (root คลุมเต็มจอ จึงรับคลิกที่ไม่โดน panel ได้ทั้งหมด)
  root.addEventListener('click', (e) => {
    if (e.target === root) api.close();
  });

  // Esc ปิด + วน Tab อยู่ในกล่อง (เหมือน modal.js)
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      api.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
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

  panel.querySelector('.filter-pop__close').addEventListener('click', () => api.close());
  panel.querySelector('.filter-pop__done').addEventListener('click', () => api.close());
  panel.querySelector('.filter-pop__reset').addEventListener('click', (e) => {
    apply({ ...CLEARED, granularity: getState().granularity });
    buildBody(); // ช่องติ๊กต้องกลับไปตรงกับสถานะใหม่ — โฟกัสยังอยู่ที่ปุ่มล้างใน footer
    e.currentTarget.focus();
  });

  document.body.appendChild(root);
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);

  live = api;
  panel.querySelector('.filter-pop__close').focus();
  return api;
}

/**
 * สร้างแถบตัวกรอง — แถวเตี้ยที่เห็นตลอดเวลา ตัวเลือกอยู่ใน popup
 *
 * element ที่คืนมามีเมธอด `__sync(filters)` ให้ main.js เรียกเมื่อ URL เปลี่ยน
 * เพื่ออัปเดตชิปสรุปโดยไม่ต้องสร้างแถบใหม่ (สร้างใหม่ = โฟกัสหลุด + popup ปิด)
 *
 * @param {object} opts
 * @param {object} opts.filters   ค่าปัจจุบัน
 * @param {object} opts.options   ค่าที่เลือกได้ (จาก filterOptions)
 * @param {(next:object)=>void} opts.onChange
 */
export function filterBar({ filters, options, onChange }) {
  // แถบเก่ากำลังจะถูกทิ้ง — popup ที่ผูกกับปุ่มของมันต้องปิดก่อน
  closeFilterPopup();

  let state = normalize(filters);
  const years = options.years ?? [];

  const bar = document.createElement('div');
  bar.className = 'filter-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('filter.title'));

  /* ── ปีอยู่บนแถบ ไม่ได้ซ่อนใน popup ──
   *
   * ต่างจากตัวกรองอื่นตรงที่ **ปีมีค่าอยู่เสมอ** (ค่าเริ่มต้นคือปีล่าสุด)
   * ถ้าเอาไปซ่อนใน popup เหมือนตัวอื่น ผู้ใช้จะไม่มีทางรู้ว่ากำลังดูแค่ปีเดียวอยู่
   * แล้วเข้าใจว่ายอดรวมที่เห็นคือทั้งหมดตั้งแต่เปิดฟาร์ม ซึ่งอันตรายกว่าเปลืองที่บนจอ */
  const yearWrap = document.createElement('label');
  yearWrap.className = 'filter-year';
  yearWrap.title = t('filter.yearHint');
  const yearId = nextId('f-year');
  yearWrap.htmlFor = yearId;
  yearWrap.innerHTML = `<span class="filter-year__label">${esc(t('filter.year'))}</span>`;

  const yearSel = document.createElement('select');
  yearSel.className = 'filter-year__select';
  yearSel.id = yearId;
  yearSel.setAttribute('aria-label', t('filter.year'));
  yearSel.innerHTML =
    years.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('') +
    `<option value="all">${esc(t('filter.allYears'))}</option>`;
  yearWrap.appendChild(yearSel);

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'btn btn--sm filter-open';
  openBtn.setAttribute('aria-haspopup', 'dialog');
  openBtn.setAttribute('aria-expanded', 'false');
  openBtn.innerHTML = `
    <svg class="filter-open__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h16l-6.2 7.3v5.4L10.2 20v-7.7z" />
    </svg>
    <span>${esc(t('filter.open'))}</span>
    <span class="filter-open__count" hidden></span>`;

  const chips = document.createElement('div');
  chips.className = 'filter-chips';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', t('filter.active'));

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--sm filter-reset';
  reset.textContent = t('filter.reset');

  bar.append(yearWrap, openBtn, chips, reset);

  const count = openBtn.querySelector('.filter-open__count');

  /** วาดชิปสรุป + ตัวเลขบนปุ่ม + ปุ่มล้าง ให้ตรงกับ state */
  const paint = () => {
    // ปีที่ยังไม่ได้เลือกเอง = ปีล่าสุด — ต้องให้ช่องเลือกแสดงค่านั้น ไม่ใช่ว่างไว้
    yearSel.value = resolveYear(state, years) ?? 'all';

    const items = summarize(state);
    count.textContent = String(items.length);
    count.hidden = items.length === 0;
    openBtn.classList.toggle('is-on', items.length > 0);
    reset.hidden = items.length === 0;

    chips.innerHTML = '';
    for (const item of items) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'filter-chip';
      chip.setAttribute('aria-label', `${t('filter.remove')} · ${item.label}: ${item.text}`);
      chip.title = `${t('filter.remove')} · ${item.label}`;
      chip.innerHTML =
        `<span class="filter-chip__label">${esc(item.label)}</span>` +
        `<span class="filter-chip__text">${esc(item.text)}</span>` +
        '<span class="filter-chip__x" aria-hidden="true">&times;</span>';
      chip.addEventListener('click', () => {
        apply({ ...state, ...item.clear });
        // ชิปที่กดหายไปแล้ว โฟกัสต้องไปเกาะที่อื่นทันที ไม่ปล่อยตกไปที่ body
        openBtn.focus();
      });
      chips.appendChild(chip);
    }
  };

  const apply = (next) => {
    state = normalize(next);
    paint();
    onChange({ ...state });
  };

  /** ให้ main.js เรียกเมื่อ URL เปลี่ยน — ซิงก์เฉพาะแถบ ไม่แตะ popup ที่ผู้ใช้กำลังใช้อยู่ */
  bar.__sync = (next) => {
    state = normalize(next);
    paint();
  };

  yearSel.addEventListener('change', () => apply({ ...state, year: yearSel.value }));

  reset.addEventListener('click', () => apply({ ...CLEARED, granularity: state.granularity }));

  openBtn.addEventListener('click', () => {
    // กดซ้ำตอนเปิดอยู่ = ปิด (ปกติคลิกจะโดน backdrop ปิดไปก่อนแล้ว — กันไว้สำหรับคีย์บอร์ด)
    if (live) {
      closeFilterPopup();
      return;
    }
    openBtn.setAttribute('aria-expanded', 'true');
    openPopup({
      anchor: openBtn,
      options,
      getState: () => state,
      apply,
      onClosed: () => openBtn.setAttribute('aria-expanded', 'false'),
    });
  });

  paint();
  return bar;
}
