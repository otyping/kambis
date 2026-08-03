/**
 * ui/cards.js — KPI strip และการ์ดรายงาน 8 ใบ
 *
 * แต่ละการ์ด = ตัวเลขพาดหัว + กราฟย่อ + chip คุณภาพข้อมูล + กดเพื่อดูรายละเอียด
 * ทุกการ์ดเป็น <button> จริง เพื่อให้ใช้คีย์บอร์ดและ screen reader ได้
 */
import { t, pick } from '../i18n.js';
import { weight, grams, n, pct, esc, DASH } from '../format.js';
import { icon } from './icons.js';
import * as charts from '../charts/index.js';
import { releaseCharts } from '../charts/core.js';
import { breakdownControls } from './controls.js';
import { dataGaps, gapList } from './gaps.js';

/** ระดับคุณภาพจากจำนวน finding */
export function qualityLevel(counts) {
  if (!counts) return 'good';
  if (counts.critical > 0) return 'bad';
  if (counts.warning > 0) return 'warn';
  return 'good';
}

function qualityChip(counts) {
  const level = qualityLevel(counts);
  if (!counts || counts.critical + counts.warning + counts.info === 0) {
    return `<span class="quality-chip" data-level="good">✓ ${t('quality.clean')}</span>`;
  }
  const parts = [];
  if (counts.critical) parts.push(`${counts.critical} ${t('quality.critical')}`);
  if (counts.warning) parts.push(`${counts.warning} ${t('quality.warning')}`);
  if (!parts.length && counts.info) parts.push(`${counts.info} ${t('quality.info')}`);
  const glyph = level === 'bad' ? '✕' : level === 'warn' ? '⚠' : 'ⓘ';
  return `<span class="quality-chip" data-level="${level}">${glyph} ${parts.join(' · ')}</span>`;
}

/** ─── KPI strip ─── */
export function renderKpiStrip(el, kpi) {
  el.innerHTML = kpi.headline
    .map((item) => {
      const isPct = item.unit === '%';
      const isCount = item.unit === '';
      let value = DASH;
      let unit = '';
      if (item.value !== null && Number.isFinite(item.value)) {
        if (isPct) {
          value = n(item.value, 1);
          unit = '%';
        } else if (isCount) {
          value = n(item.value);
        } else {
          const g = grams(item.value);
          value = g.value;
          unit = g.unit;
        }
      }
      const hint = pick(item, 'hint') || item.hint || '';
      return `<div class="glass kpi">
        <span class="kpi__label">${esc(pick(item, 'label'))}</span>
        <div class="kpi__value num">${value}${unit ? `<span class="kpi__unit">${unit}</span>` : ''}</div>
        <div class="kpi__hint">${esc(hint)}</div>
      </div>`;
    })
    .join('');
}

/** โครงการ์ดหนึ่งใบ */
function cardShell({ key, iconName, title, sub, metric, unit, stats, chip, wide }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `glass glass--interactive card${wide ? ' card--wide' : ''}`;
  btn.dataset.card = key;
  btn.setAttribute('aria-haspopup', 'dialog');

  btn.innerHTML = `
    <div class="card__head">
      <span class="card__icon">${icon(iconName)}</span>
      <span class="card__titles">
        <span class="card__title">${esc(title)}</span>
        <span class="card__sub">${esc(sub)}</span>
      </span>
    </div>
    <div class="card__metric">
      <span class="card__metric-value num">${metric}</span>
      ${unit ? `<span class="card__metric-unit">${unit}</span>` : ''}
    </div>
    <div class="card__body"></div>
    <div class="card__stats">${stats}</div>
    <div class="card__foot">
      ${chip}
      <span class="card__cta">${t('action.detail')} →</span>
    </div>`;
  return btn;
}

const stat = (label, value) => `<span class="card__stat">${esc(label)} <b>${value}</b></span>`;

/**
 * ติดแถบ "มุมมอง / จัดเรียง / กรอง" ให้กราฟบนการ์ด
 *
 * แยกกล่องควบคุมออกจากกล่องกราฟ เพราะตัววาดกราฟล้าง innerHTML ของกล่องตัวเองทุกครั้ง
 * ถ้าวางปนกันไว้ ตัวเลือกจะหายไปตั้งแต่วาดรอบแรก
 *
 * @param {HTMLElement} body ช่อง .card__body
 * @param {{label:string, rows:Array, render:(box, rows)=>void, sortable?:boolean,
 *          getValue?:(row)=>number, well?:boolean}[]} views
 */
function attachBreakdown(body, views, deferred) {
  const box = document.createElement('div');

  const bar = breakdownControls({
    views,
    compact: true,
    onChange: ({ view, rows }) => {
      box.className = view.well ? 'chart-well' : '';
      view.render(box, rows);
      // มุมมองที่ไม่ใช่การจัดอันดับ (เช่นเส้นแนวโน้ม) เรียงเองตามเวลาอยู่แล้ว
      const selects = bar.querySelectorAll('.ctl-select');
      selects[1].hidden = view.sortable === false;
      selects[2].hidden = view.sortable === false;
    },
  });

  body.append(bar, box);

  /* ห้ามวาดตอนนี้ — การ์ดยังไม่ได้ถูกใส่ลงหน้า จึงวัดความกว้างไม่ได้
   * ถ้าวาดเลย canvas จะได้ขนาด default แล้วโดน CSS ยืด/บีบทีหลังจนภาพเพี้ยน
   * ผู้เรียกจะสั่งวาดให้หลัง appendChild แล้ว
   *
   * ผูก node ไว้ด้วย เพื่อให้ข้ามการ์ดที่ไม่ได้ถูกใส่ลงหน้าในรอบนี้ได้
   * (หน้าแต่ละหน้าหยิบการ์ดไปแค่บางใบ) — ไม่งั้นจะเสียเวลาวาดของที่ไม่มีใครเห็น */
  deferred.push({ node: body, run: () => bar.__emit() });
}

/** สั่งวาดกราฟที่เลื่อนไว้ เฉพาะอันที่อยู่ในหน้าจริงแล้ว */
export function runDeferred(deferred) {
  for (const item of deferred) {
    if (typeof item === 'function') {
      item();
    } else if (item.node.isConnected) {
      item.run();
    }
  }
}

/**
 * ─── การ์ดทั้ง 8 ใบ ───
 *
 * @param {HTMLElement} el
 * @param {object} payload
 * @param {(key:string, trigger:HTMLElement)=>void} onOpen
 * @param {{only?: string[], defer?: Array}} [opts]
 *   only  — เลือกเฉพาะการ์ดที่ต้องการ ตามลำดับที่ระบุ
 *           หน้าแต่ละหน้าหยิบการ์ดไปคนละชุด แต่ยังใช้โค้ดสร้างชุดเดียวกัน
 *           เพื่อไม่ให้ตัวเลขบนการ์ดเดียวกันเพี้ยนไปคนละแบบในแต่ละหน้า
 *   defer — ส่ง array ของหน้ามาให้ แล้วงานวาดกราฟจะถูกฝากไว้ในนั้นแทนที่จะวาดทันที
 *           **จำเป็นเมื่อเรียกจากหน้าที่ยังไม่ถูกใส่ลง DOM** เพราะกล่องยังกว้าง 0
 *           setupCanvas จะคืน null แล้วกราฟหายเงียบ ๆ (เคยพังมาแล้ว)
 */
export function renderCards(el, payload, onOpen, opts = {}) {
  const { kpi, analysis, meta } = payload;
  const bySource = analysis.bySource ?? {};
  const metaOf = (key) => meta.sources.find((s) => s.key === key) ?? {};
  const titleOf = (key) => pick(metaOf(key), 'title') || key;

  // สลับธีม/ภาษาจะวาดการ์ดใหม่ทั้งหมด — ปล่อยกราฟชุดเดิมก่อนเสมอ
  releaseCharts(el);
  el.innerHTML = '';
  const cards = [];

  // กราฟทุกอันวาดหลังการ์ดเข้า DOM แล้วเท่านั้น ไม่งั้นวัดความกว้างไม่ได้
  const drawLater = [];

  // 1) ภาพรวมผู้บริหาร
  {
    const g = grams(kpi.perCrop.totalFlower);
    const card = cardShell({
      key: 'overview',
      iconName: 'overview',
      title: t('card.overview.title'),
      sub: t('card.overview.sub'),
      metric: g.value,
      unit: g.unit,
      wide: true,
      stats: [
        stat(t('label.harvested'), n(kpi.perCrop.harvestedCount)),
        stat(t('label.inProgress'), n(kpi.perCrop.plannedCount)),
        stat(t('label.plants'), n(kpi.perCrop.totalPlants)),
        stat(t('label.gPerPlant'), n(kpi.perCrop.gPerPlant, 1)),
      ].join(''),
      chip: qualityChip(analysis.counts),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: t('label.sizeMix'),
        rows: [],
        sortable: false,
        well: true,
        render: (box) => charts.sizeMixBar(box, kpi.perCrop.sizeMix, { height: 96 }),
      },
      {
        label: t('label.byQuarter'),
        rows: kpi.perCrop.byQuarter.map((q) => ({ key: q.key, flower: q.flower })),
        render: (box, rows) => charts.barH(box, rows, { max: 6 }),
      },
      {
        label: t('label.byLocation'),
        rows: kpi.inventory.byLocation,
        render: (box, rows) => charts.barH(box, rows, { max: 6 }),
      },
    ], drawLater);
    cards.push(card);
  }

  // 2) ผลผลิตรายวัน
  {
    const g = grams(kpi.dailyTrim.totalFlower);
    const card = cardShell({
      key: 'dailyTrim',
      iconName: 'daily',
      title: titleOf('dailyTrim'),
      sub: t('card.dailyTrim.sub'),
      metric: g.value,
      unit: g.unit,
      stats: [
        stat(t('label.days'), n(kpi.dailyTrim.dayCount)),
        stat(t('label.crops'), n(kpi.dailyTrim.byCrop.length)),
        stat(t('label.nonFlower'), weight(kpi.dailyTrim.totalNonFlower)),
      ].join(''),
      chip: qualityChip(bySource.dailyTrim),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: t('label.trend'),
        rows: [],
        sortable: false,
        render: (box) =>
          charts.sparkline(
            box,
            kpi.dailyTrim.series.map((d) => ({ value: d.flower })),
            { height: 46 }
          ),
      },
      {
        label: t('label.byCrop'),
        rows: kpi.dailyTrim.byCrop,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
      {
        label: t('label.byStrain'),
        rows: kpi.dailyTrim.byStrain,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
    ], drawLater);
    cards.push(card);
  }

  // 3) ผลผลิตต่อครอป
  {
    const card = cardShell({
      key: 'perCrop',
      iconName: 'crop',
      title: titleOf('perCrop'),
      sub: t('card.perCrop.sub'),
      metric: n(kpi.perCrop.gPerPlant, 1),
      unit: 'g / ' + t('label.plants'),
      stats: [
        stat(t('label.harvested'), n(kpi.perCrop.harvestedCount)),
        stat(t('label.inProgress'), n(kpi.perCrop.plannedCount)),
        stat(t('label.quarter'), n(kpi.perCrop.byQuarter.length)),
      ].join(''),
      chip: qualityChip(bySource.perCrop),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: `${t('label.byQuarter')} · ${t('label.gPerPlant')}`,
        rows: kpi.perCrop.byQuarter.map((q) => ({ key: q.key, flower: q.gPerPlant })),
        render: (box, rows) => charts.barH(box, rows, { max: 6, unit: 'g' }),
      },
      {
        label: `${t('label.byQuarter')} · ${t('label.flower')}`,
        rows: kpi.perCrop.byQuarter.map((q) => ({ key: q.key, flower: q.flower })),
        render: (box, rows) => charts.barH(box, rows, { max: 6 }),
      },
      {
        label: `${t('label.topCrops')} · ${t('label.gPerPlant')}`,
        rows: kpi.perCrop.topCrops.map((c) => ({ key: c.crop, flower: c.gPerPlant })),
        render: (box, rows) => charts.barH(box, rows, { max: 6, unit: 'g' }),
      },
    ], drawLater);
    cards.push(card);
  }

  // 4) ขนย้ายออกจากฟาร์ม
  {
    const g = grams(kpi.outbound.totalFlower);
    const card = cardShell({
      key: 'outbound',
      iconName: 'truck',
      title: titleOf('outbound'),
      sub: t('card.outbound.sub'),
      metric: g.value,
      unit: g.unit,
      stats: [
        stat(t('label.shipments'), n(kpi.outbound.shipmentCount)),
        stat(t('label.nonFlower'), weight(kpi.outbound.totalNonFlower)),
      ].join(''),
      chip: qualityChip(bySource.outbound),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: t('label.byStrain'),
        rows: kpi.outbound.byStrain,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
      {
        label: t('label.byCrop'),
        rows: kpi.outbound.byCrop,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
      {
        label: t('label.trend'),
        rows: [],
        sortable: false,
        render: (box) =>
          charts.sparkline(
            box,
            kpi.outbound.series.map((d) => ({ value: d.flower })),
            { height: 46 }
          ),
      },
    ], drawLater);
    cards.push(card);
  }

  // 5) รับดอกเข้ากรุงเทพ
  {
    const g = grams(kpi.inbound.totalFlower);
    const matched = kpi.inbound.reconciliation.filter((r) => r.matched).length;
    const comparable = kpi.inbound.reconciliation.filter((r) => r.diff !== null).length;
    const card = cardShell({
      key: 'inbound',
      iconName: 'inbox',
      title: titleOf('inbound'),
      sub: t('card.inbound.sub'),
      metric: g.value,
      unit: g.unit,
      stats: [
        stat(t('label.receipts'), n(kpi.inbound.receiptCount)),
        stat(t('label.matched'), `${matched}/${comparable}`),
      ].join(''),
      chip: qualityChip(bySource.inbound),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: t('label.reconciliation'),
        rows: [],
        sortable: false,
        well: true,
        render: (box) =>
          charts.groupedBars(box, kpi.inbound.reconciliation, { height: 150, max: 10 }),
      },
      {
        label: t('label.byStrain'),
        rows: kpi.inbound.byStrain,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
      {
        label: t('label.trend'),
        rows: [],
        sortable: false,
        render: (box) =>
          charts.sparkline(
            box,
            kpi.inbound.series.map((d) => ({ value: d.flower })),
            { height: 46 }
          ),
      },
    ], drawLater);
    cards.push(card);
  }

  // 6) การขาย
  {
    const g = grams(kpi.sales.totalFlower);
    const card = cardShell({
      key: 'sales',
      iconName: 'sales',
      title: titleOf('sales'),
      sub: t('card.sales.sub'),
      metric: g.value,
      unit: g.unit,
      stats: [
        stat(t('label.customers'), n(kpi.sales.customerCount)),
        stat(t('label.orders'), n(kpi.sales.orderCount)),
      ].join(''),
      chip: qualityChip(bySource.sales),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: t('label.byCustomer'),
        rows: kpi.sales.byCustomer,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
      {
        label: t('label.byStrain'),
        rows: kpi.sales.byStrain,
        render: (box, rows) => charts.barH(box, rows, { max: 5 }),
      },
      {
        label: t('label.monthly'),
        rows: kpi.sales.byMonth.map((m) => ({ key: m.month, flower: m.flower })),
        render: (box, rows) => charts.barH(box, rows, { max: 8 }),
      },
    ], drawLater);
    cards.push(card);
  }

  // 7) สินค้าคงเหลือ
  {
    const g = grams(kpi.inventory.totalFlower);
    const card = cardShell({
      key: 'inventory',
      iconName: 'stock',
      title: titleOf('inventory'),
      sub: t('card.inventory.sub'),
      metric: g.value,
      unit: g.unit,
      stats: [
        stat(t('label.nonFlower'), weight(kpi.inventory.totalNonFlower)),
        stat(t('label.updatedAt'), esc(kpi.inventory.updatedAt.join(' · ') || DASH)),
      ].join(''),
      chip: qualityChip(bySource.inventory),
    });
    attachBreakdown(card.querySelector('.card__body'), [
      {
        label: t('label.byLocation'),
        rows: kpi.inventory.byLocation,
        render: (box, rows) => charts.barH(box, rows, { max: 4 }),
      },
      {
        label: t('label.byStrain'),
        rows: kpi.inventory.byStrain,
        render: (box, rows) => charts.barH(box, rows, { max: 6 }),
      },
      {
        label: t('label.sizeMix'),
        rows: [],
        sortable: false,
        well: true,
        render: (box) => charts.sizeMixBar(box, kpi.inventory.sizeMix, { height: 96 }),
      },
    ], drawLater);
    cards.push(card);
  }

  /* การ์ด "คุณภาพข้อมูล" ไม่ได้อยู่ในชุดนี้ — หน้าเป็นคนวางเองด้วย qualityCard()
   * เพราะผู้ใช้กำหนดว่ามันต้องเป็นการ์ด **ใบสุดท้ายของหน้า** ซึ่งอยู่หลังการ์ด
   * "รอข้อมูล" ที่หน้าเป็นคนสร้าง การ์ดชุดนี้จึงเรียงให้ไม่ได้ */

  // เลือกเฉพาะการ์ดที่หน้านี้ต้องการ และเรียงตามลำดับที่ระบุ
  const wanted = opts.only
    ? opts.only.map((key) => cards.find((c) => c.dataset.card === key)).filter(Boolean)
    : cards;

  for (const card of wanted) {
    card.addEventListener('click', () => onOpen(card.dataset.card, card));
    el.appendChild(card);
  }

  /* ถ้าผู้เรียกส่ง defer มา แปลว่ากล่องนี้ยังไม่อยู่ในหน้า — ฝากงานวาดไว้ให้เขาสั่งเอง
   * หลังจากใส่ลง DOM แล้ว ไม่งั้น canvas จะกว้าง 0 แล้วกราฟหายทั้งหมด */
  if (opts.defer) {
    opts.defer.push(...drawLater);
    return;
  }

  // ตอนนี้การ์ดอยู่ในหน้าแล้ว วัดความกว้างได้จริง จึงค่อยวาดกราฟ
  runDeferred(drawLater);
}

/**
 * ─── การ์ดคุณภาพข้อมูล ───
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเองเพราะใช้สองที่ที่มี payload คนละก้อน:
 * รายงาน Dryflower ใช้ผลวิเคราะห์จาก /api/reports ส่วนรายงาน Supply โหลดแยก (lazy)
 * จึงมี meta/analysis เป็นของตัวเอง — เอาก้อนของ Dryflower ไปแสดงบนหน้า Supply ไม่ได้
 *
 * นอกจาก finding แล้ว การ์ดนี้ยังต้องบอก **สิ่งที่ชีตยังไม่มี** ด้วย
 * เพราะ "ตัวเลขถูกต้องแต่ไม่ครบ" กับ "ตัวเลขผิด" เป็นคนละเรื่อง และผู้ใช้ต้องรู้ทั้งคู่
 *
 * @param {{analysis:object, meta:object, kpi?:object, report?:string}} payload
 * @param {Array} drawLater งานวาดที่ต้องรอให้การ์ดเข้า DOM ก่อน
 * @param {{wide?:boolean}} [opts]
 */
export function qualityCard(payload, drawLater, opts = {}) {
  const { analysis, meta } = payload;
  const report = payload.report ?? 'dryflower';
  const c = analysis.counts;
  const titleOf = (key) => pick(meta.sources.find((s) => s.key === key) ?? {}, 'title') || key;

  const gaps = dataGaps(report, payload);

  const card = cardShell({
    key: 'quality',
    iconName: 'quality',
    title: t('quality.title'),
    sub: t('quality.desc'),
    metric: String(analysis.score),
    unit: '/ 100',
    wide: opts.wide ?? false,
    stats: [
      stat(t('quality.critical'), n(c.critical)),
      stat(t('quality.warning'), n(c.warning)),
      stat(t('quality.info'), n(c.info)),
      stat(t('quality.gaps'), n(gaps.length)),
      stat(t('quality.checked'), `${n(analysis.rowsChecked)} ${t('meta.rows')}`),
    ].join(''),
    chip: qualityChip(c),
  });

  // จำนวน finding แยกตามรายงาน — เอาไว้ให้เลือกดูว่าปัญหากระจุกอยู่ที่ชีตไหน
  const bySourceRows = Object.entries(analysis.bySource ?? {})
    .map(([key, counts]) => ({ key: titleOf(key), flower: counts.total }))
    .filter((r) => r.flower > 0);

  const views = [
    {
      label: t('quality.bySeverity'),
      rows: [],
      sortable: false,
      render: (box) => {
        const total = Math.max(1, c.critical + c.warning + c.info);
        box.innerHTML = `<div class="mini-bars">${['critical', 'warning', 'info']
          .map((sev) => {
            const color =
              sev === 'critical'
                ? 'var(--sev-critical)'
                : sev === 'warning'
                  ? 'var(--sev-warning)'
                  : 'var(--sev-info)';
            return `<div class="mini-bar">
                <span class="mini-bar__label">${t(`quality.${sev}`)}</span>
                <span class="mini-bar__track"><span class="mini-bar__fill" style="width:${
                  (c[sev] / total) * 100
                }%;background:${color}"></span></span>
                <span class="mini-bar__value num">${n(c[sev])}</span>
              </div>`;
          })
          .join('')}</div>`;
      },
    },
    {
      label: t('quality.gaps'),
      rows: [],
      sortable: false,
      render: (box) => {
        box.innerHTML = '';
        gapList(box, gaps, { compact: true });
      },
    },
  ];

  // รายงาน Supply มีชีตเดียว กราฟ "แยกตามรายงาน" จึงเป็นแท่งเดียวโดด ๆ ที่ไม่บอกอะไร
  if (bySourceRows.length > 1) {
    views.push({
      label: t('quality.bySource'),
      rows: bySourceRows,
      render: (box, rows) => charts.barH(box, rows, { max: 6, unit: '' }),
    });
  }

  attachBreakdown(card.querySelector('.card__body'), views, drawLater);
  return card;
}
