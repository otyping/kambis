/**
 * csv.js — CSV parser ตามมาตรฐาน RFC4180
 *
 * จำเป็นต้องเขียนเองเพราะเซลล์ในชีตของ Kambis มีทั้ง comma ในตัวเลข ("1,695.00"),
 * เครื่องหมายคำพูดซ้อน และขึ้นบรรทัดใหม่ในเซลล์เดียว (เช่น "Og Kush หน้าถุงเขียน\nPablo Revenge")
 */

/**
 * แปลงข้อความ CSV เป็น array ของแถว (แต่ละแถวเป็น array ของ string)
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // ตัด BOM ถ้ามี
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      // \r\n หรือ \r เดี่ยว ๆ ถือเป็นจบแถวเหมือนกัน
      if (text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // แถวสุดท้ายที่ไม่ได้ลงท้ายด้วย newline
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * ตัดแถวว่างท้ายตาราง (Google มักส่งแถวว่างมาเป็นสิบ) แต่คงแถวว่างตรงกลางไว้
 * เพราะแถวว่างตรงกลางคือตัวคั่นบล็อกข้อมูลในหลายชีต
 * @param {string[][]} rows
 * @returns {string[][]}
 */
export function trimTrailingEmptyRows(rows) {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => String(c ?? '').trim() === '')) end--;
  return rows.slice(0, end);
}

/** แถวนี้ว่างทั้งแถวหรือไม่ */
export function isEmptyRow(row) {
  return !row || row.every((c) => String(c ?? '').trim() === '');
}
