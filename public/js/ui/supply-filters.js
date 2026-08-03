/**
 * ui/supply-filters.js — แถบตัวกรองของรายงาน KAMBIS SUPPLY STOCK
 *
 * ทำไมไม่ใช้ `ui/filters.js` ตัวเดียวกับรายงาน Dryflower:
 * มิติของข้อมูลคนละเรื่องกันทั้งหมด รายงานดอกกรองด้วย สายพันธุ์/ครอป/ขนาด/คลัง
 * ส่วนวัสดุสิ้นเปลืองมี 138 รายการที่ต่างกันแค่ชื่อ หมวด และสถานะของคงเหลือ
 * ยัดสองชุดนี้เข้าโครงเดียวกันจะได้ช่องที่ว่างเปล่าอยู่ครึ่งหนึ่งเสมอ
 *
 * สถานะเก็บใน hash เหมือนกัน (`#/supply?q=ถุงมือ&group=nutrient`) จึงส่งลิงก์ต่อได้
 * แต่ **หน้าเป็นคนวาดใหม่เอง ไม่ผ่าน router** เพราะช่องค้นหาพิมพ์ทีละตัวอักษร
 * ถ้าให้ router วาดทั้งหน้าใหม่ทุกครั้ง โฟกัสจะหลุดจากช่องพิมพ์ทันทีที่กดตัวแรก
 */
import { t } from '../i18n.js';
import { esc } from '../format.js';
import { normalizeItemName } from '../shared/agg-core.js';

/** อ่านตัวกรองจาก URLSearchParams */
export function readSupplyFilters(params) {
  const get = (key, fallback) => params?.get(key) || fallback;
  return {
    year: get('year', ''),
    q: get('q', ''),
    group: get('group', 'all'),
    price: get('price', 'all'),
  };
}

/** เขียนกลับเป็น patch ให้ setParams — ค่าเริ่มต้นไม่ต้องอยู่ใน URL */
export function supplyFilterParams(f) {
  return {
    year: f.year || '',
    q: f.q?.trim() || '',
    group: f.group === 'all' ? '' : f.group,
    price: f.price === 'all' ? '' : f.price,
  };
}

export function isSupplyFiltered(f) {
  return Boolean(f.q?.trim() || f.group !== 'all' || f.price !== 'all');
}

/**
 * ตัวกรองรายการหนึ่ง ๆ — ใช้ร่วมกันทุกตารางบนหน้า
 *
 * @param {object} f ตัวกรอง
 * @param {{groupOf:(name:string)=>string|null, priceOf:(name:string)=>number|null}} lookup
 * @returns {(row:{item:string, unitPrice?:number|null}) => boolean}
 */
export function supplyMatcher(f, lookup) {
  // ค้นหาด้วยชื่อที่ normalize แล้ว เพราะชื่อเดียวกันเขียนต่างกันสองที่ในชีต
  // (แท็บ "4.ป้ายแท็กสีขาว" กับตาราง "ป้ายแท็ก-สีขาว (100 ชิ้น/ห่อ)")
  const needleRaw = (f.q ?? '').trim().toLowerCase();
  const needle = normalizeItemName(f.q ?? '');

  return (row) => {
    const name = String(row?.item ?? '');
    if (needleRaw) {
      const hit =
        name.toLowerCase().includes(needleRaw) ||
        (needle && normalizeItemName(name).includes(needle));
      if (!hit) return false;
    }
    if (f.group !== 'all' && lookup.groupOf(name) !== f.group) return false;
    if (f.price !== 'all') {
      const price = row?.unitPrice !== undefined ? row.unitPrice : lookup.priceOf(name);
      const has = price !== null && price !== undefined;
      if (f.price === 'with' && !has) return false;
      if (f.price === 'without' && has) return false;
    }
    return true;
  };
}

/**
 * สร้างตัวค้นหมวด/ราคาจากรายการทั้งหมด
 *
 * ตารางสั่งของรายเดือนใช้ชื่อคนละแบบกับชื่อแท็บ จึงต้องเก็บทั้งชื่อแท็บและ
 * ชื่อที่จับคู่ได้ (`matchedOrderRow`) ไว้ในแผนที่เดียวกัน ไม่งั้นกรองหมวดแล้ว
 * ตารางมูลค่าการสั่งซื้อจะว่างทั้งตาราง
 */
export function supplyLookup(items = []) {
  const group = new Map();
  const price = new Map();
  for (const it of items) {
    const keys = [it.item, it.matchedOrderRow].filter(Boolean).map(normalizeItemName);
    for (const k of keys) {
      if (it.group) group.set(k, it.group);
      if (it.unitPrice !== null && it.unitPrice !== undefined) price.set(k, it.unitPrice);
    }
  }
  return {
    groupOf: (name) => group.get(normalizeItemName(name)) ?? null,
    priceOf: (name) => (price.has(normalizeItemName(name)) ? price.get(normalizeItemName(name)) : null),
  };
}

/**
 * แถบตัวกรอง — แถวเดียว เห็นทุกช่องตลอดเวลา
 *
 * ต่างจากรายงาน Dryflower ที่ซ่อนไว้ใน popup เพราะที่นั่นมี 6 ตัวและบางตัว
 * เลือกได้หลายค่า ส่วนที่นี่มี 4 ตัวที่เป็นช่องเดียว ๆ กางไว้เลยอ่านง่ายกว่า
 *
 * @param {object} o
 * @param {object} o.filters
 * @param {{years:string[], groups:string[]}} o.options
 * @param {(next:object)=>void} o.onChange เรียกทุกครั้งที่ค่าเปลี่ยน (หน้าเป็นคนวาดใหม่)
 */
export function supplyFilterBar({ filters, options, onChange }) {
  const state = { ...filters };

  const bar = document.createElement('div');
  bar.className = 'filter-bar supply-filter-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', t('filter.title'));

  const emit = () => onChange({ ...state });

  // ── ปี ──
  const years = options.years ?? [];
  if (years.length) {
    const wrap = document.createElement('label');
    wrap.className = 'filter-year';
    wrap.innerHTML = `<span class="filter-year__label">${esc(t('filter.year'))}</span>`;
    const sel = document.createElement('select');
    sel.className = 'filter-year__select';
    sel.setAttribute('aria-label', t('filter.year'));
    sel.innerHTML =
      years.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('') +
      `<option value="all">${esc(t('filter.allYears'))}</option>`;
    // ยังไม่ได้เลือกเอง = ปีล่าสุดที่มีข้อมูล (กฎเดียวกับรายงาน Dryflower)
    sel.value = state.year === 'all' ? 'all' : state.year || years[0];
    sel.addEventListener('change', () => {
      state.year = sel.value;
      emit();
    });
    wrap.appendChild(sel);
    bar.appendChild(wrap);
  }

  // ── ค้นหาชื่อรายการ ──
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'supply-search';
  search.placeholder = t('supply.searchItem');
  search.setAttribute('aria-label', t('supply.searchItem'));
  search.value = state.q ?? '';
  /* หน่วงไว้ก่อนค่อยกรอง — พิมพ์ชื่อไทยหนึ่งคำมี 8–10 ตัวอักษร
   * ถ้ากรองทุกตัวอักษรจะวาดตาราง 138 แถวใหม่สิบรอบโดยไม่จำเป็น */
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = search.value;
      emit();
    }, 220);
  });
  bar.appendChild(search);

  // ── หมวด / ราคา ──
  const pick = (label, value, choices, key) => {
    const wrap = document.createElement('label');
    wrap.className = 'filter-year';
    wrap.innerHTML = `<span class="filter-year__label">${esc(label)}</span>`;
    const sel = document.createElement('select');
    sel.className = 'filter-year__select';
    sel.setAttribute('aria-label', label);
    sel.innerHTML = choices
      .map(([v, text]) => `<option value="${esc(v)}">${esc(text)}</option>`)
      .join('');
    sel.value = value;
    sel.addEventListener('change', () => {
      state[key] = sel.value;
      emit();
    });
    wrap.appendChild(sel);
    bar.appendChild(wrap);
  };

  if ((options.groups ?? []).length > 1) {
    pick(
      t('supply.group'),
      state.group,
      [
        ['all', t('filter.all')],
        ['item', t('supply.groupItem')],
        ['nutrient', t('supply.groupNutrient')],
      ],
      'group'
    );
  }

  pick(
    t('supply.priceFilter'),
    state.price,
    [
      ['all', t('filter.all')],
      ['with', t('supply.hasPrice')],
      ['without', t('supply.noPriceOnly')],
    ],
    'price'
  );

  // ── ปุ่มล้าง (โผล่เฉพาะตอนกรองอยู่จริง) ──
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--sm filter-reset';
  reset.textContent = t('filter.reset');
  reset.hidden = !isSupplyFiltered(state);
  reset.addEventListener('click', () => {
    state.q = '';
    state.group = 'all';
    state.price = 'all';
    emit();
  });
  bar.appendChild(reset);

  const count = document.createElement('span');
  count.className = 'ctl-count';
  bar.appendChild(count);

  /** ให้หน้าบอกกลับมาว่ากรองแล้วเหลือกี่รายการ — ไม่งั้นกรองจนว่างแล้วงงว่าพังหรือไม่มีจริง */
  bar.__setCount = (shown, total) => {
    count.textContent = shown === total ? '' : `${shown} / ${total} ${t('supply.itemsUnit')}`;
  };

  return bar;
}
