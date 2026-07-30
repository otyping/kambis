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

/** ─── การ์ดทั้ง 8 ใบ ─── */
export function renderCards(el, payload, onOpen) {
  const { kpi, analysis, meta } = payload;
  const bySource = analysis.bySource ?? {};
  const metaOf = (key) => meta.sources.find((s) => s.key === key) ?? {};
  const titleOf = (key) => pick(metaOf(key), 'title') || key;

  // สลับธีม/ภาษาจะวาดการ์ดใหม่ทั้งหมด — ปล่อยกราฟชุดเดิมก่อนเสมอ
  releaseCharts(el);
  el.innerHTML = '';
  const cards = [];

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
    const body = card.querySelector('.card__body');
    const wrap = document.createElement('div');
    wrap.className = 'chart-well';
    body.appendChild(wrap);
    charts.sizeMixBar(wrap, kpi.perCrop.sizeMix, { height: 96 });
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
    const body = card.querySelector('.card__body');
    charts.sparkline(
      body,
      kpi.dailyTrim.series.map((d) => ({ value: d.flower })),
      { height: 46 }
    );
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
    const body = card.querySelector('.card__body');
    charts.barH(
      body,
      kpi.perCrop.byQuarter.map((q) => ({ key: q.key, flower: q.gPerPlant })),
      { max: 5, unit: 'g' }
    );
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
    const body = card.querySelector('.card__body');
    charts.barH(body, kpi.outbound.byStrain, { max: 5 });
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
    const body = card.querySelector('.card__body');
    const wrap = document.createElement('div');
    wrap.className = 'chart-well';
    body.appendChild(wrap);
    charts.groupedBars(wrap, kpi.inbound.reconciliation, { height: 150, max: 10 });
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
    const body = card.querySelector('.card__body');
    charts.barH(body, kpi.sales.byCustomer, { max: 5 });
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
    const body = card.querySelector('.card__body');
    charts.barH(body, kpi.inventory.byLocation, { max: 4 });
    cards.push(card);
  }

  // 8) คุณภาพข้อมูล
  {
    const c = analysis.counts;
    const card = cardShell({
      key: 'quality',
      iconName: 'quality',
      title: t('quality.title'),
      sub: t('quality.desc'),
      metric: String(analysis.score),
      unit: '/ 100',
      stats: [
        stat(t('quality.critical'), n(c.critical)),
        stat(t('quality.warning'), n(c.warning)),
        stat(t('quality.info'), n(c.info)),
        stat(t('quality.checked'), `${n(analysis.rowsChecked)} ${t('meta.rows')}`),
      ].join(''),
      chip: qualityChip(c),
    });
    const body = card.querySelector('.card__body');
    body.innerHTML = `<div class="mini-bars">${['critical', 'warning', 'info']
      .map((sev) => {
        const total = Math.max(1, c.critical + c.warning + c.info);
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
    cards.push(card);
  }

  for (const card of cards) {
    card.addEventListener('click', () => onOpen(card.dataset.card, card));
    el.appendChild(card);
  }
}
