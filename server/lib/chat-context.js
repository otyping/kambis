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
export function buildDataContext(payload, supplyPayload = null) {
  /* ทุกจุดที่อ่าน kpi/sources ต้องกัน undefined ไว้
   *
   * รายงานบางตัวโหลดแบบ lazy (เช่นวัสดุสิ้นเปลือง) และแหล่งข้อมูลหนึ่งพังไม่ควร
   * ทำให้ทั้ง response พัง — ถ้า deref ตรง ๆ แล้ว key หายไป จะกลายเป็น 500
   * ตอนผู้ใช้ถามคำถาม ซึ่งเป็นอาการที่หาสาเหตุยากมาก */
  const meta = payload?.meta ?? {};
  const kpi = payload?.kpi ?? {};
  const analysis = payload?.analysis ?? { counts: {}, findings: [], total: 0 };
  const sources = payload?.sources ?? {};
  const rowsOf = (key) => sources[key]?.rows ?? [];
  const pc = kpi.perCrop ?? {};
  const dt = kpi.dailyTrim ?? {};
  const ob = kpi.outbound ?? {};
  const ib = kpi.inbound ?? {};
  const sl = kpi.sales ?? {};
  const inv = kpi.inventory ?? {};
  const out = [];

  out.push('# ข้อมูล Dashboard ณ ปัจจุบัน');
  out.push(`ดึงข้อมูลเมื่อ: ${meta.fetchedAt ?? '—'}`);
  out.push(
    `คะแนนคุณภาพข้อมูล: ${analysis.score ?? '—'}/100 (ตรวจ ${n(analysis.rowsChecked)} แถว)`
  );
  out.push('');

  out.push('## ตัวเลขสำคัญระดับผู้บริหาร');
  for (const h of kpi.headline ?? []) {
    const unit = h.unit ? ` ${h.unit}` : '';
    out.push(`- ${h.labelTh}: ${n(h.value, h.unit === '%' ? 1 : 0)}${unit} (${h.hint})`);
  }
  out.push('');

  out.push('## ผลผลิตต่อครอป (แหล่ง: แบบฟอร์มน้ำหนักดอกทริมต่อครอป)');
  out.push(`- ผลผลิตดอกรวมของครอปที่เก็บเกี่ยวแล้ว: ${n(pc.totalFlower)} g`);
  out.push(`- จำนวนต้นรวม: ${n(pc.totalPlants)} ต้น`);
  out.push(`- ผลผลิตต่อต้นเฉลี่ย: ${n(pc.gPerPlant, 2)} g/ต้น`);
  out.push(`- ครอปที่เก็บเกี่ยวแล้ว ${pc.harvestedCount} ครอป / กำลังปลูก ${pc.plannedCount} ครอป`);
  out.push('- สัดส่วนตามขนาด:');
  out.push(sizeMix(pc.sizeMix));
  out.push('- แยกตามไตรมาส (ผลผลิตรวม / จำนวนต้น / g ต่อต้น):');
  for (const q of pc.byQuarter ?? []) {
    out.push(`  - ${q.key}: ${n(q.flower)} g / ${n(q.plants)} ต้น / ${n(q.gPerPlant, 2)} g ต่อต้น`);
  }
  out.push('- ครอปที่ให้ผลผลิตต่อต้นสูงสุด:');
  for (const c of (pc.topCrops ?? []).slice(0, 8)) {
    out.push(`  - ${c.crop} (${c.quarter}): ${n(c.gPerPlant, 2)} g/ต้น จาก ${n(c.plants)} ต้น`);
  }
  out.push('- ครอปที่กำลังปลูก (รอบปลูก โคลน→เร่งใบ→ทำดอก→เก็บเกี่ยว→ดอกพร้อม):');
  for (const u of pc.upcoming ?? []) {
    const c = u.cycle || {};
    out.push(
      `  - ${u.crop} (${u.quarter ?? '—'}): โคลน ${c.clone ?? '—'} / เร่งใบ ${c.veg ?? '—'} / ทำดอก ${c.flower ?? '—'} / เก็บเกี่ยว ${c.harvest ?? '—'} / ดอกพร้อม ${c.dryReady ?? '—'}`
    );
  }
  out.push('');

  out.push('## ผลผลิตทริมรายวัน (แหล่ง: แบบฟอร์มน้ำหนักดอกทริมรายวัน)');
  out.push(`- รวมน้ำหนักดอก: ${n(dt.totalFlower)} g / ไม่ใช่ดอก: ${n(dt.totalNonFlower)} g`);
  out.push(`- จำนวนวันที่มีการทริม: ${dt.dayCount} วัน`);
  out.push('- แยกตามครอป (สูงสุด 10):');
  out.push(breakdown(dt.byCrop, 10));
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(dt.byStrain, 10));
  out.push('');

  out.push('## ขนย้ายออกจากฟาร์ม');
  out.push(`- รวมน้ำหนักดอก: ${n(ob.totalFlower)} g / ไม่ใช่ดอก: ${n(ob.totalNonFlower)} g`);
  out.push(`- จำนวนเที่ยวขน: ${ob.shipmentCount}`);
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(ob.byStrain, 10));
  out.push('');

  out.push('## รับดอกเข้าคลังกรุงเทพ');
  out.push(`- รวมน้ำหนักดอก: ${n(ib.totalFlower)} g / ไม่ใช่ดอก: ${n(ib.totalNonFlower)} g`);
  out.push(`- จำนวนครั้งที่รับ: ${ib.receiptCount}`);
  const recon = (ib.reconciliation ?? []).filter((r) => r.diff !== null);
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
  out.push(`- ยอดขายดอกรวม: ${n(sl.totalFlower)} g / ของไม่ใช่ดอก: ${n(sl.totalNonFlower)} g`);
  out.push(`- จำนวนลูกค้า: ${sl.customerCount} / จำนวนครั้งที่ขาย: ${sl.orderCount}`);
  out.push('- แยกตามลูกค้า:');
  out.push(breakdown(sl.byCustomer, 15));
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(sl.byStrain, 10));
  out.push('- ยอดรายเดือน:');
  for (const m of sl.byMonth ?? []) {
    out.push(`  - ${m.month}: ดอก ${n(m.flower)} g / ไม่ใช่ดอก ${n(m.nonFlower)} g`);
  }
  out.push('');

  out.push('## สินค้าคงเหลือ');
  out.push(`- รวมน้ำหนักดอก: ${n(inv.totalFlower)} g / ไม่ใช่ดอก: ${n(inv.totalNonFlower)} g`);
  out.push(`- ข้อมูล ณ วันที่: ${(inv.updatedAt ?? []).join(', ') || '—'}`);
  out.push('- แยกตามคลัง:');
  out.push(breakdown(inv.byLocation, 10));
  out.push('- แยกตามสายพันธุ์:');
  out.push(breakdown(inv.byStrain, 12));
  out.push('- สัดส่วนตามขนาด:');
  out.push(sizeMix(inv.sizeMix));
  out.push('');

  out.push('## คุณภาพข้อมูล');
  out.push(
    `- พบทั้งหมด ${analysis.total ?? 0} รายการ: ร้ายแรง ${analysis.counts?.critical ?? 0} / ควรตรวจสอบ ${analysis.counts?.warning ?? 0} / ข้อสังเกต ${analysis.counts?.info ?? 0}`
  );
  out.push('- รายการร้ายแรงทั้งหมด:');
  const criticals = (analysis.findings ?? []).filter((f) => f.severity === 'critical');
  for (const f of criticals) {
    out.push(`  - [${f.source}] ${f.messageTh}`);
  }
  const warnGroups = new Map();
  for (const f of (analysis.findings ?? []).filter((x) => x.severity === 'warning')) {
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
  out.push(`- สายพันธุ์: ${distinct([...rowsOf('sales'), ...rowsOf('inventory')], 'strain')}`);
  out.push(`- ลูกค้า: ${distinct(rowsOf('sales'), 'customer')}`);
  out.push(`- คลัง: ${distinct(rowsOf('inventory'), 'location')}`);
  out.push(`- ครอปที่มีข้อมูลผลผลิต: ${distinct(rowsOf('perCrop'), 'crop')}`);
  out.push('');

  /* งบรายรับ-รายจ่าย (ชีตแบบฟอร์มต้นทุน)
   *
   * เป็นแหล่งเดียวที่มีคำว่า "รายได้" ในระบบ จึงต้องอยู่ในบริบทเสมอ
   * ใส่เป็นตารางรายเดือนเพราะคำถามส่วนใหญ่ถามเทียบเดือน ("เดือนไหนกำไร") */
  const fin = kpi?.cost;
  if (fin?.available) {
    out.push(`## งบรายรับ-รายจ่าย ปี ${fin.year} (แหล่ง: แบบฟอร์มต้นทุน — แท็บ "สรุป")`);
    out.push('หน่วยเป็นบาททั้งหมด · เป็นงบระดับบริษัท ไม่ใช่แยกรายลูกค้าหรือสายพันธุ์');
    out.push(
      `- ทั้งปี: รายได้ ${n(fin.totals.revenue)} · ต้นทุนการปลูก ${n(fin.totals.cost)} ` +
        `· กำไรขั้นต้น ${n(fin.totals.grossProfit)} · EBITDA ${n(fin.totals.ebitda)} ` +
        `· ค่าเสื่อมราคา ${n(fin.totals.depreciation)} · EBIT ${n(fin.totals.ebit)}`
    );
    out.push(
      `- แยกต้นทุน: วัตถุดิบ ${n(fin.totals.materialCost)} · Farm ${n(fin.totals.farmExpense)} ` +
        `· Office ${n(fin.totals.officeExpense)}`
    );
    out.push('- รายเดือน (เดือน | รายได้ | ต้นทุน | กำไรขั้นต้น | EBITDA):');
    for (const m of fin.byMonth) {
      if (m.revenue === null && m.cost === null) continue;
      out.push(
        `  - ${m.month} | ${n(m.revenue)} | ${n(m.cost)} | ${n(m.grossProfit)} | ${n(m.ebitda)}`
      );
    }
    out.push(
      `- เดือนล่าสุดที่มีความเคลื่อนไหว: ${fin.lastActiveMonth ?? '—'} ` +
        '(เดือนหลังจากนี้ยังไม่มีรายการ ไม่ใช่ยอดเป็นศูนย์)'
    );
    out.push('');
  } else {
    out.push('## งบรายรับ-รายจ่าย');
    out.push('- ยังอ่านชีต "แบบฟอร์มต้นทุน" ไม่ได้ในรอบนี้ จึงไม่มีตัวเลขรายได้/ต้นทุนให้ตอบ');
    out.push('');
  }

  /* วัสดุสิ้นเปลือง — ใส่เฉพาะเมื่อโหลดแล้ว เพราะรายงานนี้เป็น lazy
   * จำกัดความยาวไว้ เพราะมี 138 รายการแต่บริบททั้งก้อนมีงบราว 8 พันตัวอักษร */
  const sup = supplyPayload?.kpi;
  if (sup) {
    out.push('## วัสดุสิ้นเปลือง (แหล่ง: รายงาน Log Stock บันทึกประจำวัน)');
    out.push(`- จำนวนรายการที่ติดตาม: ${sup.itemCount} รายการ · ข้อมูล ณ ${sup.asOf || '—'}`);
    out.push(`- เดือนที่มีข้อมูลการเบิก: ${(sup.months ?? []).join(', ') || '—'}`);
    out.push(`- ของที่ต่ำกว่าหรือเท่าจำนวนขั้นต่ำ (ต้องสั่งซื้อ): ${(sup.needsReorder ?? []).length} รายการ`);
    for (const r of (sup.needsReorder ?? []).slice(0, 20)) {
      const price = r.unitPrice === null ? 'ไม่มีราคาในชีต' : `${n(r.unitPrice, 2)} บาท/${r.unit ?? 'หน่วย'}`;
      out.push(
        `  - ${r.item}: คงเหลือ ${n(r.balance)} ${r.unit ?? ''} (ขั้นต่ำ ${n(r.minimum)}) ` +
          `ควรสั่ง ${n(r.suggestedQty)} · ${price}`
      );
    }
    if ((sup.needsReorder ?? []).length > 20) {
      out.push(`  … และอีก ${sup.needsReorder.length - 20} รายการ`);
    }
    out.push('- เบิกใช้มากที่สุด (รวมทุกเดือน):');
    for (const u of (sup.usage ?? []).slice(0, 10)) {
      out.push(`  - ${u.item}: ${n(u.total)} ${u.unit ?? ''}`);
    }
    out.push(
      `- มูลค่าตามตารางสั่งของรายเดือน: ${n(sup.order?.totalAmount)} บาท ` +
        `(จาก ${(sup.order?.items ?? []).length} รายการ — เป็นข้อมูลราคาชุดเดียวที่มีในระบบ)`
    );
    out.push('');
  }

  out.push('## สถานะการดึงข้อมูลแต่ละแหล่ง');
  for (const s of meta.sources ?? []) {
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
   - "คงเหลือ / สต็อก" (ดอก) → รายงานสินค้าคงเหลือ
   - "ผลผลิต / ต่อต้น" → รายงานผลผลิตต่อครอป
   - "ของใช้ / วัสดุ / อุปกรณ์ / ต้องสั่งซื้อ / เบิกของ / ใกล้หมด" → รายงาน Log Stock บันทึกประจำวัน
   ถ้าถามหลายเรื่องในประโยคเดียว ให้แยกตอบทีละเรื่องพร้อมบอกว่ามาจากรายงานไหน
11. คำว่า "สต็อก" กำกวม ต้องแยกให้ชัดว่าเป็น **สต็อกดอก** (สินค้าคงเหลือ หน่วยเป็นกรัม)
   หรือ **สต็อกของใช้** (วัสดุสิ้นเปลือง หน่วยเป็นชิ้น/กล่อง/ถัง) ถ้าไม่ชัดให้ถามกลับ
12. เงินในระบบมาจากสามที่ ซึ่ง **คนละขอบเขตกัน ห้ามเอามาบวกกัน**
   - **รายได้ / ต้นทุนการปลูก / EBITDA / ค่าเสื่อมราคา / EBIT** → ชีต "แบบฟอร์มต้นทุน"
     เป็นงบรายเดือนระดับบริษัท ใช้ตอบคำถามเรื่องรายได้และกำไรได้เต็มที่
   - **ต้นทุนวัสดุสิ้นเปลือง** → แท็บ "สั่งของรายเดือน" ของรายงาน Log Stock
     เป็นของใช้ในฟาร์ม ไม่ใช่ต้นทุนการปลูก
   - **รายงานการขายดอกยังไม่มีคอลัมน์ราคา** จึงแยกรายได้รายลูกค้า/สายพันธุ์
     หรือคิดราคาขายเฉลี่ยต่อกรัม (ASP) **ไม่ได้** ถ้าถูกถามให้ตอบตรง ๆ ว่าชีตยังไม่มีราคา
     **ห้ามเอารายได้รวมจากชีตต้นทุนไปหารด้วยกรัมที่ขายเพื่อเดา ASP เด็ดขาด**
     เพราะรายได้ก้อนนั้นเป็นของทั้งบริษัท ไม่ได้ผูกกับรายการขายรายบรรทัด
13. ตัวเลขในงบต้นทุนให้อ่านจาก "งบสรุป" เสมอ ซึ่งเป็นตัวเลขที่ผู้บริหารถืออยู่จริง
   ผลรวมของแท็บรายละเอียดยังไม่ตรงกับงบสรุปอยู่บางจุด (มี finding กำกับไว้แล้ว)
   ถ้าคำถามแตะจุดที่ไม่ตรง ให้บอกทั้งสองตัวเลขพร้อมบอกว่าต่างกันเท่าไร ห้ามเลือกข้างเอง
14. **ต้นทุนต่อกรัมยังคำนวณไม่ได้** ถึงจะมีทั้งต้นทุนรายเดือนและผลผลิตรายเดือน
   เพราะต้นทุนของเดือนหนึ่งเป็นของครอปที่เก็บเกี่ยวอีกเดือนหนึ่ง ยังไม่มีกติกาผูกให้
   ถ้าถูกถามให้อธิบายเหตุผลนี้ **ห้ามหารกันตรง ๆ แล้วตอบเป็นตัวเลข**`;
