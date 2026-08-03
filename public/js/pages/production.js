/**
 * pages/production.js — 2. การผลิต
 *
 * ตามเอกสาร:
 *   (a) ผลผลิตรวมตามเวลา — แท่งซ้อน แยกสีตามสายพันธุ์ กำกับด้วยครอป
 *   (b) สัดส่วนขนาดดอกต่อครอป — แท่งซ้อน 100%
 *   (c) ตารางเปรียบเทียบรายครอป
 *
 * เรื่องที่ต้องระวัง: SUMMARY SHEET ของรายงานต่อครอปไม่มีคอลัมน์สายพันธุ์
 * จึงต้อง join กับรายงานทริมรายวัน ครอปที่ยังไม่มีในรายงานรายวันจะขึ้น "—"
 * ไม่ใช่เดาว่าเป็นสายพันธุ์อะไร
 */
import { t } from '../i18n.js';
import { n, pct, esc, DASH } from '../format.js';
import * as charts from '../charts/index.js';
import { renderCards } from '../ui/cards.js';
import { sortableTable } from '../ui/table.js';
import { pageHeader, panel, well, grid, emptyNote } from './shared.js';
import { stackBy, topCategories, sum, comparePeriod, SIZE_KEYS } from '../shared/agg-core.js';

export const meta = { report: 'dryflower', page: 'production' };

/** จำนวนสีในชุด categorical — เกินจากนี้ยุบเป็น "อื่น ๆ" */
const MAX_STRAIN_COLORS = 8;

export function render(ctx) {
  const { host, payload, sources, onOpen, drawLater, strainScale } = ctx;

  pageHeader(host, { title: t('page.production.title'), sub: t('page.production.sub') });

  const daily = sources.dailyTrim?.rows ?? [];
  const perCrop = sources.perCrop?.rows ?? [];
  const harvested = perCrop.filter((r) => r.hasYield);

  const g1 = grid(host, { cols: 1 });

  // ── (a) ผลผลิตตามเวลา แยกสายพันธุ์ ──
  {
    const body = panel(g1, t('prod.overTime'), t('prod.overTimeNote'));
    if (!daily.length) {
      emptyNote(body);
    } else {
      // ครอปที่เด่นที่สุดของแต่ละเดือน เอาไปเป็นป้ายบรรทัดที่สองใต้เดือน
      const cropOfMonth = new Map();
      for (const r of daily) {
        if (!r.date || !r.crop) continue;
        const m = r.date.slice(0, 7);
        const byCrop = cropOfMonth.get(m) ?? new Map();
        byCrop.set(r.crop, (byCrop.get(r.crop) ?? 0) + (r.flowerTotal || 0));
        cropOfMonth.set(m, byCrop);
      }

      const rows = stackBy(
        daily,
        (r) => (r.date ? r.date.slice(0, 7) : null),
        (r) => strainScale.map(r.strain)
      )
        .map((row) => {
          const byCrop = cropOfMonth.get(row.key);
          const topCrop = byCrop
            ? [...byCrop.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
            : null;
          return { ...row, sub: topCrop ?? '' };
        })
        .sort((a, b) => comparePeriod(a.key, b.key));

      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.stackedBars(box, rows, {
            keys: strainScale.keys,
            height: 260,
            labelFormat: 'month',
          }),
      });
    }
  }

  // ── (b) สัดส่วนขนาดดอกต่อครอป ──
  {
    const body = panel(g1, t('prod.sizeTrend'), t('prod.sizeTrendNote'));
    const rows = harvested
      .filter((r) => (r.flowerTotal || 0) > 0)
      .map((r) => ({
        key: r.crop ?? DASH,
        sub: r.quarter ?? '',
        parts: Object.fromEntries(SIZE_KEYS.map((k) => [k, r.sizes?.[k] ?? 0])),
        // เรียงตามเวลาเก็บเกี่ยว ไม่ใช่ตามตัวอักษรของรหัสครอป
        _order: r.cycle?.harvest ?? r.quarter ?? '',
      }))
      .sort((a, b) => comparePeriod(a._order, b._order) || String(a.key).localeCompare(String(b.key)));

    if (!rows.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.pctStackedBars(box, rows, {
            keys: SIZE_KEYS,
            // ขนาดดอกเป็นข้อมูลที่มีลำดับ จึงใช้ไล่เฉดสีเดียว ไม่ใช่สีแยกหมวด
            ramp: 'size',
            height: 260,
            max: 40,
          }),
      });
    }
  }

  // ── (c) ตารางเปรียบเทียบรายครอป ──
  {
    const body = panel(host, t('prod.cropTable'), t('prod.cropTableNote'), { wide: true });

    /* สายพันธุ์ต่อครอป — SUMMARY SHEET ไม่มีคอลัมน์นี้ ต้อง join จากรายงานทริมรายวัน
     *
     * สองรายงานนับ "ครอป" คนละหยาบละเอียด:
     *   รายงานต่อครอป  รวมสองห้องเป็นรหัสเดียว  →  G1/1&G1/3-17NOV25
     *   รายงานทริมรายวัน แยกทีละห้อง            →  G1/1-17NOV25 · G1/3-17NOV25
     * เทียบสตริงตรง ๆ จึงไม่มีวันตรงกันเลย ต้องแตกรหัสรวมออกเป็นห้องย่อยก่อน
     */
    const strainsByCrop = new Map();
    for (const r of daily) {
      if (!r.crop || !r.strain) continue;
      const m = strainsByCrop.get(r.crop) ?? new Map();
      m.set(r.strain, (m.get(r.strain) ?? 0) + (r.flowerTotal || 0));
      strainsByCrop.set(r.crop, m);
    }

    /** แตก "G1/1&G1/3-17NOV25" เป็น ["G1/1-17NOV25", "G1/3-17NOV25"] */
    const expandCrop = (crop) => {
      const code = String(crop ?? '');
      if (!code.includes('&')) return [code];
      const dash = code.lastIndexOf('-');
      if (dash < 0) return code.split('&');
      const units = code.slice(0, dash).split('&');
      const suffix = code.slice(dash); // รวมขีดหน้าไว้ด้วย
      return units.map((u) => u + suffix);
    };

    const strainLabel = (crop) => {
      const totals = new Map();
      for (const key of expandCrop(crop)) {
        const m = strainsByCrop.get(key);
        if (!m) continue;
        for (const [strain, weight] of m) totals.set(strain, (totals.get(strain) ?? 0) + weight);
      }
      if (!totals.size) return null;
      return [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([s]) => s)
        .join(', ');
    };

    const rows = harvested.map((r) => {
      const total = r.flowerTotal || 0;
      const big = sum(['XXL', 'XL', 'L', 'M'].map((k) => r.sizes?.[k]));
      const small = sum(['S', 'XS'].map((k) => r.sizes?.[k]));
      return {
        crop: r.crop,
        quarter: r.quarter,
        strain: strainLabel(r.crop),
        flower: total,
        plants: r.plants,
        gPerPlant: r.gramsPerPlant,
        bigPct: total > 0 ? (big / total) * 100 : null,
        smallPct: total > 0 ? (small / total) * 100 : null,
      };
    });

    if (!rows.length) {
      emptyNote(body);
    } else {
      const numCell = (v, d = 0) =>
        v === null || v === undefined ? `<span class="muted">${DASH}</span>` : n(v, d);
      const table = sortableTable(
        [
          { label: t('label.crop'), get: (r) => r.crop ?? '' },
          { label: t('label.quarter'), get: (r) => r.quarter ?? '' },
          {
            label: t('label.strain'),
            get: (r) => r.strain ?? '',
            // ครอปที่ยังไม่มีในรายงานรายวัน = ไม่รู้สายพันธุ์ ไม่ใช่ไม่มีสายพันธุ์
            render: (r) =>
              r.strain ? esc(r.strain) : `<span class="muted" title="${esc(t('prod.strainUnknown'))}">${DASH}</span>`,
          },
          { label: t('label.flower'), align: 'n', get: (r) => r.flower, render: (r) => `<b>${n(r.flower)}</b>` },
          { label: t('label.plants'), align: 'n', get: (r) => r.plants, render: (r) => numCell(r.plants) },
          { label: t('label.gPerPlant'), align: 'n', get: (r) => r.gPerPlant, render: (r) => numCell(r.gPerPlant, 2) },
          {
            label: t('prod.bigBuds'),
            align: 'n',
            get: (r) => r.bigPct,
            render: (r) => (r.bigPct === null ? `<span class="muted">${DASH}</span>` : pct(r.bigPct)),
          },
          {
            label: t('prod.smallBuds'),
            align: 'n',
            get: (r) => r.smallPct,
            render: (r) => (r.smallPct === null ? `<span class="muted">${DASH}</span>` : pct(r.smallPct)),
          },
        ],
        rows,
        { sortIndex: 3, sortDir: 'desc' }
      );
      body.appendChild(table);
    }
  }

  // การ์ดเดิมของสองรายงานที่เกี่ยวข้อง — ยังเป็นทางเข้าไปดูข้อมูลดิบ
  const cardHost = document.createElement('div');
  cardHost.className = 'card-grid';
  host.appendChild(cardHost);
  renderCards(cardHost, { ...payload, sources }, onOpen, { only: ['dailyTrim', 'perCrop'], defer: drawLater });
}

/** สร้างตัวจับสายพันธุ์→สีครั้งเดียวจากข้อมูลทั้งชุด (ห้ามสร้างใหม่จากข้อมูลที่กรองแล้ว) */
export function buildStrainScale(allSources) {
  const rows = [
    ...(allSources.dailyTrim?.rows ?? []),
    ...(allSources.outbound?.rows ?? []),
    ...(allSources.sales?.rows ?? []),
  ];
  return topCategories(rows, (r) => r.strain, MAX_STRAIN_COLORS, t('label.other'));
}
