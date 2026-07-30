/**
 * ui/controls.js — ตัวควบคุม "กรอง" และ "จัดเรียง" ที่ใช้ร่วมกันทุกการ์ดและทุก modal
 *
 * เขียนรวมไว้ที่เดียวเพราะกฎการเรียงต้องเหมือนกันทั้งระบบ
 * ถ้าปล่อยให้แต่ละที่เรียงเอง จะเกิดกรณีแบบไตรมาสที่เรียงตามตัวอักษรจนได้
 * Q1'2026 มาก่อน Q2'2025 ซ้ำอีกในจุดอื่น
 */
import { t } from '../i18n.js';
import { esc } from '../format.js';

/**
 * ลำดับเวลาของป้ายช่วงเวลา — ตรรกะเดียวกับ periodOrder() ฝั่ง server
 *
 * ต้องมีสองที่เพราะเบราว์เซอร์ import โค้ดใน server/ ไม่ได้
 * ถ้าแก้ที่นี่ต้องแก้ `server/lib/normalize.js` ให้ตรงกันด้วย
 */
export function periodOrder(label) {
  const s = String(label ?? '').trim();
  if (!s) return Number.MAX_SAFE_INTEGER;

  const q =
    s.match(/Q\s*([1-4])\s*['’\s/-]*\s*(\d{4})/i) || s.match(/(\d{4})\s*[-\s]*Q\s*([1-4])/i);
  if (q) {
    const [a, b] = [q[1], q[2]];
    const year = Number(a.length === 4 ? a : b);
    const quarter = Number(a.length === 4 ? b : a);
    return year * 10000 + quarter * 3 * 100;
  }

  const ymd = s.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (ymd) return Number(ymd[1]) * 10000 + Number(ymd[2]) * 100 + Number(ymd[3] ?? 0);

  const year = s.match(/^(\d{4})$/);
  if (year) return Number(year[1]) * 10000;

  return Number.MAX_SAFE_INTEGER;
}

/** ป้ายนี้เป็นช่วงเวลาที่อ่านออกไหม (ใช้ตัดสินว่าจะเสนอตัวเลือก "ตามเวลา" ไหม) */
export function looksLikePeriod(label) {
  return periodOrder(label) !== Number.MAX_SAFE_INTEGER;
}

/**
 * โหมดการเรียงที่ใช้ได้กับลิสต์แบบ {key, flower}
 * ค่าที่เป็น null ถูกดันไปท้ายเสมอ ไม่ว่าจะเรียงทางไหน — `—` แปลว่าไม่มีข้อมูล ไม่ใช่ 0
 */
export const SORT_MODES = {
  valueDesc: {
    labelKey: 'sort.valueDesc',
    compare: (a, b, val) => nullLast(val(a), val(b), (x, y) => y - x),
  },
  valueAsc: {
    labelKey: 'sort.valueAsc',
    compare: (a, b, val) => nullLast(val(a), val(b), (x, y) => x - y),
  },
  timeAsc: {
    labelKey: 'sort.timeAsc',
    compare: (a, b) => periodOrder(a.key) - periodOrder(b.key),
  },
  timeDesc: {
    labelKey: 'sort.timeDesc',
    compare: (a, b) => periodOrder(b.key) - periodOrder(a.key),
  },
  nameAsc: {
    labelKey: 'sort.nameAsc',
    compare: (a, b) => String(a.key).localeCompare(String(b.key), 'th'),
  },
  nameDesc: {
    labelKey: 'sort.nameDesc',
    compare: (a, b) => String(b.key).localeCompare(String(a.key), 'th'),
  },
};

function nullLast(av, bv, cmp) {
  const aNull = av === null || av === undefined || !Number.isFinite(av);
  const bNull = bv === null || bv === undefined || !Number.isFinite(bv);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return cmp(av, bv);
}

/**
 * เรียงลิสต์ breakdown ตามโหมดที่เลือก
 *
 * ชื่อพารามิเตอร์ต้องไม่ใช่ `valueOf` เด็ดขาด — ทุก object มี Object.prototype.valueOf
 * ติดตัวอยู่แล้ว ถ้าอ่าน view.valueOf จะได้เมธอดของ Object กลับมาแทน undefined
 * ค่า default จึงไม่ทำงาน แล้วพังตอนเรียกด้วยข้อความ "Cannot convert undefined or null to object"
 * @param {{key:string, flower?:number}[]} rows
 * @param {keyof SORT_MODES} mode
 * @param {(row)=>number} [getValue]
 */
export function sortRows(rows, mode, getValue = (r) => r.flower) {
  // มุมมองบางอันไม่ได้เป็นลิสต์ (เช่นสัดส่วนตามขนาดที่เป็น object) — ปล่อยผ่านไปเลย
  if (!Array.isArray(rows)) return rows;
  const spec = SORT_MODES[mode] ?? SORT_MODES.valueDesc;
  return [...rows].sort((a, b) => spec.compare(a, b, getValue));
}

/**
 * โหมดที่ควรเสนอให้กับลิสต์ชุดนี้
 * เสนอ "ตามเวลา" เฉพาะตอนที่ key เป็นช่วงเวลาจริง ๆ ไม่งั้นเลือกไปก็ไม่มีความหมาย
 */
export function availableModes(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const timeLike = list.length > 0 && list.every((r) => looksLikePeriod(r?.key));
  return timeLike
    ? ['timeAsc', 'timeDesc', 'valueDesc', 'valueAsc']
    : ['valueDesc', 'valueAsc', 'nameAsc', 'nameDesc'];
}

/** โหมดเริ่มต้น — ข้อมูลที่เป็นช่วงเวลาควรเรียงตามเวลา ไม่ใช่ตามขนาด */
export function defaultMode(rows) {
  return availableModes(rows)[0];
}

function makeSelect(className, ariaLabel) {
  const sel = document.createElement('select');
  sel.className = className;
  sel.setAttribute('aria-label', ariaLabel);
  // การ์ดทั้งใบกดแล้วเปิด modal — ไม่ให้การกดตัวเลือกไปสั่งเปิดตามไปด้วย
  for (const evt of ['click', 'keydown', 'pointerdown']) {
    sel.addEventListener(evt, (e) => e.stopPropagation());
  }
  return sel;
}

/**
 * แถบควบคุมของการ์ด/แผง: เลือกมุมมอง + เลือกการเรียง
 *
 * @param {object} opts
 * @param {{value:string,label:string,rows:Array}[]} opts.views มุมมองที่เลือกได้ (มิติของข้อมูล)
 * @param {(state:{view:object, mode:string, rows:Array})=>void} opts.onChange
 * @param {string} [opts.filterLabel] ถ้าใส่ จะมีช่องกรองค่าเฉพาะตัวเพิ่มมาด้วย
 * @returns {HTMLElement}
 */
export function breakdownControls({ views, onChange, compact = false }) {
  const bar = document.createElement('div');
  bar.className = compact ? 'ctl-row ctl-row--compact' : 'ctl-row';

  const viewSel = makeSelect('ctl-select', t('ctl.view'));
  viewSel.innerHTML = views
    .map((v, i) => `<option value="${i}">${esc(v.label)}</option>`)
    .join('');

  const sortSel = makeSelect('ctl-select', t('ctl.sort'));

  // ช่องกรอง: ตัดรายการที่ค่าเป็นศูนย์/ว่างออก เพื่อดูเฉพาะอันที่มีข้อมูลจริง
  const onlyData = makeSelect('ctl-select', t('ctl.filter'));
  onlyData.innerHTML =
    `<option value="all">${esc(t('ctl.showAll'))}</option>` +
    `<option value="nonzero">${esc(t('ctl.onlyWithData'))}</option>` +
    `<option value="top5">${esc(t('ctl.top5'))}</option>`;

  bar.append(viewSel, sortSel, onlyData);

  const state = { viewIndex: 0, mode: null, filter: 'all' };

  const fillSortOptions = (rows) => {
    const modes = availableModes(rows);
    if (!modes.includes(state.mode)) state.mode = modes[0];
    sortSel.innerHTML = modes
      .map((m) => `<option value="${m}">${esc(t(SORT_MODES[m].labelKey))}</option>`)
      .join('');
    sortSel.value = state.mode;
  };

  const emit = () => {
    const view = views[state.viewIndex];
    let rows = sortRows(view.rows, state.mode, view.getValue);

    // มุมมองที่ไม่ใช่ลิสต์จัดอันดับ ไม่มีอะไรให้กรอง
    if (!Array.isArray(rows)) return onChange({ view, mode: state.mode, rows });

    if (state.filter === 'nonzero') {
      const val = view.getValue ?? ((r) => r.flower);
      rows = rows.filter((r) => Number.isFinite(val(r)) && val(r) > 0);
    } else if (state.filter === 'top5') {
      // "5 อันดับแรก" หมายถึงค่าสูงสุด 5 อัน แล้วค่อยคืนไปเรียงตามที่ผู้ใช้เลือก
      const val = view.getValue ?? ((r) => r.flower);
      const top = new Set(
        sortRows(view.rows, 'valueDesc', val)
          .slice(0, 5)
          .map((r) => r.key)
      );
      rows = rows.filter((r) => top.has(r.key));
    }

    onChange({ view, mode: state.mode, rows });
  };

  viewSel.addEventListener('change', () => {
    state.viewIndex = Number(viewSel.value);
    fillSortOptions(views[state.viewIndex].rows);
    emit();
  });
  sortSel.addEventListener('change', () => {
    state.mode = sortSel.value;
    emit();
  });
  onlyData.addEventListener('change', () => {
    state.filter = onlyData.value;
    emit();
  });

  // มุมมองเดียวก็ไม่ต้องมีตัวเลือกให้เกะกะ
  if (views.length === 1) viewSel.hidden = true;

  fillSortOptions(views[0].rows);
  bar.__emit = emit;
  return bar;
}
