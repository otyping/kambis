/**
 * analysis.js — Data Analysis engine
 *
 * รันทุกครั้งที่มีการอัปเดตข้อมูล (บังคับตาม CLAUDE.md ข้อ 2)
 *
 * หลักการ:
 *   1. คำนวณใหม่เสมอ ไม่เชื่อคอลัมน์ Total/% ในชีต
 *   2. ห้ามซ่อมข้อมูลเงียบ ๆ — ค่าดิบเก็บไว้ ค่าที่คำนวณใหม่แสดงผล ความต่างออกเป็น finding
 *   3. finding ไม่บล็อกการแสดงผล ข้อมูลยังขึ้นตามปกติแต่ติดธงกำกับ
 */
import { SIZE_KEYS, NON_FLOWER_KEYS, sum, periodOrder } from './normalize.js';

const TOLERANCE_G = 0.5; // ยอมรับความคลาดเคลื่อนจากการปัดเศษ
const PCT_TOLERANCE = 0.6; // % ที่ชีตคำนวณมักปัดทศนิยม
const FUTURE_MONTHS = 12;
const OUTLIER_FACTOR = 3;
const CROSS_SOURCE_TOLERANCE_PCT = 2; // ขนออก vs รับเข้า ต่างกันได้ไม่เกิน 2%
const SUPPLY_STALE_DAYS = 30; // วัสดุที่ไม่มีใครบันทึกนานกว่านี้ = น่าสงสัยว่าลืมอัปเดต

const SEVERITY_WEIGHT = { critical: 12, warning: 4, info: 1 };

/**
 * ตัวช่วยสร้าง finding ให้หน้าตาเหมือนกันทุกที่
 *
 * `gid` เติมทีหลังใน analyze() โดยค้นจากชื่อ tab — ใช้ทำลิงก์ตรงไปยัง tab นั้น
 * `related` ใช้กับการตรวจข้ามรายงาน ที่ต้องเปิดดูหลายชีตถึงจะเข้าใจปัญหา
 */
function finding(id, severity, fields) {
  return {
    id,
    severity,
    source: fields.source ?? null,
    tab: fields.tab ?? null,
    gid: null,
    row: fields.row ?? null,
    field: fields.field ?? null,
    messageTh: fields.messageTh,
    messageEn: fields.messageEn,
    expected: fields.expected ?? null,
    actual: fields.actual ?? null,
    delta: fields.delta ?? null,
    related: fields.related ?? [],
  };
}

/**
 * สร้างตัวค้นหา gid ของ tab จากชื่อ
 * ใช้เติม gid ให้ finding ทุกอันตอนท้าย เพื่อให้ front-end ทำลิงก์
 * แบบ …/edit?gid=N#gid=N ที่เปิดตรงไปยัง tab ที่มีปัญหาได้เลย
 */
function makeGidResolver(sources) {
  // Map ซ้อนแทนการต่อ key ด้วยตัวคั่น — ชื่อ tab มีอักขระอะไรก็ไม่ชนกัน
  // และไม่ทำให้ไฟล์กลายเป็น binary ในสายตาเครื่องมือค้นหา
  const byKey = new Map();
  for (const [key, source] of Object.entries(sources)) {
    const tabs = new Map();
    for (const tab of source?.tabs ?? []) {
      if (tab.name) tabs.set(tab.name, tab.gid ?? null);
    }
    byKey.set(key, tabs);
  }
  return (sourceKey, tabName) =>
    sourceKey && tabName ? (byKey.get(sourceKey)?.get(tabName) ?? null) : null;
}

/** แปลง Set ของชื่อ tab เป็นรายการ related (จำกัดจำนวนไม่ให้ล้นจอ) */
function relatedTabs(sourceKey, tabNames, limit = 4) {
  return [...tabNames].slice(0, limit).map((tab) => ({ source: sourceKey, tab, gid: null }));
}

const fmt = (n) =>
  n === null || n === undefined || !Number.isFinite(n)
    ? '—'
    : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

// ─────────────────────────────────────────────────────────────
// Structural — เข้าถึงข้อมูลได้ไหม แปลงได้ไหม
// ─────────────────────────────────────────────────────────────
function checkStructural(source, out) {
  if (source.status === 'error') {
    out.push(
      finding('structural.sourceFailed', 'critical', {
        source: source.key,
        messageTh: `ดึงข้อมูล "${source.titleTh}" ไม่สำเร็จ: ${source.error || 'ไม่ทราบสาเหตุ'}`,
        messageEn: `Failed to load "${source.titleEn}": ${source.error || 'unknown error'}`,
      })
    );
    return;
  }

  if (source.status === 'stale') {
    out.push(
      finding('structural.stale', 'warning', {
        source: source.key,
        messageTh: `"${source.titleTh}" ใช้ข้อมูลจากแคช (${source.tabsStale} tab ดึงสดไม่ได้)`,
        messageEn: `"${source.titleEn}" served from cache (${source.tabsStale} tab(s) unreachable)`,
      })
    );
  }

  /* ค้นรายชื่อแท็บสดไม่สำเร็จ กำลังใช้รายชื่อที่บันทึกไว้ครั้งก่อน
   *
   * severity เป็น info ไม่ใช่ warning เพราะเน็ตกระตุกครั้งเดียวไม่ควรฉุดคะแนน
   * คุณภาพข้อมูล ซึ่งควรสะท้อนว่า "ตัวเลขในชีตขัดกันเองไหม" ไม่ใช่ "เน็ตดีไหม"
   * ส่วนความมองเห็นแก้ด้วยแถบเตือนบนหัวเว็บ (ui/notices.js) ซึ่งตรงกว่า
   *
   * แต่ต้องมีร่องรอยไว้ที่นี่ด้วย เพราะมันแปลว่า **แท็บที่เพิ่งเพิ่มในชีตรอบนี้
   * ยังไม่ถูกอ่าน** — ยอดรวมจึงไม่ขยับด้วยเหตุผลที่ไม่ใช่ข้อมูล */
  if (source.discovery === 'config') {
    out.push(
      finding('structural.tabDiscoveryFallback', 'info', {
        source: source.key,
        messageTh:
          `ค้นรายชื่อแท็บสดของ "${source.titleTh}" ไม่สำเร็จ (${source.discoveryError || 'ไม่ทราบสาเหตุ'}) ` +
          'กำลังใช้รายชื่อที่บันทึกไว้ครั้งก่อน — แท็บที่เพิ่งเพิ่มในชีตรอบนี้จะยังไม่ถูกอ่าน',
        messageEn:
          `Could not list tabs of "${source.titleEn}" live (${source.discoveryError || 'unknown'}). ` +
          'Falling back to the saved tab list — tabs added since then are not read.',
      })
    );
  }

  if (source.rowCount === 0) {
    out.push(
      finding('structural.noRows', 'critical', {
        source: source.key,
        messageTh: `"${source.titleTh}" ไม่มีแถวข้อมูลเลย`,
        messageEn: `"${source.titleEn}" produced no data rows`,
      })
    );
  }

  for (const w of source.warnings || []) {
    out.push(
      finding('structural.parserWarning', 'warning', {
        source: source.key,
        tab: w.tab,
        messageTh: w.message,
        messageEn: w.message,
      })
    );
  }

  for (const tab of source.tabs || []) {
    if (tab.fetchStatus === 'error') {
      out.push(
        finding('structural.tabFailed', 'warning', {
          source: source.key,
          tab: tab.name,
          messageTh: `tab "${tab.name}" ดึงไม่สำเร็จ: ${tab.fetchError || 'ไม่ทราบสาเหตุ'}`,
          messageEn: `Tab "${tab.name}" failed to load: ${tab.fetchError || 'unknown'}`,
        })
      );
    }
    if (tab.layoutConfidence !== null && tab.layoutConfidence !== undefined && tab.layoutConfidence < 0.6) {
      out.push(
        finding('structural.layoutAmbiguous', 'warning', {
          source: source.key,
          tab: tab.name,
          messageTh: `โครงคอลัมน์ของ tab "${tab.name}" ไม่ชัดเจน (ตรงกับยอดรวมเพียง ${Math.round(tab.layoutConfidence * 100)}%)`,
          messageEn: `Column layout for tab "${tab.name}" is ambiguous (only ${Math.round(tab.layoutConfidence * 100)}% of rows reconcile)`,
        })
      );
    }

    checkTabProducedData(source, tab, out);
  }
}

/**
 * ชื่อแท็บที่เห็นแล้วรู้ว่าเป็นของเหลือ ไม่ใช่ข้อมูลที่หายไป
 * เช่นแท็บเปล่าที่ Google ตั้งชื่อให้เอง หรือแท็บที่ก๊อปมาแล้วยังไม่ได้ใช้
 */
const LEFTOVER_TAB_RE = /^(ชีต\s*\d+|Sheet\s*\d+|สำเนา|Copy of|ต้นฉบับ)/i;

/** เหตุผลที่ระบบ "ตั้งใจ" ข้ามแท็บ — ไม่ใช่ความผิดพลาด */
const EXPECTED_SKIPS = new Set(['template', 'summary']);

/**
 * แท็บนี้โหลดมาแล้วได้ข้อมูลจริงหรือเปล่า
 *
 * ทำไมต้องมี: การตรวจเดิมดูแค่ "ดึงสำเร็จไหม" กับ "โครงคอลัมน์ชัดไหม"
 * แท็บที่ดึงได้ปกติแต่ระบบอ่านข้อมูลไม่ได้เลยจึงเงียบสนิท จำนวนแท็บเพิ่มขึ้น
 * แต่ยอดรวมไม่ขยับ ผู้บริหารเห็นตัวเลขที่ขาดไปโดยไม่มีอะไรเตือน
 *
 * สำคัญ: ต้องไม่ฟ้องแท็บที่ parser ตั้งใจไม่อ่าน ไม่งั้นจะได้เสียงรบกวนเป็นสิบ ๆ อัน
 * (perCrop มีแท็บรายครอป 37 อันที่ข้อมูลจริงอยู่ใน SUMMARY SHEET — มาร์ก detailOnly ไว้)
 */
function checkTabProducedData(source, tab, out) {
  if (tab.fetchStatus === 'error') return; // มี structural.tabFailed รายงานไปแล้ว
  if (tab.detailOnly) return; // parser ตั้งใจไม่อ่านแท็บนี้ ข้อมูลจริงอยู่ที่อื่น

  if (tab.skipped) {
    const expected = EXPECTED_SKIPS.has(tab.skipped);
    out.push(
      finding('structural.tabIgnored', expected ? 'info' : 'warning', {
        source: source.key,
        tab: tab.name,
        messageTh: expected
          ? `ข้าม tab "${tab.name}" ตามที่ตั้งใจไว้ (${tab.skipped}) — ไม่ได้นับรวมในยอด`
          : `tab "${tab.name}" ถูกข้ามทั้งแท็บเพราะชื่อไม่ตรงรูปแบบที่ระบบรู้จัก (${tab.skipped}) ` +
            'ถ้าเป็นแท็บข้อมูลจริง ตัวเลขในแท็บนี้จะหายไปจากรายงานทั้งหมด',
        messageEn: expected
          ? `Tab "${tab.name}" skipped as intended (${tab.skipped}) — excluded from totals`
          : `Tab "${tab.name}" was skipped entirely because its name does not match a known pattern (${tab.skipped}). ` +
            'If it holds real data, none of it reaches the dashboard.',
        field: tab.skipped,
      })
    );
    return;
  }

  if ((tab.rowCount ?? 0) > 0) return;

  const leftover = LEFTOVER_TAB_RE.test(String(tab.name ?? '').trim());
  out.push(
    finding('structural.tabEmpty', leftover ? 'info' : 'warning', {
      source: source.key,
      tab: tab.name,
      messageTh: leftover
        ? `tab "${tab.name}" ไม่มีข้อมูลที่อ่านได้ — ดูเหมือนแท็บเปล่าที่เหลือค้างไว้ในชีต`
        : `tab "${tab.name}" โหลดได้แต่อ่านข้อมูลไม่ได้เลยสักแถว ` +
          'อาจเป็นแท็บว่าง หรือโครงสร้างไม่ตรงกับที่ระบบรู้จัก ถ้าเป็นแท็บข้อมูลจริงต้องแจ้ง dev ให้ปรับ parser',
      messageEn: leftover
        ? `Tab "${tab.name}" yielded no readable rows — looks like an empty leftover tab`
        : `Tab "${tab.name}" loaded but produced no readable rows. ` +
          'It may be empty, or its layout may differ from what the parser expects — if it holds real data, the parser needs updating.',
      expected: '> 0 แถว',
      actual: '0 แถว',
    })
  );
}

// ─────────────────────────────────────────────────────────────
// Arithmetic — ผลรวมและเปอร์เซ็นต์ตรงกับที่ชีตบอกไหม
// ─────────────────────────────────────────────────────────────
function checkArithmetic(source, out) {
  for (const rec of source.rows) {
    const stated = rec.raw?.statedFlowerTotal;
    if (stated !== null && stated !== undefined && rec.flowerTotal !== null) {
      const delta = rec.flowerTotal - stated;
      if (Math.abs(delta) > TOLERANCE_G) {
        out.push(
          finding('arith.flowerTotal', 'critical', {
            source: source.key,
            tab: rec.tab,
            row: rec.rowIndex,
            field: 'รวมน้ำหนักดอก',
            messageTh: `ผลรวมน้ำหนักดอกไม่ตรง: คำนวณได้ ${fmt(rec.flowerTotal)} g แต่ชีตระบุ ${fmt(stated)} g (ต่าง ${fmt(delta)} g)`,
            messageEn: `Flower total mismatch: computed ${fmt(rec.flowerTotal)} g vs sheet ${fmt(stated)} g (Δ ${fmt(delta)} g)`,
            expected: rec.flowerTotal,
            actual: stated,
            delta,
          })
        );
      }
    }

    const statedNon = rec.raw?.statedNonFlowerTotal;
    if (statedNon !== null && statedNon !== undefined && rec.nonFlowerTotal !== null) {
      const delta = rec.nonFlowerTotal - statedNon;
      if (Math.abs(delta) > TOLERANCE_G) {
        out.push(
          finding('arith.nonFlowerTotal', 'warning', {
            source: source.key,
            tab: rec.tab,
            row: rec.rowIndex,
            field: 'รวมน้ำหนักที่ไม่ใช่ดอก',
            messageTh: `ผลรวมของที่ไม่ใช่ดอกไม่ตรง: คำนวณได้ ${fmt(rec.nonFlowerTotal)} g แต่ชีตระบุ ${fmt(statedNon)} g`,
            messageEn: `Non-flower total mismatch: computed ${fmt(rec.nonFlowerTotal)} g vs sheet ${fmt(statedNon)} g`,
            expected: rec.nonFlowerTotal,
            actual: statedNon,
            delta,
          })
        );
      }
    }

    // perCrop มีคอลัมน์ "ยอดน้ำหนักรวม" ซ้ำกับ "Total (g)" — ต้องตรงกัน
    const grand = rec.raw?.statedGrandTotal;
    if (
      grand !== null &&
      grand !== undefined &&
      rec.raw?.statedFlowerTotal !== null &&
      rec.raw?.statedFlowerTotal !== undefined
    ) {
      const delta = grand - rec.raw.statedFlowerTotal;
      if (Math.abs(delta) > TOLERANCE_G) {
        out.push(
          finding('arith.grandTotal', 'critical', {
            source: source.key,
            tab: rec.tab,
            row: rec.rowIndex,
            field: 'ยอดน้ำหนักรวม',
            messageTh: `ครอป ${rec.crop}: คอลัมน์ "ยอดน้ำหนักรวม" (${fmt(grand)} g) ไม่ตรงกับ "Total" (${fmt(rec.raw.statedFlowerTotal)} g) ต่างกัน ${fmt(delta)} g`,
            messageEn: `Crop ${rec.crop}: "ยอดน้ำหนักรวม" (${fmt(grand)} g) disagrees with "Total" (${fmt(rec.raw.statedFlowerTotal)} g) by ${fmt(delta)} g`,
            expected: rec.raw.statedFlowerTotal,
            actual: grand,
            delta,
          })
        );
      }
    }

    // >M total (เกรดพรีเมียม)
    const statedPremium = rec.raw?.statedPremiumTotal;
    if (statedPremium !== null && statedPremium !== undefined && rec.premiumTotal !== null) {
      const delta = rec.premiumTotal - statedPremium;
      if (Math.abs(delta) > TOLERANCE_G) {
        out.push(
          finding('arith.premiumTotal', 'warning', {
            source: source.key,
            tab: rec.tab,
            row: rec.rowIndex,
            field: 'รวม >M',
            messageTh: `ผลรวมเกรด >M ไม่ตรง: คำนวณได้ ${fmt(rec.premiumTotal)} g แต่ชีตระบุ ${fmt(statedPremium)} g`,
            messageEn: `>M total mismatch: computed ${fmt(rec.premiumTotal)} g vs sheet ${fmt(statedPremium)} g`,
            expected: rec.premiumTotal,
            actual: statedPremium,
            delta,
          })
        );
      }
    }
  }

  // แถว Total ของแต่ละ tab ต้องเท่ากับผลรวมของแถวข้อมูลใน tab นั้น
  const byTab = new Map();
  for (const rec of source.rows) {
    if (!byTab.has(rec.tab)) byTab.set(rec.tab, []);
    byTab.get(rec.tab).push(rec);
  }
  for (const tab of source.tabs || []) {
    const stated = tab.statedTotal;
    if (!stated) continue;
    const recs = byTab.get(tab.name) || [];
    if (recs.length === 0) continue;

    const computedFlower = sum(recs.map((r) => r.flowerTotal));
    if (stated.flowerTotal !== null && stated.flowerTotal !== undefined) {
      const delta = computedFlower - stated.flowerTotal;
      if (Math.abs(delta) > TOLERANCE_G) {
        out.push(
          finding('arith.tabTotal', 'critical', {
            source: source.key,
            tab: tab.name,
            row: stated.rowIndex,
            field: 'แถว Total',
            messageTh: `แถว Total ของ "${tab.name}" ไม่ตรงกับผลรวมรายแถว: คำนวณได้ ${fmt(computedFlower)} g แต่ชีตระบุ ${fmt(stated.flowerTotal)} g`,
            messageEn: `Total row of "${tab.name}" disagrees with the sum of its rows: computed ${fmt(computedFlower)} g vs sheet ${fmt(stated.flowerTotal)} g`,
            expected: computedFlower,
            actual: stated.flowerTotal,
            delta,
          })
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Range — เปอร์เซ็นต์และน้ำหนักอยู่ในช่วงที่เป็นไปได้ไหม
// ─────────────────────────────────────────────────────────────
const PCT_LABELS = {
  premium: '>M',
  S: 'S',
  XS: 'XS',
  shake: 'Shake',
  sugarleaf: 'Sugarleaf',
  sesDok: 'เศษดอก',
  dokPan: 'ดอกปั่น',
};

function checkRange(source, out) {
  for (const rec of source.rows) {
    const pcts = rec.raw?.statedPct;
    if (pcts) {
      for (const [key, value] of Object.entries(pcts)) {
        if (value === null || value === undefined) continue;
        if (value > 100 + PCT_TOLERANCE || value < 0) {
          out.push(
            finding('range.percent', 'warning', {
              source: source.key,
              tab: rec.tab,
              row: rec.rowIndex,
              field: `% ${PCT_LABELS[key] || key}`,
              messageTh: `เปอร์เซ็นต์ ${PCT_LABELS[key] || key} = ${fmt(value)}% ซึ่งอยู่นอกช่วง 0–100`,
              messageEn: `${PCT_LABELS[key] || key} percentage = ${fmt(value)}%, outside the valid 0–100 range`,
              expected: '0–100',
              actual: value,
            })
          );
        }
      }
    }

    for (const key of SIZE_KEYS) {
      const v = rec.sizes[key];
      if (v !== null && v < 0) {
        out.push(
          finding('range.negative', 'warning', {
            source: source.key,
            tab: rec.tab,
            row: rec.rowIndex,
            field: key,
            messageTh: `น้ำหนักขนาด ${key} ติดลบ (${fmt(v)} g)`,
            messageEn: `Size ${key} has a negative weight (${fmt(v)} g)`,
            actual: v,
          })
        );
      }
    }
    for (const key of NON_FLOWER_KEYS) {
      const v = rec.nonFlower[key];
      if (v !== null && v < 0) {
        out.push(
          finding('range.negative', 'warning', {
            source: source.key,
            tab: rec.tab,
            row: rec.rowIndex,
            field: key,
            messageTh: `น้ำหนัก ${key} ติดลบ (${fmt(v)} g)`,
            messageEn: `${key} has a negative weight (${fmt(v)} g)`,
            actual: v,
          })
        );
      }
    }
  }

  // outlier: ใช้กฎ Tukey แบบเข้ม (Q3 + 3×IQR) แทนการเทียบกับค่ากลางตรง ๆ
  // เพราะข้อมูลชุดนี้เบ้ขวาโดยธรรมชาติ การขนของรอบใหญ่ไม่ใช่ความผิดปกติ
  const totals = source.rows.map((r) => r.flowerTotal).filter((v) => v !== null && v > 0);
  if (totals.length >= 12) {
    const sorted = [...totals].sort((a, b) => a - b);
    const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    const q1 = quantile(0.25);
    const q3 = quantile(0.75);
    const iqr = q3 - q1;
    const limit = q3 + OUTLIER_FACTOR * iqr;

    if (iqr > 0) {
      for (const rec of source.rows) {
        if (rec.flowerTotal !== null && rec.flowerTotal > limit) {
          out.push(
            finding('range.outlier', 'info', {
              source: source.key,
              tab: rec.tab,
              row: rec.rowIndex,
              field: 'รวมน้ำหนักดอก',
              messageTh: `ค่าสูงผิดปกติ ${fmt(rec.flowerTotal)} g (เกินเกณฑ์ ${fmt(limit)} g จากการกระจายตัวของข้อมูลชุดนี้)`,
              messageEn: `Unusually high value ${fmt(rec.flowerTotal)} g (above the ${fmt(limit)} g threshold for this dataset's distribution)`,
              expected: `≤ ${fmt(limit)}`,
              actual: rec.flowerTotal,
            })
          );
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Units — ป้ายหน่วยตรงกับขนาดของตัวเลขไหม
// ─────────────────────────────────────────────────────────────
function checkUnits(source, out) {
  // ฟอร์มขนย้ายเขียนหัวคอลัมน์เป็น (kg) แต่กรอกเป็นกรัม
  // ตรวจจากขนาดตัวเลข: ถ้าค่ามัธยฐาน > 500 แปลว่าเป็นกรัมแน่นอน (500 kg ต่อแถวเป็นไปไม่ได้)
  if (source.key !== 'outbound' && source.key !== 'inbound') return;

  const totals = source.rows.map((r) => r.flowerTotal).filter((v) => v !== null && v > 0);
  if (totals.length < 3) return;
  const sorted = [...totals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median > 500) {
    out.push(
      finding('units.mismatch', 'warning', {
        source: source.key,
        field: 'หน่วยน้ำหนัก',
        messageTh: `หัวตารางของ "${source.titleTh}" เขียนหน่วยเป็น (kg) แต่ค่าจริงเป็นกรัม (ค่ากลาง ${fmt(median)}) — ระบบตีความเป็นกรัมทั้งหมด`,
        messageEn: `"${source.titleEn}" headers are labelled (kg) but the values are grams (median ${fmt(median)}) — interpreted as grams throughout`,
        expected: 'kg',
        actual: 'g',
      })
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Dates — วันที่อ่านได้ไหม สมเหตุสมผลไหม
// ─────────────────────────────────────────────────────────────
function checkDates(source, out, now) {
  const futureLimit = new Date(now);
  futureLimit.setMonth(futureLimit.getMonth() + FUTURE_MONTHS);

  for (const rec of source.rows) {
    // วันที่ในรอบปลูกของ perCrop
    if (rec.cycle) {
      for (const [phase, iso] of Object.entries(rec.cycle)) {
        if (!iso) continue;
        const d = new Date(iso);
        if (d > futureLimit) {
          out.push(
            finding('date.tooFarFuture', 'warning', {
              source: source.key,
              tab: rec.tab,
              row: rec.rowIndex,
              field: phase,
              messageTh: `ครอป ${rec.crop}: วันที่ช่วง ${phase} = ${iso} ซึ่งไกลเกิน ${FUTURE_MONTHS} เดือนข้างหน้า (น่าจะพิมพ์ปีผิด: "${rec.raw?.cycleText?.[phase] ?? ''}")`,
              messageEn: `Crop ${rec.crop}: ${phase} date ${iso} is more than ${FUTURE_MONTHS} months ahead (likely a year typo: "${rec.raw?.cycleText?.[phase] ?? ''}")`,
              actual: iso,
            })
          );
        }
      }

      // ลำดับรอบปลูกต้องเรียงจากต้นไปปลาย
      const order = ['clone', 'veg', 'flower', 'harvest', 'dryReady'];
      const seq = order.map((p) => ({ p, d: rec.cycle[p] })).filter((x) => x.d);
      for (let i = 1; i < seq.length; i++) {
        if (new Date(seq[i].d) < new Date(seq[i - 1].d)) {
          out.push(
            finding('date.outOfOrder', 'warning', {
              source: source.key,
              tab: rec.tab,
              row: rec.rowIndex,
              field: seq[i].p,
              messageTh: `ครอป ${rec.crop}: ${seq[i].p} (${seq[i].d}) มาก่อน ${seq[i - 1].p} (${seq[i - 1].d})`,
              messageEn: `Crop ${rec.crop}: ${seq[i].p} (${seq[i].d}) precedes ${seq[i - 1].p} (${seq[i - 1].d})`,
              expected: `≥ ${seq[i - 1].d}`,
              actual: seq[i].d,
            })
          );
          break;
        }
      }
    }

    // แถวที่ควรมีวันที่แต่ไม่มี
    if (!rec.date && (source.key === 'sales' || source.key === 'dailyTrim')) {
      out.push(
        finding('date.missing', 'warning', {
          source: source.key,
          tab: rec.tab,
          row: rec.rowIndex,
          field: 'วันที่',
          messageTh: `แถวนี้ไม่มีวันที่ที่อ่านได้ (ค่าดิบ: "${rec.raw?.dateText ?? ''}")`,
          messageEn: `Row has no readable date (raw: "${rec.raw?.dateText ?? ''}")`,
        })
      );
    }
  }

  // ชื่อ tab กับวันที่ในหัวฟอร์มต้องตรงกัน
  for (const tab of source.tabs || []) {
    if (tab.dateFromTabName && tab.dateFromHeader && tab.dateFromTabName !== tab.dateFromHeader) {
      out.push(
        finding('date.tabHeaderMismatch', 'warning', {
          source: source.key,
          tab: tab.name,
          field: 'วันที่',
          messageTh: `tab ชื่อ "${tab.name}" (${tab.dateFromTabName}) แต่ในฟอร์มเขียนวันที่ ${tab.dateFromHeader} — ระบบใช้วันที่ในฟอร์ม`,
          messageEn: `Tab is named "${tab.name}" (${tab.dateFromTabName}) but the form header says ${tab.dateFromHeader} — the header date is used`,
          expected: tab.dateFromTabName,
          actual: tab.dateFromHeader,
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Completeness — ข้อมูลครบไหม
// ─────────────────────────────────────────────────────────────
function checkCompleteness(source, out) {
  for (const rec of source.rows) {
    // มีน้ำหนักแต่ช่อง Total ในชีตว่าง (พบมากในชีตขายดอก)
    const stated = rec.raw?.statedFlowerTotal;
    if (rec.flowerTotal !== null && rec.flowerTotal > 0 && (stated === null || stated === undefined)) {
      out.push(
        finding('complete.missingTotal', 'warning', {
          source: source.key,
          tab: rec.tab,
          row: rec.rowIndex,
          field: 'Total Flower',
          messageTh: `แถวนี้มีน้ำหนักดอก ${fmt(rec.flowerTotal)} g แต่ช่องผลรวมในชีตถูกเว้นว่าง`,
          messageEn: `Row carries ${fmt(rec.flowerTotal)} g of flower but the sheet's total cell is blank`,
          expected: rec.flowerTotal,
          actual: null,
        })
      );
    }

    // รายงานวัสดุสิ้นเปลืองไม่มีสายพันธุ์โดยธรรมชาติ — ถ้าไม่กันไว้จะได้ finding
    // หลักพันจากแถว log ทุกแถว จนการ์ดคุณภาพข้อมูลใช้งานไม่ได้
    if (!rec.strain && source.key !== 'perCrop' && source.kind !== 'supply') {
      out.push(
        finding('complete.missingStrain', 'info', {
          source: source.key,
          tab: rec.tab,
          row: rec.rowIndex,
          field: 'สายพันธุ์',
          messageTh: 'แถวนี้ไม่ได้ระบุสายพันธุ์',
          messageEn: 'Row has no strain recorded',
        })
      );
    }

    if (!rec.crop && (source.key === 'sales' || source.key === 'outbound' || source.key === 'inbound')) {
      out.push(
        finding('complete.missingCrop', 'info', {
          source: source.key,
          tab: rec.tab,
          row: rec.rowIndex,
          field: 'ครอป',
          messageTh: 'แถวนี้ไม่ได้ระบุครอป ทำให้ตามรอยกลับไปยังแปลงปลูกไม่ได้',
          messageEn: 'Row has no crop code, so it cannot be traced back to a grow batch',
        })
      );
    }
  }

  // ชื่อสายพันธุ์เดียวกันแต่สะกดหลายแบบในต้นทาง
  // รายงานรวมเป็นรายการเดียวต่อสายพันธุ์ ไม่ใช่ทีละแถว เพื่อไม่ให้ท่วมรายการ
  const spellings = new Map();
  for (const rec of source.rows) {
    const rawText = rec.raw?.strainText;
    if (!rec.strain || !rawText) continue;
    const cleaned = String(rawText).replace(/\s+/g, ' ').trim();
    if (cleaned === rec.strain) continue;
    if (!spellings.has(rec.strain)) spellings.set(rec.strain, new Set());
    spellings.get(rec.strain).add(cleaned);
  }
  for (const [canonical, variants] of spellings) {
    const list = [...variants];
    out.push(
      finding('complete.strainSpelling', 'info', {
        source: source.key,
        field: 'สายพันธุ์',
        messageTh: `สายพันธุ์ "${canonical}" ถูกสะกด ${list.length} แบบในชีต: ${list
          .map((v) => `"${v}"`)
          .join(', ')} — ระบบรวมให้เป็นชื่อเดียวแล้ว`,
        messageEn: `Strain "${canonical}" is spelled ${list.length} different ways in the sheet: ${list
          .map((v) => `"${v}"`)
          .join(', ')} — merged under one name`,
        expected: canonical,
        actual: list.length,
      })
    );
  }

  // แถวซ้ำสนิท (วันที่+ครอป+สายพันธุ์+น้ำหนักเท่ากันทุกช่อง)
  const seen = new Map();
  for (const rec of source.rows) {
    const key = [
      rec.date,
      rec.crop,
      rec.strain,
      ...SIZE_KEYS.map((k) => rec.sizes[k]),
      ...NON_FLOWER_KEYS.map((k) => rec.nonFlower[k]),
    ].join('|');
    if (rec.flowerTotal === null && rec.nonFlowerTotal === null) continue;
    if (seen.has(key)) {
      out.push(
        finding('complete.duplicate', 'info', {
          source: source.key,
          tab: rec.tab,
          row: rec.rowIndex,
          messageTh: `แถวนี้ซ้ำกับแถว ${seen.get(key)} ทุกค่า — อาจบันทึกซ้ำ`,
          messageEn: `Row duplicates row ${seen.get(key)} exactly — possible double entry`,
        })
      );
    } else {
      seen.set(key, rec.rowIndex);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Finance — งบรายรับ-รายจ่าย (แบบฟอร์มต้นทุน)
//
// เป็นจำนวนเงินรายเดือน ไม่มีน้ำหนัก/ขนาด/สายพันธุ์ จึงใช้กฎคนละชุดกับดอกไม้
// สิ่งที่ตรวจได้คือ **ความสอดคล้องกันเองของงบ** ซึ่งเป็นหัวใจของชีตนี้:
//   งบสรุปต้องเท่ากับผลรวมของแท็บรายละเอียด · EBITDA/EBIT ต้องคำนวณกลับได้
// ─────────────────────────────────────────────────────────────

/** ต่างกันไม่เกินเท่านี้ถือว่าปัดเศษ ไม่ต้องเตือน */
const MONEY_TOL = 1;

function checkFinance(source, out) {
  const summary = source.rows.filter((r) => r.kind === 'summary');
  const detail = source.rows.filter((r) => r.kind === 'expense');

  /** ยอดรวมทั้งปีของบรรทัดหนึ่งในงบสรุป */
  const lineTotal = (line) =>
    summary.filter((r) => r.line === line).reduce((a, r) => a + (r.amount ?? 0), 0);
  const groupTotal = (group) =>
    detail.filter((r) => r.group === group).reduce((a, r) => a + (r.amount ?? 0), 0);

  if (!summary.length) {
    out.push(
      finding('finance.noSummary', 'critical', {
        source: source.key,
        messageTh: 'อ่านแท็บ "สรุป" ไม่ได้ — ตัวเลขรายได้และต้นทุนทั้งหมดมาจากแท็บนี้',
        messageEn: 'Could not read the "สรุป" tab — every revenue and cost figure comes from it',
      })
    );
    return;
  }

  /* งบสรุป vs ผลรวมรายการจริง
   *
   * เป็นการตรวจที่มีค่าที่สุดของชีตนี้ เพราะงบสรุปคือสิ่งที่ผู้บริหารเห็น
   * แต่รายละเอียดคือสิ่งที่เกิดขึ้นจริง ถ้าสองอันไม่ตรงกันแปลว่ามีรายการตกหล่น
   * หรือสูตรผลรวมในชีตครอบไม่ครบ */
  for (const [line, group, labelTh, labelEn] of [
    ['materialCost', 'growing', 'ต้นทุนวัตถุดิบ', 'Material cost'],
    ['farmExpense', 'farm', 'ค่าใช้จ่าย Farm', 'Farm expense'],
    ['officeExpense', 'office', 'ค่าใช้จ่าย Office', 'Office expense'],
  ]) {
    const stated = lineTotal(line);
    const actual = groupTotal(group);
    if (!stated && !actual) continue;
    const delta = Number((actual - stated).toFixed(2));
    if (Math.abs(delta) <= MONEY_TOL) continue;
    out.push(
      finding('finance.summaryMismatch', 'critical', {
        source: source.key,
        tab: 'สรุป',
        field: line,
        expected: stated,
        actual,
        delta,
        messageTh:
          `${labelTh}: งบสรุปบอก ${money(stated)} บาท แต่รวมรายการจริงในแท็บรายละเอียดได้ ` +
          `${money(actual)} บาท (ต่างกัน ${money(Math.abs(delta))} บาท)`,
        messageEn:
          `${labelEn}: the summary says ${money(stated)} THB but the detail rows add up to ` +
          `${money(actual)} THB (off by ${money(Math.abs(delta))} THB)`,
      })
    );
  }

  /* แถวที่ผลรวม 12 เดือนไม่เท่าช่อง Total ของแถวนั้นเอง
   * เจอจริงแล้วหนึ่งแถว: ค่าไฟฟ้า — สูตรผลรวมไม่ครอบเดือนกรกฎาคม */
  for (const tab of source.tabs ?? []) {
    if (!tab.rowMismatches) continue;
    out.push(
      finding('finance.rowTotalMismatch', 'warning', {
        source: source.key,
        tab: tab.name,
        messageTh:
          `แท็บ "${tab.name}" มี ${tab.rowMismatches} แถวที่ผลรวม 12 เดือนไม่เท่ากับช่อง Total ` +
          'ของแถวนั้น — มักเกิดจากสูตรผลรวมครอบไม่ครบเดือนที่เพิ่งกรอกเพิ่ม',
        messageEn:
          `Tab "${tab.name}" has ${tab.rowMismatches} row(s) where the 12 monthly values do not ` +
          'match that row’s own Total — usually a SUM range that misses a newly filled month',
      })
    );
  }

  /* ── EBITDA ต้องเท่ากับ รายได้ − รวมต้นทุนการปลูก ──
   *
   * เป็นการตรวจที่จับของจริงมาแล้ว: มีคนแก้แถวต้นทุนในงบสรุปให้ตรงกับแท็บรายละเอียด
   * (เพิ่มขึ้นรวม 1.23 ล้าน) แต่ **แถว EBITDA กับ EBIT ไม่ได้คำนวณใหม่ตาม**
   * ผลคือชีตขัดกันเอง: กำไรขั้นต้นที่คิดจากตัวเลขต้นทุนปัจจุบันไม่เท่ากับช่อง EBITDA
   *
   * ถ้าไม่ตรวจข้อนี้ Dashboard จะโชว์ตัวเลขที่ถูก แล้วผู้ใช้เปิดชีตมาเทียบเจอคนละเลข
   * โดยไม่มีอะไรอธิบายว่าทำไม — ซึ่งทำให้เลิกเชื่อ Dashboard ทั้งระบบ */
  for (const month of [...new Set(summary.map((r) => r.month))].sort()) {
    const rev = summary.find((r) => r.line === 'revenue' && r.month === month)?.amount ?? null;
    const grow = summary.find((r) => r.line === 'growingCost' && r.month === month)?.amount ?? null;
    const eb = summary.find((r) => r.line === 'ebitda' && r.month === month)?.amount ?? null;
    if (rev === null || grow === null || eb === null) continue;
    const delta = Number((rev - grow - eb).toFixed(2));
    if (Math.abs(delta) <= MONEY_TOL) continue;
    out.push(
      finding('finance.ebitdaMismatch', 'critical', {
        source: source.key,
        tab: 'สรุป',
        field: month,
        expected: Number((rev - grow).toFixed(2)),
        actual: eb,
        delta,
        messageTh:
          `${month}: ช่อง EBITDA ในชีตบอก ${money(eb)} แต่คิดจากตัวเลขในชีตเองได้ ` +
          `${money(rev - grow)} (รายได้ ${money(rev)} − รวมต้นทุนการปลูก ${money(grow)}) ` +
          `ต่างกัน ${money(Math.abs(delta))} บาท — มักเกิดจากแก้แถวต้นทุนแล้วลืมคำนวณแถว EBITDA ใหม่`,
        messageEn:
          `${month}: the EBITDA cell says ${money(eb)} but the sheet's own figures give ` +
          `${money(rev - grow)} (revenue ${money(rev)} − total growing cost ${money(grow)}), ` +
          `off by ${money(Math.abs(delta))} — usually a cost row edited without refreshing EBITDA`,
      })
    );
  }

  /* EBIT ต้องเท่ากับ EBITDA − ค่าเสื่อมราคา
   * ตรวจรายเดือน เพราะผิดเดือนเดียวก็ทำให้กราฟแนวโน้มเพี้ยนแล้ว */
  const months = [...new Set(summary.map((r) => r.month))].sort();
  const at = (line, month) =>
    summary.find((r) => r.line === line && r.month === month)?.amount ?? null;

  for (const month of months) {
    const ebitda = at('ebitda', month);
    const ebit = at('ebit', month);
    const dep = at('depreciation', month);
    if (ebitda === null || ebit === null || dep === null) continue;
    const delta = Number((ebitda - dep - ebit).toFixed(2));
    if (Math.abs(delta) <= MONEY_TOL) continue;
    out.push(
      finding('finance.ebitMismatch', 'warning', {
        source: source.key,
        tab: 'สรุป',
        field: month,
        expected: Number((ebitda - dep).toFixed(2)),
        actual: ebit,
        delta,
        messageTh:
          `${month}: EBIT ที่ชีตบอก (${money(ebit)}) ไม่เท่ากับ EBITDA − ค่าเสื่อมราคา ` +
          `(${money(ebitda)} − ${money(dep)} = ${money(ebitda - dep)})`,
        messageEn:
          `${month}: the stated EBIT (${money(ebit)}) does not equal EBITDA − depreciation ` +
          `(${money(ebitda)} − ${money(dep)} = ${money(ebitda - dep)})`,
      })
    );
  }

  /* ── แต่ละบรรทัดครอบคลุมเดือนไม่เท่ากัน ──
   *
   * เจอจริง: รายได้กรอกถึงมิถุนายน แต่ค่าเสื่อมราคาและค่าใช้จ่าย Office ถูกตั้งไว้
   * ล่วงหน้าครบ 12 เดือน ถ้าใครเอา "ยอดรวมทั้งปี" ของสองฝั่งมาลบกันตรง ๆ
   * จะได้ผลขาดทุนเกินจริงไป 4.3 ล้านบาท โดยไม่มีอะไรบอกเลยว่าเทียบคนละช่วงเวลา
   *
   * Dashboard ตัดยอดที่เดือนล่าสุดที่มีความเคลื่อนไหวให้แล้ว (ดู buildCost)
   * แต่คนที่เปิดชีตเองยังเจอกับดักนี้อยู่ จึงต้องรายงานไว้ */
  const monthsOf = (line) =>
    summary.filter((r) => r.line === line && (r.amount ?? 0) !== 0).map((r) => r.month);
  const revenueMonths = monthsOf('revenue').length;
  const depMonths = monthsOf('depreciation').length;

  if (revenueMonths > 0 && depMonths > revenueMonths) {
    out.push(
      finding('finance.coverageMismatch', 'warning', {
        source: source.key,
        tab: 'สรุป',
        expected: revenueMonths,
        actual: depMonths,
        delta: depMonths - revenueMonths,
        messageTh:
          `รายได้กรอกไว้ ${revenueMonths} เดือน แต่ค่าเสื่อมราคากรอกไว้ ${depMonths} เดือน ` +
          '— เอายอดรวมทั้งปีของสองบรรทัดนี้มาลบกันตรง ๆ ไม่ได้ เพราะเป็นคนละช่วงเวลา ' +
          '(หน้าต้นทุนตัดยอดที่เดือนล่าสุดที่มีความเคลื่อนไหวให้แล้ว)',
        messageEn:
          `Revenue is filled for ${revenueMonths} month(s) but depreciation for ${depMonths}. ` +
          'Their full-year totals cannot be subtracted directly — different periods. ' +
          '(The cost page already cuts totals at the last month with activity.)',
      })
    );
  }

  /* แท็บที่เนื้อหาซ้ำกับแท็บอื่นทั้งแท็บ — parser ข้ามให้แล้วเพื่อไม่ให้นับซ้ำ
   * แต่ต้องบอกผู้ใช้ ไม่งั้นจะสงสัยว่าทำไมแท็บนั้นไม่มีผลอะไรเลย */
  for (const tab of source.tabs ?? []) {
    if (tab.skipped !== 'duplicate-content') continue;
    out.push(
      finding('finance.duplicateTab', 'warning', {
        source: source.key,
        tab: tab.name,
        messageTh:
          `แท็บ "${tab.name}" มีเนื้อหาเหมือนแท็บ "${tab.duplicateOf}" ทั้งแท็บ ` +
          'ระบบจึงข้ามไปเพื่อไม่ให้ยอดถูกนับสองเท่า — ถ้าตั้งใจให้เป็นรายงานคนละอัน ต้องแก้เนื้อในก่อน',
        messageEn:
          `Tab "${tab.name}" is byte-for-byte the same as "${tab.duplicateOf}", so it is skipped ` +
          'to avoid double counting — if it is meant to be a different report, its contents must be changed',
      })
    );
  }
}

/** จำนวนเงินแบบอ่านง่ายในข้อความ finding */
function money(v) {
  return Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ─────────────────────────────────────────────────────────────
// Supply — วัสดุสิ้นเปลือง (ชีต Log Stock บันทึกประจำวัน)
//
// กฎชุดนี้แยกจากกฎของดอกไม้ทั้งหมด เพราะไม่มีน้ำหนัก ขนาด หรือสายพันธุ์ให้ตรวจ
// สิ่งที่ตรวจได้คือความสอดคล้องของบัญชี รับ–เบิก–คงเหลือ ซึ่งเป็นหัวใจของชีตนี้
// ─────────────────────────────────────────────────────────────
function checkSupply(source, out, now) {
  const todayIso = now.toISOString().slice(0, 10);
  const staleLimit = new Date(now);
  staleLimit.setDate(staleLimit.getDate() - SUPPLY_STALE_DAYS);
  const staleIso = staleLimit.toISOString().slice(0, 10);

  // จัดแถว log เข้ากลุ่มตามแท็บ เพื่อไล่ยอดยกมาทีละรายการ
  const byTab = new Map();
  for (const rec of source.rows) {
    if (rec.kind !== 'log') continue;
    if (!byTab.has(rec.tab)) byTab.set(rec.tab, []);
    byTab.get(rec.tab).push(rec);
  }

  for (const [tabName, rows] of byTab) {
    let prev = null;
    let driftReported = false;

    for (const rec of rows) {
      // ยอดติดลบ = บัญชีผิดแน่นอน ของจริงติดลบไม่ได้
      if (rec.balance !== null && rec.balance < 0) {
        out.push(
          finding('supply.negativeBalance', 'critical', {
            source: source.key,
            tab: tabName,
            row: rec.rowIndex,
            field: 'จำนวนคงเหลือ',
            messageTh: `${rec.item}: ยอดคงเหลือวันที่ ${rec.date} ติดลบ (${fmt(rec.balance)})`,
            messageEn: `${rec.item}: balance on ${rec.date} is negative (${fmt(rec.balance)})`,
            actual: rec.balance,
          })
        );
      }

      // Index ในชีตควรเท่ากับ คงเหลือ − ขั้นต่ำ เสมอ ถ้าไม่ตรงแปลว่ามีคนพิมพ์ทับสูตร
      if (rec.index !== null && rec.balance !== null && rec.minimum !== null) {
        const expected = rec.balance - rec.minimum;
        if (Math.abs(rec.index - expected) >= 0.5) {
          out.push(
            finding('supply.indexMismatch', 'warning', {
              source: source.key,
              tab: tabName,
              row: rec.rowIndex,
              field: 'Index',
              messageTh: `${rec.item}: ช่อง Index = ${fmt(rec.index)} แต่ คงเหลือ − ขั้นต่ำ = ${fmt(expected)}`,
              messageEn: `${rec.item}: Index cell is ${fmt(rec.index)} but balance − minimum = ${fmt(expected)}`,
              expected,
              actual: rec.index,
              delta: rec.index - expected,
            })
          );
        }
      }

      // ยอดยกมาต้องเดินต่อกันได้: คงเหลือ = คงเหลือเดิม + รับ − เบิก
      // รายงานแค่ครั้งแรกต่อแท็บ เพราะเมื่อหลุดแล้วแถวถัดไปจะผิดตามกันทั้งคอลัมน์
      if (!driftReported && prev !== null && rec.balance !== null) {
        const expected = prev + (rec.received ?? 0) - (rec.issued ?? 0);
        if (Math.abs(rec.balance - expected) >= 0.5) {
          out.push(
            finding('supply.balanceDrift', 'warning', {
              source: source.key,
              tab: tabName,
              row: rec.rowIndex,
              field: 'จำนวนคงเหลือ',
              messageTh:
                `${rec.item}: วันที่ ${rec.date} ยอดคงเหลือ ${fmt(rec.balance)} ` +
                `แต่ยอดยกมา ${fmt(prev)} + รับ ${fmt(rec.received ?? 0)} − เบิก ${fmt(rec.issued ?? 0)} = ${fmt(expected)}`,
              messageEn:
                `${rec.item}: on ${rec.date} balance is ${fmt(rec.balance)} but ` +
                `${fmt(prev)} + ${fmt(rec.received ?? 0)} − ${fmt(rec.issued ?? 0)} = ${fmt(expected)}`,
              expected,
              actual: rec.balance,
              delta: rec.balance - expected,
            })
          );
          driftReported = true;
        }
      }
      if (rec.balance !== null) prev = rec.balance;
    }
  }

  // ตรวจระดับแท็บ — ใช้ค่า current ที่ parser คำนวณจากแถวล่าสุดที่ยังไม่เลยวันนี้
  for (const tab of source.tabs || []) {
    if (tab.skipped || tab.role === 'order') continue;

    if (tab.current && tab.current.minimum === null) {
      out.push(
        finding('supply.noMinimum', 'info', {
          source: source.key,
          tab: tab.name,
          field: 'ขั้นต่ำ',
          messageTh: `${tab.item}: ไม่ได้กำหนดจำนวนขั้นต่ำ จึงไม่ขึ้นในรายการของที่ต้องสั่งซื้อ`,
          messageEn: `${tab.item}: no minimum quantity set, so it can never appear in the reorder list`,
        })
      );
    }

    if (tab.current && tab.current.date < staleIso) {
      out.push(
        finding('supply.staleItem', 'info', {
          source: source.key,
          tab: tab.name,
          field: 'วันที่',
          messageTh: `${tab.item}: บันทึกล่าสุด ${tab.current.date} เก่ากว่า ${SUPPLY_STALE_DAYS} วัน`,
          messageEn: `${tab.item}: last entry ${tab.current.date} is older than ${SUPPLY_STALE_DAYS} days`,
          actual: tab.current.date,
        })
      );
    }

    // รายงานรวมครั้งเดียวต่อแท็บ ไม่ใช่ทีละแถว — ไม่งั้นได้หลักพันรายการ
    if (tab.futureCount > 0) {
      out.push(
        finding('supply.futureRows', 'info', {
          source: source.key,
          tab: tab.name,
          field: 'วันที่',
          messageTh:
            `${tab.item}: มี ${tab.futureCount} แถวลงวันที่ล่วงหน้า — ` +
            `ยอดคงเหลือปัจจุบันอ่านจากแถววันที่ ≤ ${todayIso} เท่านั้น`,
          messageEn:
            `${tab.item}: ${tab.futureCount} rows are dated in the future — ` +
            `the current balance is read from rows dated ≤ ${todayIso} only`,
          actual: tab.futureCount,
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Cross-source — ข้อมูลข้ามรายงานสอดคล้องกันไหม
// ─────────────────────────────────────────────────────────────
function checkCrossSource(sources, out) {
  const outbound = sources.outbound;
  const inbound = sources.inbound;

  /** รวมยอดรายวัน พร้อมจำชื่อ tab ที่ประกอบเป็นยอดนั้น (ไว้ทำลิงก์) */
  const byDate = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.date) continue;
      let e = m.get(r.date);
      if (!e) {
        e = { total: 0, tabs: new Set() };
        m.set(r.date, e);
      }
      e.total += r.flowerTotal || 0;
      if (r.tab) e.tabs.add(r.tab);
    }
    return m;
  };

  /** รวมยอดตามครอป พร้อมจำชื่อ tab */
  const byCrop = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.crop) continue;
      let e = m.get(r.crop);
      if (!e) {
        e = { total: 0, tabs: new Set() };
        m.set(r.crop, e);
      }
      e.total += r.flowerTotal || 0;
      if (r.tab) e.tabs.add(r.tab);
    }
    return m;
  };

  // 1) ขนออกจากฟาร์ม vs รับเข้ากรุงเทพ — เทียบยอดรวมรายวัน
  //    finding นี้ต้องเปิดดูสองชีตถึงจะเข้าใจ จึงแนบลิงก์ทั้งสองฝั่ง
  if (outbound?.rows?.length && inbound?.rows?.length) {
    const outMap = byDate(outbound.rows);
    const inMap = byDate(inbound.rows);

    for (const [date, shipped] of outMap) {
      const received = inMap.get(date);
      if (!received) continue; // วันที่ไม่ตรงกันเป็นเรื่องปกติของการขนส่งข้ามวัน
      if (shipped.total === 0) continue;

      const diffPct = (Math.abs(received.total - shipped.total) / shipped.total) * 100;
      if (diffPct <= CROSS_SOURCE_TOLERANCE_PCT) continue;

      const inboundTab = [...received.tabs][0] ?? null;
      out.push(
        finding('cross.shipmentMismatch', 'critical', {
          source: 'inbound',
          tab: inboundTab,
          field: 'รวมน้ำหนักดอก',
          messageTh: `วันที่ ${date}: ขนออกจากฟาร์ม ${fmt(shipped.total)} g แต่รับที่กรุงเทพ ${fmt(received.total)} g (ต่าง ${fmt(received.total - shipped.total)} g / ${diffPct.toFixed(1)}%)`,
          messageEn: `${date}: farm shipped ${fmt(shipped.total)} g but Bangkok received ${fmt(received.total)} g (Δ ${fmt(received.total - shipped.total)} g / ${diffPct.toFixed(1)}%)`,
          expected: shipped.total,
          actual: received.total,
          delta: received.total - shipped.total,
          related: [
            ...relatedTabs('outbound', shipped.tabs),
            ...relatedTabs('inbound', received.tabs),
          ],
        })
      );
    }

    const unmatched = [...outMap.keys()].filter((d) => !inMap.has(d));
    if (unmatched.length) {
      const tabs = new Set();
      for (const d of unmatched.slice(0, 4)) for (const t of outMap.get(d).tabs) tabs.add(t);
      out.push(
        finding('cross.noReceipt', 'info', {
          source: 'outbound',
          tab: [...tabs][0] ?? null,
          field: 'วันที่',
          messageTh: `มี ${unmatched.length} วันที่ขนออกจากฟาร์มแต่ไม่พบใบรับที่กรุงเทพในวันเดียวกัน (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ' …' : ''})`,
          messageEn: `${unmatched.length} shipment date(s) have no same-day Bangkok receipt (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ' …' : ''})`,
          actual: unmatched.length,
          related: relatedTabs('outbound', tabs),
        })
      );
    }
  }

  // 2) ผลรวมรายวัน vs ยอดต่อครอป
  const daily = sources.dailyTrim;
  const perCrop = sources.perCrop;
  if (daily?.rows?.length && perCrop?.rows?.length) {
    const dailyByCrop = byCrop(daily.rows);

    for (const rec of perCrop.rows) {
      if (!rec.crop || rec.flowerTotal === null) continue;
      const d = dailyByCrop.get(rec.crop);
      if (!d || d.total === 0) continue;

      const diffPct = (Math.abs(d.total - rec.flowerTotal) / rec.flowerTotal) * 100;
      if (diffPct <= 5) continue;

      out.push(
        finding('cross.cropTotalMismatch', 'warning', {
          source: 'perCrop',
          tab: rec.tab,
          row: rec.rowIndex,
          field: 'Total',
          messageTh: `ครอป ${rec.crop}: ผลรวมรายวันได้ ${fmt(d.total)} g แต่รายงานต่อครอประบุ ${fmt(rec.flowerTotal)} g (ต่าง ${diffPct.toFixed(1)}%)`,
          messageEn: `Crop ${rec.crop}: daily entries sum to ${fmt(d.total)} g but the per-crop report says ${fmt(rec.flowerTotal)} g (Δ ${diffPct.toFixed(1)}%)`,
          expected: rec.flowerTotal,
          actual: d.total,
          delta: d.total - rec.flowerTotal,
          related: relatedTabs('dailyTrim', d.tabs),
        })
      );
    }
  }

  // 3) ยอดขายต่อครอป ต้องไม่เกินของที่รับเข้ากรุงเทพ
  const sales = sources.sales;
  if (sales?.rows?.length && inbound?.rows?.length) {
    const receivedByCrop = byCrop(inbound.rows);
    const soldByCrop = byCrop(sales.rows);

    for (const [crop, sold] of soldByCrop) {
      const received = receivedByCrop.get(crop);
      if (!received || sold.total === 0) continue;
      if (sold.total <= received.total * 1.02) continue;

      out.push(
        finding('cross.oversold', 'warning', {
          source: 'sales',
          tab: [...sold.tabs][0] ?? null,
          field: 'ครอป',
          messageTh: `ครอป ${crop}: ขายไป ${fmt(sold.total)} g แต่รับเข้ากรุงเทพเพียง ${fmt(received.total)} g`,
          messageEn: `Crop ${crop}: sold ${fmt(sold.total)} g but only ${fmt(received.total)} g was received in Bangkok`,
          expected: `≤ ${fmt(received.total)}`,
          actual: sold.total,
          delta: sold.total - received.total,
          related: [
            ...relatedTabs('sales', sold.tabs),
            ...relatedTabs('inbound', received.tabs),
          ],
        })
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────

/**
 * รันการตรวจสอบทั้งหมด
 * @param {Record<string, object>} sources ผลจาก parser ของแต่ละรายงาน
 * @returns {{score:number, counts:object, findings:Array, bySource:object, ranAt:string, durationMs:number}}
 */
export function analyze(sources) {
  const started = Date.now();
  const now = new Date();
  const findings = [];

  for (const source of Object.values(sources)) {
    if (!source) continue;
    checkStructural(source, findings);
    if (source.status === 'error') continue; // ไม่มีข้อมูลให้ตรวจต่อ

    // วัสดุสิ้นเปลืองไม่มีน้ำหนัก/ขนาด/สายพันธุ์ให้ตรวจ ใช้กฎคนละชุดกันทั้งหมด
    if (source.kind === 'supply') {
      checkSupply(source, findings, now);
      continue;
    }

    // งบรายรับ-รายจ่ายก็เช่นกัน — เป็นจำนวนเงินรายเดือน ไม่ใช่น้ำหนักดอก
    if (source.kind === 'finance') {
      checkFinance(source, findings, now);
      continue;
    }

    checkArithmetic(source, findings);
    checkRange(source, findings);
    checkUnits(source, findings);
    checkDates(source, findings, now);
    checkCompleteness(source, findings);
  }

  checkCrossSource(sources, findings);

  // เติม gid ของ tab ให้ทุก finding — front-end ใช้ทำลิงก์ตรงไปยัง tab ที่มีปัญหา
  const gidOf = makeGidResolver(sources);
  for (const f of findings) {
    f.gid = gidOf(f.source, f.tab);
    for (const r of f.related) r.gid = gidOf(r.source, r.tab);
    // ตัด related ที่ซ้ำกับลิงก์หลักออก ไม่ให้ขึ้นสองอันเหมือนกัน
    f.related = f.related.filter((r) => !(r.source === f.source && r.tab === f.tab));
  }

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  // คะแนนคุณภาพ: หัก 12 ต่อ critical, 4 ต่อ warning, 1 ต่อ info
  // แล้ว normalize ด้วยจำนวนแถวเพื่อไม่ให้ชุดข้อมูลใหญ่เสียเปรียบ
  //
  // ตัวหารนับเฉพาะรายงานดอกไม้ — ชีตวัสดุสิ้นเปลืองมีแถว log หลายพันแถว
  // ถ้านับรวมเข้าไปด้วย คะแนนจะกระโดดขึ้นทั้งที่คุณภาพข้อมูลไม่ได้ดีขึ้นเลย
  // (badge บนหัวเว็บจะกลายเป็นตัวเลขที่โกหก)
  const scoredRows = Object.values(sources).reduce(
    (n, s) => n + (s?.kind === 'supply' || s?.kind === 'finance' ? 0 : s?.rowCount || 0),
    0
  );
  const penalty = findings.reduce((p, f) => p + SEVERITY_WEIGHT[f.severity], 0);

  /* ไม่มีแถวที่นับคะแนนเลย (เช่นตอนวิเคราะห์เฉพาะรายงานวัสดุ) → คะแนนเป็น null
   * ถ้าปล่อยให้ตกไปใช้ตัวหารขั้นต่ำ 40 จะได้ตัวเลขที่ดูเหมือนคะแนนแต่ไม่มีความหมาย
   * แล้วเอาไปเทียบกับคะแนนของ Dashboard หลักไม่ได้ */
  const totalRows = scoredRows || 1;
  const score =
    scoredRows === 0
      ? null
      : Math.max(0, Math.round(100 - (penalty / Math.max(totalRows, 40)) * 100));

  const bySource = {};
  for (const key of Object.keys(sources)) {
    bySource[key] = { critical: 0, warning: 0, info: 0, total: 0 };
  }
  for (const f of findings) {
    const bucket = bySource[f.source];
    if (!bucket) continue;
    bucket[f.severity]++;
    bucket.total++;
  }

  // เรียงร้ายแรงก่อน แล้วค่อยกลุ่มตามรายงาน
  const order = { critical: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || String(a.source).localeCompare(String(b.source))
  );

  return {
    score,
    counts,
    total: findings.length,
    findings,
    bySource,
    rowsChecked: totalRows,
    ranAt: now.toISOString(),
    durationMs: Date.now() - started,
  };
}

// ─────────────────────────────────────────────────────────────
// ตรวจสิ่งที่ "นำเสนอ" ไม่ใช่แค่สิ่งที่ "อ่านเข้ามา"
// ─────────────────────────────────────────────────────────────

/**
 * ลิสต์นี้เรียงตามเวลาจริงหรือยัง
 * @returns {{ok:boolean, at?:number, prev?:string, curr?:string}}
 */
function checkChronological(keys) {
  for (let i = 1; i < keys.length; i++) {
    const prev = periodOrder(keys[i - 1]);
    const curr = periodOrder(keys[i]);
    // ค่าที่อ่านไม่ออกถูกดันไปท้ายอยู่แล้ว ไม่ถือว่าผิดลำดับ
    if (prev === Number.MAX_SAFE_INTEGER || curr === Number.MAX_SAFE_INTEGER) continue;
    if (curr < prev) return { ok: false, at: i, prev: keys[i - 1], curr: keys[i] };
  }
  return { ok: true };
}

/**
 * ตรวจว่า KPI ที่จะเอาไปวาดกราฟถูกจัดลำดับถูกต้อง
 *
 * ทำไมต้องมี: `analyze()` ตรวจข้อมูลที่ "อ่านเข้ามา" แต่ตัวเลขที่ผู้บริหารเห็นบนจอ
 * ผ่านการจัดกลุ่มและเรียงลำดับของ `aggregate.js` อีกชั้น ความผิดพลาดในขั้นนำเสนอ
 * (เช่นเรียงไตรมาสตามตัวอักษรจนได้ Q1'2026 มาก่อน Q2'2025) ไม่มีอะไรจับได้เลย
 * ทั้งที่ทำให้อ่านแนวโน้มผิดทันที
 *
 * เรียกหลัง buildKpi() แล้วผนวก finding เข้ากับผลวิเคราะห์เดิม
 *
 * @param {object} analysis ผลจาก analyze()
 * @param {object} kpi ผลจาก buildKpi()
 * @returns {object} analysis ที่เติม finding และคิดคะแนนใหม่แล้ว
 */
export function verifyPresentation(analysis, kpi) {
  const extra = [];

  const addOrderFinding = (sourceKey, field, labelTh, labelEn, bad) => {
    extra.push({
      id: 'order.notChronological',
      severity: 'critical',
      source: sourceKey,
      tab: null,
      gid: null,
      row: null,
      field,
      messageTh:
        `${labelTh} เรียงลำดับผิด — "${bad.curr}" ถูกวางไว้หลัง "${bad.prev}" ` +
        'ทั้งที่เกิดขึ้นก่อน กราฟและแนวโน้มที่เห็นจะอ่านผิด',
      messageEn:
        `${labelEn} is out of order — "${bad.curr}" appears after "${bad.prev}" ` +
        'even though it comes first chronologically; trends will read incorrectly',
      expected: `${bad.curr} → ${bad.prev}`,
      actual: `${bad.prev} → ${bad.curr}`,
      delta: null,
      related: [],
    });
  };

  // ไตรมาสของรายงานผลผลิตต่อครอป
  const quarters = (kpi?.perCrop?.byQuarter ?? []).map((q) => q.key);
  const q = checkChronological(quarters);
  if (!q.ok) addOrderFinding('perCrop', 'byQuarter', 'ผลผลิตแยกตามไตรมาส', 'Yield by quarter', q);

  // ยอดขายรายเดือน
  const months = (kpi?.sales?.byMonth ?? []).map((m) => m.month);
  const m = checkChronological(months);
  if (!m.ok) addOrderFinding('sales', 'byMonth', 'ยอดขายรายเดือน', 'Monthly sales', m);

  // เส้นแนวโน้มรายวันของทุกรายงานที่มี series
  for (const [key, label] of [
    ['dailyTrim', ['ผลผลิตรายวัน', 'Daily trim series']],
    ['outbound', ['ขนย้ายออกจากฟาร์มรายวัน', 'Outbound series']],
    ['inbound', ['รับดอกเข้ากรุงเทพรายวัน', 'Inbound series']],
  ]) {
    const dates = (kpi?.[key]?.series ?? []).map((d) => d.date);
    const r = checkChronological(dates);
    if (!r.ok) addOrderFinding(key, 'series', label[0], label[1], r);
  }

  // เดือนของตารางการเบิกวัสดุ — เขียนแยกจาก loop ข้างบนเพราะ supply ไม่มี .series
  // (กับดัก: ตอนนี้ข้อมูลอยู่ในปีเดียวกันหมด localeCompare จึงเรียงถูกโดยบังเอิญ
  //  บั๊กจะโผล่ตอนข้ามปีเท่านั้น จึงต้องมีตัวตรวจไว้ตั้งแต่แรก)
  const supplyMonths = kpi?.supply?.months ?? [];
  const sm = checkChronological(supplyMonths);
  if (!sm.ok) {
    addOrderFinding('supplyLog', 'months', 'เดือนของการเบิกวัสดุ', 'Supply usage months', sm);
  }

  /* ของที่ต้องสั่งซื้อแต่ไม่มีราคา — ใบขอซื้อจะออกมาโดยไม่มีมูลค่า
   *
   * รวมเป็นรายการเดียวไม่ใช่ทีละชิ้น เพราะปกติขาดพร้อมกันหลายสิบรายการ
   * (ตารางสั่งของรายเดือนมีแค่ 60 รายการ แต่มีแท็บ log 138 รายการ)
   * ห้ามคิดราคาที่ขาดเป็น 0 เพราะยอดรวมในใบขอซื้อจะต่ำกว่าจริง */
  const noPrice = (kpi?.supply?.needsReorder ?? []).filter((r) => r.unitPrice === null);
  if (noPrice.length > 0) {
    const names = noPrice.slice(0, 6).map((r) => r.item).join(', ');
    const more = noPrice.length > 6 ? ` และอีก ${noPrice.length - 6} รายการ` : '';
    const moreEn = noPrice.length > 6 ? ` and ${noPrice.length - 6} more` : '';
    extra.push({
      id: 'supply.missingPrice',
      severity: 'warning',
      source: 'supplyLog',
      tab: 'สั่งของรายเดือน',
      gid: null,
      row: null,
      field: 'ราคา / @',
      messageTh:
        `มี ${noPrice.length} รายการที่ต้องสั่งซื้อแต่หาราคาในแท็บ "สั่งของรายเดือน" ไม่เจอ ` +
        `จึงคำนวณมูลค่าใบขอซื้อไม่ครบ — ${names}${more}`,
      messageEn:
        `${noPrice.length} items need reordering but have no price in the "สั่งของรายเดือน" tab, ` +
        `so the purchase request total is incomplete — ${names}${moreEn}`,
      expected: null,
      actual: noPrice.length,
      delta: null,
      related: [],
    });
  }

  if (extra.length === 0) return analysis;

  const findings = [...analysis.findings, ...extra];
  const counts = { ...analysis.counts };
  const bySource = { ...analysis.bySource };
  for (const f of extra) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    const bucket = bySource[f.source];
    if (bucket) {
      bucket[f.severity]++;
      bucket.total++;
    }
  }

  // คิดคะแนนใหม่ด้วยสูตรเดียวกับ analyze() เพื่อให้ตัวเลขบน badge สอดคล้องกัน
  // (คะแนนเดิมเป็น null แปลว่าชุดนี้ไม่มีแถวที่นับคะแนน — ต้องคง null ไว้)
  const penalty = findings.reduce((p, f) => p + SEVERITY_WEIGHT[f.severity], 0);
  const score =
    analysis.score === null
      ? null
      : Math.max(0, Math.round(100 - (penalty / Math.max(analysis.rowsChecked, 40)) * 100));

  const order = { critical: 0, warning: 1, info: 2 };
  findings.sort(
    (a, b) => order[a.severity] - order[b.severity] || String(a.source).localeCompare(String(b.source))
  );

  return { ...analysis, findings, counts, bySource, score, total: findings.length };
}
