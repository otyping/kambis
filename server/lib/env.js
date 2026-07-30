/**
 * env.js — อ่านไฟล์ .env เข้ามาเป็น environment variable
 *
 * มีเพื่อไม่ต้องพิมพ์ API key ต่อท้ายคำสั่งทุกครั้งที่เปิดเซิร์ฟเวอร์
 * ไฟล์ .env ถูก gitignore ไว้ — ห้าม commit
 *
 * ตัวแปรที่ตั้งไว้ใน shell อยู่แล้วจะชนะเสมอ ไฟล์ .env เป็นแค่ค่าสำรอง
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadDotEnv(file = path.join(ROOT, '.env')) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return 0; // ไม่มีไฟล์ก็ไม่เป็นไร
  }

  let count = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // ตัดเครื่องหมายคำพูดที่ครอบค่าไว้ออก
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
      count++;
    }
  }
  return count;
}
