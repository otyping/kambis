/**
 * ui/placeholder.js — การ์ด "รอข้อมูล"
 *
 * เอกสารกำหนดหัวข้อไว้หลายอันที่ชีตต้นทางยังไม่มีข้อมูลรองรับ เช่น รายได้ ต้นทุน
 * ราคาขายเฉลี่ยต่อกรัม สต็อกย้อนหลัง และอายุสต็อก
 *
 * เลือกแสดงเป็นการ์ดที่บอกชัดว่า "ต้องเพิ่มคอลัมน์อะไรในชีตไหน" แทนที่จะซ่อนไป
 * เพราะการซ่อนทำให้ผู้ใช้เข้าใจว่าลืมทำ ส่วนการเดาตัวเลขมาแทนคือการ
 * "ซ่อมข้อมูลเงียบ ๆ" ซึ่ง CLAUDE.md ข้อ 2 ห้ามไว้
 *
 * ทุกการ์ดต้องมีลิงก์ไปยังชีตต้นทาง ตามกฎข้อ 10 (ห้ามบอกปัญหาโดยไม่บอกว่าอยู่ที่ไหน)
 */
import { t } from '../i18n.js';
import { esc } from '../format.js';

/**
 * @param {object} opts
 * @param {string} opts.title       หัวข้อตามเอกสาร
 * @param {string} [opts.why]       เหตุผลที่ทำไม่ได้ตอนนี้
 * @param {{sheet:string, sheetUrl?:string, gid?:string, columns:string[]}[]} opts.needs
 * @param {boolean} [opts.wide]
 * @returns {HTMLElement}
 */
export function awaitingCard({ title, why, needs = [], wide = false }) {
  const card = document.createElement('article');
  card.className = `glass card card--awaiting${wide ? ' card--wide' : ''}`;

  const needsHtml = needs
    .map((need) => {
      const link =
        need.sheetUrl && need.gid
          ? `${need.sheetUrl}?gid=${need.gid}#gid=${need.gid}`
          : need.sheetUrl || null;
      const label = link
        ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(need.sheet)} ↗</a>`
        : esc(need.sheet);
      const cols = need.columns.map((c) => `<code>${esc(c)}</code>`).join(' · ');
      return `<li><span class="awaiting__sheet">${label}</span><span class="awaiting__cols">${cols}</span></li>`;
    })
    .join('');

  card.innerHTML = `
    <div class="card__head">
      <span class="card__icon card__icon--muted" aria-hidden="true">⏳</span>
      <span class="card__titles">
        <span class="card__title">${esc(title)}</span>
        <span class="card__sub">${esc(t('awaiting.badge'))}</span>
      </span>
    </div>
    <div class="card__metric">
      <span class="card__metric-value num card__metric-value--muted">—</span>
    </div>
    <div class="awaiting__body">
      ${why ? `<p class="awaiting__why">${esc(why)}</p>` : ''}
      <p class="awaiting__need-label">${esc(t('awaiting.needs'))}</p>
      <ul class="awaiting__needs">${needsHtml}</ul>
    </div>`;

  return card;
}

/**
 * แถบเล็ก ๆ กำกับค่าที่เป็นการประมาณ ไม่ใช่ค่าที่วัดได้จริง
 * ต้องอยู่ติดกับตัวเลขเสมอ ไม่ใช่ไปอยู่ในคำอธิบายท้ายหน้า
 */
export function estimateChip(note) {
  const span = document.createElement('span');
  span.className = 'quality-chip';
  span.dataset.level = 'warn';
  span.textContent = `≈ ${t('awaiting.estimated')}`;
  if (note) span.title = note;
  return span;
}
