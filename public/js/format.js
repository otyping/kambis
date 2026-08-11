/**
 * format.js — จัดรูปแบบตัวเลขและวันที่
 * หลักสำคัญ: null ≠ 0 — ค่าที่ไม่มีข้อมูลต้องแสดงเป็น "—" ไม่ใช่ 0
 */
import { getLang } from './i18n.js';

const DASH = '—';

/** ตัวเลขทั่วไป พร้อมคั่นหลักพัน */
export function n(value, decimals = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** น้ำหนักเป็นกรัม — เกิน 1 กก. แสดงเป็น kg เพื่อให้อ่านง่าย */
export function grams(value, { forceUnit = null } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { value: DASH, unit: '' };
  }
  if (forceUnit === 'g' || Math.abs(value) < 1000) {
    return { value: n(value, Math.abs(value) < 10 && value % 1 !== 0 ? 2 : 0), unit: 'g' };
  }
  const kg = value / 1000;
  return { value: n(kg, kg >= 100 ? 0 : 1), unit: 'kg' };
}

/** น้ำหนักเป็นข้อความบรรทัดเดียว */
export function weight(value, opts) {
  const g = grams(value, opts);
  return g.unit ? `${g.value} ${g.unit}` : g.value;
}

/** เปอร์เซ็นต์ */
export function pct(value, decimals = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${n(value, decimals)}%`;
}

/** วันที่แบบสั้น จาก ISO (YYYY-MM-DD) */
export function date(iso) {
  if (!iso) return DASH;
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/** เดือน จาก YYYY-MM */
export function month(ym) {
  if (!ym) return DASH;
  const d = new Date(`${ym}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ym;
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/* ── ป้ายช่วงเวลาบนการ์ดและช่องตัวเลข ──
 *
 * ต่างจาก month() ข้างบนตรงที่ **เขียนปีเป็น ค.ศ. ไม่ใช่ พ.ศ.**
 * เพราะป้ายพวกนี้อยู่ใกล้แถบตัวกรองที่เขียนว่า "2026" ถ้าใช้คนละศักราช
 * ผู้ใช้จะไม่แน่ใจว่ากำลังดูปีไหนอยู่ ส่วน month() ยังใช้ พ.ศ. เหมือนเดิม
 * เพราะแกนกราฟกับตารางอ้างอิงกับชีตต้นทางที่เป็น พ.ศ.
 */

/** ชื่อเดือนแบบสั้นไม่มีปี — `2026-07-15` → `ก.ค.` / `Jul` */
export function monthShort(ym) {
  if (!ym) return '';
  const d = new Date(`${String(ym).slice(0, 7)}-01T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(ym);
  return d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/** เดือนเดียวพร้อมปี — `2026-08` → `ส.ค. 2026` */
export function monthYear(ym) {
  if (!ym) return '';
  return `${monthShort(ym)} ${String(ym).slice(0, 4)}`;
}

/**
 * ช่วงเดือน — `2026-03-10` + `2026-08-07` → `มี.ค.–ส.ค. 2026`
 * ช่วงข้ามปีบอกปีทั้งสองฝั่ง ไม่งั้นจะอ่านเป็นช่วงในปีเดียว
 */
export function monthSpan(from, to) {
  if (!from || !to) return '';
  const fromYear = String(from).slice(0, 4);
  return fromYear === String(to).slice(0, 4)
    ? `${monthShort(from)}–${monthShort(to)} ${fromYear}`
    : `${monthYear(from)}–${monthYear(to)}`;
}

/** วันและเวลา จาก ISO timestamp */
export function dateTime(iso) {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(getLang() === 'en' ? 'en-GB' : 'th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** เวลาที่ผ่านไปแบบสั้น */
export function ago(iso) {
  if (!iso) return DASH;
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return DASH;
  const mins = Math.floor(diff / 60000);
  const en = getLang() === 'en';
  if (mins < 1) return en ? 'just now' : 'เมื่อสักครู่';
  if (mins < 60) return en ? `${mins} min ago` : `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return en ? `${hours} h ago` : `${hours} ชม.ที่แล้ว`;
  const days = Math.floor(hours / 24);
  return en ? `${days} d ago` : `${days} วันที่แล้ว`;
}

/**
 * เวลาที่เหลือแบบสั้น ใช้กับคูลดาวน์ของปุ่มรีเฟรช
 *
 * ปัดขึ้นเสมอ — บอก "อีก 1 นาที" แล้วกดได้จริงตอน 1 นาที 10 วิ ดีกว่าบอก "อีก 0 นาที"
 * แล้วกดไม่ได้ ซึ่งผู้ใช้จะอ่านว่าปุ่มเสีย
 */
export function countdown(ms) {
  const secs = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const en = getLang() === 'en';
  if (secs >= 60) return en ? `${Math.ceil(secs / 60)} min` : `${Math.ceil(secs / 60)} นาที`;
  return en ? `${secs} sec` : `${secs} วินาที`;
}

/**
 * ความยาวของตัวเลขพาดหัวเป็น "จำนวนอักขระ" — ส่งให้ CSS ผ่าน --val-len
 * แล้ว .kpi__value / .card__metric-value เอาไปหารความกว้างจริงของการ์ด (หน่วย cqi)
 * ตัวเลขยาวจึงหดลงพอดีกรอบแทนที่จะล้นออกไป (เคยเจอ 17,299,482฿ ทะลุขอบการ์ด)
 *
 * หน่วยตัวเล็กกว่าตัวเลขราวครึ่งหนึ่ง จึงนับ 0.55 ตัวต่ออักขระ บวกช่องไฟอีก 0.4
 * ค่าไม่ต้องเป๊ะ ขอแค่อย่าต่ำกว่าความจริง ไม่งั้นตัวเลขจะยังล้นอยู่ดี
 */
export function valueLen(value, unit = '') {
  const len = String(value).length + (unit ? String(unit).length * 0.55 + 0.4 : 0);
  return Math.round(len * 10) / 10;
}

/** ตัดข้อความยาวให้พอดีป้ายกำกับ */
export function truncate(text, max = 22) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** กัน HTML injection จากค่าที่มาจากชีต */
export function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { DASH };
