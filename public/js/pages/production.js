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
import { n, pct, esc, date, DASH } from '../format.js';
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
      /* แท่งหนึ่ง = ยอดรวมทั้งเดือนของทุกครอป ป้ายใต้แกน x จึงเขียนชื่อครอปไม่ได้
       *
       * เดิมเขียนครอปที่ให้ผลผลิตมากที่สุดของเดือนไว้ใต้ชื่อเดือน ซึ่งอ่านแล้วเข้าใจว่า
       * ทั้งแท่งมาจากครอปเดียว ทั้งที่เดือนหนึ่งทริมหลายครอปพร้อมกันได้
       * ครอปย้ายไปอยู่ใน tooltip แทน: สายพันธุ์ที่มาจากครอปเดียวเขียนต่อท้ายบรรทัดเดิม
       * ส่วนสายพันธุ์ที่มาจากหลายครอปแตกเป็นบรรทัดย่อยพร้อมน้ำหนักของแต่ละครอป
       * (`detail` ของ stackedBars) — ตอบได้ทั้ง "เดือนนี้ทริมกี่สายพันธุ์"
       * และ "สายพันธุ์นั้นมาจากครอปไหน ครอปละเท่าไร"
       */
      const cropsOfStrain = new Map(); // 'YYYY-MM' → สายพันธุ์ → ครอป → น้ำหนัก
      for (const r of daily) {
        // ไม่รู้ครอป = ไม่เขียนอะไรกำกับ ห้ามเดาจากครอปที่เหลือของเดือนนั้น
        if (!r.date || !r.crop) continue;
        const m = r.date.slice(0, 7);
        const strain = strainScale.map(r.strain);
        const byStrain = cropsOfStrain.get(m) ?? new Map();
        const byCrop = byStrain.get(strain) ?? new Map();
        byCrop.set(r.crop, (byCrop.get(r.crop) ?? 0) + (r.flowerTotal || 0));
        byStrain.set(strain, byCrop);
        cropsOfStrain.set(m, byStrain);
      }

      const rows = stackBy(
        daily,
        (r) => (r.date ? r.date.slice(0, 7) : null),
        (r) => strainScale.map(r.strain)
      )
        .map((row) => {
          const detail = {};
          for (const [strain, byCrop] of cropsOfStrain.get(row.key) ?? []) {
            const items = [...byCrop.entries()]
              .filter(([, w]) => w > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([label, value]) => ({ label, value }));

            /* แถวที่ไม่มีครอปกำกับต้องโผล่เป็นบรรทัดของตัวเอง ไม่ใช่หายเงียบ ๆ
             * ไม่งั้นยอดของบรรทัดย่อยจะบวกไม่ถึงยอดของสายพันธุ์ แล้วไม่มีอะไรบอกว่าทำไม */
            const known = items.reduce((acc, it) => acc + it.value, 0);
            const rest = (row.parts?.[strain] ?? 0) - known;
            if (rest > 0.5) items.push({ label: t('label.noCrop'), value: rest });

            if (items.length) detail[strain] = items;
          }
          return { ...row, detail };
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
    /* ยุบ 6 ขนาดเหลือ 3 กลุ่ม: ดอกใหญ่ (≥M) · S · XS
     *
     * คำถามที่กราฟนี้ต้องตอบคือ "สัดส่วนดอกใหญ่ขยับไปทางไหน" ซึ่ง 6 เฉดของไล่สีเดียวกัน
     * แยกด้วยตาไม่ออกอยู่แล้วบนแท่งกว้าง 38px — สามกลุ่มสามสีอ่านได้ในแวบเดียว
     * รายละเอียดของกลุ่มดอกใหญ่ไม่ได้หายไป ยังอยู่ครบใน tooltip ผ่าน `detail`
     * (XXL/XL/L/M ทีละขนาด พร้อม % ของตัวเอง) */
    const BIG_SIZES = SIZE_KEYS.filter((k) => k !== 'S' && k !== 'XS');
    const bigLabel = t('prod.bigBuds');
    const sizeGroups = [bigLabel, 'S', 'XS'];

    const rows = harvested
      .filter((r) => (r.flowerTotal || 0) > 0)
      .map((r) => ({
        key: r.crop ?? DASH,
        /* ป้ายบรรทัดที่สองเป็น "วันที่ทริม" ไม่ใช่ไตรมาส เพราะแท่งเรียงตามวันทริม
         * ถ้าเขียนไตรมาสไว้ จะเห็นแค่ Q1'2026 ซ้ำ ๆ หกแท่งแล้วตรวจลำดับด้วยตาไม่ได้เลย
         * ครอปที่ชีตยังไม่กรอกวันเก็บเกี่ยวปล่อยว่าง ไม่เอาไตรมาสมาแทน (คนละหน่วยกัน) */
        sub: r.cycle?.harvest ? date(r.cycle.harvest) : '',
        parts: {
          [bigLabel]: sum(BIG_SIZES.map((k) => r.sizes?.[k])),
          S: r.sizes?.S ?? 0,
          XS: r.sizes?.XS ?? 0,
        },
        // เรียงจากใหญ่ไปเล็กตามลำดับขนาดจริง ไม่ใช่ตามน้ำหนัก — เป็นข้อมูลที่มีลำดับ
        detail: {
          [bigLabel]: BIG_SIZES.map((k) => ({ label: k, value: r.sizes?.[k] ?? 0 })).filter(
            (it) => it.value > 0
          ),
        },
        /* เรียงตามวันทริมจริง ล่าสุดอยู่ขวาสุด — ไม่ใช่ตามตัวอักษรของรหัสครอป
         * (รหัสครอปคือวันปลูก ไม่ใช่วันทริม เรียงตามนั้นจะได้คนละลำดับ)
         * 11 จาก 28 ครอปในชีตยังไม่มีวันเก็บเกี่ยว จึงตกไปใช้ไตรมาสของตัวเองแทน
         * ไม่งั้นจะหลุดไปกองซ้ายสุดทั้งที่รู้คร่าว ๆ ว่าอยู่ช่วงไหน */
        _order: r.cycle?.harvest ?? r.quarter ?? '',
      }))
      .sort((a, b) => comparePeriod(a._order, b._order) || String(a.key).localeCompare(String(b.key)));

    /* แสดง 10 ครอปล่าสุด (stackedBars ตัดด้วย slice(-max) จึงได้ท้ายแถวคือใหม่สุด)
     * มากกว่านี้แท่งจะแคบจนอ่านสัดส่วนไม่ออก และครอปเก่าเกินไปก็ไม่ได้ใช้ตัดสินใจแล้ว
     *
     * **ตัดแล้วต้องบอกว่าตัดไปเท่าไร** ไม่งั้นคนอ่านจะนึกว่านี่คือครอปทั้งหมดที่มี
     * (ครอปที่เหลืออยู่ครบในตารางเปรียบเทียบด้านล่าง ไม่ได้หายไปจากหน้า) */
    const LIMIT = 10;
    const note =
      rows.length > LIMIT
        ? `${t('prod.sizeTrendNote')} · ${t('prod.showingLatest', { n: LIMIT, total: rows.length })}`
        : t('prod.sizeTrendNote');
    const body = panel(g1, t('prod.sizeTrend'), note);

    if (!rows.length) {
      emptyNote(body);
    } else {
      const box = well(body);
      drawLater.push({
        node: box,
        run: () =>
          charts.pctStackedBars(box, rows, {
            keys: sizeGroups,
            // ขนาดดอกเป็นข้อมูลที่มีลำดับ จึงใช้ไล่เฉด ไม่ใช่สีแยกหมวด
            // แต่เป็นไล่เฉดชุด 3 ขั้นที่เว้นช่วงให้แยกกันออกจริง (ดู palette().sizes3)
            ramp: 'size3',
            height: 260,
            max: LIMIT,
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
      const share = (key) => (total > 0 ? ((r.sizes?.[key] ?? 0) / total) * 100 : null);
      return {
        crop: r.crop,
        /* วันทริม = วันเก็บเกี่ยวของครอปนั้นในชีตต่อครอป (คอลัมน์ Harvest)
         * เก็บเป็น ISO ไว้เรียง แล้วค่อยจัดรูปแบบตอนแสดง — ครอปที่ชีตยังไม่กรอกวัน
         * ต้องเป็น null เพื่อให้ตกไปท้ายตารางเสมอ ไม่ใช่เดาจากไตรมาส */
        harvest: r.cycle?.harvest ?? null,
        strain: strainLabel(r.crop),
        flower: total,
        plants: r.plants,
        gPerPlant: r.gramsPerPlant,
        bigPct: total > 0 ? (big / total) * 100 : null,
        sPct: share('S'),
        xsPct: share('XS'),
      };
    });

    if (!rows.length) {
      emptyNote(body);
    } else {
      const numCell = (v, d = 0) =>
        v === null || v === undefined ? `<span class="muted">${DASH}</span>` : n(v, d);
      const pctCell = (v) => (v === null ? `<span class="muted">${DASH}</span>` : pct(v));
      const table = sortableTable(
        [
          { label: t('label.crop'), get: (r) => r.crop ?? '' },
          {
            label: t('prod.trimDate'),
            // ค่าที่ใช้เรียงเป็น ISO — table.js จะจับได้ว่าเป็นคอลัมน์เวลาแล้วเรียงตามเวลาจริง
            get: (r) => r.harvest ?? '',
            render: (r) => (r.harvest ? esc(date(r.harvest)) : `<span class="muted">${DASH}</span>`),
          },
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
          /* สามคอลัมน์นี้ใช้ป้ายชุดเดียวกับ legend ของกราฟด้านบน (ดอกใหญ่ · S · XS)
           * เดิมรวม S กับ XS เป็น "ดอกเล็ก" ก้อนเดียว ซึ่งซ่อนความต่างที่สำคัญ:
           * ครอปที่ S 40% กับครอปที่ XS 40% ขายได้ไม่เท่ากันเลย */
          { label: t('prod.bigBuds'), align: 'n', get: (r) => r.bigPct, render: (r) => pctCell(r.bigPct) },
          { label: 'S', align: 'n', get: (r) => r.sPct, render: (r) => pctCell(r.sPct) },
          { label: 'XS', align: 'n', get: (r) => r.xsPct, render: (r) => pctCell(r.xsPct) },
        ],
        rows,
        // เปิดมาที่ "วันที่ทริมล่าสุดอยู่บนสุด" — ครอปที่เพิ่งทริมคือเรื่องที่กำลังตัดสินใจอยู่
        // ครอปที่ชีตยังไม่กรอกวันจะตกไปท้ายตารางเสมอ (table.js ดันค่าว่างลงล่างทุกทิศ)
        { sortIndex: 1, sortDir: 'desc' }
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
