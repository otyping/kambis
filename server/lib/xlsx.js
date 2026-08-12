/**
 * xlsx.js — เขียนไฟล์ .xlsx เองโดยไม่ใช้ไลบรารีภายนอก
 *
 * โปรเจกต์นี้ตั้งกฎ zero npm dependencies ไว้ แต่ยังต้องออกใบขอซื้อเป็น Excel ได้
 * โชคดีที่ .xlsx คือไฟล์ ZIP ที่บรรจุ XML ไม่กี่ไฟล์ และ Node มี `node:zlib`
 * เป็น core module (ไม่ใช่ npm package) จึงบีบอัดแบบ deflate ได้เลย
 *
 * สิ่งที่ต้องเขียนเองมีสามชั้น:
 *   1. CRC32            — ZIP บังคับให้มี checksum ของทุกไฟล์
 *   2. ZIP writer       — local file header + central directory + EOCD
 *   3. SpreadsheetML    — โครง XML ขั้นต่ำที่ Excel ยอมเปิด
 *
 * ข้อความไทยเขียนเป็น inline string (t="inlineStr") ไม่ใช้ sharedStrings.xml
 * เพราะไม่ต้องทำตารางอ้างอิงแยก โค้ดสั้นลงและพลาดยากกว่ามาก
 */
import { deflateRawSync } from 'node:zlib';

// ── CRC32 ────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

// ── ZIP ──────────────────────────────────────────────────────
/**
 * ประกอบไฟล์ ZIP จากรายการ { name, data }
 *
 * ใช้ deflate แบบ raw (method 8) ทุกไฟล์ และเขียนขนาด/CRC ลง local header
 * ตรง ๆ ไม่ใช้ data descriptor เพราะเรารู้ขนาดล่วงหน้าอยู่แล้ว
 *
 * @param {{name:string, data:Buffer|string}[]} files
 * @param {Date} [modified] เวลาที่ประทับบนไฟล์ (ส่งเข้ามาเพื่อให้ทดสอบซ้ำได้)
 * @returns {Buffer}
 */
export function zip(files, modified = new Date()) {
  const entries = [];
  const chunks = [];
  let offset = 0;

  // เวลาในรูปแบบ MS-DOS ที่ ZIP ใช้ (ความละเอียด 2 วินาที)
  const dosTime =
    (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1);
  const dosDate =
    ((modified.getFullYear() - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate();

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const deflated = deflateRawSync(raw);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flag: ชื่อไฟล์เป็น UTF-8
    local.writeUInt16LE(8, 8); // method: deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBuf, deflated);
    entries.push({ nameBuf, crc, compressed: deflated.length, size: raw.length, offset });
    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralStart = offset;
  for (const e of entries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compressed, 20);
    central.writeUInt32LE(e.size, 24);
    central.writeUInt16LE(e.nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(e.offset, 42);
    chunks.push(central, e.nameBuf);
    offset += central.length + e.nameBuf.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(offset - centralStart, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

// ── SpreadsheetML ────────────────────────────────────────────
/** escape อักขระที่ XML สงวนไว้ — ข้อความไทยผ่านได้ตามปกติเพราะไฟล์เป็น UTF-8 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // อักขระควบคุมที่ XML 1.0 ไม่ยอมรับ ทำให้ Excel ฟ้องไฟล์เสีย
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/** เลขคอลัมน์ (0-based) → ตัวอักษรแบบ Excel: 0→A, 25→Z, 26→AA */
export function columnLetter(index) {
  let n = index;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

/**
 * รูปแบบเซลล์ (index ต้องตรงกับลำดับ cellXfs ใน STYLES ด้านล่างเป๊ะ ๆ)
 *
 * ชุดนี้ทำตามแบบฟอร์ม Purchase Request ของบริษัทที่มีอยู่แล้ว
 * (ตัวอักษรขนาด 16, ตารางมีเส้นขอบครบ, ช่องกรอกเป็นเส้นใต้, ชื่อผู้อนุมัติมีเส้นบน)
 */
export const STYLE = {
  NORMAL: 0,
  TITLE: 1, // หัวเอกสาร — หนา จัดกลาง
  LABEL: 2, // "Name:" "Project:" — หนา ชิดซ้าย
  LABEL_C: 3, // "Date:" "Phase:" — หนา จัดกลาง
  FIELD: 4, // ช่องกรอก — เส้นใต้
  TH: 5, // หัวตาราง — หนา จัดกลาง เส้นขอบครบ
  TD: 6, // เซลล์ข้อความ — เส้นขอบครบ
  TD_C: 7, // เซลล์จัดกลาง — เส้นขอบครบ
  TD_MONEY: 8, // เซลล์เงิน — เส้นขอบครบ #,##0.00
  TOTAL_LABEL: 9, // แถวรวม — หนา จัดกลาง มีพื้น
  TOTAL_VALUE: 10, // ยอดรวม — หนา ชิดขวา
  SIGN_LINE: 11, // เส้นสำหรับเซ็น — เส้นใต้
  SIGN_NAME: 12, // ชื่อผู้อนุมัติ — เส้นบน จัดกลาง
  NOTE: 13, // หมายเหตุ — ตัวเล็ก
};

/* ฟอนต์ต้องรองรับภาษาไทย เพราะชื่อวัสดุเป็นไทยเกือบทั้งหมด
 * Tahoma มีอยู่ทุกเครื่อง Windows และแสดงทั้งไทยและละตินได้ครบ */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1">
<numFmt numFmtId="164" formatCode="#,##0.00"/>
</numFmts>
${/* Angsana New 16pt ตามที่ผู้ใช้กำหนด — เป็นฟอนต์ที่บริษัทใช้กับเอกสารไทย
    * ตัวอักษรเตี้ยกว่า Tahoma มาก ที่ 16pt จึงอ่านพอ ๆ กับ Tahoma 11
    * หัวเอกสารกับหมายเหตุขยับขึ้น/ลงจากฐานนี้ ไม่ได้ตั้งค่าอิสระ */ ''}
<fonts count="4">
<font><sz val="16"/><name val="Angsana New"/></font>
<font><b/><sz val="16"/><name val="Angsana New"/></font>
<font><b/><sz val="22"/><name val="Angsana New"/></font>
<font><sz val="14"/><color rgb="FF666666"/><name val="Angsana New"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7E1B1"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="4">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"/><diagonal/></border>
<border><left/><right/><top style="thin"/><bottom/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="3" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * แปลงเซลล์หนึ่งช่องเป็น XML
 * @param {{v:any, s?:number}|string|number|null} cell
 */
function cellXml(cell, ref) {
  const value = cell !== null && typeof cell === 'object' ? cell.v : cell;
  const style = cell !== null && typeof cell === 'object' ? (cell.s ?? STYLE.NORMAL) : STYLE.NORMAL;
  const s = style ? ` s="${style}"` : '';

  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  // inline string — ไม่ต้องมี sharedStrings.xml
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * สร้างไฟล์ .xlsx ที่มีชีตเดียว
 *
 * @param {object} opts
 * @param {string} [opts.sheetName]
 * @param {Array<Array<any>>} opts.rows แถวของเซลล์ — ค่าเป็น string/number/null
 *   หรือ { v, s } เมื่อต้องการกำหนดรูปแบบ (ดู STYLE)
 * @param {number[]} [opts.columnWidths] ความกว้างคอลัมน์ (หน่วยเดียวกับ Excel)
 * @param {string[]} [opts.merges] ช่วงเซลล์ที่ผสานกัน เช่น ['A1:E1']
 * @param {Record<number, number>} [opts.rowHeights] ความสูงแถว (1-based)
 * @param {Date} [opts.modified]
 * @returns {Buffer}
 */
export function buildXlsx({
  sheetName = 'Sheet1',
  rows,
  columnWidths = [],
  merges = [],
  rowHeights = {},
  modified,
  page = null,
  image = null,
}) {
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => cellXml(cell, `${columnLetter(c)}${r + 1}`))
        .join('');
      const h = rowHeights[r + 1];
      const attrs = h ? ` ht="${h}" customHeight="1"` : '';
      return `<row r="${r + 1}"${attrs}>${cells}</row>`;
    })
    .join('');

  const cols = columnWidths.length
    ? `<cols>${columnWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  /* mergeCells ต้องอยู่ **หลัง** sheetData ตามลำดับที่ schema กำหนด
   * สลับลำดับแล้ว Excel จะฟ้องว่าไฟล์เสียและขอซ่อมก่อนเปิด */
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((ref) => `<mergeCell ref="${ref}"/>`)
        .join('')}</mergeCells>`
    : '';

  /* ── ตั้งค่าหน้ากระดาษสำหรับพิมพ์ ──
   *
   * เอกสารนี้มีไว้ปริ้นให้ผู้บริหารเซ็น ถ้าไม่ตั้งค่า Excel จะใช้ Letter
   * แล้วตารางล้นไปหน้าที่สองโดยที่คนสั่งพิมพ์ไม่รู้ตัวจนกระดาษออกมาแล้ว
   *
   * `fitToWidth: 1, fitToHeight: 1` บังคับย่อให้ลงแผ่นเดียว ต้องมาคู่กับ
   * `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` ไม่งั้น Excel เมินทั้งคู่
   *
   * **ลำดับ element ใน worksheet ถูกกำหนดโดย schema** — sheetPr ต้องมาก่อน cols
   * ส่วน mergeCells/pageMargins/pageSetup/drawing ต้องอยู่หลัง sheetData ตามลำดับนี้
   * สลับแล้ว Excel ฟ้องว่าไฟล์เสียและขอซ่อมก่อนเปิด */
  const sheetPr = page?.fitToPage
    ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    : '';

  const marginsXml = page
    ? `<pageMargins left="${page.margins?.left ?? 0.4}" right="${page.margins?.right ?? 0.4}" ` +
      `top="${page.margins?.top ?? 0.5}" bottom="${page.margins?.bottom ?? 0.5}" ` +
      `header="0.3" footer="0.3"/>`
    : '';

  // paperSize 9 = A4 (ตามตาราง ECMA-376) · orientation portrait
  const setupXml = page
    ? `<pageSetup paperSize="9" orientation="${page.orientation ?? 'portrait'}"` +
      (page.fitToPage ? ' fitToWidth="1" fitToHeight="1"' : '') +
      '/>'
    : '';

  const drawingXml = image ? '<drawing r:id="rId2"/>' : '';
  const sheetNs = image
    ? ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    : '';

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${sheetNs}>${sheetPr}${cols}<sheetData>${sheetRows}</sheetData>${mergeXml}${marginsXml}${setupXml}${drawingXml}</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  /* ── โลโก้ ──
   *
   * รูปใน .xlsx ต้องมีสี่ชิ้นครบถึงจะขึ้น: ไฟล์รูปใน xl/media/ · drawing1.xml
   * ที่บอกตำแหน่ง · rels ของ drawing ที่ชี้ไปหารูป · และ <drawing> ในแผ่นงาน
   * ขาดชิ้นใดชิ้นหนึ่ง Excel จะเปิดได้แต่ไม่มีรูป หรือฟ้องว่าไฟล์เสีย
   *
   * ใช้ oneCellAnchor เพื่อให้รูปคงขนาดเดิมไม่ว่าคอลัมน์จะกว้างแค่ไหน
   * (twoCellAnchor จะยืดรูปตามเซลล์ โลโก้จะเบี้ยวเวลาปรับความกว้างคอลัมน์)
   * EMU คือหน่วยของ OOXML — 914400 EMU = 1 นิ้ว */
  const EMU_PER_PX = 9525;
  const drawing = image
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:oneCellAnchor>
<xdr:from><xdr:col>${image.col ?? 0}</xdr:col><xdr:colOff>${image.offsetX ?? 0}</xdr:colOff><xdr:row>${image.row ?? 0}</xdr:row><xdr:rowOff>${image.offsetY ?? 0}</xdr:rowOff></xdr:from>
<xdr:ext cx="${Math.round((image.width ?? 90) * EMU_PER_PX)}" cy="${Math.round((image.height ?? 90) * EMU_PER_PX)}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="1" name="${escapeXml(image.name ?? 'Logo')}"/><xdr:cNvPicPr/></xdr:nvPicPr>
<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round((image.width ?? 90) * EMU_PER_PX)}" cy="${Math.round((image.height ?? 90) * EMU_PER_PX)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>
</xdr:wsDr>`
    : null;

  const drawingRels = image
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/>
</Relationships>`
    : null;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>${
    image ? '\n<Default Extension="png" ContentType="image/png"/>' : ''
  }
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${
    image
      ? '\n<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      : ''
  }
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // แผ่นงานต้องมี rels ของตัวเองเมื่อมีรูป — ชี้จาก r:id="rId2" ในแท็ก <drawing>
  const sheetRels = image
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`
    : null;

  const files = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ];
  if (image) {
    files.push(
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', data: sheetRels },
      { name: 'xl/drawings/drawing1.xml', data: drawing },
      { name: 'xl/drawings/_rels/drawing1.xml.rels', data: drawingRels },
      { name: 'xl/media/logo.png', data: image.data }
    );
  }

  return zip(files, modified);
}
