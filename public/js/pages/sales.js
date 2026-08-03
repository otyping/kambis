/**
 * pages/sales.js — 4. การขาย
 *
 * เอกสารขอไว้สองกราฟ:
 *   (a) ยอดขายตามเวลา — มูลค่า (฿) และกรัมที่ขาย
 *   (b) ราคาขายเฉลี่ยต่อกรัม (ASP) แยกตามขนาด/สายพันธุ์
 *
 * ตรวจชีตขายดอกครบทั้ง 5 แท็บแล้ว **ไม่มีคอลัมน์ราคาหรือมูลค่าเลย**
 * มีเพียง วันที่ · ลูกค้า · ครอป · สายพันธุ์ · น้ำหนักรายขนาด · ผลรวม
 *
 * จึงทำได้เฉพาะฝั่ง "กรัมที่ขาย" ส่วนมูลค่ากับ ASP ขึ้นการ์ดรอข้อมูล
 * ห้ามประมาณราคาจากตัวเลขอื่นมาแทน เพราะจะกลายเป็นตัวเลขที่ดูน่าเชื่อแต่ไม่จริง
 */
import { t, pick } from '../i18n.js';
import * as charts from '../charts/index.js';
import { renderCards } from '../ui/cards.js';
import { awaitingCard } from '../ui/placeholder.js';
import { pageHeader, panel, well, grid, emptyNote } from './shared.js';
import { stackBy, groupSum, comparePeriod } from '../shared/agg-core.js';

export const meta = { report: 'dryflower', page: 'sales' };

export function render(ctx) {
  const { host, payload, sources, onOpen, drawLater, strainScale } = ctx;

  pageHeader(host, { title: t('page.sales.title'), sub: t('page.sales.sub') });

  const sales = sources.sales?.rows ?? [];
  const salesSheet = payload.meta.sources.find((s) => s.key === 'sales') ?? {};

  // ── (a) กรัมที่ขายรายเดือน แยกสายพันธุ์ ──
  {
    const body = panel(host, t('sales.overTime'), t('sales.overTimeNote'), { wide: true });
    if (!sales.length) {
      emptyNote(body);
    } else {
      const rows = stackBy(
        sales,
        (r) => (r.date ? r.date.slice(0, 7) : null),
        (r) => strainScale.map(r.strain)
      ).sort((a, b) => comparePeriod(a.key, b.key));

      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.stackedBars(box, rows, {
            keys: strainScale.keys,
            height: 250,
            labelFormat: 'month',
          }),
      });
    }
  }

  const g = grid(host, { cols: 2 });

  // ── ยอดขายแยกตามลูกค้า (กรัม) ──
  {
    const body = panel(g, t('sales.byCustomer'));
    const rows = groupSum(sales, (r) => r.customer).sort((a, b) => b.flower - a.flower);
    if (!rows.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({ node: box, run: () => charts.barH(box, rows, { max: 10 }) });
    }
  }

  // ── ยอดขายแยกตามสายพันธุ์ (กรัม) ──
  {
    const body = panel(g, t('sales.byStrain'));
    const rows = groupSum(sales, (r) => r.strain).sort((a, b) => b.flower - a.flower);
    if (!rows.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({ node: box, run: () => charts.barH(box, rows, { max: 10 }) });
    }
  }

  // ── สิ่งที่ทำไม่ได้เพราะชีตไม่มีคอลัมน์ราคา ──
  const gaps = grid(host, { cols: 2 });
  const sheetNeed = {
    sheet: pick(salesSheet, 'title') || 'แบบฟอร์มขายดอก',
    sheetUrl: salesSheet.sheetUrl,
    columns: [t('awaiting.col.pricePerGram'), t('awaiting.col.lineAmount')],
  };

  gaps.appendChild(
    awaitingCard({
      title: t('awaiting.salesValue.title'),
      why: t('awaiting.salesValue.why'),
      needs: [sheetNeed],
    })
  );
  gaps.appendChild(
    awaitingCard({
      title: t('awaiting.asp.title'),
      why: t('awaiting.asp.why'),
      needs: [
        {
          ...sheetNeed,
          columns: [t('awaiting.col.pricePerGram'), t('awaiting.col.pricePerSize')],
        },
      ],
    })
  );

  const cardHost = document.createElement('div');
  cardHost.className = 'card-grid';
  host.appendChild(cardHost);
  renderCards(cardHost, { ...payload, sources }, onOpen, { only: ['sales'], defer: drawLater });
}
