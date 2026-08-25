/**
 * tabs.js — ค้นหารายชื่อ tab ทั้งหมดของ Google Sheet
 *
 * ใช้ร่วมกันสองที่:
 *   - scripts/sync-sources.js  ตอนสร้าง config/sources.json ครั้งแรก
 *   - server/lib/loader.js     ตอนรีเฟรชทุกครั้ง เพื่อรับแท็บที่เพิ่มใหม่
 *
 * Google ไม่มี API สาธารณะสำหรับถามรายชื่อ tab ของไฟล์ที่แชร์แบบลิงก์
 * แต่หน้า /htmlview ฝัง JS ที่ประกาศ tab ทุกอันไว้ครบ และหน้านั้นเล็ก (~50 KB)
 * เพราะเนื้อตารางโหลดทีหลัง จึงเรียกซ้ำทุกรอบได้โดยไม่กระทบเวลารีเฟรช
 */
import { fetchText } from './fetcher.js';

/**
 * แกะรายชื่อ tab จาก HTML ของหน้า htmlview
 *
 * รูปแบบที่ฝังอยู่คือ items.push({name: "ชื่อแท็บ", pageUrl: "....gid=123"})
 * @param {string} html
 * @returns {{gid:string, name:string}[]} เรียงตามลำดับแท็บจริงในไฟล์
 */
export function extractTabs(html) {
  const tabs = [];
  const re = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*pageUrl:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/\\\//g, '/').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const gidMatch = m[2].match(/gid=(\d+)/);
    if (!gidMatch) continue;
    tabs.push({ gid: gidMatch[1], name: name.trim() });
  }
  // กัน tab ซ้ำ (บางไฟล์ฝัง list ซ้ำสองรอบ)
  const seen = new Set();
  return tabs.filter((t) => (seen.has(t.gid) ? false : seen.add(t.gid)));
}

/**
 * ดึงรายชื่อ tab สดจาก Google
 * @param {string} sheetId
 * @param {{timeoutMs?:number, retries?:number}} [opts]
 * @throws เมื่อดึงไม่ได้ — ผู้เรียกต้องตัดสินใจเองว่าจะ fallback ไปใช้อะไร
 */
export async function discoverTabs(sheetId, opts = {}) {
  const html = await fetchText(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`, {
    timeoutMs: opts.timeoutMs ?? 30000,
    retries: opts.retries ?? 2,
  });
  const tabs = extractTabs(html);
  if (tabs.length === 0) {
    // หน้าโหลดได้แต่ไม่เจอ tab เลย = โครงหน้าเปลี่ยน หรือโดนเด้งไปหน้า login
    // อย่าถือว่าสำเร็จ เพราะจะกลายเป็น "ชีตนี้ไม่มีแท็บ" แล้วข้อมูลหายทั้งรายงาน
    throw new Error('ไม่พบรายชื่อแท็บในหน้า htmlview (ไฟล์อาจไม่ได้แชร์แบบสาธารณะแล้ว)');
  }
  return tabs;
}

/* เลขลำดับเอกสารหน้าชื่อแท็บ — ธรรมเนียมของบริษัท (`1.Rockwool` · `9.58 Stock หัวหิน`)
 *
 * แทรกรายการใหม่หนึ่งอันทำให้ทุกแท็บที่อยู่หลังจากนั้น **ถูกเรียงเลขใหม่ทั้งแถว**
 * (เจอจริง ส.ค. 69: แทรกที่ 42 แล้ว 43→44 … 53→54 รวด 11 อัน) */
const ORDINAL_PREFIX = /^\s*\d+(?:\.\d+)*\s*[.)\s]\s*/;

/** ชื่อแท็บที่ตัดเลขลำดับหน้าออกแล้ว — ใช้ดูว่า "เปลี่ยนแค่เลข" หรือ "เปลี่ยนชื่อจริง" */
export function stripOrdinal(name) {
  return String(name ?? '')
    .replace(ORDINAL_PREFIX, '')
    .trim();
}

/**
 * เทียบรายชื่อแท็บเก่ากับใหม่
 *
 * `renamed[].renumbered` = เปลี่ยนแค่เลขลำดับหน้าชื่อ เนื้อชื่อเดิมเป๊ะ
 * ซึ่ง **ไม่กระทบ parser เลย** เพราะทุกตัวอ้าง gid หรือตัดเลขนำหน้าทิ้งอยู่แล้ว
 * ต่างจากการเปลี่ยนชื่อจริงที่ทำให้ตัวคัดชื่ออย่าง `STOCK_TAB_RE` พลาดได้
 *
 * @param {{gid:string,name:string}[]} before
 * @param {{gid:string,name:string}[]} after
 * @returns {{added:{gid,name}[], removed:{gid,name}[], renamed:{gid,from,to,renumbered:boolean}[], changed:boolean}}
 */
export function diffTabs(before = [], after = []) {
  const prev = new Map(before.map((t) => [t.gid, t.name]));
  const next = new Map(after.map((t) => [t.gid, t.name]));

  const added = after.filter((t) => !prev.has(t.gid));
  const removed = before.filter((t) => !next.has(t.gid));
  const renamed = after
    .filter((t) => prev.has(t.gid) && prev.get(t.gid) !== t.name)
    .map((t) => {
      const from = prev.get(t.gid);
      const base = stripOrdinal(t.name);
      // ตัดเลขแล้วเหลือค่าว่าง = ชื่อเป็นตัวเลขล้วน ตัดสินไม่ได้ ให้ถือว่าเปลี่ยนชื่อจริง
      return { gid: t.gid, from, to: t.name, renumbered: base !== '' && base === stripOrdinal(from) };
    });

  return {
    added,
    removed,
    renamed,
    changed: added.length > 0 || removed.length > 0 || renamed.length > 0,
  };
}
