/**
 * chat-context.js — แปลง payload ของ Dashboard เป็นบริบทสำหรับ Chatbot
 *
 * ส่งข้อมูลดิบทั้ง 449KB ไปให้โมเดลไม่คุ้ม (แพงและช้า) จึงสรุปเป็นข้อความ
 * ที่มีตัวเลขสำคัญครบ ประมาณ 4–6 พัน token แล้วให้โมเดลตอบจากตรงนั้น
 *
 * หลักการ: ใส่แต่ตัวเลขที่คำนวณจาก record ที่ผ่าน parser แล้ว
 * และบอกข้อจำกัดของข้อมูลไปด้วย เพื่อให้โมเดลไม่ตอบเกินกว่าที่ข้อมูลรองรับ
 */

const n = (v, d = 0) =>
  v === null || v === undefined || !Number.isFinite(v)
    ? '—'
    : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** ตารางแยกตามมิติ เช่น สายพันธุ์ / ลูกค้า / ครอป */
function breakdown(rows, limit, labelKey = 'key') {
  if (!rows?.length) return '  (ไม่มีข้อมูล)';
  return rows
    .slice(0, limit)
    .map((r) => `  - ${r[labelKey] ?? '—'}: ${n(r.flower)} g`)
    .join('\n');
}

/** สัดส่วนตามขนาดดอก */
function sizeMix(mix) {
  if (!mix) return '  (ไม่มีข้อมูล)';
  const total = Object.values(mix).reduce((a, b) => a + (b || 0), 0);
  if (!total) return '  (ไม่มีข้อมูล)';
  return ['XXL', 'XL', 'L', 'M', 'S', 'XS']
    .map((k) => `  - ${k}: ${n(mix[k])} g (${(((mix[k] || 0) / total) * 100).toFixed(1)}%)`)
    .join('\n');
}

/** ชุดค่าที่มีอยู่จริงในข้อมูล — ให้โมเดลรู้ว่าถามถึงอะไรได้ */
function distinct(rows, key, limit = 40) {
  const seen = [...new Set(rows.map((r) => r[key]).filter(Boolean))];
  const shown = seen.slice(0, limit).join(', ');
  return seen.length > limit ? `${shown} … (อีก ${seen.length - limit} รายการ)` : shown || '—';
}

/**
 * สร้างบริบทข้อมูลเป็นข้อความ
 * @param {object} payload ผลจาก loadAll()
 */
export function buildDataContext(payload) {
  const { meta, kpi, analysis, sources } = payload;
  const out = [];

  out.push('# ข้อมูล Dashboard ณ ปัจจุบัน');
  out.push(`ดึงข้อมูลเมื่อ: ${meta.fetchedAt}`);
  out.push(`คะแนนคุณภาพข้อมูล: ${analysis.score}/100 (ตรวจ ${n(analysis.rowsChecked)} แถว)`);
  out.push('');

  out.push('## ตัวเลขสำคัญระดับผู้บริหาร');
  for (const h of kpi.headline) {
    const unit = h.unit ? ` ${h.unit}` : '';
    out.push(`- ${h.labelTh}: ${n(h.value, h.unit === '%' ? 1 : 0)}${unit} (${h.hint})`);
  }
  out.push('');

  out.push('## ผลผลิตต่อครอป (แหล่ง: แบบฟอร์มน้ำหนักดอกทริมต่อครอป)');
  out.push(`- ผลผลิตดอกรวมของครอปที่เก็บเกี่ยวแล้ว: ${n(kpi.perCrop.totalFlower)} g`);
  out.push(`- จำนวนต้นรวม: ${n(kpi.perCrop.totalPlants)} ต้น`);
  out.push(`- ผลผลิตต่อต้นเฉลี่ย: ${n(kpi.perCrop.gPerPlant, 2)} g/ต้น`);
  out.push(`- ครอปที่เก็บเกี่ยวแล้ว ${kpi.perCrop.harvestedCount} ครอป / กำลังปลูก ${kpi.perCrop.plannedCount} ครอป`);
  out.push('- สัดส่วนตามขนาด:');
  out.push(sizeMix(kpi.perCrop.sizeMix));
  out.push('- แยกตามไตรมาส (ผลผลิตรวม / จำนวนต้น / g ต่อต้น):');
  for (const q of kpi.perCrop.byQuarter) {
    out.push(`  - ${q.key}: ${n(q.flower)} g / ${n(q.plants)} ต้น / ${n(q.gPerPlant, 2)} g ต่อต้น`);
  }
  out.push('- ครอปที่ให้ผลผลิตต่อต้นสูงสุด:');
  for (const c of kpi.perCrop.topCrops.slice(0, 8)) {
    out.push(`  - ${c.crop} (${c.quarter}): ${n(c.gPerPlant, 2)} g/ต้น จาก ${n(c.plants)} ต้น`);
  }
  out.push('- ครอปที่กำลังปลูก (รอบปลูก โคลน→เร่งใบ→ทำดอก→เก็บเกี่ยว→ดอกพร้อม):');
  for (const u of kpi.perCrop.upcoming) {
    const c = u.cycle || {};
    out.push(
      `  - ${u.crop} (${u.quarter ?? '—'}): โคลน ${c.clone ?? '—'} / เร่งใบ ${c.veg ?? '—'} / ทำดอก ${c.flower ?? '—'} / เก็บเกี่ยว ${c.harvest ?? '—'} / ดอกพร้อม ${c.dryReady ?? '—'}`
    );
  }
  out.push('');

  out.push('## ผลผลิตทริมรายวัน (แหล่ง: แบบฟอร์มน้ำหนักดอกทริมรายวัน)');
  out.push(`- รวมน้ำหนักดอก: ${n(kpi.dailyTrim.totalFlower)} g / ไม่ใช่ดอก: ${n(kpi.dailyTrim.totalNonFlower)} g`);
  out.push(`- จำนวนวันที่มีการทริม: ${kpi.dailyTrim.dayCount} วัน`);
  out.push('- แยกตามครอป (สูงสุด 10):');
  out.push(breakdown(kpi.dailyTrim.byCrop, 10));
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(kpi.dailyTrim.byStrain, 10));
  out.push('');

  out.push('## ขนย้ายออกจากฟาร์ม');
  out.push(`- รวมน้ำหนักดอก: ${n(kpi.outbound.totalFlower)} g / ไม่ใช่ดอก: ${n(kpi.outbound.totalNonFlower)} g`);
  out.push(`- จำนวนเที่ยวขน: ${kpi.outbound.shipmentCount}`);
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(kpi.outbound.byStrain, 10));
  out.push('');

  out.push('## รับดอกเข้าคลังกรุงเทพ');
  out.push(`- รวมน้ำหนักดอก: ${n(kpi.inbound.totalFlower)} g / ไม่ใช่ดอก: ${n(kpi.inbound.totalNonFlower)} g`);
  out.push(`- จำนวนครั้งที่รับ: ${kpi.inbound.receiptCount}`);
  const recon = kpi.inbound.reconciliation.filter((r) => r.diff !== null);
  const matched = recon.filter((r) => r.matched).length;
  out.push(`- เทียบยอดขนออกกับยอดรับเข้า: ตรงกัน ${matched} จาก ${recon.length} วันที่เทียบได้`);
  const mismatched = recon.filter((r) => !r.matched).slice(0, 10);
  if (mismatched.length) {
    out.push('- วันที่ยอดไม่ตรง:');
    for (const r of mismatched) {
      out.push(`  - ${r.date}: ขนออก ${n(r.shipped)} g / รับเข้า ${n(r.received)} g (ต่าง ${n(r.diff)} g)`);
    }
  }
  out.push('');

  out.push('## การขายดอก');
  out.push(`- ยอดขายดอกรวม: ${n(kpi.sales.totalFlower)} g / ของไม่ใช่ดอก: ${n(kpi.sales.totalNonFlower)} g`);
  out.push(`- จำนวนลูกค้า: ${kpi.sales.customerCount} / จำนวนครั้งที่ขาย: ${kpi.sales.orderCount}`);
  out.push('- แยกตามลูกค้า:');
  out.push(breakdown(kpi.sales.byCustomer, 15));
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(kpi.sales.byStrain, 10));
  out.push('- ยอดรายเดือน:');
  for (const m of kpi.sales.byMonth) {
    out.push(`  - ${m.month}: ดอก ${n(m.flower)} g / ไม่ใช่ดอก ${n(m.nonFlower)} g`);
  }
  out.push('');

  out.push('## สินค้าคงเหลือ');
  out.push(`- รวมน้ำหนักดอก: ${n(kpi.inventory.totalFlower)} g / ไม่ใช่ดอก: ${n(kpi.inventory.totalNonFlower)} g`);
  out.push(`- ข้อมูล ณ วันที่: ${kpi.inventory.updatedAt.join(', ') || '—'}`);
  out.push('- แยกตามคลัง:');
  out.push(breakdown(kpi.inventory.byLocation, 10));
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(kpi.inventory.byStrain, 12));
  out.push('- สัดส่วนตามขนาด:');
  out.push(sizeMix(kpi.inventory.sizeMix));
  out.push('');

  out.push('## คุณภาพข้อมูล');
  out.push(
    `- พบทั้งหมด ${analysis.total} รายการ: ร้ายแรง ${analysis.counts.critical} / ควรตรวจสอบ ${analysis.counts.warning} / ข้อสังเกต ${analysis.counts.info}`
  );
  out.push('- รายการร้ายแรงทั้งหมด:');
  const criticals = analysis.findings.filter((f) => f.severity === 'critical');
  for (const f of criticals) {
    out.push(`  - [${f.source}] ${f.messageTh}`);
  }
  const warnGroups = new Map();
  for (const f of analysis.findings.filter((x) => x.severity === 'warning')) {
    const k = `${f.source}/${f.id}`;
    warnGroups.set(k, (warnGroups.get(k) || 0) + 1);
  }
  if (warnGroups.size) {
    out.push('- สรุปรายการที่ควรตรวจสอบ (แหล่ง/ประเภท: จำนวน):');
    for (const [k, c] of [...warnGroups.entries()].sort((a, b) => b[1] - a[1])) {
      out.push(`  - ${k}: ${c}`);
    }
  }
  out.push('');

  out.push('## ค่าที่มีอยู่ในข้อมูล');
  out.push(`- สายพันธุ์: ${distinct([...sources.sales.rows, ...sources.inventory.rows], 'strain')}`);
  out.push(`- ลูกค้า: ${distinct(sources.sales.rows, 'customer')}`);
  out.push(`- คลัง: ${distinct(sources.inventory.rows, 'location')}`);
  out.push(`- ครอปที่มีข้อมูลผลผลิต: ${distinct(sources.perCrop.rows, 'crop')}`);
  out.push('');

  out.push('## สถานะการดึงข้อมูลแต่ละแหล่ง');
  for (const s of meta.sources) {
    out.push(`- ${s.titleTh}: ${s.status} · ${n(s.rowCount)} แถว · ${s.tabsOk}/${s.tabCount} ชีตย่อย`);
  }

  return out.join('\n');
}

/** คำสั่งระบบ — กำหนดขอบเขตว่าตอบอะไรได้ ตอบอะไรไม่ได้ */
export const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยวิเคราะห์ข้อมูลของ Kambis ฟาร์มและธุรกิจจำหน่ายดอกกัญชา
คุณตอบคำถามเกี่ยวกับข้อมูลใน Executive Report Dashboard ที่ให้ไว้เท่านั้น

กฎการตอบ
1. ตอบจากข้อมูลที่ให้ไว้ในบริบทเท่านั้น ห้ามเดาหรือแต่งตัวเลขขึ้นเอง
   ถ้าข้อมูลที่ให้มาไม่พอตอบ ให้บอกตรง ๆ ว่าไม่มีข้อมูลนั้น และบอกว่าต้องดูจากรายงานไหน
2. เวลาอ้างตัวเลข ให้บอกหน่วยและแหล่งที่มา (ชื่อรายงาน) กำกับด้วยเสมอ
3. ถ้าคำถามเกี่ยวข้องกับข้อมูลที่มีปัญหาคุณภาพ ให้เตือนด้วยว่าตัวเลขนั้นมีข้อสังเกตอะไร
   ปัญหาทั้งหมดอยู่ในชีตต้นทาง ไม่ใช่ข้อผิดพลาดของ Dashboard
4. น้ำหนักทุกค่าเป็นกรัม (g) ถ้าตัวเลขใหญ่ให้แปลงเป็นกิโลกรัมช่วยให้อ่านง่าย และบอกทั้งสองหน่วย
5. "—" หรือค่าว่างแปลว่าไม่มีข้อมูล ไม่ใช่ศูนย์ ห้ามนับเป็นศูนย์ในการคำนวณค่าเฉลี่ย
6. ถ้าคำนวณอะไรเพิ่ม ให้แสดงวิธีคิดสั้น ๆ ให้ผู้ใช้ตรวจตามได้
7. ตอบภาษาเดียวกับที่ผู้ใช้ถาม ตอบกระชับตรงประเด็น ใช้ bullet เมื่อช่วยให้อ่านง่ายขึ้น
   ไม่ต้องเกริ่นนำ ไม่ต้องสรุปซ้ำท้ายคำตอบ
8. ชื่อสายพันธุ์ ชื่อครอป ชื่อลูกค้า เขียนตามที่ปรากฏในข้อมูล ไม่ต้องแปล
9. ถ้าคำถามระบุเจาะจง (คลังไหน เดือนไหน ครอปไหน สายพันธุ์ไหน) ต้องตอบตัวเลขของสิ่งนั้นโดยตรง
   ห้ามเอายอดรวมทุกคลัง/ทุกเดือนมาตอบแทน ถ้าบริบทมีแต่ยอดรวมให้บอกตรง ๆ ว่าแยกไม่ได้
10. คำถามคนละเรื่องต้องดึงจากคนละรายงาน อย่าสลับกัน
   - "ขายดี / ยอดขาย / ลูกค้า" → รายงานการขายดอก
   - "คงเหลือ / สต็อก" → รายงานสินค้าคงเหลือ
   - "ผลผลิต / ต่อต้น" → รายงานผลผลิตต่อครอป
   ถ้าถามหลายเรื่องในประโยคเดียว ให้แยกตอบทีละเรื่องพร้อมบอกว่ามาจากรายงานไหน`;
