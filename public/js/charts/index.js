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
  drawYAxisRange,
  roundedTopRect,
  roundedRightRect,
  palette,
  attachTooltip,
  legendHtml,
  onResize,
  releaseChart,
  shortNum,
  drawXLabels,
  FONT_SM,
  chartFont,
  axisUnit,
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

/**
 * จัดรูปแบบค่าตามหน่วยของกราฟนั้น — ทุกกราฟต้องผ่านตัวนี้ตัวเดียว
 *
 * `'g'` (ค่าเริ่มต้น) = น้ำหนัก ย่อเป็น kg ให้เอง · `'%'` = เปอร์เซ็นต์
 * หน่วยอื่น เช่น `'฿'` = ตัวเลขล้วนตามด้วยหน่วย **ห้ามเอา weight() ไปครอบ**
 * ไม่งั้นเงิน 17,299,482 บาท จะขึ้นบนจอว่า "17,299 kg" — เคยเกิดจริงกับ
 * โดนัทสัดส่วนต้นทุนและแท่ง "วัสดุที่มีมูลค่าสูงสุด" ที่ส่ง unit: '฿' มาแล้วแต่ถูกเมิน
 */
function fmtValue(value, unit) {
  if (unit === '%') return pct(value);
  if (!unit || unit === 'g') return weight(value);
  return `${n(value)} ${unit}`;
}

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
  ctx.font = FONT_SM();
  ctx.textBaseline = 'middle';

  const labelW = Math.min(150, Math.max(80, w * 0.32));

  /* ช่องตัวเลขทางขวาต้องกว้างตามข้อความจริง ไม่ใช่ค่าตายตัว
   *
   * ของเดิมจองไว้ 76px ซึ่งพอสำหรับ "400 kg" แต่ยอดเงินหลักล้าน ("6,079,796 ฿")
   * กว้างเกินนั้น สัญลักษณ์ ฿ ตัวสุดท้ายจึงถูกตัดครึ่งหายไปนอกผืนผ้าใบ
   * วัดทุกค่าก่อนแล้วเผื่อ 8px หน้า-หลัง เพดาน 160px กันไม่ให้แท่งถูกบีบจนอ่านไม่ออก */
  const valueTexts = data.map((r) => fmtValue(r[valueKey], unit));
  const valueW = Math.min(160, Math.max(60, ...valueTexts.map((s) => ctx.measureText(s).width)) + 16);

  const box = { x: labelW, y: 8, w: Math.max(20, w - labelW - valueW), h: h - 16 };
  const max = Math.max(...data.map((r) => r[valueKey]));
  const rowH = box.h / data.length;
  const barH_ = Math.min(18, rowH - GAP * 2);

  const hits = [];

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
    ctx.fillText(valueTexts[i], box.x + box.w + 8, y + barH_ / 2);

    // แถบรับเมาส์กินเต็มความสูงของแถว ไม่เว้นช่องว่างระหว่างแท่ง
    // ไม่งั้นเลื่อนเมาส์ผ่านรอยต่อแล้ว tooltip จะสะดุด
    const bandTop = box.y + i * rowH;
    hits.push({ y0: bandTop, y1: bandTop + rowH, row, cx: box.x + barW / 2, cy: y });
  });

  attachTooltip(container, canvas, (mx, my) => {
    const hit = hits.find((s) => my >= s.y0 && my <= s.y1);
    if (!hit) return null;
    const value = fmtValue(hit.row[valueKey], unit);
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
  ctx.font = FONT_SM();
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
  /* colors  — กำหนดสีเองได้ เพราะกราฟที่มีตั้งแต่ 3 เส้นขึ้นไป (เช่นสต็อกแยกคลัง)
   *           ใช้แค่ series1/series2 ไม่พอ
   * dashed  — ดัชนีของเส้นที่ต้องวาดเป็นเส้นประ ใช้กับค่าที่เป็น "ประมาณการ"
   *           ไม่ใช่ค่าที่วัดได้จริง — ต้องดูออกโดยไม่ต้องอ่านคำอธิบาย */
  const { xKey = 'date', height = 190, format = 'date', colors, dashed = [], unit = 'g' } = opts;
  const height_ = height;
  const { canvas, setup } = prepare(container, height_);
  if (!setup) return;
  const { ctx, w, h } = setup;

  const active = series.filter((s) => s.points?.length);
  const allValues = active.flatMap((s) => s.points.map((pt) => pt.value)).filter(Number.isFinite);
  if (!active.length || !hasData(allValues)) return drawEmpty(ctx, w, h);

  const p = palette();
  // ช่องแกน Y กว้างขึ้นเล็กน้อยเพราะป้ายบนสุดมีหน่วยต่อท้าย (เช่น "400 kg")
  const box = { x: 54, y: 12, w: w - 66, h: h - 44 };
  /* แกนต้องครอบค่าติดลบด้วย ไม่งั้นจุดที่ติดลบจะถูกวาดใต้ผืนผ้าใบแล้วหายไปเงียบ ๆ
   * (เคยเกิดกับเส้น EBITDA บนหน้าต้นทุน — สี่เดือนที่ขาดทุนดูเหมือนไม่มีข้อมูล) */
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  // แกน Y ต้องบอกหน่วยเดียวกับ tooltip ไม่งั้น "400k" อ่านไม่ออกว่ากรัมหรือกิโล
  const axis = axisUnit(unit, Math.max(Math.abs(max), Math.abs(min)));
  const { bottom, span } = drawYAxisRange(ctx, box, min, max, {
    div: axis.div,
    unitLabel: axis.label,
  });

  const labels = active[0].points.map((pt) => pt[xKey]);
  const count = labels.length;
  const xAt = (i) => (count === 1 ? box.x + box.w / 2 : box.x + (i / (count - 1)) * box.w);
  const yAt = (v) => box.y + box.h - ((v - bottom) / span) * box.h;
  const zeroY = yAt(0);

  // ป้ายแกน X — วัดความกว้างจริงแล้วข้ามอันที่จะทับกัน
  const fmt = format === 'month' ? fmtMonth : fmtDate;
  ctx.font = FONT_SM();
  ctx.fillStyle = p.inkMute;
  ctx.textBaseline = 'top';
  drawXLabels(
    ctx,
    box,
    labels.map((label, i) => ({ x: xAt(i), text: fmt(label) })),
    box.y + box.h + 8
  );

  const colorAt = (si) =>
    colors?.[si] ?? (si === 0 ? p.series1 : si === 1 ? p.series2 : p.cats[si % p.cats.length]);

  active.forEach((s, si) => {
    const color = colorAt(si);

    // พื้นที่ใต้เส้นแบบจาง เฉพาะชุดแรก
    if (si === 0 && count > 1) {
      ctx.beginPath();
      let started = false;
      s.points.forEach((pt, i) => {
        if (!Number.isFinite(pt.value)) return;
        const x = xAt(i);
        const y = yAt(pt.value);
        if (!started) {
          // ฐานของพื้นที่ใต้เส้นคือเส้นศูนย์ ไม่ใช่ก้นกล่อง — ต่างกันเมื่อแกนลงต่ำกว่าศูนย์
          ctx.moveTo(x, zeroY);
          ctx.lineTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      if (started) {
        ctx.lineTo(xAt(count - 1), zeroY);
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
    // เส้นประ = ค่าประมาณการ ไม่ใช่ค่าที่วัดได้จริง (ต้องดูออกโดยไม่ต้องอ่านคำอธิบาย)
    ctx.setLineDash(dashed.includes(si) ? [5, 4] : []);
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
    ctx.setLineDash([]); // คืนค่าเดิม ไม่ให้เส้นประเลยไปถึงจุดข้อมูลและชุดถัดไป

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
        return `${s.label}: <b>${Number.isFinite(v) ? fmtValue(v, unit) : '—'}</b>`;
      })
      .join('<br>');
    return { html: `${label}<br>${lines}`, x: xAt(i), y: box.y };
  });

  if (active.length >= 2) {
    const legend = document.createElement('div');
    legend.innerHTML = legendHtml(
      active.map((s, i) => ({ label: s.label, color: colorAt(i) }))
    );
    container.appendChild(legend.firstElementChild);
  }

  onResize(canvas, () => line(container, series, opts));
}

// ─────────────────────────────────────────────────────────────
/**
 * โดนัท — ค่าเริ่มต้นคือสัดส่วนตามขนาดดอก (ข้อมูลมีลำดับ จึงใช้ไล่เฉดสีเดียว)
 *
 * order/ramp กำหนดเองได้ เพื่อใช้กับหมวดอื่นที่ไม่มีลำดับ เช่นสัดส่วนสต็อกระหว่างคลัง
 * ผู้เรียกเดิมไม่ได้ส่งมา จึงยังได้ผลเหมือนเดิมทุกประการ
 */
export function donut(container, mix, opts = {}) {
  const order = opts.order ?? ['XXL', 'XL', 'L', 'M', 'S', 'XS'];
  const ramp = opts.ramp ?? 'size';
  // โดนัทถูกใช้กับทั้งน้ำหนักดอกและเงิน — ไม่รับหน่วยจะได้ "17,299 kg" จากยอด 17.3 ล้านบาท
  const unit = opts.unit ?? 'g';
  const values = order.map((k) => mix?.[k] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);

  const height = opts.height ?? 210;
  const { canvas, setup } = prepare(container, height);
  if (!setup) return;
  const { ctx, w, h } = setup;

  if (!total) return drawEmpty(ctx, w, h);

  const p = palette();
  const arc = ramp === 'cat' ? p.cats : p.sizes;
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

    ctx.fillStyle = arc[i];
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
  ctx.font = chartFont(17, '600');
  ctx.fillText(fmtValue(total, unit), cx, cy - 6);
  ctx.font = FONT_SM();
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
      html: `${hit.key}<br><b>${fmtValue(hit.value, unit)}</b> · ${hit.share.toFixed(1)}%`,
      x: mx,
      y: my,
    };
  });

  const legend = document.createElement('div');
  legend.innerHTML = legendHtml(
    order
      .map((key, i) => ({ label: key, color: arc[i], value: values[i] }))
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
  const box = { x: 54, y: 12, w: w - 66, h: h - 46 };
  const max = Math.max(...data.flatMap((r) => [r[aKey] ?? 0, r[bKey] ?? 0]), 1);
  // กราฟนี้เป็นน้ำหนักดอกเสมอ (ขนออก↔รับเข้า) จึงบอกหน่วยที่ป้ายบนสุดเหมือนกราฟอื่น
  const axis = axisUnit('g', max);
  const top = drawYAxis(ctx, box, max, { div: axis.div, unitLabel: axis.label });

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

  // ป้ายแกน X — วัดความกว้างจริงแล้วข้ามอันที่จะทับกัน
  ctx.font = FONT_SM();
  ctx.fillStyle = p.inkMute;
  ctx.textBaseline = 'top';
  // กราฟแท่งเหมือน stackedBars — ป้ายอยู่กึ่งกลางแท่ง ไม่ดันหัวท้ายไปชิดขอบกรอบ
  drawXLabels(
    ctx,
    box,
    data.map((row, i) => ({ x: box.x + slot * (i + 0.5), text: fmtDate(row.date) })),
    box.y + box.h + 8,
    10,
    { center: true, bounds: [2, w - 2] }
  );

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
/**
 * แท่งซ้อนแนวตั้ง — x = ช่วงเวลา/ครอป, ชั้นในแท่ง = หมวด (สายพันธุ์ / ขนาดดอก)
 *
 * โหมด normalize ทำให้ทุกแท่งสูงเท่ากันแล้วอ่านเป็นสัดส่วน 100%
 * ใช้ตอบคำถาม "สัดส่วนขนาดดอกเปลี่ยนไปไหม" ซึ่งดูจากปริมาณดิบไม่ออก
 *
 * @param {HTMLElement} container
 * @param {{key:string, sub?:string, parts:Record<string,number>,
 *          detail?:Record<string,{label:string,value:number}[]>}[]} rows
 * `sub` = ป้ายบรรทัดที่สองใต้แกน x
 * `detail[หมวด]` = ที่มาของหมวดนั้นใน tooltip เรียงมากไปน้อย (ยอดต้องบวกได้เท่าหมวดแม่)
 * ใช้กับกรณีที่แท่งเป็นยอดรวมของหลายอย่างจนป้ายใต้แกนเขียนแทนไม่ได้
 * เช่นผลผลิตรวมรายเดือน ที่สายพันธุ์เดียวถูกทริมจากหลายครอป
 * ramp เลือกชุดสี — 'cat' สำหรับหมวดที่ไม่มีลำดับ (สายพันธุ์),
 * 'size' สำหรับขนาดดอกซึ่งมีลำดับจึงต้องใช้ไล่เฉดสีเดียว,
 * 'size3' สำหรับกราฟที่ยุบขนาดดอกเหลือ 3 กลุ่ม (สามขั้นที่แยกกันออกจริง ไม่ใช่สามขั้นแรก)
 * เลือกที่นี่ไม่ใช่ที่ผู้เรียก เพราะสีต้องอ่านจาก tokens.css ตอนวาดเสมอ
 * (ผู้เรียกส่ง hex มาเองไม่ได้ — สลับธีมแล้วจะไม่เปลี่ยนตาม)
 *
 * @param {{keys:string[], ramp?:'cat'|'size'|'size3', colors?:string[], height?:number,
 *          normalize?:boolean, unit?:string, max?:number,
 *          labelFormat?:'month'|'date'|'raw'}} opts
 */
export function stackedBars(container, rows, opts = {}) {
  const {
    keys = [],
    colors,
    ramp = 'cat',
    height = 220,
    normalize = false,
    unit = 'g',
    max: topN = 24,
    labelFormat = 'raw',
    onSelect = null,
  } = opts;

  const data = rows.slice(-topN);

  const { canvas, setup } = prepare(container, height);
  if (!setup) return; // กว้าง 0 = ยังไม่เข้า DOM ผู้เรียกต้องวาดใหม่ทีหลัง
  const { ctx, w, h } = setup;

  const totals = data.map((r) => keys.reduce((t2, k) => t2 + (r.parts?.[k] || 0), 0));
  if (!data.length || !hasData(totals)) return drawEmpty(ctx, w, h);

  const p = palette();
  const series = colors ?? (ramp === 'size3' ? p.sizes3 : ramp === 'size' ? p.sizes : p.cats);
  // ช่องแกน Y กว้างขึ้นเมื่อป้ายบนสุดมีหน่วยต่อท้าย — โหมดสัดส่วนใช้ "100%" ซึ่งสั้นกว่า
  const box = { x: normalize ? 46 : 54, y: 12, w: w - (normalize ? 58 : 66), h: h - 52 };

  /* โหมดสัดส่วนใช้แกน 0–100 คงที่ ไม่ต้องหา max จากข้อมูล
   * ส่วนโหมดปริมาณต้องบอกหน่วยที่ป้ายบนสุด ไม่งั้น "200k" อ่านไม่ออกว่ากรัมหรือกิโล */
  const axisMax = Math.max(...totals, 1);
  const axis = normalize ? { div: 1, label: '%' } : axisUnit(unit, axisMax);
  const top = drawYAxis(ctx, box, normalize ? 100 : axisMax, {
    div: axis.div,
    unitLabel: axis.label,
  });

  const slot = box.w / data.length;
  const barW = Math.max(3, Math.min(38, slot - GAP * 2));
  const hits = [];

  data.forEach((row, i) => {
    const cx = box.x + slot * (i + 0.5);
    const x = cx - barW / 2;
    const total = totals[i];
    if (total > 0) {
      // ไล่จากฐานขึ้นบน — เก็บไว้ว่าชั้นบนสุดคือชั้นไหน เพื่อมนเฉพาะปลายด้านข้อมูล
      const stack = keys
        .map((k, ki) => ({ key: k, value: row.parts?.[k] || 0, color: series[ki % series.length] }))
        .filter((s) => s.value > 0);

      let acc = 0;
      stack.forEach((seg, si) => {
        const value = normalize ? (seg.value / total) * 100 : seg.value;
        const segH = (value / top) * box.h;
        const y = box.y + box.h - ((acc + value) / top) * box.h;
        ctx.fillStyle = seg.color;
        if (si === stack.length - 1) {
          roundedTopRect(ctx, x, y, barW, segH, 4);
        } else {
          // เว้นช่องว่างสีพื้น 2px ระหว่างชั้น ให้แยกออกจากกันได้โดยไม่ต้องมีเส้นขอบ
          ctx.fillRect(x, y, barW, Math.max(1, segH - GAP));
        }
        acc += value;
      });
    }
    hits.push({ x0: cx - slot / 2, x1: cx + slot / 2, row, cx, total });
  });

  ctx.font = FONT_SM();
  ctx.fillStyle = p.inkMute;
  ctx.textBaseline = 'top';

  const labelOf = (row) =>
    labelFormat === 'month' ? fmtMonth(row.key) : labelFormat === 'date' ? fmtDate(row.key) : row.key;

  /* ตัดป้ายให้พอดี "ช่องของแท่งตัวเอง" โดยวัดความกว้างจริง ไม่ใช่ตัดตายตัวที่ 14 ตัวอักษร
   *
   * ป้ายที่ยาวเกินช่องจะถูก drawXLabels ข้ามทิ้ง — ที่ 1280px ตัวอักษรขนาดปกติ
   * ชื่อครอปยาวเกินช่องไปเล็กน้อย ทำให้หายไปครึ่งหนึ่ง (เหลือ 5 จาก 10 แท่ง)
   * ตัดเองก่อนจึงได้ครบทุกแท่ง และจอกว้าง ๆ ก็ได้ชื่อเต็มโดยไม่ถูกตัดที่ 14 ตัวเปล่า ๆ
   *
   * ถ้าช่องแคบจนเหลือไม่ถึง 6 ตัวอักษร ปล่อยให้ drawXLabels ข้ามไปดีกว่า
   * เพราะ "G…" สิบอันเรียงกันบอกอะไรไม่ได้เลย */
  const fitLabel = (raw) => {
    const text = String(raw ?? '');
    /* ต้องเหลือช่องไฟมากกว่า minGap ของ drawXLabels (10px) จริง ๆ ไม่ใช่เท่ากันพอดี
     * เพราะเงื่อนไขการชนใช้ `<` ไม่ใช่ `<=` — พอดีเป๊ะแปลว่าชน แล้วป้ายจะถูกข้าม */
    const max = slot - 12;
    if (!text || ctx.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 6 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return s.length > 6 ? `${s}…` : truncate(text, 14);
  };

  /* กราฟแท่ง = ป้ายอยู่กึ่งกลางแท่งของตัวเองทุกอัน ไม่ดันหัวท้ายไปชิดขอบกรอบ
   * (ดูเหตุผลใน drawXLabels — การดันไปชิดขอบทำให้ป้ายของแท่งที่ 2 กับรองสุดท้ายหายไป)
   * bounds กันตัวหนังสือล้นขอบ canvas ตอนแท่งแรก/สุดท้ายอยู่ใกล้ขอบมาก */
  const xLabelOpts = { center: true, bounds: [2, w - 2] };

  drawXLabels(
    ctx,
    box,
    data.map((row, i) => ({ x: box.x + slot * (i + 0.5), text: fitLabel(labelOf(row)) })),
    box.y + box.h + 8,
    10,
    xLabelOpts
  );

  /* ป้ายบรรทัดที่สอง (เช่นวันที่ทริมใต้ชื่อครอป) วาดแยกอีกรอบ
   * ให้ drawXLabels ตรวจการชนของตัวเองใหม่ ไม่ใช่ใช้ผลของบรรทัดแรก
   * เพราะข้อความยาวไม่เท่ากัน อันที่รอดบรรทัดบนอาจชนกันในบรรทัดล่าง */
  if (data.some((r) => r.sub)) {
    drawXLabels(
      ctx,
      box,
      data.map((row, i) => ({ x: box.x + slot * (i + 0.5), text: fitLabel(row.sub ?? '') })),
      box.y + box.h + 22,
      10,
      xLabelOpts
    );
  }

  attachTooltip(container, canvas, (mx) => {
    const hit = hits.find((s) => mx >= s.x0 && mx <= s.x1);
    if (!hit || !hit.total) return null;

    const fmt = (v) => fmtValue(v, unit);
    const share = (v) => pct((v / hit.total) * 100);
    const row = (html) => `<span class="chart-tip__row">${html}</span>`;
    const sub = (html) => `<span class="chart-tip__sub">${html}</span>`;

    /* หมวดหนึ่งอาจมาจากหลายที่ (เช่นสายพันธุ์เดียวถูกทริมจากหลายครอปในเดือนเดียว)
     * ที่มาเดียวเขียนต่อท้ายบรรทัดเดิมพอ · หลายที่ต้องแตกเป็นบรรทัดย่อย **ครบทุกอัน**
     * ไม่ยุบเป็น "อีก N อัน" เพราะผู้ใช้ต้องการเห็นทุกครอปที่ทริมในเดือนนั้นจริง ๆ
     * (ยอมให้กล่องยาวขึ้น ดีกว่าต้องไปเปิดตารางข้างล่างเพื่อดูอีกสองครอปที่เหลือ)
     *
     * % ของบรรทัดย่อยคิดจากยอดรวมของทั้งแท่งเหมือนบรรทัดแม่ บวกกันแล้วต้องได้ % ของแม่พอดี
     *
     * ลำดับบรรทัด: หมวดที่ไม่มีลำดับ (สายพันธุ์) เรียงมากไปน้อยเพื่ออ่านเป็นการจัดอันดับ
     * ส่วนหมวดที่มีลำดับ (ขนาดดอก) ต้องคงลำดับเดิมไว้ให้ตรงกับชั้นในแท่งและ legend
     * ไม่งั้นจะได้ "XS" มาก่อน "S" ในเดือนที่ XS เยอะกว่า ซึ่งอ่านแล้วสะดุดทุกครั้ง */
    const ordinal = ramp === 'size' || ramp === 'size3';
    const entries = keys
      .map((k, ki) => ({ k, v: hit.row.parts?.[k] || 0, c: series[ki % series.length] }))
      .filter((s) => s.v > 0);
    const lines = [];
    for (const s of ordinal ? entries : entries.sort((a, b) => b.v - a.v).slice(0, 8)) {
      const items = hit.row.detail?.[s.k] ?? [];
      const inline = items.length === 1 ? ` · ${esc(items[0].label)}` : '';
      lines.push(
        row(
          `<span style="color:${s.c}">■</span> ${esc(s.k)}: <b>${fmt(s.v)}</b> (${share(
            s.v
          )})${inline}`
        )
      );
      if (items.length < 2) continue;
      for (const it of items) {
        lines.push(sub(`${esc(it.label)}: <b>${fmt(it.value)}</b> (${share(it.value)})`));
      }
    }

    const head = hit.row.sub ? `${esc(labelOf(hit.row))} · ${esc(hit.row.sub)}` : esc(labelOf(hit.row));
    return {
      html: `${row(head)}${row(`${t('label.total')}: <b>${fmt(hit.total)}</b>`)}${lines.join('')}`,
      x: hit.cx,
      y: box.y,
    };
  });

  /* กดที่แท่งเพื่อเปิดรายละเอียด — ผู้เรียกเป็นคนตัดสินว่ารายละเอียดคืออะไร
   *
   * ใช้ hits ชุดเดียวกับ tooltip แต่ **ต้องโดนแท่งที่มีข้อมูลจริง** ต่างจาก tooltip
   * ที่คงค่าเดิมไว้ตอนชี้โดนช่องว่างระหว่างแท่ง (ตั้งใจ กันกระพริบ) — การกดพลาด
   * แล้วเปิดเดือนที่ไม่ได้เล็งเป็นคนละเรื่องกับ tooltip ที่ค้างภาพเดิมไว้ครู่หนึ่ง
   *
   * บนมือถือแท่งกว้างแค่ ~15px แตะให้โดนยาก ผู้เรียกจึงควรมีทางที่สองที่เป็นปุ่มจริง
   * ให้ด้วยเสมอ (pages/supply.js ทำเป็นแถวปุ่มเดือนใต้กราฟ) */
  if (typeof onSelect === 'function') {
    const hitAt = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      return hits.find((s) => s.total > 0 && mx >= s.x0 && mx <= s.x1);
    };
    canvas.addEventListener('mousemove', (e) => {
      canvas.style.cursor = hitAt(e) ? 'pointer' : '';
    });
    canvas.addEventListener('click', (e) => {
      const hit = hitAt(e);
      if (hit) onSelect(hit.row);
    });
  }

  // มี ≥2 หมวดต้องมี legend เสมอ — ห้ามให้สีเป็นตัวบอกตัวตนเพียงอย่างเดียว
  const used = keys.filter((k) => data.some((r) => (r.parts?.[k] || 0) > 0));
  if (used.length >= 2) {
    const legend = document.createElement('div');
    legend.innerHTML = legendHtml(
      used.map((k) => ({ label: k, color: series[keys.indexOf(k) % series.length] }))
    );
    if (legend.firstElementChild) container.appendChild(legend.firstElementChild);
  }

  onResize(canvas, () => stackedBars(container, rows, opts));
}

/** แท่งซ้อนแบบ 100% — อ่านสัดส่วนล้วน ไม่ใช่ปริมาณ */
export function pctStackedBars(container, rows, opts = {}) {
  return stackedBars(container, rows, { ...opts, normalize: true });
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
    ['clone', 'veg', p.stages[0]],
    ['veg', 'flower', p.stages[1]],
    ['flower', 'harvest', p.stages[2]],
    ['harvest', 'dryReady', p.stages[3]],
  ];

  ctx.font = FONT_SM();
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
    { label: t('label.veg'), color: p.stages[0] },
    { label: t('label.flowerPhase'), color: p.stages[1] },
    { label: t('label.harvest'), color: p.stages[2] },
    { label: t('label.dryReady'), color: p.stages[3] },
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
