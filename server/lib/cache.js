/**
 * cache.js — cache บนดิสก์ + last-good fallback
 *
 * เป้าหมาย: Dashboard ต้องเปิดได้แม้ Google ล่มหรือเน็ตหลุด
 * โดยใช้สำเนาล่าสุดที่ดึงได้สำเร็จ พร้อมติดธง stale ให้ผู้ใช้รู้
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
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

const SNAPSHOT = path.join(CACHE_DIR, 'snapshot.json');

/** เก็บ payload ที่ประกอบเสร็จแล้วทั้งก้อน เผื่อเปิดครั้งถัดไปตอนออฟไลน์ */
export async function writeSnapshot(payload) {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(payload), 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** อ่าน snapshot ล่าสุด — คืน null ถ้าไม่มีหรือเสีย */
export async function readSnapshot() {
  try {
    const [text, st] = await Promise.all([readFile(SNAPSHOT, 'utf8'), stat(SNAPSHOT)]);
    const data = JSON.parse(text);
    return { data, cachedAt: st.mtime.toISOString() };
  } catch {
    return null;
  }
}

export { CACHE_DIR };
