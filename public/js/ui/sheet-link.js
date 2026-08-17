/**
 * ui/sheet-link.js — ลิงก์ที่เปิดตรงไปยังแท็บหนึ่งของ Google Sheet
 *
 * **Google Sheets ต้องมี `gid` ทั้งใน query และ fragment ถึงจะเด้งไปแท็บนั้นจริง**
 * ใส่แค่ `#gid=` อย่างเดียวจะเปิดที่แท็บแรกเสมอ ส่วน `?gid=` อย่างเดียวก็เหมือนกัน
 * รายละเอียดนี้พลาดง่ายและพลาดแล้วดูเหมือนใช้ได้ (หน้าเปิดขึ้นมาแต่ผิดแท็บ)
 * จึงเก็บไว้ที่เดียว ไม่ให้มีสำเนาที่สอง — เดิมฝังอยู่ใน `modal.js` ที่เดียว
 * พอตารางอื่นอยากลิงก์บ้างก็จะเกิดสำเนาที่เขียนไม่เหมือนกัน
 */

/**
 * @param {string|null|undefined} sheetUrl ลิงก์ไฟล์ชีต (จาก `meta.sources[].sheetUrl`)
 * @param {string|number|null|undefined} gid แท็บที่ต้องการ
 * @returns {string|null} `null` เมื่อไม่มีลิงก์ — ผู้เรียกต้องแสดงเป็นข้อความธรรมดา
 *   **ห้ามสร้างลิงก์หลอกที่กดแล้วไม่ไปไหน**
 */
export function tabUrl(sheetUrl, gid) {
  if (!sheetUrl) return null;
  if (gid === null || gid === undefined || gid === '') return sheetUrl;
  return `${sheetUrl}?gid=${gid}#gid=${gid}`;
}

/** หา sheetUrl ของรายงานหนึ่งจาก meta ที่ payload ส่งมา (sources เป็นอาร์เรย์) */
export function sheetUrlOf(meta, key) {
  return (meta?.sources ?? []).find((s) => s.key === key)?.sheetUrl ?? null;
}
