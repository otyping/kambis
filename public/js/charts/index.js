/**
 * charts/index.js — กราฟทุกชนิดของ Dashboard
 *
 * ทุกฟังก์ชันรับ (container, data, options) และวาดลง canvas ที่สร้างเอง
 * container ต้องเป็น element ที่มี position:relative (คลาส .chart)
 */
import {
  setupCanvas,
  drawEmpty,
  hasData,
  drawYAxis,
  roundedTopRect,
  roundedRightRect,
  palette,
  attachTooltip,
  legendHtml,
  onResize,
  releaseChart,
  shortNum,
  FONT_SM,
} from './core.js';
import { t } from '../i18n.js';
import { weight, n, pct, date as fmtDate, month as fmtMonth, truncate, esc } from '../format.js';

/**
 * สร้าง canvas ใหม่ในกล่อง
 * ต้อง releaseChart ก่อนล้าง DOM เสมอ ไม่งั้น observer กับ bitmap ของ canvas เดิม
 * จะค้างอยู่ในหน่วยความจำแม้ element หลุดจาก DOM ไปแล้ว
 */
function prepare(container, height) {
  releaseChart(container);
  container.innerHTML = '';
  container.classList.add('chart');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  container.appendChild(canvas);
  const setup = setupCanvas(canvas, height);
  return { canvas, setup };
}

/** ช่องว่างสีพื้น 2px ระหว่างส่วนที่ติดกัน ทำให้แยกแท่งออกจากกันได้ */
const GAP = 2;

// ─────────────────────────────────────────────────────────────
/**
 * แท่งแนวนอน — ใช้กับการจัดอันดับ (สายพันธุ์ / ลูกค้า / ครอป)
 * ทุกแท่งใช้สีเดียวกัน เพราะชื่อบนแกนบอกตัวตนอยู่แล้ว
 * (การไล่สีตามอันดับเป็น anti-pattern — สีต้องผูกกับตัวตน ไม่ใช่อันดับ)
 */
export function barH(container, rows, opts = {}) {
  const { labelKey = 'key', valueKey = 'flower', max: topN = 8, unit = 'g' } = opts;
  const data = rows.filter((r) => Number.isFinite(r[valueKey]) && r[valueKey] > 0).slice(0, topN);

  const height = Math.max(90, data.length * 30 + 24);
  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  if (!data.length) return drawEmpty(ctx, w, h);

  const p = palette();
  const labelW = Math.min(150, Math.max(80, w * 0.32));
  const valueW = 76;
  const box = { x: labelW, y: 8, w: Math.max(20, w - labelW - valueW), h: h - 16 };
  const max = Math.max(...data.map((r) => r[valueKey]));
  const rowH = box.h / data.length;
  const barH_ = Math.min(18, rowH - GAP * 2);

  const hits = [];
  ctx.font = FONT_SM;
  ctx.textBaseline = 'middle';

  // ตัดป้ายชื่อตามความกว้างที่วัดได้จริง ไม่ใช่ตามจำนวนตัวอักษร
  // (ชื่อลูกค้าภาษาไทย/อังกฤษกว้างไม่เท่ากัน ตัดตามตัวอักษรทำให้ล้นขอบซ้าย)
  const fitLabel = (text, maxWidth) => {
    let s = String(text ?? '—');
    if (ctx.measureText(s).width <= maxWidth) return s;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
    return `${s}…`;
  };

  data.forEach((row, i) => {
    const y = box.y + i * rowH + (rowH - barH_) / 2;
    const barW = Math.max(2, (row[valueKey] / max) * box.w);

    ctx.textAlign = 'right';
    ctx.fillStyle = p.inkSoft;
    ctx.fillText(fitLabel(row[labelKey], labelW - 12), labelW - 10, y + barH_ / 2);

    ctx.fillStyle = p.series1;
    roundedRightRect(ctx, box.x, y, barW, barH_, 4);

    ctx.textAlign = 'left';
    ctx.fillStyle = p.ink;
    const label = unit === '%' ? pct(row[valueKey]) : weight(row[valueKey]);
    ctx.fillText(label, box.x + box.w + 8, y + barH_ / 2);

    // แถบรับเมาส์กินเต็มความสูงของแถว ไม่เว้นช่องว่างระหว่างแท่ง
    // ไม่งั้นเลื่อนเมาส์ผ่านรอยต่อแล้ว tooltip จะสะดุด
    const bandTop = box.y + i * rowH;
    hits.push({ y0: bandTop, y1: bandTop + rowH, row, cx: box.x + barW / 2, cy: y });
  });

  attachTooltip(container, canvas, (mx, my) => {
    const hit = hits.find((s) => my >= s.y0 && my <= s.y1);
    if (!hit) return null;
    const value = unit === '%' ? pct(hit.row[valueKey]) : weight(hit.row[valueKey]);
    const extra = hit.row.rows ? `<br>${t('label.records')}: ${n(hit.row.rows)}` : '';
    return {
      html: `${esc(hit.row[labelKey] ?? '—')}<br><b>${value}</b>${extra}`,
      x: hit.cx,
      y: hit.cy,
    };
  });

  onResize(canvas, () => barH(container, rows, opts));
}

// ─────────────────────────────────────────────────────────────
/**
 * แท่งซ้อนแนวนอนแถวเดียว — สัดส่วนตามขนาดดอก (XXL…XS)
 * ขนาดเป็นข้อมูลเรียงลำดับ จึงใช้ไล่เฉดสีเดียว ไม่ใช่สีแยกประเภท
 */
export function sizeMixBar(container, mix, opts = {}) {
  const order = ['XXL', 'XL', 'L', 'M', 'S', 'XS'];
  const values = order.map((k) => mix?.[k] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);

  const height = opts.height ?? 108;
  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  if (!total) return drawEmpty(ctx, w, h);

  const p = palette();
  const barY = 10;
  const barH_ = 30;
  let x = 0;
  const hits = [];

  order.forEach((key, i) => {
    const value = values[i];
    if (value <= 0) return;
    const segW = (value / total) * w;
    // เว้นช่องว่าง 2px ระหว่างส่วน เพื่อให้แยกออกจากกันแม้สีใกล้กัน
    const drawW = Math.max(1, segW - GAP);
    ctx.fillStyle = p.sizes[i];
    ctx.fillRect(x, barY, drawW, barH_);
    // แถบรับเมาส์รวมช่องว่างเข้าไปด้วย ให้ต่อกันสนิททั้งแถว
    hits.push({ x0: x, x1: x + segW, key, value, share: (value / total) * 100 });
    x += segW;
  });

  // ป้ายกำกับตรงส่วนที่กว้างพอ (ไม่ใส่ทุกส่วน เพื่อไม่ให้ตัวหนังสือทับกัน)
  ctx.font = FONT_SM;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let lx = 0;
  order.forEach((key, i) => {
    const value = values[i];
    if (value <= 0) return;
    const segW = (value / total) * w;
    if (segW > 46) {
      ctx.fillStyle = p.inkSoft;
      ctx.fillText(key, lx + 2, barY + barH_ + 7);
      ctx.fillStyle = p.inkMute;
      ctx.fillText(`${((value / total) * 100).toFixed(0)}%`, lx + 2, barY + barH_ + 22);
    }
    lx += segW;
  });

  attachTooltip(container, canvas, (mx) => {
    const hit = hits.find((s) => mx >= s.x0 && mx <= s.x1);
    if (!hit) return null;
    return {
      html: `${hit.key}<br><b>${weight(hit.value)}</b> · ${hit.share.toFixed(1)}%`,
      x: (hit.x0 + hit.x1) / 2,
      y: barY,
    };
  });

  onResize(canvas, () => sizeMixBar(container, mix, opts));
}

// ─────────────────────────────────────────────────────────────
/**
 * กราฟเส้นตามเวลา — รองรับ 1–2 ชุดข้อมูล
 * ค่า null คือช่องว่าง เส้นจะขาดตรงนั้น ไม่ลากลงศูนย์
 */
export function line(container, series, opts = {}) {
  const { xKey = 'date', height = 190, format = 'date' } = opts;
  const height_ = height;
  const { canvas, setup } = prepare(container, height_);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const active = series.filter((s) => s.points?.length);
  const allValues = active.flatMap((s) => s.points.map((pt) => pt.value)).filter(Number.isFinite);
  if (!active.length || !hasData(allValues)) return drawEmpty(ctx, w, h);

  const p = palette();
  const box = { x: 46, y: 12, w: w - 58, h: h - 44 };
  const max = Math.max(...allValues, 1);
  const top = drawYAxis(ctx, box, max);

  const labels = active[0].points.map((pt) => pt[xKey]);
  const count = labels.length;
  const xAt = (i) => (count === 1 ? box.x + box.w / 2 : box.x + (i / (count - 1)) * box.w);
  const yAt = (v) => box.y + box.h - (v / top) * box.h;

  // ป้ายแกน X แบบเว้นระยะ ไม่ใส่ทุกจุดเพื่อไม่ให้ทับกัน
  const fmt = format === 'month' ? fmtMonth : fmtDate;
  const stride = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(box.w / 76))));
  ctx.font = FONT_SM;
  ctx.fillStyle = p.inkMute;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  labels.forEach((label, i) => {
    if (i % stride !== 0 && i !== count - 1) return;
    // ป้ายตัวสุดท้ายชิดขวาไม่ให้ล้นออกนอก canvas
    ctx.textAlign = i === count - 1 && count > 1 ? 'right' : i === 0 ? 'left' : 'center';
    ctx.fillText(fmt(label), xAt(i), box.y + box.h + 8);
  });
  ctx.textAlign = 'center';

  active.forEach((s, si) => {
    const color = si === 0 ? p.series1 : p.series2;

    // พื้นที่ใต้เส้นแบบจาง เฉพาะชุดแรก
    if (si === 0 && count > 1) {
      ctx.beginPath();
      let started = false;
      s.points.forEach((pt, i) => {
        if (!Number.isFinite(pt.value)) return;
        const x = xAt(i);
        const y = yAt(pt.value);
        if (!started) {
          ctx.moveTo(x, box.y + box.h);
          ctx.lineTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      if (started) {
        ctx.lineTo(xAt(count - 1), box.y + box.h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
        grad.addColorStop(0, p.fade);
        grad.addColorStop(1, p.fade0);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    // เส้นหลัก 2px — ขาดตรงที่ข้อมูลหาย
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let pen = false;
    s.points.forEach((pt, i) => {
      if (!Number.isFinite(pt.value)) {
        pen = false;
        return;
      }
      const x = xAt(i);
      const y = yAt(pt.value);
      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // จุดข้อมูล เฉพาะเมื่อจุดไม่แน่นเกินไป
    if (count <= 40) {
      s.points.forEach((pt, i) => {
        if (!Number.isFinite(pt.value)) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xAt(i), yAt(pt.value), count <= 18 ? 4 : 3, 0, Math.PI * 2);
        ctx.fill();
        // วงแหวนสีพื้น 2px กันจุดที่ทับกันกลืนเป็นก้อนเดียว
        ctx.strokeStyle = p.well;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }
  });

  attachTooltip(container, canvas, (mx, my) => {
    if (my < box.y - 10 || my > box.y + box.h + 10) return null;
    const i = Math.round(((mx - box.x) / box.w) * (count - 1));
    if (i < 0 || i >= count) return null;
    const label = fmt(labels[i]);
    const lines = active
      .map((s) => {
        const v = s.points[i]?.value;
        return `${s.label}: <b>${Number.isFinite(v) ? weight(v) : '—'}</b>`;
      })
      .join('<br>');
    return { html: `${label}<br>${lines}`, x: xAt(i), y: box.y };
  });

  if (active.length >= 2) {
    const legend = document.createElement('div');
    legend.innerHTML = legendHtml(
      active.map((s, i) => ({ label: s.label, color: i === 0 ? p.series1 : p.series2 }))
    );
    container.appendChild(legend.firstElementChild);
  }

  onResize(canvas, () => line(container, series, opts));
}

// ─────────────────────────────────────────────────────────────
/** โดนัท — สัดส่วนตามขนาดดอก (ข้อมูลเรียงลำดับ ใช้ไล่เฉดสีเดียว) */
export function donut(container, mix, opts = {}) {
  const order = ['XXL', 'XL', 'L', 'M', 'S', 'XS'];
  const values = order.map((k) => mix?.[k] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);

  const height = opts.height ?? 210;
  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  if (!total) return drawEmpty(ctx, w, h);

  const p = palette();
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.min(w, h) / 2 - 12;
  const inner = outer * 0.62;

  let angle = -Math.PI / 2;
  const hits = [];

  order.forEach((key, i) => {
    const value = values[i];
    if (value <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    // เว้นช่องว่างเล็กน้อยระหว่างชิ้น
    const pad = sweep > 0.06 ? 0.012 : 0;

    ctx.fillStyle = p.sizes[i];
    ctx.beginPath();
    ctx.arc(cx, cy, outer, angle + pad, angle + sweep - pad);
    ctx.arc(cx, cy, inner, angle + sweep - pad, angle + pad, true);
    ctx.closePath();
    ctx.fill();

    hits.push({ a0: angle, a1: angle + sweep, key, value, share: (value / total) * 100 });
    angle += sweep;
  });

  // ตัวเลขรวมตรงกลาง
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = p.ink;
  ctx.font = "600 17px 'Noto Sans Thai', system-ui, sans-serif";
  const wt = weight(total);
  ctx.fillText(wt, cx, cy - 6);
  ctx.font = FONT_SM;
  ctx.fillStyle = p.inkMute;
  ctx.fillText(t('label.total'), cx, cy + 13);

  attachTooltip(container, canvas, (mx, my) => {
    const dx = mx - cx;
    const dy = my - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < inner || dist > outer) return null;
    let a = Math.atan2(dy, dx);
    if (a < -Math.PI / 2) a += Math.PI * 2;
    const hit = hits.find((s) => a >= s.a0 && a <= s.a1);
    if (!hit) return null;
    return {
      html: `${hit.key}<br><b>${weight(hit.value)}</b> · ${hit.share.toFixed(1)}%`,
      x: mx,
      y: my,
    };
  });

  const legend = document.createElement('div');
  legend.innerHTML = legendHtml(
    order
      .map((key, i) => ({ label: key, color: p.sizes[i], value: values[i] }))
      .filter((it) => it.value > 0)
  );
  if (legend.firstElementChild) container.appendChild(legend.firstElementChild);

  onResize(canvas, () => donut(container, mix, opts));
}

// ─────────────────────────────────────────────────────────────
/** แท่งแนวตั้งจับคู่ — เทียบยอดขนออกกับยอดรับเข้ารายวัน */
export function groupedBars(container, rows, opts = {}) {
  const { height = 200, aKey = 'shipped', bKey = 'received', max: topN = 14 } = opts;
  const data = rows
    .filter((r) => Number.isFinite(r[aKey]) || Number.isFinite(r[bKey]))
    .slice(-topN);

  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  if (!data.length) return drawEmpty(ctx, w, h);

  const p = palette();
  const box = { x: 46, y: 12, w: w - 58, h: h - 46 };
  const max = Math.max(...data.flatMap((r) => [r[aKey] ?? 0, r[bKey] ?? 0]), 1);
  const top = drawYAxis(ctx, box, max);

  const slot = box.w / data.length;
  const barW = Math.max(3, Math.min(15, slot / 2 - GAP));
  const hits = [];

  data.forEach((row, i) => {
    const cx = box.x + slot * (i + 0.5);
    [
      [row[aKey], p.series1, -1],
      [row[bKey], p.series2, 1],
    ].forEach(([value, color, side]) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const barHt = (value / top) * box.h;
      const x = side < 0 ? cx - barW - GAP / 2 : cx + GAP / 2;
      ctx.fillStyle = color;
      roundedTopRect(ctx, x, box.y + box.h - barHt, barW, barHt, 4);
    });
    hits.push({ x0: cx - slot / 2, x1: cx + slot / 2, row, cx });
  });

  // ป้ายแกน X เว้นระยะ
  ctx.font = FONT_SM;
  ctx.fillStyle = p.inkMute;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const stride = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(box.w / 66))));
  data.forEach((row, i) => {
    if (i % stride !== 0 && i !== data.length - 1) return;
    ctx.fillText(fmtDate(row.date), box.x + slot * (i + 0.5), box.y + box.h + 8);
  });

  attachTooltip(container, canvas, (mx) => {
    const hit = hits.find((s) => mx >= s.x0 && mx <= s.x1);
    if (!hit) return null;
    const r = hit.row;
    const diff = Number.isFinite(r.diff)
      ? `<br>${t('label.diff')}: <b>${weight(r.diff)}</b>`
      : '';
    return {
      html: `${fmtDate(r.date)}<br>${t('label.shipped')}: <b>${weight(r[aKey])}</b><br>${t(
        'label.received'
      )}: <b>${weight(r[bKey])}</b>${diff}`,
      x: hit.cx,
      y: box.y,
    };
  });

  const legend = document.createElement('div');
  legend.innerHTML = legendHtml([
    { label: t('label.shipped'), color: p.series1 },
    { label: t('label.received'), color: p.series2 },
  ]);
  if (legend.firstElementChild) container.appendChild(legend.firstElementChild);

  onResize(canvas, () => groupedBars(container, rows, opts));
}

// ─────────────────────────────────────────────────────────────
/** ไทม์ไลน์รอบปลูก — แถบแนวนอนแบบ Gantt ต่อหนึ่งครอป */
export function cycleTimeline(container, crops, opts = {}) {
  const data = crops.filter((c) => c.cycle?.clone || c.cycle?.harvest).slice(0, opts.max ?? 8);

  const rowH = 30;
  const height = Math.max(100, data.length * rowH + 34);
  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  if (!data.length) return drawEmpty(ctx, w, h);

  const p = palette();
  const labelW = Math.min(130, Math.max(76, w * 0.28));
  const box = { x: labelW, y: 8, w: Math.max(30, w - labelW - 12), h: data.length * rowH };

  const stamps = data
    .flatMap((c) => Object.values(c.cycle).filter(Boolean))
    .map((d) => new Date(d).getTime())
    .filter(Number.isFinite);
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const span = Math.max(1, max - min);
  const xAt = (iso) => box.x + ((new Date(iso).getTime() - min) / span) * box.w;

  const PHASES = [
    ['clone', 'veg', p.sizes[4]],
    ['veg', 'flower', p.sizes[3]],
    ['flower', 'harvest', p.sizes[2]],
    ['harvest', 'dryReady', p.sizes[1]],
  ];

  ctx.font = FONT_SM;
  ctx.textBaseline = 'middle';
  const hits = [];

  data.forEach((crop, i) => {
    const y = box.y + i * rowH;
    const barY = y + (rowH - 13) / 2;

    ctx.textAlign = 'right';
    ctx.fillStyle = p.inkSoft;
    ctx.fillText(truncate(crop.crop ?? '—', 16), labelW - 10, y + rowH / 2);

    PHASES.forEach(([from, to, color]) => {
      const a = crop.cycle[from];
      const b = crop.cycle[to];
      if (!a || !b) return;
      const x0 = xAt(a);
      const x1 = xAt(b);
      if (!(x1 > x0)) return;
      ctx.fillStyle = color;
      ctx.fillRect(x0, barY, Math.max(2, x1 - x0 - GAP), 13);
    });

    hits.push({ y0: y, y1: y + rowH, crop });
  });

  // แกนเวลาด้านล่าง
  ctx.strokeStyle = p.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(box.x, box.y + box.h + 0.5);
  ctx.lineTo(box.x + box.w, box.y + box.h + 0.5);
  ctx.stroke();

  ctx.fillStyle = p.inkMute;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(fmtDate(new Date(min).toISOString().slice(0, 10)), box.x, box.y + box.h + 7);
  ctx.textAlign = 'right';
  ctx.fillText(
    fmtDate(new Date(max).toISOString().slice(0, 10)),
    box.x + box.w,
    box.y + box.h + 7
  );

  attachTooltip(container, canvas, (mx, my) => {
    const hit = hits.find((s) => my >= s.y0 && my <= s.y1);
    if (!hit) return null;
    const c = hit.crop;
    const line_ = (labelKey, value) =>
      value ? `${t(labelKey)}: <b>${fmtDate(value)}</b><br>` : '';
    return {
      html:
        `${esc(c.crop)}<br>` +
        line_('label.clone', c.cycle.clone) +
        line_('label.veg', c.cycle.veg) +
        line_('label.flowerPhase', c.cycle.flower) +
        line_('label.harvest', c.cycle.harvest) +
        line_('label.dryReady', c.cycle.dryReady) +
        (c.plants ? `${t('label.plants')}: <b>${n(c.plants)}</b>` : ''),
      x: mx,
      y: hit.y0,
    };
  });

  const legend = document.createElement('div');
  legend.innerHTML = legendHtml([
    { label: t('label.veg'), color: p.sizes[4] },
    { label: t('label.flowerPhase'), color: p.sizes[3] },
    { label: t('label.harvest'), color: p.sizes[2] },
    { label: t('label.dryReady'), color: p.sizes[1] },
  ]);
  if (legend.firstElementChild) container.appendChild(legend.firstElementChild);

  onResize(canvas, () => cycleTimeline(container, crops, opts));
}

// ─────────────────────────────────────────────────────────────
/** เส้นเล็กในการ์ด — ไม่มีแกน ไม่มี tooltip ใช้บอกทิศทางเท่านั้น */
export function sparkline(container, points, opts = {}) {
  const height = opts.height ?? 46;
  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const values = points.map((pt) => pt.value).filter(Number.isFinite);
  if (values.length < 2) return drawEmpty(ctx, w, h, ' ');

  const p = palette();
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pad = 4;
  const xAt = (i) => (i / (points.length - 1)) * w;
  const yAt = (v) => h - pad - ((v - min) / span) * (h - pad * 2);

  ctx.beginPath();
  points.forEach((pt, i) => {
    if (!Number.isFinite(pt.value)) return;
    const x = xAt(i);
    const y = yAt(pt.value);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, p.fade);
  grad.addColorStop(1, p.fade0);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  let pen = false;
  points.forEach((pt, i) => {
    if (!Number.isFinite(pt.value)) {
      pen = false;
      return;
    }
    const x = xAt(i);
    const y = yAt(pt.value);
    if (!pen) {
      ctx.moveTo(x, y);
      pen = true;
    } else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = p.series1;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  onResize(canvas, () => sparkline(container, points, opts));
}
