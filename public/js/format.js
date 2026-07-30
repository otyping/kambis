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
