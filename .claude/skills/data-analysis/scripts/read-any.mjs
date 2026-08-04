#!/usr/bin/env node
/**
 * read-any.mjs — อ่าน "ไฟล์ข้อมูลดิบ" ทุกชนิดที่เจอในงานนี้ ด้วย Node core module ล้วน
 * (zero dependency ตามกฎของโปรเจกต์ — node:zlib / node:sqlite เป็น core ไม่ใช่ npm)
 *
 *   node .claude/skills/data-analysis/scripts/read-any.mjs <ไฟล์> [ตัวเลือก]
 *
 *   --rows N          จำนวนแถวที่พรีวิว (ค่าเริ่มต้น 15)
 *   --sheet NAME      เลือกแท็บ/ตาราง (xlsx, ods, sqlite, html)
 *   --path a.b        เจาะเข้าไปใน JSON ก่อนแปลงเป็นตาราง
 *   --header N        บังคับว่าแถวที่ N (0-based) คือหัวตาราง
 *   --profile         สรุปรายคอลัมน์: nonNull / numeric / sum / min / max / median
 *   --json            พิมพ์ rows เป็น JSON (เอาไปต่อท่อ)
 *   --no-fill-merged  ไม่เติมค่าจากเซลล์ merge (ค่าเริ่มต้นคือเติมแล้วรายงานจำนวน)
 *
 * เครื่องมือนี้ใช้ "สำรวจ" ไฟล์ดิบก่อนเขียน parser จริง — ไม่ใช่ตัวแทน parser
 * ตัวเลขที่จะขึ้น Dashboard ต้องมาจาก server/lib/parsers/* ที่ผ่าน analysis.js เสมอ
 */

import { readFileSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { extname, basename } from 'node:path';
import { parseCsv, trimTrailingEmptyRows } from '../../../../server/lib/csv.js';

/* ───────────────────────── ZIP (xlsx / docx / pptx / ods) ───────────────────────── */

/**
 * แตกไฟล์ในแพ็กเกจ ZIP โดยไล่จาก End of Central Directory ย้อนขึ้นไป
 * (ปลอดภัยกว่าไล่ local header ทีละอัน เพราะไฟล์ที่เขียนแบบ streaming
 *  จะใส่ขนาดจริงไว้ใน data descriptor ที่อยู่ *หลัง* ข้อมูล)
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function unzip(buf) {
  const files = new Map();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ไม่ใช่ไฟล์ ZIP (หา End of Central Directory ไม่เจอ)');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory เพี้ยนที่รายการ ' + i);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + size);

    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

/* ───────────────────────── การเดารูปแบบไฟล์และ encoding ───────────────────────── */

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');

function sniffKind(buf, file) {
  const ext = extname(file).toLowerCase();
  if (buf.subarray(0, 4).equals(ZIP_MAGIC)) {
    if (ext === '.docx') return 'docx';
    if (ext === '.ods') return 'ods';
    if (ext === '.pptx') return 'pptx';
    return 'xlsx'; // .xlsx และ zip ที่มี xl/workbook.xml
  }
  if (buf.subarray(0, 16).equals(SQLITE_MAGIC)) return 'sqlite';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (ext === '.xls') return 'xls-legacy';
  if (ext === '.json') return 'json';
  if (ext === '.jsonl' || ext === '.ndjson') return 'ndjson';
  if (ext === '.xml') return 'xml';
  if (ext === '.html' || ext === '.htm') return 'html';
  return 'text';
}

/**
 * ถอดรหัสข้อความโดยดู BOM ก่อน แล้วค่อยลอง UTF-8 แบบเข้มงวด
 * ถ้าพังค่อยตกไป windows-874 (TIS-620) ซึ่งเป็นชุดอักขระไทยที่ Excel เก่ายังเขียนออกมา
 * @returns {{text: string, encoding: string}}
 */
export function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8 (มี BOM)' };
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf.subarray(2)), encoding: 'utf-16le' };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-874').decode(buf), encoding: 'windows-874 (TIS-620)' };
  }
}

/**
 * เดาตัวคั่นจาก "ความสม่ำเสมอของจำนวนคอลัมน์" ไม่ใช่จากจำนวนครั้งที่เจอ
 * (ข้อความไทยมีจุลภาคเยอะ การนับความถี่อย่างเดียวจะเลือก comma ผิดเสมอ)
 */
export function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  if (!lines.length) return ',';
  let best = ',';
  let bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => splitSimple(l, d).length);
    const cols = counts[0];
    if (cols < 2) continue;
    const consistent = counts.filter((c) => c === cols).length / counts.length;
    const score = consistent * 100 + Math.min(cols, 40);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitSimple(line, d) {
  // นับเฉพาะตัวคั่นที่อยู่นอกเครื่องหมายคำพูด
  const out = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; cur += ch; continue; }
    if (ch === d && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/* ───────────────────────────────── XLSX ───────────────────────────────── */

const XLSX_BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function xmlAttr(tag, name) {
  // ต้องมีช่องว่างนำหน้าชื่อ attribute เสมอ ไม่งั้น xmlAttr(tag,'s') จะไปคว้า spans="1:5"
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function colIndexFromRef(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/);
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** serial ของ Excel → ISO date (ฐาน 1899-12-30 เพราะ Excel เชื่อว่าปี 1900 เป็นปีอธิกสุรทิน) */
export function excelSerialToIso(serial, date1904 = false) {
  if (!Number.isFinite(serial)) return null;
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = base + Math.round(serial * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
}

function readXlsx(buf, opts) {
  const zip = unzip(buf);
  const notes = [];
  const text = (name) => (zip.has(name) ? zip.get(name).toString('utf8') : '');

  // sharedStrings — ข้อความส่วนใหญ่อยู่ที่นี่ ไม่ได้อยู่ในตัว sheet
  const shared = [];
  for (const si of text('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []) {
    const parts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    shared.push(parts.map((t) => decodeEntities(t.replace(/<[^>]+>/g, ''))).join(''));
  }

  // styles — ใช้ตัดสินว่า cell ที่เป็นตัวเลขจริง ๆ แล้วเป็นวันที่หรือเปล่า
  const stylesXml = text('xl/styles.xml');
  const customFmt = new Map();
  for (const f of stylesXml.match(/<numFmt\b[^>]*\/>/g) || []) {
    customFmt.set(Number(xmlAttr(f, 'numFmtId')), xmlAttr(f, 'formatCode') || '');
  }
  const cellXfsBlock = (stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const xfFmtIds = (cellXfsBlock.match(/<xf\b[^>]*>/g) || []).map((x) => Number(xmlAttr(x, 'numFmtId') || 0));
  const isDateStyle = (s) => {
    const id = xfFmtIds[Number(s)] ?? 0;
    if (XLSX_BUILTIN_DATE_FMT.has(id)) return true;
    const code = customFmt.get(id);
    return !!code && /[yYdD]|mm?m/.test(code.replace(/\[[^\]]*\]|"[^"]*"/g, ''));
  };

  const wb = text('xl/workbook.xml');
  const date1904 = /date1904="(1|true)"/.test(wb);
  const rels = text('xl/_rels/workbook.xml.rels');
  const relTarget = new Map();
  for (const r of rels.match(/<Relationship\b[^>]*\/>/g) || []) {
    relTarget.set(xmlAttr(r, 'Id'), xmlAttr(r, 'Target'));
  }

  const sheets = [];
  for (const s of wb.match(/<sheet\b[^>]*\/>/g) || []) {
    const name = xmlAttr(s, 'name');
    const rid = xmlAttr(s, 'r:id');
    let target = relTarget.get(rid) || `worksheets/sheet${sheets.length + 1}.xml`;
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    sheets.push({ name, path: 'xl/' + target });
  }
  if (!sheets.length) sheets.push({ name: 'sheet1', path: 'xl/worksheets/sheet1.xml' });

  const wanted = opts.sheet ? sheets.filter((s) => s.name === opts.sheet) : sheets;
  if (opts.sheet && !wanted.length) {
    throw new Error(`ไม่มีแท็บชื่อ "${opts.sheet}" — มีอยู่: ${sheets.map((s) => s.name).join(', ')}`);
  }

  const out = [];
  for (const sheet of wanted) {
    const xml = zip.has(sheet.path) ? zip.get(sheet.path).toString('utf8') : '';
    if (!xml) { notes.push(`อ่านแท็บ "${sheet.name}" ไม่ได้ (${sheet.path} ไม่อยู่ในไฟล์)`); continue; }

    const rows = [];
    let maxCol = 0;
    for (const rowXml of xml.match(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/g) || []) {
      const rIdx = Number(xmlAttr(rowXml, 'r') || rows.length + 1) - 1;
      const cells = [];
      for (const cm of rowXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1];
        const body = cm[2] || '';
        const ci = colIndexFromRef(xmlAttr('<c ' + attrs + '>', 'r')) ?? cells.length;
        const type = xmlAttr('<c ' + attrs + '>', 't');
        const style = xmlAttr('<c ' + attrs + '>', 's');
        let value = '';
        if (type === 'inlineStr') {
          value = (body.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
            .map((t) => decodeEntities(t.replace(/<[^>]+>/g, ''))).join('');
        } else {
          const v = body.match(/<v>([\s\S]*?)<\/v>/);
          const rawV = v ? decodeEntities(v[1]) : '';
          if (type === 's') value = shared[Number(rawV)] ?? '';
          else if (type === 'e') value = rawV;              // #DIV/0! ฯลฯ — เก็บไว้ให้เห็น
          else if (rawV !== '' && style !== null && isDateStyle(style) && /^-?\d+(\.\d+)?$/.test(rawV)) {
            value = excelSerialToIso(Number(rawV), date1904) ?? rawV;
          } else value = rawV;
        }
        cells[ci] = value;
        if (ci + 1 > maxCol) maxCol = ci + 1;
      }
      rows[rIdx] = cells;
    }

    // เติมช่องที่ xlsx ข้ามไป (cell ว่างไม่ถูกเขียนลงไฟล์เลย) ให้เป็น '' ทุกช่อง
    const grid = [];
    for (let r = 0; r < rows.length; r++) {
      const src = rows[r] || [];
      const line = new Array(maxCol).fill('');
      for (let c = 0; c < maxCol; c++) line[c] = src[c] ?? '';
      grid.push(line);
    }

    // เซลล์ merge เก็บค่าไว้ที่มุมซ้ายบนเท่านั้น — ช่องที่เหลือว่างเปล่า
    const merges = (xml.match(/<mergeCell\b[^>]*\/>/g) || []).map((m) => xmlAttr(m, 'ref'));
    let filled = 0;
    if (opts.fillMerged !== false) {
      for (const ref of merges) {
        const [a, b] = String(ref).split(':');
        const r1 = Number(a.replace(/[A-Z]/g, '')) - 1;
        const r2 = Number(b.replace(/[A-Z]/g, '')) - 1;
        const c1 = colIndexFromRef(a);
        const c2 = colIndexFromRef(b);
        const v = grid[r1]?.[c1] ?? '';
        if (v === '') continue;
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            if (grid[r] && grid[r][c] === '') { grid[r][c] = v; filled++; }
          }
        }
      }
    }
    if (merges.length) {
      notes.push(opts.fillMerged === false
        ? `แท็บ "${sheet.name}" มีเซลล์ merge ${merges.length} กลุ่ม (ไม่ได้เติมค่าตาม --no-fill-merged)`
        : `แท็บ "${sheet.name}" มีเซลล์ merge ${merges.length} กลุ่ม — เติมค่าให้แล้ว ${filled} ช่อง`);
    }

    out.push({ name: sheet.name, rows: trimTrailingEmptyRows(grid) });
  }

  return { sheets: out, notes, allSheetNames: sheets.map((s) => s.name) };
}

/* ───────────────────────────────── DOCX ───────────────────────────────── */

function readDocx(buf) {
  const zip = unzip(buf);
  const xml = (zip.get('word/document.xml') || Buffer.alloc(0)).toString('utf8');

  const tables = [];
  for (const tbl of xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []) {
    const rows = [];
    for (const tr of tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
      const cells = [];
      for (const tc of tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []) {
        cells.push(decodeEntities(tc.replace(/<[^>]+>/g, '')).trim());
      }
      rows.push(cells);
    }
    if (rows.length) tables.push({ name: `ตารางที่ ${tables.length + 1}`, rows });
  }

  const body = xml
    .replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '\n')
    .replace(/<w:p[ >]/g, '\n<w:p ')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br\/>/g, '\n');
  const paragraphs = decodeEntities(body.replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.trim()).filter(Boolean);

  return { paragraphs, tables };
}

/* ───────────────────────────── ODS / HTML / XML ───────────────────────────── */

/** ODS — ยังไม่ได้ทดสอบกับไฟล์จริงในโปรเจกต์นี้ ถ้าใช้แล้วเพี้ยนให้แก้ตรงนี้ */
function readOds(buf) {
  const zip = unzip(buf);
  const xml = (zip.get('content.xml') || Buffer.alloc(0)).toString('utf8');
  const sheets = [];
  for (const t of xml.match(/<table:table\b[\s\S]*?<\/table:table>/g) || []) {
    const name = xmlAttr(t, 'table:name') || `table${sheets.length + 1}`;
    const rows = [];
    for (const tr of t.match(/<table:table-row\b[^>]*(?:\/>|>[\s\S]*?<\/table:table-row>)/g) || []) {
      const cells = [];
      for (const tc of tr.match(/<table:table-cell\b[^>]*(?:\/>|>[\s\S]*?<\/table:table-cell>)/g) || []) {
        const repeat = Number(xmlAttr(tc, 'table:number-columns-repeated') || 1);
        const v = xmlAttr(tc, 'office:value')
          ?? decodeEntities(tc.replace(/<[^>]+>/g, '')).trim();
        for (let i = 0; i < Math.min(repeat, 1024); i++) cells.push(v);
      }
      rows.push(cells);
    }
    sheets.push({ name, rows: trimTrailingEmptyRows(rows) });
  }
  return { sheets, notes: ['ตัวอ่าน ODS ยังไม่ได้ทดสอบกับไฟล์จริง — ตรวจค่าที่ได้ก่อนเชื่อ'] };
}

function readHtmlTables(text) {
  const sheets = [];
  for (const tbl of text.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows = [];
    for (const tr of tbl.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = [];
      for (const td of tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []) {
        cells.push(decodeEntities(td.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
      }
      rows.push(cells);
    }
    if (rows.length) sheets.push({ name: `ตารางที่ ${sheets.length + 1}`, rows });
  }
  return sheets;
}

/* ───────────────────────────────── JSON ───────────────────────────────── */

function pick(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return null;
    cur = Array.isArray(cur) && /^\d+$/.test(key) ? cur[Number(key)] : cur[key];
  }
  return cur;
}

function jsonToRows(value) {
  if (Array.isArray(value) && value.length && typeof value[0] === 'object' && value[0] !== null) {
    const keys = [];
    for (const item of value) for (const k of Object.keys(item || {})) if (!keys.includes(k)) keys.push(k);
    const rows = [keys];
    for (const item of value) {
      rows.push(keys.map((k) => {
        const v = item?.[k];
        return v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      }));
    }
    return rows;
  }
  return null;
}

/* ──────────────────────── การคำนวณ: ต้องแม่นก่อน ต้องเร็วทีหลัง ──────────────────────── */

/**
 * ผลรวมแบบชดเชยความคลาดเคลื่อน (Neumaier) — บวก float ตรง ๆ หลายพันแถวแล้วเพี้ยนได้จริง
 * เช่น 0.1 + 0.2 = 0.30000000000000004 สะสมไปเรื่อย ๆ จนชนกับ tolerance 0.5 g
 * @param {number[]} values
 * @returns {number}
 */
export function accurateSum(values) {
  let sum = 0;
  let comp = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const t = sum + v;
    comp += Math.abs(sum) >= Math.abs(v) ? (sum - t) + v : (v - t) + sum;
    sum = t;
  }
  return sum + comp;
}

/** median ที่เฉลี่ยสองค่ากลางเมื่อจำนวนเป็นเลขคู่ (ไม่ใช่หยิบตัวล่างมาใช้) */
export function median(values) {
  const s = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** ตัวเลขในเซลล์ — กติกาเดียวกับ normalize.num(): "-" และค่าว่าง = null ไม่ใช่ 0 */
function cellNum(value) {
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (s === '' || s === '-' || s === '—' || s === '–' || s === 'N/A' || /^#[A-Z/]+[!?]$/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }   // (1,234) = -1234 ตามแบบบัญชี
  s = s.replace(/,/g, '').replace(/\s/g, '').replace(/[฿%]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function profileColumns(rows, headerIdx) {
  const header = rows[headerIdx] || [];
  const body = rows.slice(headerIdx + 1);
  const width = Math.max(header.length, ...body.map((r) => r.length), 0);
  const out = [];
  for (let c = 0; c < width; c++) {
    const raw = body.map((r) => r[c] ?? '');
    const nonEmpty = raw.filter((v) => String(v).trim() !== '');
    const nums = raw.map(cellNum).filter((v) => v !== null);
    const distinct = [...new Set(nonEmpty.map(String))];
    out.push({
      col: c,
      name: String(header[c] ?? '').trim() || `(คอลัมน์ ${c})`,
      nonNull: nonEmpty.length,
      total: body.length,
      numeric: nums.length,
      sum: nums.length ? accurateSum(nums) : null,
      min: nums.length ? Math.min(...nums) : null,
      max: nums.length ? Math.max(...nums) : null,
      median: median(nums),
      distinct: distinct.length,
      samples: distinct.slice(0, 3),
    });
  }
  return out;
}

/** หัวตารางที่เดาได้: แถวแรกที่มี ≥2 ช่องเป็นข้อความ และแถวถัดไปมีตัวเลข */
function guessHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cur = rows[i] || [];
    const next = rows[i + 1] || [];
    const labels = cur.filter((v) => String(v).trim() && cellNum(v) === null).length;
    const numbersBelow = next.filter((v) => cellNum(v) !== null).length;
    if (labels >= 2 && numbersBelow >= 1) return i;
  }
  return 0;
}

/* ───────────────────────────────── การแสดงผล ───────────────────────────────── */

const w = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ');
  // อักษรไทยกว้างไม่เท่าอังกฤษในเทอร์มินัล — ตัดตามจำนวนอักขระพอ ไม่ต้องเป๊ะ
  return t.length > n ? t.slice(0, n - 1) + '…' : t.padEnd(n);
};

function printTable(rows, limit, headerIdx) {
  const shown = rows.slice(0, limit);
  const width = Math.max(...shown.map((r) => r.length), 0);
  const colW = [];
  for (let c = 0; c < width; c++) {
    colW[c] = Math.min(22, Math.max(4, ...shown.map((r) => String(r[c] ?? '').replace(/\s+/g, ' ').length)));
  }
  shown.forEach((row, i) => {
    const mark = i === headerIdx ? '▸' : ' ';
    const line = [];
    for (let c = 0; c < width; c++) line.push(w(row[c], colW[c]));
    console.log(`${mark}${String(i).padStart(4)} │ ${line.join(' │ ')}`);
  });
  if (rows.length > limit) console.log(`      … อีก ${rows.length - limit} แถว`);
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1000 || Number.isInteger(n)) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return String(Number(n.toPrecision(10)));
}

/* ───────────────────────────────── main ───────────────────────────────── */

function parseArgs(argv) {
  const opts = { rows: 15, fillMerged: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rows') opts.rows = Number(argv[++i]);
    else if (a === '--sheet') opts.sheet = argv[++i];
    else if (a === '--path') opts.path = argv[++i];
    else if (a === '--header') opts.header = Number(argv[++i]);
    else if (a === '--profile') opts.profile = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-fill-merged') opts.fillMerged = false;
    else rest.push(a);
  }
  opts.file = rest[0];
  return opts;
}

function emit(opts, kind, encoding, sheets, notes, extra = {}) {
  if (opts.json) {
    console.log(JSON.stringify({ kind, encoding, notes, ...extra, sheets }, null, 2));
    return;
  }

  console.log(`ชนิดไฟล์  : ${kind}${encoding ? ` · encoding ${encoding}` : ''}`);
  if (extra.allSheetNames) console.log(`แท็บทั้งหมด: ${extra.allSheetNames.length} — ${extra.allSheetNames.join(' · ')}`);
  for (const n of notes || []) console.log(`หมายเหตุ  : ${n}`);

  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    const width = Math.max(0, ...rows.map((r) => r.length));
    const headerIdx = Number.isInteger(opts.header) ? opts.header : guessHeaderRow(rows);
    console.log(`\n── ${sheet.name} — ${rows.length} แถว × ${width} คอลัมน์ · เดาว่าหัวตารางคือแถว ${headerIdx} (▸)`);
    if (!rows.length) { console.log('   (ไม่มีข้อมูล)'); continue; }
    printTable(rows, opts.rows, headerIdx);

    if (opts.profile) {
      console.log('\n   คอลัมน์                  ไม่ว่าง   ตัวเลข        ผลรวม          ต่ำสุด        สูงสุด       มัธยฐาน  ค่าไม่ซ้ำ');
      for (const p of profileColumns(rows, headerIdx)) {
        if (!p.nonNull) continue;
        console.log(
          `   ${w(p.name, 22)} ${String(p.nonNull).padStart(7)} ${String(p.numeric).padStart(8)}`
          + ` ${fmt(p.sum).padStart(14)} ${fmt(p.min).padStart(12)} ${fmt(p.max).padStart(12)}`
          + ` ${fmt(p.median).padStart(12)} ${String(p.distinct).padStart(8)}`
          + (p.numeric === 0 ? `  เช่น ${p.samples.join(' / ')}` : '')
        );
      }
      console.log('\n   ผลรวมคำนวณด้วย Neumaier compensation · "-" และช่องว่างนับเป็นไม่มีข้อมูล ไม่ใช่ 0');
      console.log('   โปรไฟล์นี้นับ *ทุกแถว* รวมแถว Total ของชีตด้วย — เป็นตัวเลขไว้สำรวจ ห้ามเอาไปใช้เป็นยอดจริง');
    }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error('ใช้: node .claude/skills/data-analysis/scripts/read-any.mjs <ไฟล์> [--rows N] [--sheet ชื่อ] [--profile] [--json]');
    process.exit(2);
  }

  const buf = readFileSync(opts.file);
  const kind = sniffKind(buf, opts.file);
  const size = statSync(opts.file).size;
  if (!opts.json) console.log(`ไฟล์      : ${basename(opts.file)} (${size.toLocaleString('en-US')} ไบต์)`);

  switch (kind) {
    case 'xlsx': {
      const { sheets, notes, allSheetNames } = readXlsx(buf, opts);
      return emit(opts, 'xlsx', null, sheets, notes, { allSheetNames });
    }
    case 'ods': {
      const { sheets, notes } = readOds(buf);
      return emit(opts, 'ods', null, sheets, notes);
    }
    case 'docx': {
      const { paragraphs, tables } = readDocx(buf);
      if (opts.json) return console.log(JSON.stringify({ kind, paragraphs, tables }, null, 2));
      console.log(`ชนิดไฟล์  : docx — ${paragraphs.length} ย่อหน้า · ${tables.length} ตาราง\n`);
      for (const p of paragraphs.slice(0, opts.rows)) console.log('  ' + p);
      if (paragraphs.length > opts.rows) console.log(`  … อีก ${paragraphs.length - opts.rows} ย่อหน้า`);
      return emit({ ...opts, json: false }, 'docx (ตาราง)', null, tables, []);
    }
    case 'sqlite': {
      const { DatabaseSync } = require_sqlite();
      const db = new DatabaseSync(opts.file, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
      const target = opts.sheet || tables[0];
      const rows = target ? db.prepare(`SELECT * FROM "${target}" LIMIT ${Math.max(opts.rows, 1) * 4}`).all() : [];
      const grid = jsonToRows(rows) || [[]];
      return emit(opts, 'sqlite', null, [{ name: target || '(ไม่มีตาราง)', rows: grid }], [], { allSheetNames: tables });
    }
    case 'pdf':
      console.error('PDF: ดึงข้อความไม่ได้อย่างน่าเชื่อถือด้วย core module ล้วน (เนื้อหาอยู่ใน content stream ที่บีบอัดและอ้าง font map)');
      console.error('ให้ขอไฟล์ต้นทางเป็น .csv / .xlsx แทน — อย่าคีย์ตัวเลขจาก PDF ด้วยมือแล้วเอาไปคำนวณ');
      process.exit(3);
      break;
    case 'xls-legacy':
      console.error('.xls รูปแบบเก่า (BIFF binary) อ่านตรง ๆ ไม่ได้ — ให้ Save As เป็น .xlsx หรือ .csv ก่อน');
      process.exit(3);
      break;
    default: {
      const { text, encoding } = decodeText(buf);
      if (kind === 'json' || kind === 'ndjson' || /^\s*[[{]/.test(text)) {
        const lines = () => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
        let value;
        if (kind === 'ndjson') value = lines();
        else {
          try { value = JSON.parse(text); }
          catch { value = lines(); }   // ndjson ที่ไม่ได้ตั้งนามสกุลไว้
        }
        value = pick(value, opts.path);
        const grid = jsonToRows(value);
        if (grid) return emit(opts, kind, encoding, [{ name: opts.path || '(ราก)', rows: grid }], []);
        console.log(`ชนิดไฟล์  : ${kind} · encoding ${encoding}`);
        console.log('โครงสร้างไม่ใช่ array ของ object — คีย์ระดับบน:');
        console.log('  ' + Object.keys(value ?? {}).join(' · '));
        console.log('ใช้ --path <คีย์> เพื่อเจาะเข้าไป');
        return;
      }
      if (kind === 'html' || kind === 'xml') {
        const sheets = readHtmlTables(text);
        if (sheets.length) return emit(opts, kind, encoding, sheets, []);
      }
      const delim = sniffDelimiter(text);
      const rows = delim === ','
        ? trimTrailingEmptyRows(parseCsv(text))
        : trimTrailingEmptyRows(text.split(/\r?\n/).map((l) => splitSimple(l, delim).map((c) => c.replace(/^"|"$/g, ''))));
      const crlf = /\r\n/.test(text);
      return emit(opts, `text (ตัวคั่น ${JSON.stringify(delim)})`, `${encoding}${crlf ? ' · CRLF' : ' · LF'}`, [{ name: basename(opts.file), rows }], []);
    }
  }
}

function require_sqlite() {
  // node:sqlite มีตั้งแต่ Node 22 — ถ้าเวอร์ชันเก่ากว่านี้ให้ error ที่อ่านรู้เรื่อง
  try {
    return globalThis.process.getBuiltinModule('node:sqlite');
  } catch {
    throw new Error('Node เวอร์ชันนี้ไม่มี node:sqlite (ต้อง Node 22 ขึ้นไป)');
  }
}

main();
