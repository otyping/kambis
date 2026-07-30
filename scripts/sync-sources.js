#!/usr/bin/env node
/**
 * sync-sources.js — แปลง "แบบฟอร์มรายงาน Kambis.txt" เป็น config/sources.json
 *
 * กฎเหล็กของโปรเจกต์: ลิงก์ Google Sheets ทุกอันต้องมาจากไฟล์ .txt เท่านั้น
 * สคริปต์นี้คือจุดเดียวที่แปลงไฟล์ .txt ให้เป็น config ที่โค้ดอ่านได้
 *
 *   node scripts/sync-sources.js
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverTabs, extractTabs } from '../server/lib/tabs.js';

export { extractTabs };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_TXT = 'แบบฟอร์มรายงาน Kambis.txt';
const OUT = path.join(ROOT, 'config', 'sources.json');

/**
 * ผูกชื่อรายงานในไฟล์ .txt เข้ากับ key/parser ภายในระบบ
 * match แบบ "มีคำนี้อยู่ในบรรทัดชื่อ" เพื่อให้ทนต่อการพิมพ์ชื่อไม่ตรงเป๊ะ
 */
const PROFILES = [
  {
    key: 'dailyTrim',
    parser: 'dailyTrim',
    match: (t) => t.includes('รายวัน'),
    titleTh: 'น้ำหนักดอกทริมรายวัน',
    titleEn: 'Daily Trim Weight',
    icon: 'daily',
  },
  {
    key: 'perCrop',
    parser: 'perCrop',
    match: (t) => t.includes('ต่อครอป'),
    titleTh: 'น้ำหนักดอกทริมต่อครอป',
    titleEn: 'Yield per Crop',
    icon: 'crop',
  },
  {
    key: 'outbound',
    parser: 'outbound',
    match: (t) => t.includes('ขนย้าย') || t.includes('ออกจากฟาร์ม'),
    titleTh: 'ขนย้ายออกจากฟาร์ม',
    titleEn: 'Farm Outbound',
    icon: 'truck',
  },
  {
    key: 'inbound',
    parser: 'inbound',
    match: (t) => t.includes('รับดอก') || t.includes('ถึงกรุงเทพ'),
    titleTh: 'รับดอกถึงกรุงเทพ',
    titleEn: 'Bangkok Inbound',
    icon: 'inbox',
  },
  {
    key: 'sales',
    parser: 'sales',
    match: (t) => t.includes('ขายดอก'),
    titleTh: 'การขายดอก',
    titleEn: 'Sales',
    icon: 'sales',
  },
  {
    key: 'inventory',
    parser: 'inventory',
    match: (t) => t.includes('คงเหลือ') || t.includes('สินค้า'),
    titleTh: 'สินค้าคงเหลือ',
    titleEn: 'Inventory',
    icon: 'stock',
  },
];

const SHEET_URL_RE = /https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/;

/**
 * อ่านไฟล์ .txt แล้วจับคู่ "บรรทัดชื่อรายงาน" กับ "บรรทัด URL" ที่ตามมา
 * รูปแบบในไฟล์คือ:
 *     ชื่อรายงาน:
 *     https://docs.google.com/spreadsheets/d/....
 */
export function parseSourceList(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let pendingLabel = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const urlMatch = line.match(SHEET_URL_RE);
    if (urlMatch) {
      const gidMatch = line.match(/[#?&]gid=(\d+)/);
      entries.push({
        label: (pendingLabel || '').replace(/[:：]\s*$/, '').trim(),
        sheetId: urlMatch[1],
        linkedGid: gidMatch ? gidMatch[1] : null,
        url: line,
      });
      pendingLabel = null;
    } else {
      // บรรทัดที่ไม่ใช่ URL ถือเป็นชื่อรายงานของ URL ถัดไป
      pendingLabel = line;
    }
  }
  return entries;
}

async function main() {
  const txtPath = path.join(ROOT, SOURCE_TXT);
  const text = await readFile(txtPath, 'utf8');
  const txtStat = await stat(txtPath);
  const entries = parseSourceList(text);

  if (entries.length === 0) {
    console.error(`✗ ไม่พบลิงก์ Google Sheets ใน "${SOURCE_TXT}"`);
    process.exit(1);
  }

  console.log(`อ่าน "${SOURCE_TXT}" พบ ${entries.length} ลิงก์\n`);

  const sources = [];
  const unmatched = [];

  for (const entry of entries) {
    const profile = PROFILES.find((p) => p.match(entry.label));
    if (!profile) {
      unmatched.push(entry);
      console.warn(`  ⚠ ไม่รู้จักรายงาน "${entry.label}" — ข้ามไป (เพิ่ม PROFILES ในสคริปต์นี้)`);
      continue;
    }

    process.stdout.write(`  • ${profile.key.padEnd(10)} ${entry.label} … `);
    let tabs = [];
    let error = null;
    try {
      tabs = await discoverTabs(entry.sheetId);
    } catch (err) {
      error = err.message;
    }

    if (error) {
      console.log(`✗ ${error}`);
    } else {
      console.log(`${tabs.length} tabs`);
    }

    sources.push({
      key: profile.key,
      parser: profile.parser,
      icon: profile.icon,
      labelInTxt: entry.label,
      titleTh: profile.titleTh,
      titleEn: profile.titleEn,
      sheetId: entry.sheetId,
      linkedGid: entry.linkedGid,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${entry.sheetId}/edit`,
      tabs,
      tabDiscoveryError: error,
    });
  }

  // เรียงตาม PROFILES เพื่อให้ลำดับการ์ดบน dashboard คงที่ ไม่ขึ้นกับลำดับในไฟล์ .txt
  sources.sort(
    (a, b) =>
      PROFILES.findIndex((p) => p.key === a.key) - PROFILES.findIndex((p) => p.key === b.key)
  );

  const payload = {
    $comment:
      'GENERATED FILE — ห้ามแก้ด้วยมือ. สร้างจาก "แบบฟอร์มรายงาน Kambis.txt" ด้วย node scripts/sync-sources.js',
    generatedFrom: SOURCE_TXT,
    generatedAt: new Date().toISOString(),
    sourceMtime: txtStat.mtime.toISOString(),
    unmatchedLabels: unmatched.map((u) => u.label),
    sources,
  };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  const totalTabs = sources.reduce((n, s) => n + s.tabs.length, 0);
  console.log(`\n✓ เขียน config/sources.json — ${sources.length} รายงาน / ${totalTabs} tabs`);
  if (unmatched.length) {
    console.log(`  (มี ${unmatched.length} รายการที่ยังไม่ได้ map: ${unmatched.map((u) => u.label).join(', ')})`);
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('sync-sources.js')) {
  main().catch((err) => {
    console.error('✗ sync ล้มเหลว:', err);
    process.exit(1);
  });
}
