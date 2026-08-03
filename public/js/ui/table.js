/**
 * ui/table.js — ตารางที่เรียงลำดับได้ ใช้ใน modal ทุกใบ
 * ตารางกว้างกว่าจอให้ scroll ในกล่องตัวเอง ไม่ทำให้ทั้งหน้าเลื่อนแนวนอน
 *
 * **คอลัมน์ที่เป็นช่วงเวลาต้องเรียงตามเวลา ไม่ใช่ตามตัวอักษร**
 * ป้ายไตรมาสเขียนว่า `Q1'2026` ถ้าเรียงด้วย localeCompare จะได้
 * Q1'2026 → Q2'2025 → Q2'2026 เพราะเทียบ "Q1" กับ "Q2" ก่อนถึงปี
 * (กราฟกับการ์ดกันเคสนี้ไว้แล้วผ่าน comparePeriod แต่หัวตารางที่กดเรียงได้เคยหลุด)
 */
import { esc } from '../format.js';
import { comparePeriod, looksLikePeriod } from '../shared/agg-core.js';

/**
 * @param {Array<{key:string,label:string,align?:'n',get:(row)=>any,render?:(row)=>string}>} columns
 * @param {Array<object>} rows
 */
export function sortableTable(columns, rows, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  const table = document.createElement('table');
  table.className = 'data';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((col, i) => {
    const th = document.createElement('th');
    th.textContent = col.label;
    th.scope = 'col';
    th.tabIndex = 0;
    th.dataset.index = String(i);
    if (col.align === 'n') th.style.textAlign = 'right';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  wrap.appendChild(table);

  let sortIndex = opts.sortIndex ?? null;
  let sortDir = opts.sortDir ?? 'desc';
  let data = [...rows];

  /**
   * คอลัมน์นี้เป็นช่วงเวลาหรือเปล่า — ดูจากค่าที่มีอยู่จริงทั้งคอลัมน์
   *
   * ต้องเข้าเกณฑ์ทุกค่า ไม่ใช่แค่บางค่า ไม่งั้นคอลัมน์ข้อความธรรมดาที่บังเอิญ
   * มีตัวเลข 4 หลักปนอยู่บางแถวจะถูกเรียงด้วยกฎเวลาแล้วค่าที่เหลือไปกองท้ายหมด
   */
  const isPeriodColumn = (col) => {
    let seen = 0;
    for (const row of data) {
      const v = col.get(row);
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number') return false;
      if (!looksLikePeriod(v)) return false;
      seen++;
    }
    return seen > 0;
  };

  const draw = () => {
    if (sortIndex !== null) {
      const col = columns[sortIndex];
      const byTime = isPeriodColumn(col);
      data.sort((a, b) => {
        const av = col.get(a);
        const bv = col.get(b);
        const aNull = av === null || av === undefined || av === '';
        const bNull = bv === null || bv === undefined || bv === '';
        if (aNull && bNull) return 0;
        if (aNull) return 1; // ค่าว่างไปท้ายเสมอ ไม่ว่าจะเรียงทางไหน
        if (bNull) return -1;
        const cmp = byTime
          ? comparePeriod(av, bv)
          : typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'th');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    headRow.querySelectorAll('th').forEach((th, i) => {
      if (i === sortIndex) th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });

    // จำกัดจำนวนแถวที่วาด เพื่อไม่ให้ DOM บวมกับข้อมูลหลายร้อยแถว
    const limit = opts.limit ?? 400;
    const shown = data.slice(0, limit);

    tbody.innerHTML = shown
      .map(
        (row) =>
          `<tr>${columns
            .map((col) => {
              const html = col.render ? col.render(row) : esc(col.get(row) ?? '—');
              return `<td class="${col.align === 'n' ? 'n' : ''}">${html}</td>`;
            })
            .join('')}</tr>`
      )
      .join('');

    if (data.length > limit) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="muted" colspan="${columns.length}">… ${data.length - limit} ${
        opts.moreLabel ?? 'more'
      }</td>`;
      tbody.appendChild(tr);
    }
  };

  const sortBy = (index) => {
    if (sortIndex === index) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else {
      sortIndex = index;
      sortDir = 'desc';
    }
    draw();
  };

  headRow.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (th) sortBy(Number(th.dataset.index));
  });
  headRow.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const th = e.target.closest('th');
    if (!th) return;
    e.preventDefault();
    sortBy(Number(th.dataset.index));
  });

  draw();

  /** เปลี่ยนชุดข้อมูลโดยไม่สร้างตารางใหม่ (ใช้กับตัวกรอง) */
  wrap.setRows = (next) => {
    data = [...next];
    draw();
  };

  return wrap;
}
