/**
 * preload-window.js — ชั่วโมงนี้อยู่ในช่วงที่ควรอุ่นข้อมูลไหม
 *
 * แยกออกมาจาก server.js เพราะไฟล์นั้น import เพื่อเทสต์ไม่ได้ (โหลดแล้วเปิดพอร์ตทันที)
 * และตรรกะข้ามเที่ยงคืนเป็นของที่เขียนผิดแล้วไม่มีใครสังเกต — ตัวอุ่นจะเงียบไปเฉย ๆ
 * แล้วผู้ใช้กลับไปเจอ 504 เหมือนเดิมโดยไม่มีอะไรบอกว่าทำไม
 */

/**
 * @param {string} spec ช่วงชั่วโมงแบบ "6-21" (ข้ามเที่ยงคืนได้ เช่น "22-2")
 * @param {Date} [now] เวลาท้องถิ่นของเครื่อง (ในคอนเทนเนอร์คือ TZ=Asia/Bangkok)
 * @returns {boolean}
 */
export function inPreloadWindow(spec, now = new Date()) {
  const m = String(spec ?? '').match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);

  /* รูปแบบเพี้ยน = อุ่นตลอดเวลา ดีกว่าเงียบแล้วไม่อุ่นเลย
   * พิมพ์ผิดหนึ่งตัวไม่ควรทำให้ฟีเจอร์ตายเงียบ ๆ — ผลที่แย่กว่าคือกลับไปเจอ 504 */
  if (!m) return true;

  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from > 23 || to > 23) return true;

  const h = now.getHours();
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
}
