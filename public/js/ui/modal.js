/**
 * ui/modal.js — หน้าต่างรายละเอียดของแต่ละการ์ด
 *
 * Accessibility: focus trap, Esc ปิด, คืน focus กลับที่การ์ดเดิม, aria-modal
 * บนมือถือกลายเป็น bottom sheet เต็มจอ (จัดการใน responsive.css)
 */
import { t, pick, pickMessage } from '../i18n.js';
import { weight, n, pct, date as fmtDate, dateTime, esc, DASH } from '../format.js';
import * as charts from '../charts/index.js';
import { releaseCharts } from '../charts/core.js';
import { pauseBackground } from '../bg/three-bg.js';
import { sortableTable } from './table.js';
import { breakdownControls } from './controls.js';
import { dataGaps, gapList } from './gaps.js';

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

let backdrop;
let dialog;
let lastFocus = null;

export function initModal() {
  backdrop = document.getElementById('modal-backdrop');
  dialog = document.getElementById('modal');

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener('keydown', (e) => {
    if (!backdrop.classList.contains('is-open')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;

    const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

export function close() {
  pauseBackground(false);
  backdrop.classList.remove('is-open');
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  // ต้องปล่อยกราฟก่อนทิ้ง DOM ไม่งั้น observer กับ bitmap ของ canvas จะค้างในหน่วยความจำ
  releaseCharts(dialog);
  dialog.innerHTML = '';
  if (lastFocus) {
    lastFocus.focus();
    lastFocus = null;
  }
}

function open(title, sub, buildBody, trigger) {
  lastFocus = trigger ?? document.activeElement;
  releaseCharts(dialog);

  dialog.innerHTML = `
    <div class="modal__head">
      <div>
        <h2 class="modal__title" id="modal-title">${esc(title)}</h2>
        <p class="modal__sub">${esc(sub)}</p>
      </div>
      <button type="button" class="modal__close" aria-label="${t('action.close')}">&times;</button>
    </div>
    <div class="modal__body" id="modal-body"></div>`;

  dialog.querySelector('.modal__close').addEventListener('click', close);

  pauseBackground(true); // modal บังฉากหลังจนมิด ไม่ต้องเปลือง CPU วาดต่อ

  /* เปิด modal ให้เห็นก่อน แล้วค่อยสร้างเนื้อหา
   * ตอนที่ยังไม่เปิด กล่องถูกซ่อนอยู่ กว้าง 0 กราฟจึงวัดขนาดตัวเองไม่ได้
   * ถ้าสร้างก่อนเปิด canvas จะได้ขนาดผิดแล้วภาพถูกบีบ */
  backdrop.classList.add('is-open');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  buildBody(dialog.querySelector('#modal-body'));

  backdrop.scrollTop = 0;
  dialog.querySelector('.modal__close').focus();
}

/** บล็อกย่อยในกล่องกระจก */
function panel(parent, title, note) {
  const box = document.createElement('section');
  box.className = 'glass';
  box.style.padding = 'var(--sp-4)';
  box.innerHTML = `<h3 class="panel__title">${esc(title)}${
    note ? ` <span>${esc(note)}</span>` : ''
  }</h3>`;
  const body = document.createElement('div');
  box.appendChild(body);
  parent.appendChild(box);
  return body;
}

/** กล่องพื้นเข้มสำหรับวางกราฟ */
function well(parent) {
  const box = document.createElement('div');
  box.className = 'chart-well';
  parent.appendChild(box);
  return box;
}

/**
 * แผงจัดอันดับที่เรียงและกรองได้
 *
 * ใช้แทนการเรียก charts.barH() ตรง ๆ ทุกจุด เพื่อให้ทุกกราฟในหน้ารายละเอียด
 * มีตัวควบคุมเหมือนกันหมด ไม่ใช่บางอันมีบางอันไม่มี
 *
 * @param {HTMLElement} grid
 * @param {string} title
 * @param {{key:string,flower:number}[]} rows
 * @param {object} [opts] ส่งต่อให้ charts.barH
 */
function rankPanel(grid, title, rows, opts = {}) {
  const host = panel(grid, title);
  const box = document.createElement('div');

  const bar = breakdownControls({
    views: [{ label: title, rows }],
    compact: true,
    onChange: ({ rows: next }) => charts.barH(box, next, opts),
  });

  host.append(bar, box);
  bar.__emit();
  return host;
}

/**
 * รายการ finding
 *
 * ทุกบรรทัดต้องบอกให้ได้ว่า "ปัญหานี้อยู่ในไฟล์ Google Sheet ไหน ชีตย่อยอะไร แถวที่เท่าไร"
 * เพื่อให้เปิดไปแก้ที่ต้นทางได้ทันที — ชื่อไฟล์เป็นลิงก์ไปยังชีตนั้นโดยตรง
 *
 * @param {object} [sourceIndex] แผนที่ key → meta ของแต่ละรายงาน (ชื่อ + URL ของชีต)
 */
function findingsList(parent, findings, sourceIndex) {
  if (!findings.length) {
    parent.innerHTML = `<p class="card__sub">✓ ${t('quality.clean')}</p>`;
    return;
  }

  /**
   * สร้าง URL ที่เปิดตรงไปยัง tab ที่มีปัญหา
   * Google Sheets ต้องใส่ gid ทั้งใน query และ fragment ถึงจะเด้งไป tab นั้นจริง
   */
  const tabUrl = (sheetUrl, gid) => {
    if (!sheetUrl) return null;
    if (gid === null || gid === undefined) return sheetUrl;
    return `${sheetUrl}?gid=${gid}#gid=${gid}`;
  };

  /** ป้ายลิงก์หนึ่งอัน: ชื่อไฟล์ชีต › ชื่อ tab */
  const sheetTag = (sourceKey, tabName, gid) => {
    const src = sourceIndex?.[sourceKey];
    const name = src ? pick(src, 'title') : sourceKey;
    if (!name) return '';
    const label = tabName ? `${name} › ${tabName}` : name;
    const href = tabUrl(src?.sheetUrl, gid);
    if (!href) return `<span class="finding__sheet">📄 ${esc(label)}</span>`;
    return `<a class="finding__sheet" href="${esc(href)}" target="_blank" rel="noopener"
      >📄 ${esc(label)} ↗</a>`;
  };

  const list = document.createElement('div');
  list.className = 'findings';
  list.innerHTML = findings
    .map((f) => {
      const glyph = f.severity === 'critical' ? '✕' : f.severity === 'warning' ? '⚠' : 'ⓘ';

      // ลิงก์หลัก + ลิงก์ของชีตอื่นที่ต้องเปิดดูประกอบ (เช่น เทียบขนออกกับรับเข้า)
      const links = [
        sheetTag(f.source, f.tab, f.gid),
        ...(f.related ?? []).map((r) => sheetTag(r.source, r.tab, r.gid)),
      ].filter(Boolean);

      const meta = [
        f.row !== null && f.row !== undefined ? `${t('label.row')}: ${f.row + 1}` : '',
        f.field ? `${t('label.field')}: ${esc(f.field)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');

      return `<div class="finding" data-sev="${f.severity}">
          <span class="finding__icon" aria-hidden="true">${glyph}</span>
          <div>
            <div class="finding__msg">${esc(pickMessage(f))}</div>
            <div class="finding__meta">${links.join('')}${meta ? `<span>${meta}</span>` : ''}</div>
          </div>
        </div>`;
    })
    .join('');
  parent.appendChild(list);
}

/** สร้างแผนที่ key → meta ของรายงาน ใช้สำหรับแสดงชื่อไฟล์ชีตบน finding */
function buildSourceIndex(meta) {
  const index = {};
  for (const s of meta.sources) index[s.key] = s;
  return index;
}

/** แถวข้อมูลดิบ → คอลัมน์ตารางมาตรฐาน */
const SIZE_KEYS = ['XXL', 'XL', 'L', 'M', 'S', 'XS'];

function baseColumns({ showDate = true, showCrop = true, showStrain = true, extra = [] } = {}) {
  const cols = [];
  if (showDate) {
    // isDate ให้ filteredTable หาคอลัมน์วันที่เจอโดยไม่ต้องเดาจากป้ายที่เปลี่ยนตามภาษา
    cols.push({ label: t('label.date'), isDate: true, get: (r) => r.date, render: (r) => fmtDate(r.date) });
  }
  if (showCrop) cols.push({ label: t('label.crop'), get: (r) => r.crop ?? '' });
  if (showStrain) cols.push({ label: t('label.strain'), get: (r) => r.strain ?? '' });
  cols.push(...extra);
  for (const key of SIZE_KEYS) {
    cols.push({
      label: key,
      align: 'n',
      get: (r) => r.sizes[key],
      render: (r) => (r.sizes[key] === null ? `<span class="muted">${DASH}</span>` : n(r.sizes[key])),
    });
  }
  cols.push({
    label: t('label.flower'),
    align: 'n',
    get: (r) => r.flowerTotal,
    render: (r) => `<b>${n(r.flowerTotal)}</b>`,
  });
  cols.push({
    label: t('label.nonFlower'),
    align: 'n',
    get: (r) => r.nonFlowerTotal,
    render: (r) =>
      r.nonFlowerTotal === null ? `<span class="muted">${DASH}</span>` : n(r.nonFlowerTotal),
  });
  return cols;
}

/**
 * ตัวกรอง + ตาราง (ใช้ร่วมกันทุก modal ที่มีรายการดิบ)
 *
 * กรองได้ 4 ทาง: มิติหลัก (ครอป/ลูกค้า/คลัง) · สายพันธุ์ · ช่วงวันที่ · คำค้น
 * ทุกอันทำงานร่วมกันแบบ AND และเรียงลำดับทำที่หัวตาราง
 */
function filteredTable(parent, rows, columns, { filterKey = 'crop', filterLabel } = {}) {
  const uniq = (key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'th'));

  const bar = document.createElement('div');
  bar.className = 'filter-row';

  const dropdown = (label, values) => {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', label);
    sel.innerHTML =
      `<option value="">${esc(label)}</option>` +
      values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    return sel;
  };

  const primary = dropdown(filterLabel ?? t('label.allCrops'), uniq(filterKey));
  const strain = filterKey === 'strain' ? null : dropdown(t('label.byStrain'), uniq('strain'));

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = t('label.search');
  search.setAttribute('aria-label', t('label.search'));

  // ช่วงวันที่ — เฉพาะรายงานที่มีคอลัมน์วันที่จริง
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const hasDates = dates.length > 0;
  const from = document.createElement('input');
  const to = document.createElement('input');
  for (const [el, val, label] of [
    [from, dates[0], t('ctl.from')],
    [to, dates[dates.length - 1], t('ctl.to')],
  ]) {
    el.type = 'date';
    el.value = val ?? '';
    el.title = label;
    el.setAttribute('aria-label', label);
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'btn btn--sm';
  reset.textContent = t('ctl.reset');

  const count = document.createElement('span');
  count.className = 'ctl-count';

  bar.append(primary);
  if (strain) bar.append(strain);
  if (hasDates) bar.append(from, to);
  bar.append(search, reset, count);
  parent.appendChild(bar);

  /* ค่าเริ่มต้นคือวันที่ล่าสุดอยู่บนสุด
   *
   * รายการดิบเป็นบันทึกประจำวัน คนเปิดดูเพื่อตรวจว่า "วันนี้/เมื่อวานลงอะไรไว้"
   * ไม่ใช่เพื่อไล่ตั้งแต่วันแรกที่เปิดฟาร์ม ของเดิมไม่ได้เรียงเลย จึงได้ลำดับตามที่
   * parser อ่านมา ซึ่งบังเอิญเป็นเก่า→ใหม่ แล้วต้องเลื่อนลงสุดถึงจะเห็นวันล่าสุด
   *
   * รายงานที่ไม่มีคอลัมน์วันที่ (สินค้าคงเหลือ เป็นภาพนิ่งของตอนนี้) ไม่ต้องเรียง */
  const dateIndex = columns.findIndex((c) => c.isDate);
  const table = sortableTable(columns, rows, {
    moreLabel: t('meta.rows'),
    ...(dateIndex >= 0 ? { sortIndex: dateIndex, sortDir: 'desc' } : {}),
  });
  parent.appendChild(table);

  const apply = () => {
    const needle = search.value.trim().toLowerCase();
    const chosen = primary.value;
    const strainPick = strain?.value ?? '';
    const lo = hasDates ? from.value : '';
    const hi = hasDates ? to.value : '';

    const next = rows.filter((r) => {
      if (chosen && r[filterKey] !== chosen) return false;
      if (strainPick && r.strain !== strainPick) return false;
      // วันที่เป็น ISO อยู่แล้ว เทียบเป็นสตริงได้ตรง ๆ
      if (lo && r.date && r.date < lo) return false;
      if (hi && r.date && r.date > hi) return false;
      if (!needle) return true;
      return [r.crop, r.strain, r.customer, r.tab, r.location]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });

    table.setRows(next);
    count.textContent = `${n(next.length)} / ${n(rows.length)} ${t('meta.rows')}`;
  };

  primary.addEventListener('change', apply);
  strain?.addEventListener('change', apply);
  search.addEventListener('input', apply);
  from.addEventListener('change', apply);
  to.addEventListener('change', apply);
  reset.addEventListener('click', () => {
    primary.value = '';
    if (strain) strain.value = '';
    search.value = '';
    from.value = dates[0] ?? '';
    to.value = dates[dates.length - 1] ?? '';
    apply();
  });

  apply();
}

// ─────────────────────────────────────────────────────────────
/**
 * จำนวนแถวที่กำลังดูอยู่ — บอก "N / ทั้งหมด" เมื่อแถบตัวกรองตัดบางแถวออก
 *
 * `rowCount` เดินตามแถวที่กรองแล้ว (ดู filterSources) ส่วนยอดทั้งชีตอยู่ที่ rowCountAll
 * ถ้าโชว์แต่ยอดทั้งชีต ตัวเลขนี้จะขัดกับตัวนับของ filteredTable ที่อยู่ใต้มันในกล่องเดียวกัน
 */
function rowCountText(source) {
  const shown = source.rowCount ?? source.rows?.length ?? 0;
  const all = source.rowCountAll ?? shown;
  return all > shown
    ? `${n(shown)} / ${n(all)} ${t('meta.rows')}`
    : `${n(shown)} ${t('meta.rows')}`;
}

/** เปิด modal ของการ์ดที่กด */
export function openCard(key, payload, trigger) {
  const { kpi, analysis, meta, sources } = payload;
  const sourceMeta = meta.sources.find((s) => s.key === key);
  const findings = analysis.findings.filter((f) => f.source === key);

  const builders = {
    overview: () => openOverview(payload, trigger),
    quality: () => openQuality(payload, trigger),
  };
  if (builders[key]) return builders[key]();

  const source = sources[key];
  if (!source) return;

  const title = pick(sourceMeta, 'title') || key;
  const sub = `${rowCountText(source)} · ${n(sourceMeta.tabsOk)} ${t(
    'meta.of'
  )} ${n(sourceMeta.tabCount)} ${t('meta.tabs')}`;

  open(title, sub, (body) => {
    const grid = document.createElement('div');
    grid.className = 'panel-grid';
    body.appendChild(grid);

    const k = kpi[key];

    // ── กราฟตามชนิดของรายงาน ──
    if (k?.sizeMix) charts.donut(well(panel(grid, t('label.sizeMix'))), k.sizeMix);

    if (key === 'dailyTrim') {
      charts.line(
        well(panel(grid, t('label.trend'))),
        [
          {
            label: t('label.flower'),
            points: k.series.map((d) => ({ date: d.date, value: d.flower })),
          },
          {
            label: t('label.nonFlower'),
            points: k.series.map((d) => ({ date: d.date, value: d.nonFlower })),
          },
        ],
        {}
      );
      rankPanel(grid, t('label.byCrop'), k.byCrop, { max: 10 });
      rankPanel(grid, t('label.byStrain'), k.byStrain, { max: 8 });
    }

    if (key === 'perCrop') {
      charts.barH(
        panel(grid, `${t('label.byQuarter')} · ${t('label.gPerPlant')}`),
        k.byQuarter.map((q) => ({ key: q.key, flower: q.gPerPlant, rows: q.rows })),
        { max: 10, unit: 'g' }
      );
      charts.barH(
        panel(grid, `${t('label.top')} · ${t('label.gPerPlant')}`),
        k.topCrops.map((c) => ({ key: c.crop, flower: c.gPerPlant })),
        { max: 10, unit: 'g' }
      );
      charts.cycleTimeline(
        well(panel(grid, `${t('label.upcoming')} · ${t('label.cycle')}`)),
        k.upcoming,
        { max: 8 }
      );
    }

    if (key === 'outbound' || key === 'inbound') {
      charts.line(
        well(panel(grid, t('label.trend'))),
        [
          {
            label: t('label.flower'),
            points: k.series.map((d) => ({ date: d.date, value: d.flower })),
          },
        ],
        {}
      );
      rankPanel(grid, t('label.byStrain'), k.byStrain, { max: 8 });
    }

    if (key === 'inbound') {
      charts.groupedBars(
        well(panel(grid, t('label.reconciliation'), t('quality.sourceNote'))),
        k.reconciliation,
        { height: 210, max: 20 }
      );
    }

    if (key === 'sales') {
      charts.line(
        well(panel(grid, t('label.monthly'))),
        [
          {
            label: t('label.flower'),
            points: k.byMonth.map((d) => ({ date: d.month, value: d.flower })),
          },
          {
            label: t('label.nonFlower'),
            points: k.byMonth.map((d) => ({ date: d.month, value: d.nonFlower })),
          },
        ],
        { format: 'month' }
      );
      rankPanel(grid, t('label.byCustomer'), k.byCustomer, { max: 10 });
      rankPanel(grid, t('label.byStrain'), k.byStrain, { max: 8 });
    }

    if (key === 'inventory') {
      rankPanel(grid, t('label.byLocation'), k.byLocation, { max: 6 });
      rankPanel(grid, t('label.byStrain'), k.byStrain, { max: 10 });
    }

    // ── รายการดิบ ──
    const extra = [];
    if (key === 'sales') extra.push({ label: t('label.customer'), get: (r) => r.customer ?? '' });
    if (key === 'inventory') extra.push({ label: t('label.location'), get: (r) => r.location ?? '' });
    if (key === 'perCrop') {
      extra.push({ label: t('label.quarter'), get: (r) => r.quarter ?? '' });
      extra.push({ label: t('label.plants'), align: 'n', get: (r) => r.plants, render: (r) => n(r.plants) });
      extra.push({
        label: t('label.gPerPlant'),
        align: 'n',
        get: (r) => r.gramsPerPlant,
        render: (r) => n(r.gramsPerPlant, 1),
      });
    }

    const tablePanel = panel(body, t('label.records'), rowCountText(source));
    filteredTable(
      tablePanel,
      source.rows,
      baseColumns({
        showDate: key !== 'inventory',
        showCrop: key !== 'inventory',
        showStrain: key !== 'perCrop',
        extra,
      }),
      key === 'inventory'
        ? { filterKey: 'location', filterLabel: t('label.byLocation') }
        : key === 'sales'
          ? { filterKey: 'customer', filterLabel: t('label.byCustomer') }
          : { filterKey: 'crop', filterLabel: t('label.allCrops') }
    );

    // ── finding ของรายงานนี้ ──
    findingsList(
      panel(body, t('quality.title'), `${findings.length} ${t('label.records')}`),
      findings,
      buildSourceIndex(meta)
    );

    if (sourceMeta?.sheetUrl) {
      const link = document.createElement('a');
      link.href = sourceMeta.sheetUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'btn';
      link.textContent = `${t('action.openSheet')} ↗`;
      body.appendChild(link);
    }
  }, trigger);
}

/** modal ภาพรวมผู้บริหาร */
function openOverview(payload, trigger) {
  const { kpi, analysis } = payload;
  open(t('card.overview.title'), t('card.overview.sub'), (body) => {
    const grid = document.createElement('div');
    grid.className = 'panel-grid';
    body.appendChild(grid);

    charts.donut(well(panel(grid, `${t('label.sizeMix')} · ${t('label.total')}`)), kpi.perCrop.sizeMix);
    charts.barH(
      panel(grid, `${t('label.byQuarter')} · ${t('label.gPerPlant')}`),
      kpi.perCrop.byQuarter.map((q) => ({ key: q.key, flower: q.gPerPlant })),
      { max: 10, unit: 'g' }
    );
    charts.line(
      well(panel(grid, `${t('label.monthly')} · ${t('card.sales.sub')}`)),
      [
        {
          label: t('label.flower'),
          points: kpi.sales.byMonth.map((d) => ({ date: d.month, value: d.flower })),
        },
      ],
      { format: 'month' }
    );
    rankPanel(grid, t('label.byLocation'), kpi.inventory.byLocation, { max: 6 });
    charts.cycleTimeline(
      well(panel(grid, `${t('label.upcoming')} · ${t('label.cycle')}`)),
      kpi.perCrop.upcoming,
      { max: 8 }
    );

    // ตารางสรุปเปรียบเทียบทุกสาย
    const flowRows = [
      ['perCrop', t('label.harvested'), kpi.perCrop.totalFlower],
      ['outbound', t('card.outbound.sub'), kpi.outbound.totalFlower],
      ['inbound', t('card.inbound.sub'), kpi.inbound.totalFlower],
      ['sales', t('card.sales.sub'), kpi.sales.totalFlower],
      ['inventory', t('card.inventory.sub'), kpi.inventory.totalFlower],
    ].map(([key, label, value]) => ({ key, label, value, count: analysis.bySource[key]?.total ?? 0 }));

    const flowPanel = panel(body, t('label.total'));
    flowPanel.appendChild(
      sortableTable(
        [
          { label: t('label.records'), get: (r) => r.label },
          {
            label: t('label.flower'),
            align: 'n',
            get: (r) => r.value,
            render: (r) => `<b>${weight(r.value)}</b>`,
          },
          {
            label: t('quality.title'),
            align: 'n',
            get: (r) => r.count,
            render: (r) => n(r.count),
          },
        ],
        flowRows
      )
    );
  }, trigger);
}

/** modal คุณภาพข้อมูล */
function openQuality(payload, trigger) {
  const { analysis, meta } = payload;
  open(
    t('quality.title'),
    `${t('quality.score')} ${analysis.score}/100 · ${t('quality.ranAt')} ${dateTime(analysis.ranAt)}`,
    (body) => {
      const sourceIndex = buildSourceIndex(meta);

      const note = document.createElement('p');
      note.className = 'notice';
      note.textContent = t('quality.sourceNote');
      body.appendChild(note);

      /* ── หมายเหตุ: ข้อมูลที่ยังขาด ──
       *
       * อยู่ก่อน finding โดยตั้งใจ เพราะ finding บอกว่า "ตัวเลขที่มีผิดตรงไหน"
       * ส่วนตรงนี้บอกว่า "มีตัวเลขอะไรที่ยังไม่มีให้ดูเลย" ซึ่งคะแนน 100/100
       * ก็ไม่ได้แปลว่าครบ — ต้องเห็นก่อนที่จะไปสรุปว่าข้อมูลสมบูรณ์แล้ว */
      const gaps = dataGaps(payload.report ?? 'dryflower', payload);
      const gapBox = panel(body, t('quality.gapsTitle'), `${gaps.length} ${t('label.records')}`);
      const gapNote = document.createElement('p');
      gapNote.className = 'card__sub';
      gapNote.textContent = t('quality.gapsNote');
      gapBox.appendChild(gapNote);
      gapList(gapBox, gaps);

      // ตัวกรองตามระดับความร้ายแรงและรายงาน
      const bar = document.createElement('div');
      bar.className = 'filter-row';

      const seg = document.createElement('div');
      seg.className = 'seg';
      const levels = [
        ['all', t('quality.all'), analysis.total],
        ['critical', t('quality.critical'), analysis.counts.critical],
        ['warning', t('quality.warning'), analysis.counts.warning],
        ['info', t('quality.info'), analysis.counts.info],
      ];
      seg.innerHTML = levels
        .map(
          ([value, label, count], i) =>
            `<button type="button" data-level="${value}" aria-pressed="${i === 0}">${label} (${count})</button>`
        )
        .join('');

      const bySource = document.createElement('select');
      bySource.setAttribute('aria-label', t('quality.all'));
      bySource.innerHTML =
        `<option value="">${t('quality.all')}</option>` +
        meta.sources
          .map(
            (s) =>
              `<option value="${esc(s.key)}">${esc(pick(s, 'title'))} (${
                analysis.bySource[s.key]?.total ?? 0
              })</option>`
          )
          .join('');

      bar.append(seg, bySource);
      body.appendChild(bar);

      const host = document.createElement('div');
      body.appendChild(host);

      let level = 'all';
      const render = () => {
        const chosen = bySource.value;
        const list = analysis.findings.filter(
          (f) => (level === 'all' || f.severity === level) && (!chosen || f.source === chosen)
        );
        host.innerHTML = '';
        findingsList(host, list, sourceIndex);
      };

      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        level = btn.dataset.level;
        seg.querySelectorAll('button').forEach((b) =>
          b.setAttribute('aria-pressed', String(b === btn))
        );
        render();
      });
      bySource.addEventListener('change', render);
      render();
    },
    trigger
  );
}
