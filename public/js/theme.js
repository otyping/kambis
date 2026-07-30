/**
 * theme.js — สลับโหมดสว่าง/มืด
 *
 * ลำดับความสำคัญ: สิ่งที่ผู้ใช้เลือกเอง > ค่าจากระบบปฏิบัติการ
 * ค่าที่เลือกถูกจำไว้ใน localStorage และเขียนลง <html data-theme="…">
 *
 * การ set data-theme ครั้งแรกทำใน <head> ของ index.html (ก่อน paint)
 * เพื่อไม่ให้หน้าจอกระพริบเป็นสีผิดก่อนสคริปต์นี้จะโหลด
 */

const KEY = 'kambis.theme';
const listeners = new Set();

let choice = null; // 'light' | 'dark' | null (null = ตามระบบ)

const media =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** โหมดที่แสดงอยู่จริงตอนนี้ */
export function getTheme() {
  if (choice) return choice;
  return media?.matches ? 'dark' : 'light';
}

/** ผู้ใช้เลือกเองหรือยัง (null = ยังตามระบบอยู่) */
export function getChoice() {
  return choice;
}

export function initTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') choice = saved;
  } catch {
    /* localStorage ปิดอยู่ — ใช้ค่าจากระบบ */
  }
  apply();

  // ถ้าผู้ใช้ยังไม่เลือกเอง ให้เดินตามระบบเมื่อระบบเปลี่ยน
  media?.addEventListener?.('change', () => {
    if (!choice) {
      apply();
      notify();
    }
  });

  return getTheme();
}

export function setTheme(next) {
  if (next !== 'light' && next !== 'dark') return;
  if (next === getTheme() && choice === next) return;
  choice = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ไม่เป็นไร */
  }
  apply();
  notify();
}

/** สลับไปอีกโหมด */
export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

function apply() {
  const root = document.documentElement;
  if (choice) root.setAttribute('data-theme', choice);
  else root.removeAttribute('data-theme');

  // ให้แถบที่อยู่ของเบราว์เซอร์บนมือถือเปลี่ยนสีตามด้วย
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--bg-base').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

function notify() {
  const theme = getTheme();
  for (const fn of listeners) fn(theme);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
