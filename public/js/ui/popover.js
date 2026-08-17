/**
 * ui/popover.js — เปลือกกล่องลอย: วางตำแหน่ง · ปิดด้วย Esc/คลิกนอก · ขังโฟกัส · คืนโฟกัส
 *
 * **ทำไมต้องแยกออกมา:** `FOCUSABLE` กับกับดักโฟกัสถูกคัดลอกไว้แล้ว 3 ที่
 * (`modal.js` · `filters.js` · `nav.js`) ตัวเลือกวันที่จะเป็นสำเนาที่ 4 — และเป็นสำเนา
 * ที่ **ต่างจากเดิม** ด้วย เพราะปฏิทินสูงกว่ากล่องตัวกรองมาก ถ้าเปิดจากช่องที่อยู่ครึ่งล่างของจอ
 * ต้องพลิกไปวางเหนือปุ่มแทน ซึ่ง `place()` ของ `filters.js:605` ทำไม่ได้ (มันแค่หนีบ `top`
 * ไม่ให้เกิน `innerHeight - 220` ซึ่งแปลว่ากล่องไปนั่งทับปุ่มที่เพิ่งกดได้)
 *
 * **ยังไม่ย้าย `filters.js` มาใช้ตัวนี้โดยตั้งใจ** popup ตัวกรองทำงานอยู่และเป็นของที่คนกดบ่อยที่สุด
 * การรื้อมันในรอบเดียวกับที่เพิ่มของใหม่ = เสี่ยงฟรี ๆ โดยผู้ใช้ไม่ได้อะไรกลับมา
 * ตอนนี้แค่หยุดไม่ให้เกิดสำเนาที่ 4 — ย้ายทีหลังเป็นงานแยกที่มีการตรวจของตัวเอง
 *
 * ใช้คลาสของ `.filter-pop*` เป็นค่าเริ่มต้น จึงไม่ต้องมี CSS เปลือกกล่องชุดที่สอง
 */

/** เหมือน modal.js:16 และ filters.js:275 — ตัวนี้คือฉบับที่ควรใช้ต่อไป */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** เปิดได้ทีละกล่อง — กล่องลอยซ้อนกล่องลอยคือสิ่งที่โปรเจกต์นี้เลี่ยงมาตลอด */
let live = null;

export function isPopoverOpen() {
  return live !== null;
}

/** ปิดกล่องที่เปิดอยู่ (ถ้ามี) — ต้องเรียกทุกครั้งที่ทิ้ง DOM ที่มีปุ่มเปิดอยู่ */
export function closePopover() {
  live?.close();
}

/**
 * @param {object} o
 * @param {HTMLElement} o.anchor      ปุ่มที่กดเปิด — ใช้วางตำแหน่งและคืนโฟกัส
 * @param {(panel:HTMLElement, api:object)=>void} o.build  เติมเนื้อในกล่อง
 * @param {string} [o.rootClass]      ค่าเริ่มต้น `filter-pop-root`
 * @param {string} [o.panelClass]     ค่าเริ่มต้น `filter-pop`
 * @param {string} [o.labelledBy]     id ของหัวเรื่อง (aria-labelledby)
 * @param {number} [o.width]          ความกว้างสูงสุดบนจอใหญ่
 * @param {number} [o.sheetAt]        ความกว้างจอที่เปลี่ยนเป็น bottom sheet
 * @param {()=>void} [o.onClosed]
 * @returns {{root:HTMLElement, panel:HTMLElement, close:()=>void, reflow:()=>void}}
 */
export function openPopover({
  anchor,
  build,
  rootClass = 'filter-pop-root',
  panelClass = 'filter-pop',
  labelledBy = '',
  width = 420,
  sheetAt = 767,
  onClosed,
}) {
  closePopover();

  const root = document.createElement('div');
  root.className = rootClass;

  const panel = document.createElement('div');
  panel.className = panelClass;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  if (labelledBy) panel.setAttribute('aria-labelledby', labelledBy);
  root.appendChild(panel);

  /* จอเล็กเป็นแผ่นเลื่อนขึ้นจากขอบล่าง คุมด้วยคลาส `.is-sheet` ใน CSS
   * จอใหญ่ลอยใต้ปุ่ม — และพลิกไปอยู่เหนือปุ่มเมื่อข้างล่างไม่พอ */
  const place = () => {
    if (window.matchMedia(`(max-width: ${sheetAt}px)`).matches) {
      root.classList.add('is-sheet');
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.maxHeight = '';
      return;
    }
    root.classList.remove('is-sheet');

    const r = anchor.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 24);
    panel.style.width = `${w}px`;

    // วัดความสูงจริงตอนยังไม่จำกัด ไม่งั้นจะเอา maxHeight ของรอบก่อนมาตัดสินใจ
    panel.style.maxHeight = '';
    const h = panel.offsetHeight;

    const gap = 8;
    const edge = 12;
    const below = window.innerHeight - r.bottom - gap - edge;
    const above = r.top - gap - edge;
    const flip = h > below && above > below;
    const room = Math.max(200, flip ? above : below);

    panel.style.left = `${Math.max(edge, Math.min(r.left, window.innerWidth - edge - w))}px`;
    panel.style.top = flip
      ? `${Math.max(edge, r.top - gap - Math.min(h, room))}px`
      : `${Math.max(edge, r.bottom + gap)}px`;
    panel.style.maxHeight = `${room}px`;
  };

  const api = {
    root,
    panel,
    reflow: place,
    close() {
      if (live !== api) return;
      live = null;
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      root.remove();
      onClosed?.();
      /* ปุ่มอาจหลุด DOM ไปแล้ว (สลับหน้า/สลับภาษาระหว่างที่กล่องเปิดอยู่)
       * คืนโฟกัสให้ของที่ไม่อยู่แล้วจะทำให้โฟกัสเด้งไปที่ body เงียบ ๆ */
      if (anchor?.isConnected) anchor.focus();
    },
  };

  // คลิกนอกกล่อง = ปิด (root คลุมเต็มจอ จึงเป็นฉากหลังของตัวเองไปในตัว)
  root.addEventListener('click', (e) => {
    if (e.target === root) api.close();
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // ห้ามให้ลอยขึ้นไปถึง modal ที่อยู่ข้างหลัง ไม่งั้น Esc ครั้งเดียวปิดสองชั้น
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

  build?.(panel, api);

  // ต้องเข้า DOM ก่อนถึงจะวัดความสูงได้ (กฎเดียวกับกราฟใน CLAUDE.md §6.5)
  document.body.appendChild(root);
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);

  live = api;
  return api;
}
