/**
 * cache.js — cache บนดิสก์ + last-good fallback
 *
 * เป้าหมาย: Dashboard ต้องเปิดได้แม้ Google ล่มหรือเน็ตหลุด
 * โดยใช้สำเนาล่าสุดที่ดึงได้สำเร็จ พร้อมติดธง stale ให้ผู้ใช้รู้
 */
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');

/** ทำให้ชื่อไฟล์ปลอดภัย (gid เป็นตัวเลขอยู่แล้ว แต่กันไว้) */
function safe(name) {
  return String(name).replace(/[^A-Za-z0-9_-]/g, '_');
}

function tabPath(sourceKey, gid) {
  return path.join(CACHE_DIR, safe(sourceKey), `${safe(gid)}.csv`);
}

/** เขียน CSV ดิบของ tab ลง cache — ล้มเหลวไม่ใช่เรื่องคอขาดบาดตาย */
export async function writeTabCache(sourceKey, gid, csvText) {
  try {
    const file = tabPath(sourceKey, gid);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, csvText, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** อ่าน CSV ดิบของ tab จาก cache — คืน null ถ้าไม่มี */
export async function readTabCache(sourceKey, gid) {
  try {
    const file = tabPath(sourceKey, gid);
    const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { text, cachedAt: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

/* snapshot มีได้หลายชุด เพราะรายงานที่โหลดแบบ lazy (เช่นวัสดุสิ้นเปลือง)
 * ไม่ได้อยู่ใน payload หลัก ถ้าไม่แยกเก็บ พอออฟไลน์แล้วรายงานนั้นจะหายไปเงียบ ๆ */
function snapshotPath(name = 'snapshot') {
  return path.join(CACHE_DIR, `${safe(name)}.json`);
}

/**
 * เก็บ payload ที่ประกอบเสร็จแล้วทั้งก้อน เผื่อเปิดครั้งถัดไปตอนออฟไลน์
 *
 * **เขียนแบบ atomic และเก็บชุดก่อนหน้าไว้หนึ่งชุด** (`.prev`)
 * เขียนตรง ๆ ด้วย writeFile ถ้าโปรเซสตายกลางคันจะได้ JSON ขาดครึ่ง แล้วชุดสำรอง
 * ที่มีไว้กู้ยามฉุกเฉินก็ใช้ไม่ได้พอดี — ใช้แพตเทิร์นเดียวกับ persistTabs() ใน loader.js
 *
 * `.prev` มีไว้กันกรณีเดียว: บั๊กในตัวเกณฑ์ที่ตัดสินว่าอะไรควรถูกเก็บ
 * ชุดเดียวก็พอกู้แล้ว จึงไม่ต้องมี retention policy ให้ต้องมาตัดสินใจทีหลัง
 */
export async function writeSnapshot(payload, name = 'snapshot') {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const file = snapshotPath(name);
    await writeFile(`${file}.tmp`, JSON.stringify(payload), 'utf8');
    // ครั้งแรกยังไม่มีไฟล์เดิมให้เลื่อน — ไม่ใช่ความผิดพลาด
    await rename(file, `${file}.prev`).catch(() => {});
    await rename(`${file}.tmp`, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * อ่าน snapshot ล่าสุด — ตกไปใช้ `.prev` ถ้าไฟล์หลักใช้ไม่ได้ คืน null ถ้าไม่เหลืออะไรเลย
 *
 * ตรวจ **รูปร่าง** ด้วย ไม่ใช่แค่ JSON.parse ผ่าน — ไฟล์ที่เป็น `{}` หรือ `null`
 * parse ผ่านสบาย ๆ แล้วไปพังทีหลังตอนอ่าน `meta.sources` ซึ่งไล่ต้นตอยาก
 * payload ของรายงาน lazy ใช้ `source` เอกพจน์ จึงต้องรับทั้งสองแบบ
 */
export async function readSnapshot(name = 'snapshot') {
  const main = snapshotPath(name);
  for (const file of [main, `${main}.prev`]) {
    try {
      const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      const data = JSON.parse(text);
      if (!data?.meta || !(data.sources || data.source)) continue;
      return { data, cachedAt: st.mtime.toISOString() };
    } catch {
      /* ลองไฟล์ถัดไป */
    }
  }
  return null;
}

export { CACHE_DIR };
