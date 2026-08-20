/**
 * shared/kpi.js — สร้าง KPI และชุดข้อมูลกราฟทั้งหมด
 *
 * ไฟล์นี้อยู่ใน public/ เพราะ **ทั้งฝั่ง server และเบราว์เซอร์เรียกฟังก์ชันตัวเดียวกัน**
 *
 * ฝั่ง server เรียกตอนประกอบ payload ส่วนเบราว์เซอร์เรียกซ้ำทุกครั้งที่ผู้ใช้
 * เปลี่ยนแถบตัวกรองกลาง โดยส่ง record ที่กรองแล้วเข้าไป
 *
 * ถ้าแยกเป็นสองชุด ตัวเลขบนการ์ดเดียวกันจะเพี้ยนจากกันได้เงียบ ๆ เวลามีคนแก้สูตร
 * ที่เดียว — ซึ่งเป็นบั๊กที่หาเจอยากที่สุดประเภทหนึ่ง
 *
 * ข้อบังคับ: import ได้เฉพาะจาก agg-core.js เท่านั้น ห้ามแตะ DOM หรือโมดูลของ node
 */
import {
  sum,
  comparePeriod,
  sizeMix,
  nonFlowerMix,
  groupSum,
  premiumPct,
  monthlySeries,
  dailySeries,
  normalizeItemName,
} from './agg-core.js';

/**
 * สรุปข้อมูลวัสดุสิ้นเปลืองจากชีต Log Stock
 *
 * ต่างจากรายงานอื่นตรงที่ "ยอดปัจจุบัน" ไม่ได้มาจากการบวกแถว แต่มาจาก
 * แถวล่าสุดที่ยังไม่เลยวันนี้ของแต่ละรายการ ซึ่ง parser คำนวณมาให้แล้วใน tab.current
 * (ชีตมีแถวลงวันที่ล่วงหน้าที่ยอดถูก carry forward ไว้ — บวกทั้งคอลัมน์จะได้เลขมั่ว)
 */
/**
 * ยอดคงเหลือของรายการหนึ่ง ณ วันที่ที่กำหนด
 *
 * ใช้กฎเดียวกับที่ parser คิด `tab.current` เป๊ะ ๆ — **แถวล่าสุดที่วันที่ ≤ วันที่ที่ขอ
 * และมียอดคงเหลือ** ไม่ใช่แถวสุดท้ายของแท็บ เพราะชีตมีแถวลงวันที่ล่วงหน้า
 * ที่ยอดถูก carry forward ไว้ (19,458 จาก 25,392 แถวเป็นแถวอนาคต)
 *
 * `ขั้นต่ำ` ต้องมาจาก **แถวเดียวกัน** ไม่ใช่แถวแรก เพราะเปลี่ยนได้ระหว่างทาง
 * (เจอจริง: COCO 85→38, Cuts 11→5) — นี่คือจุดที่ผิดแล้วยังดูสมเหตุสมผลที่สุด
 *
 * ตั้งใจให้ผลลัพธ์ตรงกับ `items[].balance/minimum/index` ที่ server ส่งมา
 * เมื่อ `asOf` เป็นวันเดียวกับที่ server ใช้ — มี test คุมความเท่ากันนี้ไว้
 *
 * @param {Array<{date:string, balance?:number, minimum?:number}>} log log ย่อของรายการ
 * @param {string} asOf วันที่ YYYY-MM-DD
 * @returns {{date:string, balance:number, minimum:number|null, index:number|null}|null}
 */
export function stockAt(log, asOf) {
  if (!Array.isArray(log) || !asOf) return null;
  let hit = null;
  for (const row of log) {
    if (!row?.date || row.date > asOf) continue;
    // log เรียงตามลำดับแถวในชีต ไม่ได้การันตีว่าเรียงวันที่ — เทียบวันที่เองทุกแถว
    if (row.balance === null || row.balance === undefined) continue;
    if (!hit || row.date >= hit.date) hit = row;
  }
  if (!hit) return null;
  const minimum = hit.minimum ?? null;
  return {
    date: hit.date,
    balance: hit.balance,
    minimum,
    // Index คำนวณใหม่เสมอจาก คงเหลือ − ขั้นต่ำ ไม่เชื่อช่อง Index ในชีต
    index: minimum === null ? null : hit.balance - minimum,
  };
}

/**
 * มูลค่าของที่เบิกในแต่ละเดือน = Σ (จำนวนเบิก × ราคา/หน่วย) แยกตามหมวด
 *
 * คิดในเบราว์เซอร์จาก `kpi.usage` ที่ส่งมาแล้ว ด้วยเหตุผลเดียวกับ `stockAt()`:
 * ตัวเลขต้องเดินตามตัวกรองของหน้า (ปี · คำค้น · หมวด) ซึ่ง server ไม่รู้จัก
 *
 * **ราคาเป็นราคาปัจจุบันจากคอลัมน์ H ของแท็บนั้น ไม่ใช่ราคาที่ซื้อจริงในเดือนนั้น**
 * ชีตเก็บราคาไว้ช่องเดียวต่อรายการ ไม่มีประวัติราคา ตัวเลขนี้จึงตอบว่า "ของที่เบิกไป
 * เดือนนั้น ถ้าซื้อวันนี้ต้องจ่ายเท่าไร" ผู้เรียกต้องเขียนกำกับบนหน้าจอเสมอ
 * ห้ามปล่อยให้อ่านเหมือนยอดจ่ายจริงของเดือนนั้น
 *
 * **รายการที่ไม่มีราคาไม่ถูกนับเป็น 0** แต่คืนชื่อออกมาทาง `unpriced` ให้ผู้เรียก
 * บอกผู้ใช้ว่ายอดยังไม่ครบกี่รายการ (กฎเดียวกับมูลค่าสต๊อกในตารางสต๊อก)
 *
 * @param {Array<{item:string, byMonth:Record<string,number>}>} usage แถวการเบิกที่กรองแล้ว
 * @param {string[]} months เดือนที่จะแสดง เรียงมาแล้ว (YYYY-MM)
 * @param {{priceOf:(name:string)=>number|null, groupOf:(name:string)=>string|null}} lookup
 * @returns {{rows:{month:string, byGroup:Record<string,number>, total:number}[],
 *            total:number, priced:string[], unpriced:string[]}}
 */
export function usageValueByMonth(usage = [], months = [], lookup = {}) {
  const priceOf = lookup.priceOf ?? (() => null);
  const groupOf = lookup.groupOf ?? (() => null);

  const rows = months.map((month) => ({ month, byGroup: {}, total: 0 }));
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const priced = [];
  const unpriced = [];
  let total = 0;

  for (const row of usage) {
    /* นับเฉพาะรายการที่เบิกจริงในเดือนที่กำลังแสดงอยู่ — รายการที่ไม่ได้เบิกในช่วงนี้
     * ไม่ควรถูกนับเป็น "รายการที่ยังไม่มีราคา" เพราะไม่ได้ทำให้ยอดของช่วงนี้ขาดไป */
    const qty = months.reduce((s, m) => s + (row?.byMonth?.[m] ?? 0), 0);
    if (!qty) continue;

    const price = priceOf(row.item);
    if (price === null || price === undefined) {
      unpriced.push(row.item);
      continue;
    }
    priced.push(row.item);

    // หมวดที่จับไม่ได้ต้องมีที่อยู่ของตัวเอง ('') ไม่ใช่ไปกองรวมกับหมวดใดหมวดหนึ่ง
    const group = groupOf(row.item) ?? '';
    for (const month of months) {
      const qtyOfMonth = row.byMonth?.[month];
      if (!qtyOfMonth) continue;
      const value = qtyOfMonth * price;
      const bucket = byMonth.get(month);
      bucket.byGroup[group] = (bucket.byGroup[group] ?? 0) + value;
      bucket.total += value;
      total += value;
    }
  }

  return { rows, total, priced, unpriced };
}

/**
 * ติดสถานะ "ขอซื้อไปแล้ว รอของ" ให้รายการที่ต้องสั่งซื้อ
 *
 * ปัญหาที่แก้: ของที่ขอซื้อไปแล้วยังต่ำกว่าขั้นต่ำอยู่จนกว่าของจะมาถึง
 * มันจึงโผล่ในตาราง "ของที่ต้องสั่งซื้อ" ทุกวันเหมือนไม่เคยขอ ฝ่ายจัดซื้อ
 * ที่กดขอไปเมื่อวานจึงไม่มีทางรู้ว่ารายการไหนกำลังรอของอยู่ แล้วขอซ้ำ
 *
 * **ปิดสถานะเองจาก Log Sheet ไม่ต้องให้ใครมากดอัปเดต** — ชีตมีคอลัมน์ "รับ"
 * อยู่แล้ว ถ้ามีแถวที่รับของเข้าหลังวันที่ขอ แปลว่าของถึงแล้ว ใบนั้นจบ
 * (ระบบไม่รู้ว่า CEO อนุมัติหรือยัง เพราะขั้นนั้นไม่ได้อยู่ในชีต — จึงบอกได้แค่
 * "ขอไปแล้วกี่วัน" ซึ่งเป็นสิ่งที่ต้องรู้จริง ๆ เพื่อไม่ให้ขอซ้ำ)
 *
 * เทียบกับ Lead Time ที่เขียนไว้ในหัวตารางด้วย ถ้าเลยกำหนดแล้วของยังไม่มา
 * ให้ติดธง `overdue` ไว้ตาม — แต่ **เฉพาะรายการที่ชีตเขียน Lead Time ไว้จริง**
 * (มีแค่ 65 จาก 138 แท็บ) ที่เหลือ `overdue` เป็น null ห้ามเดา
 *
 * @param {Array} needsReorder แก้ในที่ (เติมฟิลด์ pending)
 * @param {Array} items รายการทั้งหมดพร้อม log — ใช้หาว่ารับของเข้าเมื่อไร
 * @param {Array} purchaseRequests ทะเบียนใบขอซื้อจาก data/purchase-requests/index.json
 * @param {string} asOf วันที่อ้างอิง (YYYY-MM-DD)
 */
function attachPendingRequests(needsReorder, items, purchaseRequests, asOf) {
  if (!needsReorder.length) return;

  // วันที่รับของเข้าครั้งล่าสุดของแต่ละรายการ — ใช้ปิดใบขอซื้อที่ของมาถึงแล้ว
  const lastReceived = new Map();
  for (const entry of items) {
    let latest = null;
    for (const row of entry.log ?? []) {
      if (!row.date || !(row.received > 0)) continue;
      if (!latest || row.date > latest) latest = row.date;
    }
    if (latest) lastReceived.set(entry.item, latest);
  }


  /* ใบล่าสุดของแต่ละรายการที่ยังไม่มีของเข้ามาหลังวันที่ขอ
   * ไล่จากใหม่ไปเก่า เจอใบที่ยังเปิดอยู่ใบแรกก็พอ — ใบเก่ากว่านั้นไม่มีความหมาย
   * เพราะถ้าขอซ้ำหลายรอบ สิ่งที่ต้องรู้คือรอบล่าสุดว่ารอมากี่วันแล้ว */
  const open = new Map();
  const sorted = [...(purchaseRequests ?? [])].sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
  );
  for (const req of sorted) {
    const day = String(req.createdAt ?? '').slice(0, 10);
    if (!day) continue;
    for (const line of req.items ?? []) {
      if (open.has(line.item)) continue;
      const received = lastReceived.get(line.item);
      // ของเข้าหลังวันที่ขอแล้ว = ใบนั้นจบ ไม่ต้องเตือนอีก
      if (received && received >= day) continue;
      open.set(line.item, { docNo: req.docNo, form: req.form ?? 'general', date: day, qty: line.qty ?? null });
    }
  }

  const dayMs = 86_400_000;
  const today = Date.parse(`${asOf}T00:00:00Z`);
  for (const row of needsReorder) {
    const hit = open.get(row.item);
    if (!hit) {
      row.pending = null;
      continue;
    }
    const asked = Date.parse(`${hit.date}T00:00:00Z`);
    const daysAgo = Number.isFinite(today) && Number.isFinite(asked)
      ? Math.max(0, Math.round((today - asked) / dayMs))
      : null;
    row.pending = {
      ...hit,
      daysAgo,
      // ชีตไม่ได้เขียน Lead Time ไว้ทุกแท็บ — ไม่รู้ก็บอกว่าไม่รู้ ห้ามเดาว่าตรงเวลา
      overdue:
        row.leadTimeDays === null || row.leadTimeDays === undefined || daysAgo === null
          ? null
          : daysAgo > row.leadTimeDays,
    };
  }
}


function buildSupply(source, purchaseRequests = [], today = null) {
  const rows = source?.rows ?? [];
  const tabs = (source?.tabs ?? []).filter((t) => !t.skipped && t.role !== 'order');
  const logRows = rows.filter((r) => r.kind === 'log');
  const orderRows = rows.filter((r) => r.kind === 'order');

  // จับคู่ราคาในตารางจัดซื้อกับรายการในแท็บ log ด้วยชื่อที่ normalize แล้ว
  const priceByName = new Map();
  for (const o of orderRows) {
    const key = normalizeItemName(o.item);
    if (key) priceByName.set(key, o);
  }
  const lookupOrder = (itemName) => {
    const key = normalizeItemName(itemName);
    if (!key) return null;
    if (priceByName.has(key)) return priceByName.get(key);

    // ชื่อในสองที่เขียนไม่เท่ากันเสมอ เช่น "Scrog Net" กับ "Scrog Net ตาข่าย"
    // จึงยอมให้ฝั่งหนึ่งเป็นคำขึ้นต้นของอีกฝั่ง แต่ต้องยาวพอไม่ให้จับมั่ว
    //
    // ถ้าเข้าเค้ามากกว่าหนึ่งรายการ ถือว่าจับคู่ไม่ได้ — เดาผิดแล้วได้ราคาผิด
    // แย่กว่าไม่มีราคา เพราะใบขอซื้อจะมีตัวเลขที่ดูน่าเชื่อแต่ผิด
    // (เช่น "กระบอกตวง" เข้าได้ทั้งขนาด 1000 / 3000 / 5000 มล.)
    const candidates = [];
    for (const [k, v] of priceByName) {
      if (k.length >= 4 && (k.startsWith(key) || key.startsWith(k))) candidates.push(v);
    }
    return candidates.length === 1 ? candidates[0] : null;
  };

  /* ราคาปัจจุบันของรายการหนึ่ง — มาจากหัวตารางของแท็บนั้น (คอลัมน์ H)
   * ใช้กฎจับคู่ชื่อชุดเดียวกับ lookupOrder เพราะชื่อในตารางสั่งของกับชื่อแท็บ
   * เขียนไม่ตรงกัน (`ป้ายแท็ก-สีน้ำเงิน` กับ `7.ป้ายแท็กสีน้ำเงิน`)
   * และ **เข้าเค้าหลายรายการ = จับคู่ไม่ได้** เดาผิดแล้วได้ราคาผิดแย่กว่าไม่มีราคา */
  const tabPriceByName = new Map();
  for (const t of tabs) {
    const key = normalizeItemName(t.item);
    if (key && t.unitPrice !== null && t.unitPrice !== undefined) tabPriceByName.set(key, t.unitPrice);
  }
  const priceOfItem = (itemName) => {
    const key = normalizeItemName(itemName);
    if (!key) return null;
    if (tabPriceByName.has(key)) return tabPriceByName.get(key);
    const hits = [];
    for (const [k, v] of tabPriceByName) {
      if (k.length >= 4 && (k.startsWith(key) || key.startsWith(k))) hits.push(v);
    }
    return hits.length === 1 ? hits[0] : null;
  };

  /* log รายวันแบบย่อของแต่ละรายการ
   *
   * record มาตรฐานของระบบมีช่อง sizes/nonFlower/ผลรวม 16 ช่องที่เป็น null หมด
   * สำหรับข้อมูลวัสดุ — ส่งขึ้นเบราว์เซอร์ทั้ง 5,000 แถวคือ 2.8 MB ของค่าว่าง
   * จึงย่อเหลือเฉพาะช่องที่ใช้จริง แล้วตัด null ออกก่อนส่ง (เหลือ ~1 ใน 10) */
  const logByItem = new Map();
  for (const r of logRows) {
    if (!logByItem.has(r.item)) logByItem.set(r.item, []);
    const entry = { date: r.date };
    if (r.received !== null) entry.received = r.received;
    if (r.issued !== null) entry.issued = r.issued;
    if (r.balance !== null) entry.balance = r.balance;
    if (r.minimum !== null) entry.minimum = r.minimum;
    if (r.isFuture) entry.future = true;
    logByItem.get(r.item).push(entry);
  }

  const needsReorder = [];
  /* ของที่ชีตตั้งขั้นต่ำไว้ 0 = ไม่ต้องเก็บสต๊อก — หมดแล้วก็ไม่ต้องรีบสั่ง
   * แยกออกจาก needsReorder เพื่อไม่ให้ยอด "ต้องสั่งซื้อ" เกินจริง (ดูเหตุผลด้านล่าง) */
  const optionalReorder = [];
  const items = [];
  for (const tab of tabs) {
    const cur = tab.current;
    const order = lookupOrder(tab.item);
    /* ใช้ MOQ จากโน้ตได้ต่อเมื่อ **รู้ตัวคูณจริง** เท่านั้น
     * parser คืน size = null เมื่อหน่วยซื้อต่างจากหน่วยสต๊อกแล้วโน้ตไม่ได้บอกตัวคูณ
     * (เจอจริง 80.หัวหยดน้ำ `สั่งครั้งละ 500 ชิ้น` หน่วยสต๊อกเป็น `แพ็ค`)
     * ตกลงมาที่หน่วยสต๊อกตรง ๆ ปลอดภัยกว่าเดาแล้วสั่งเกิน 100 เท่า */
    const usableOrder = Boolean(tab.orderPack && tab.orderPack.size !== null);
    const purchasePackSize = usableOrder ? tab.orderPack.size : 1;
    const entry = {
      item: tab.item,
      itemNo: tab.itemNo ?? null,
      group: tab.group ?? null,
      tab: tab.name,
      gid: tab.gid,
      unit: cur?.unit ?? tab.unit ?? null,
      balance: cur?.balance ?? null,
      minimum: cur?.minimum ?? null,
      index: cur?.index ?? null,
      date: cur?.date ?? null,
      note: tab.note ?? null,
      /* ระยะเวลารอของ — คนเขียนแทรกไว้ในหัวตารางของแท็บ ไม่ใช่คอลัมน์
       * มีแค่ราวครึ่งหนึ่งของรายการ ที่เหลือเป็น null และต้องคง null ไว้ ห้ามเดา */
      leadTimeDays: tab.leadTimeDays ?? null,
      /* ราคามาจากหัวตารางของแท็บรายการเอง (คอลัมน์ H) **ไม่ใช่แท็บ "สั่งของรายเดือน"**
       *
       * ผู้ใช้เลิกใช้ช่องราคาในตารางสั่งของแล้ว เลขที่ค้างอยู่ตรงนั้นไม่ตรงกับของจริง
       * (เจอจริง: แผ่นกาวดักแมลง 65 vs 6.5 · แอลกอฮอล์ 1,318 vs 1,919.5 · Rockwool 200 vs 196.75)
       * **ห้ามตกไปใช้ราคาเก่าเมื่อคอลัมน์ H ว่าง** เพราะจะได้ตัวเลขที่เลิกใช้แล้วมาปนเงียบ ๆ
       * ไม่มีราคา = ขึ้น "ยังไม่ใส่ราคา" ให้คนไปเติมที่ชีต ซึ่งเป็นคำตอบที่ถูกกว่า */
      unitPrice: tab.unitPrice ?? null,
      priceUnit: tab.priceUnit ?? null,
      priceQty: tab.priceQty ?? null,
      /* ราคาดิบตามที่ชีตเขียน + ตัวคูณแพ็ค — เก็บไว้ให้หน้าเว็บอธิบายที่มาของ unitPrice ได้
       * คนเปิดชีตเห็น 799 แล้วหน้าจอเขียน 33.29 ถ้าไม่บอกที่มาเขาจะเลิกเชื่อทั้งตาราง */
      pack: tab.pricePack ?? null,
      order: tab.orderPack ?? null,
      /* **หน่วยที่ซื้อจริง** ต่างจากหน่วยสต๊อกได้ (ทิชชู่นับเป็นห่อ แต่ซื้อเป็นลัง)
       * ใบขอซื้อกับช่องจำนวนบนตารางใช้หน่วยนี้ ส่วนคงเหลือ/ขั้นต่ำ/Index ยังเป็นหน่วยสต๊อก
       * ไม่รู้ขนาดแพ็ค = ซื้อเป็นหน่วยสต๊อกตรง ๆ (packSize 1) ไม่ใช่เดาว่า 1 แพ็ค = 1 หน่วย */
      purchaseUnit: usableOrder ? tab.orderPack.unit : (cur?.unit ?? tab.unit ?? null),
      purchasePackSize: purchasePackSize,
      /* ราคาต่อ 1 หน่วยซื้อ — **คูณก่อนหาร** ไม่งั้น 799/24×24 = 799.0000000000001 */
      purchaseUnitPrice:
        tab.pricePack == null ? null : (tab.pricePack.price * purchasePackSize) / tab.pricePack.size,
      moq: usableOrder ? tab.orderPack.moq : null,
      orderQty: order?.orderQty ?? null,
      lastOrderedText: order?.lastOrderedText ?? null,
      lifetimeText: order?.lifetimeText ?? null,
      matchedOrderRow: order ? order.item : null,
      log: logByItem.get(tab.item) ?? [],
    };
    items.push(entry);

    /* เกณฑ์ "ต้องสั่งซื้อ" = Index ≤ 0 (Index = คงเหลือ − ขั้นต่ำ)
     *
     * รวมของที่คงเหลือ "เท่าขั้นต่ำพอดี" เข้ามาด้วย ตามที่ผู้ใช้กำหนดไว้ล่าสุด
     * (เดิมใช้ < 0) เหตุผลคือระหว่างรอของ 5–7 วันตาม Lead Time ที่เขียนไว้ในชีต
     * ของจะถูกเบิกจนต่ำกว่าขั้นต่ำแน่นอน ถ้ารอให้ติดลบก่อนค่อยสั่งก็สายไปแล้ว
     *
     * คำนวณ Index ใหม่จาก คงเหลือ − ขั้นต่ำ เสมอ ไม่เชื่อช่อง Index ในชีต
     * เพราะเป็นสูตรที่คนพิมพ์ทับได้ (มีกฎ supply.indexMismatch คอยจับอยู่) */
    if (entry.index !== null && entry.index <= 0) {
      // จำนวนที่ควรสั่ง: ใช้ที่ฝ่ายจัดซื้อกำหนดไว้ก่อน ถ้าไม่มีค่อยคิดจากส่วนที่ขาด
      const shortfall = -entry.index;
      /* **คิดจากแท็บ log เอง ไม่ใช้ช่อง "จำนวนสั่งซื้อ" ในตารางสั่งของรายเดือน**
       *
       * ช่องนั้นเป็นเลขที่คนพิมพ์ค้างไว้ และค้างมาจากสถานการณ์คนละอันกับตอนนี้ —
       * ทั้ง 5 รายการที่มีเลขอยู่ มียอด `คงเหลือ ณ ปัจจุบัน` ในตารางไม่ตรงกับ log สักอัน
       * (ฟองน้ำสก็อตไบร์ท ตารางเขียน 10 แต่ log จริงเหลือ 1 · น้ำยาอเนกประสงค์ 3 vs 0)
       *
       * เคสจริงที่ผู้ใช้จับได้: ฟองน้ำสก็อตไบร์ท ตารางเขียน `จำนวนสั่งซื้อ 12`
       * ระบบจึงเสนอให้ซื้อ 12 แพ็ค = 2,268 บาท ทั้งที่ของขาด 0 (คงเหลือ 1 = ขั้นต่ำ 1)
       * และหมายเหตุในแท็บของมันเองเขียนว่า `ใช้ 2 แพ็ค/เดือน สั่งครั้งละ 2 แพ็ค`
       * — 12 แพ็คคือของใช้ 6 เดือน
       *
       * ที่แย่กว่าคือ **มันถูกหรือผิดขึ้นกับความบังเอิญ** ปากกาเขียนป้ายแท้กมีปัญหา
       * เดียวกันเป๊ะ (ตารางเขียน 20) แต่รอดมาได้เพราะหน่วยในตารางบังเอิญเขียนเป็น
       * `ด้าม` ไม่ตรงกับ `แพ็ค` ในแท็บ log ระบบเลยทิ้งเลขนั้นไป
       *
       * เป็นปัญหาชนิดเดียวกับ **ช่องราคา** ในตารางเดียวกันนี้ ซึ่งเลิกใช้ไปแล้ว (ดู §7)
       * ต่างกันแค่คนละคอลัมน์ — ผู้ใช้สั่งให้เลิกใช้ช่องจำนวนด้วย ส.ค. 69 */
      const needStock = Math.max(shortfall, entry.minimum ?? 0, 1);

      /* ปัดขึ้นเป็นแพ็คเต็ม แล้วปัดต่อให้เป็นพหุคูณของ "สั่งครั้งละ N" ที่ชีตเขียนไว้
       * ซื้อครึ่งลังไม่ได้ และผู้ขายก็ไม่ขายต่ำกว่าขั้นต่ำ */
      const size = entry.purchasePackSize || 1;
      let packs = Math.max(1, Math.ceil(needStock / size));
      if (entry.moq) packs = Math.ceil(packs / entry.moq) * entry.moq;
      const orderStockQty = packs * size;

      // ไม่เอา log ติดไปด้วย ไม่งั้นข้อมูลชุดเดียวกันถูกส่งซ้ำสองรอบ
      const { log, ...withoutLog } = entry;
      const row = {
        ...withoutLog,
        shortfall,
        // ที่ขาดจริงก่อนปัดเป็นแพ็ค (หน่วยสต๊อก) — ใช้บอกผู้ใช้ว่าทำไมถึงสั่งเกินที่ขาด
        suggestedStockQty: needStock,
        // **suggestedQty เป็นหน่วยซื้อแล้ว** คือเลขที่ขึ้นในช่องกรอกและในใบขอซื้อ
        suggestedQty: packs,
        suggestedPacks: packs,
        // เทียบเท่ากี่หน่วยสต๊อก — แสดงใต้ช่องกรอกให้เห็นว่าสั่งไปแล้วได้ของเท่าไร
        orderStockQty,
        /* คิดจากหน่วยสต๊อกเสมอ เป็นสูตรเดียวที่กันการคูณซ้ำสองแกน
         * (ใบมีดผ่าตัด: 7.5/ใบ + สั่งครั้งละ 1 กล่อง = 100 ใบ → 750 ไม่ใช่ 7.5 และไม่ใช่ 75,000) */
        amount: entry.unitPrice !== null ? orderStockQty * entry.unitPrice : null,
      };

      /* **ขั้นต่ำ = 0 แปลว่า "ไม่ต้องเก็บสต๊อกไว้" ไม่ใช่ "ขาดของ"**
       *
       * ของพวกนี้คงเหลือ 0 · ขั้นต่ำ 0 · Index 0 จึงเข้าเกณฑ์ `index ≤ 0` ไปด้วย
       * ทั้งที่ไม่มีอะไรต้องรีบ (เครื่องมือที่ซื้อเมื่อพัง ของที่สั่งเฉพาะตอนใช้)
       * ถ้าปนอยู่ในตารางเดียวกัน ตัวเลข "ต้องสั่งซื้อ" จะเกินจริงทุกวัน
       * แล้วฝ่ายจัดซื้อจะเลิกเชื่อทั้งตาราง
       *
       * แยกออกมาเป็นรายการที่ **เลือกสั่งเองได้** แต่ไม่ติ๊กไว้ให้ และไม่นับเข้ายอด */
      if (entry.minimum === 0) optionalReorder.push(row);
      else needsReorder.push(row);
    }
  }

  // ขาดหนักสุดขึ้นก่อน — index ยิ่งติดลบยิ่งเร่งด่วน
  needsReorder.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  // กลุ่มไม่บังคับเรียงตามชื่อ เพราะไม่มีอะไรเร่งด่วนกว่ากัน
  optionalReorder.sort((a, b) => String(a.item).localeCompare(String(b.item), 'th'));

  const months = [...new Set(logRows.map((r) => r.month).filter(Boolean))].sort(comparePeriod);

  const matrix = (valueKey) => {
    const byItem = new Map();
    for (const r of logRows) {
      const v = r[valueKey];
      if (v === null || v === undefined) continue;
      if (!byItem.has(r.item)) {
        byItem.set(r.item, { item: r.item, unit: r.unit ?? null, byMonth: {}, total: 0 });
      }
      const e = byItem.get(r.item);
      e.byMonth[r.month] = (e.byMonth[r.month] ?? 0) + v;
      e.total += v;
    }
    return [...byItem.values()].filter((e) => e.total > 0).sort((a, b) => b.total - a.total);
  };

  const asOf = items.reduce((max, i) => (i.date && i.date > max ? i.date : max), '');
  const usage = matrix('issued');

  /* นับ "รอของมากี่วันแล้ว" จาก **วันจริง** ไม่ใช่วันล่าสุดในชีต
   *
   * ถ้าใช้ asOf แล้วชีตไม่ได้อัปเดตมาสามวัน ตัวเลขจะต่ำกว่าความจริงสามวัน
   * ทั้งที่ของก็ยังไม่มาอยู่ดี — ยิ่งชีตค้างนาน ยิ่งต้องเห็นว่ารอนานแล้ว
   * ไม่ส่ง today มา (เช่นในเทสต์) ถึงค่อยถอยไปใช้ asOf */
  attachPendingRequests(needsReorder, items, purchaseRequests, today || asOf);
  // กลุ่มไม่บังคับก็ต้องรู้ว่าเคยขอไปแล้วเหมือนกัน ไม่งั้นจะขอซ้ำได้เหมือนเดิม
  attachPendingRequests(optionalReorder, items, purchaseRequests, today || asOf);

  return {
    itemCount: items.length,
    tabCount: (source?.tabs ?? []).length,
    asOf,
    items,
    needsReorder,
    optionalReorder,
    months,
    usage,
    received: matrix('received'),
    usageAnomalies: findUsageAnomalies(usage, months, asOf),
    /* ตารางสั่งของรายเดือน — ยังใช้จำนวนที่ฝ่ายจัดซื้อวางแผนไว้ แต่ **ตีราคาใหม่**
     * ด้วยราคาปัจจุบันจากคอลัมน์ H ของแท็บรายการ ไม่ใช่ช่องราคาที่ค้างอยู่ในตารางนี้
     * ไม่งั้นตัวเลข "มูลค่าตามตารางสั่งซื้อ" จะเป็นราคาชุดที่เลิกใช้แล้ว
     * และขัดกับมูลค่าสต๊อกที่อยู่บนหน้าจอเดียวกัน */
    order: {
      items: orderRows.map((o) => {
        const unitPrice = priceOfItem(o.item);
        return {
          item: o.item,
          unit: o.unit,
          balance: o.balance,
          qty: o.orderQty,
          unitPrice,
          // ไม่มีราคา = ไม่มีมูลค่า ห้ามคิดเป็น 0 เพราะยอดรวมจะต่ำกว่าจริงโดยไม่มีอะไรบอก
          amount: unitPrice !== null && o.orderQty !== null ? unitPrice * o.orderQty : null,
          orderDay: o.orderDay,
          lastOrderedText: o.lastOrderedText,
          lifetimeText: o.lifetimeText,
        };
      }),
      totalAmount: sum(
        orderRows.map((o) => {
          const p = priceOfItem(o.item);
          return p !== null && o.orderQty !== null ? p * o.orderQty : null;
        })
      ),
    },
  };
}

/** หัวข้อต้นทุนการปลูกในแท็บรายละเอียด ขึ้นต้นด้วยเลขข้อเสมอ — `1)` `4.1)` `5)` */
const COST_HEADING_RE = /^\s*\d+(?:\.\d+)?\)\s*/;

/**
 * ชื่อที่เอาไปขึ้นจอ — ตัดเลขข้อกับคำว่า "รวม" ออก แล้วเติม "ค่า" ถ้ายังไม่มี
 *
 * `1) รวม ค่าบุคลากร` → `ค่าบุคลากร` · `4.2) Golden Green Coco` → `ค่า Golden Green Coco`
 * เป็นกฎ ไม่ใช่รายชื่อที่ฮาร์ดโค้ด หัวข้อใหม่ที่คนเพิ่มในชีตจึงได้ชื่อที่อ่านรู้เรื่องเอง
 */
function costHeadingLabel(item) {
  const bare = String(item).replace(COST_HEADING_RE, '').replace(/^รวม\s*/, '').trim();
  if (bare.startsWith('ค่า')) return bare;
  // เว้นวรรคเมื่อคำถัดไปไม่ใช่อักษรไทย ไม่งั้นได้ "ค่าCo2" ติดกันจนอ่านสะดุด
  return /^[฀-๿]/.test(bare) ? `ค่า${bare}` : `ค่า ${bare}`;
}

/**
 * แยกรายการในแท็บ "ต้นทุน" เป็นต้นทุนการปลูก กับ ต้นทุนเบ็ดเตล็ด
 *
 * โครงของชีต (ตรวจกับข้อมูลจริงแล้ว) เรียงแบบนี้:
 *
 *   แถวลูก 4 แถว …            ← เงินเดือน · Grower · Trimmer · Over Time
 *   1) รวม ค่าบุคลากร          ← **ยอดรวมอยู่ใต้ลูกของมัน**
 *   แถวลูก 8 แถว …            ← ปุ๋ยอะธีน่าแต่ละตัว
 *   2) รวมปุ๋ย อะธีน่า
 *   3) ค่าไฟฟ้า · 4.1) ดิน Coco Coir · 4.2) Golden Green Coco · 5) Co2   ← ไม่มีลูก
 *   ค่าเช่า · ค่าน้ำประปา · …   ← เบ็ดเตล็ด ไม่มีเลขข้อ
 *
 * กฎที่ได้: **แถวที่มีเลขข้อ = หัวข้อต้นทุนการปลูก** · แถวไม่มีเลขที่อยู่ *ก่อน* หัวข้อ
 * = ลูกของหัวข้อนั้น · แถวไม่มีเลขที่อยู่ *หลัง* หัวข้อสุดท้าย = ต้นทุนเบ็ดเตล็ด
 *
 * อ่านจากโครงของชีตเอง ไม่ฮาร์ดโค้ดรายชื่อ — เพิ่ม `6)` ในชีตแล้วขึ้นเองอัตโนมัติ
 * และ **ห้ามเอาแถวยอดรวมไปเรียงแข่งกับลูกของมัน** ไม่งั้นกราฟจะนับซ้ำ 6.85 ล้าน
 * (เคยเป็นแบบนั้นจริง — `1) รวม ค่าบุคลากร` โผล่อยู่ข้าง `- เงินเดือน` ในกราฟเดียวกัน)
 *
 * @param {Array} detail แถว kind==='expense' ที่ตัดช่วงเดือนมาแล้ว
 */
export function buildCostBreakdown(detail) {
  const rows = (detail ?? []).filter((r) => r.group === 'growing');
  const empty = { growing: [], misc: [], growingTotal: 0, miscTotal: 0, subtotalItems: new Set() };
  if (!rows.length) return empty;

  // รวมยอดรายเดือนเป็นรายการเดียว แต่จำลำดับแถวแรกที่เจอไว้ เพราะกฎแยกกลุ่มใช้ลำดับ
  const byItem = new Map();
  for (const r of rows) {
    const e = byItem.get(r.item) ?? { item: r.item, order: r.rowIndex ?? 0, amount: 0 };
    e.amount += r.amount ?? 0;
    e.order = Math.min(e.order, r.rowIndex ?? 0);
    byItem.set(r.item, e);
  }
  const ordered = [...byItem.values()].sort((a, b) => a.order - b.order);
  const lastHeading = ordered.reduce((last, e, i) => (COST_HEADING_RE.test(e.item) ? i : last), -1);

  const growing = [];
  const misc = [];
  const subtotalItems = new Set();
  let pending = [];

  ordered.forEach((e, i) => {
    if (COST_HEADING_RE.test(e.item)) {
      // มีลูก = แถวนี้เป็นยอดรวมของลูก ห้ามนับซ้ำตอนบวกยอดรายการ
      if (pending.length) subtotalItems.add(e.item);
      growing.push({
        item: e.item,
        label: costHeadingLabel(e.item),
        amount: e.amount,
        children: pending.sort((a, b) => b.amount - a.amount),
      });
      pending = [];
    } else if (i < lastHeading) {
      pending.push({ item: e.item, label: e.item, amount: e.amount });
    } else {
      misc.push({ item: e.item, label: e.item, amount: e.amount });
    }
  });

  /* แถวไม่มีเลขที่ค้างอยู่หลังหัวข้อสุดท้ายไม่มีทางเกิด (lastHeading คุมไว้แล้ว)
   * แต่ถ้าชีตเปลี่ยนโครงจนเกิดขึ้น ต้องไม่ปล่อยหาย — ยกไปเป็นเบ็ดเตล็ด */
  for (const p of pending) misc.push(p);

  return {
    growing: growing.sort((a, b) => b.amount - a.amount),
    misc: misc.sort((a, b) => b.amount - a.amount),
    growingTotal: growing.reduce((a, x) => a + x.amount, 0),
    miscTotal: misc.reduce((a, x) => a + x.amount, 0),
    subtotalItems,
  };
}

/**
 * สรุปงบรายรับ-รายจ่ายจากชีต "แบบฟอร์มต้นทุน"
 *
 * **ยอดรวมทุกตัวมาจากแท็บ "สรุป" เท่านั้น ไม่ใช่จากการบวกแท็บรายละเอียด**
 *
 * เหตุผล: แท็บรายละเอียดมีแถวยอดรวมปนอยู่กับแถวรายการ และตอนนี้ผลรวมรายการจริง
 * ไม่เท่ากับที่งบสรุปบอกอยู่สามจุด (ตรวจแล้ว: ต้นทุนวัตถุดิบต่าง 906,854 บาท
 * เพราะสูตรผลรวมของแถวค่าไฟฟ้าไม่ครอบเดือนกรกฎาคม) ถ้าเอาผลรวมรายการมาโชว์
 * ตัวเลขบน Dashboard จะไม่ตรงกับงบที่ผู้บริหารถืออยู่ในมือ
 *
 * รายละเอียดใช้ทำ "อันดับรายการที่ใช้เงินมากสุด" อย่างเดียว ส่วนความไม่ตรงกัน
 * ถูกรายงานเป็น finding `finance.summaryMismatch` ให้ไปแก้ที่ต้นทาง
 */
/* ชื่อพารามิเตอร์ต้องไม่ใช่ `year` เพราะท้ายฟังก์ชันมี `const year` ของตัวเอง
 * (ปีที่อ่านได้จากข้อมูลจริง) ถ้าชนกันจะได้ ReferenceError จาก TDZ ตอน inYear ทำงาน */
function buildCost(source, yearFilter = null) {
  const rows = source?.rows ?? [];
  const allSummary = rows.filter((r) => r.kind === 'summary');

  /* ปีที่ชีตนี้มีข้อมูลจริง — ต้องรู้ก่อนกรอง เพื่อบอกผู้ใช้ได้ว่า "มีปีไหนให้ดูบ้าง"
   * ตอนที่เขาเลือกปีที่ชีตไม่มี */
  const years = [...new Set(allSummary.map((r) => String(r.month).slice(0, 4)))].sort();

  /* ตัวกรองปีของ Dashboard ส่งมาที่นี่ตรง ๆ ไม่ได้ผ่าน applyFilters()
   *
   * แถวงบมี `date` (parsers/cost.js ใส่ `${month}-01` ให้) จึงผ่านตัวกรองปีได้อยู่แล้ว
   * แต่ตัวกรองสายพันธุ์/ครอป/ขนาดดอกจะลบมันเกลี้ยงทั้งชีต (ไม่มีฟิลด์พวกนั้นเลย)
   * filterSources() จึงยกรายงานที่ kind !== 'flower' ออกทั้งก้อน แล้วส่ง
   * **ปีอย่างเดียว** มาที่นี่ — ซึ่งเป็นมิติเดียวที่มีความหมายกับงบรายเดือน */
  const inYear = (r) => !yearFilter || String(r.month).slice(0, 4) === yearFilter;
  const summary = allSummary.filter(inYear);
  const detail = rows.filter((r) => r.kind === 'expense' && inYear(r));

  if (!summary.length) {
    return {
      available: false,
      /* "ชีตอ่านได้ไหม" เป็นคนละคำถามกับ "ปีที่เลือกมีข้อมูลไหม"
       * ถ้าไม่แยกสองอย่างนี้ หน้าจะบอกว่าดึงชีตไม่สำเร็จทั้งที่ชีตปกติดี
       * แล้วคนจะไปไล่แก้ชีตที่ไม่ได้ผิด */
      sheetAvailable: allSummary.length > 0,
      requestedYear: yearFilter,
      years,
      year: null,
      months: [],
      byMonth: [],
      totals: {},
      totalsFullYear: {},
      lastActiveMonth: null,
      lastRevenueMonth: null,
      coverage: null,
      monthsWithValue: {},
      revenueByYear: null,
      revenueByMonth: null,
      costByYear: null,
      costByMonth: null,
      topItems: [],
      byGroup: [],
      breakdown: { growing: [], misc: [], growingTotal: 0, miscTotal: 0, subtotalItems: new Set() },
      detailTotals: {},
    };
  }

  const months = [...new Set(summary.map((r) => r.month))].sort(comparePeriod);
  const at = (line, month) =>
    summary.find((r) => r.line === line && r.month === month)?.amount ?? null;
  const lineTotal = (line) =>
    summary.filter((r) => r.line === line).reduce((a, r) => a + (r.amount ?? 0), 0);

  const LINES = [
    'revenue',
    'materialCost',
    'farmExpense',
    'officeExpense',
    // ยอดต้นทุนที่ชีตคำนวณเอง — เก็บไว้เทียบกับที่เราบวกจากสามบรรทัดข้างบน
    'growingCost',
    'ebitda',
    'depreciation',
    'ebit',
  ];

  /* เดือนสุดท้ายที่ธุรกิจ "เดินจริง"
   *
   * ดูเฉพาะรายได้กับต้นทุนวัตถุดิบ ไม่รวมค่าเสื่อมราคาและค่าใช้จ่าย Office
   * เพราะสองตัวนั้นถูกตั้งไว้ล่วงหน้าจนถึงสิ้นปี (ค่ารักษาความปลอดภัยเดือนละเท่ากันทุกเดือน)
   * ถ้านับรวมด้วย กราฟจะลากเส้นแบนที่ศูนย์ไปจนถึงธันวาคม ซึ่งอ่านผิดทันที
   * ว่าธุรกิจหยุดเดิน ทั้งที่ความจริงคือ "ยังไม่ถึงเดือนนั้น" */
  const OPERATING = ['revenue', 'materialCost'];
  const lastActive = months.reduce(
    (last, m) => (OPERATING.some((l) => at(l, m) !== null && at(l, m) !== 0) ? m : last),
    null
  );
  const lastRevenueMonth = months.reduce((last, m) => (at('revenue', m) ? m : last), null);

  const byMonth = months.map((month) => {
    const revenue = at('revenue', month);
    const cost = at('growingCost', month) ?? sumOrNullList([
      at('materialCost', month),
      at('farmExpense', month),
      at('officeExpense', month),
    ]);
    return {
      month,
      revenue,
      materialCost: at('materialCost', month),
      farmExpense: at('farmExpense', month),
      officeExpense: at('officeExpense', month),
      cost,
      ebitda: at('ebitda', month),
      depreciation: at('depreciation', month),
      ebit: at('ebit', month),
      // กำไรขั้นต้นคิดใหม่เองเสมอ ไม่เชื่อช่องในชีต (กฎข้อ 2 ของ CLAUDE.md)
      grossProfit: revenue !== null && cost !== null ? revenue - cost : null,
    };
  });

  /* ── ยอดรวมต้องคิดเฉพาะเดือนที่ "เกิดขึ้นจริง" ไม่ใช่ทั้ง 12 เดือน ──
   *
   * แต่ละบรรทัดในชีตกรอกมาไม่เท่ากัน (ตรวจกับข้อมูลจริงแล้ว):
   *   รายได้ 6 เดือน · ต้นทุนวัตถุดิบ/Farm 7 เดือน · Office 12 เดือน · ค่าเสื่อมราคา 12 เดือน
   *
   * Office กับค่าเสื่อมราคาถูกตั้งไว้ล่วงหน้าถึงสิ้นปี (ค่ารักษาความปลอดภัยเดือนละ 30,900
   * เท่ากันทุกเดือน และตารางค่าเสื่อมคำนวณไว้ล่วงหน้าทั้งปี)
   *
   * ถ้าบวกทั้ง 12 เดือนจะกลายเป็นเอา **รายได้ 6 เดือน ไปหักค่าเสื่อม 12 เดือน**
   * แล้วได้ EBIT −13.3 ล้าน ทั้งที่ยอดสะสมจริงถึงเดือนล่าสุดคือ −10.3 ล้าน
   * ส่วนต่าง 4.3 ล้านมาจากเดือนที่ยังไม่ถึง — เป็นตัวเลขที่ตั้งไว้ ไม่ใช่ผลประกอบการ
   *
   * `totals` จึงตัดที่เดือนล่าสุดที่มีความเคลื่อนไหวจริง ส่วนยอด 12 เดือนตามที่ชีตบอก
   * เก็บไว้ที่ `totalsFullYear` ไม่ได้ซ่อน — ตารางรายเดือนก็ยังโชว์ครบทุกเดือนเหมือนเดิม */
  const within = (m) => !lastActive || m <= lastActive;
  const activeTotal = (line) =>
    summary.filter((r) => r.line === line && within(r.month)).reduce((a, r) => a + (r.amount ?? 0), 0);

  const totals = Object.fromEntries(LINES.map((l) => [l, activeTotal(l)]));
  totals.cost = totals.materialCost + totals.farmExpense + totals.officeExpense;
  totals.grossProfit = totals.revenue - totals.cost;

  const totalsFullYear = Object.fromEntries(LINES.map((l) => [l, lineTotal(l)]));
  totalsFullYear.cost =
    totalsFullYear.materialCost + totalsFullYear.farmExpense + totalsFullYear.officeExpense;
  totalsFullYear.grossProfit = totalsFullYear.revenue - totalsFullYear.cost;

  /* จำนวนเดือนที่แต่ละบรรทัดมีตัวเลขจริง — เอาไปบอกผู้ใช้และให้ analysis ตรวจ
   * ว่าบรรทัดไหนครอบคลุมไม่เท่ากันจนเอามาเทียบกันตรง ๆ ไม่ได้ */
  const monthsWithValue = Object.fromEntries(
    LINES.map((l) => [l, summary.filter((r) => r.line === l && (r.amount ?? 0) !== 0).length])
  );

  /* ── รายการย่อยต้องตัดที่เดือนเดียวกับยอดรวมด้านบน ──
   *
   * ช่องตัวเลขเขียนว่า "ต้นทุน (ม.ค.–ก.ค. 2026)" เพราะ totals ตัดที่ lastActiveMonth
   * ถ้ากราฟรายการย่อยใต้ช่องนั้นบวกครบ 12 เดือน สองตัวเลขบนหน้าจอเดียวกันจะคนละช่วง
   * (ตอนนี้ต่างกัน 154,500 บาท — ค่ารักษาความปลอดภัย Office ที่ตั้งไว้ล่วงหน้า ส.ค.–ธ.ค.) */
  const detailInRange = detail.filter((r) => within(r.month));

  const breakdown = buildCostBreakdown(detailInRange);

  const byItem = new Map();
  for (const r of detailInRange) {
    const key = `${r.group}|${r.item}`;
    const e = byItem.get(key) ?? {
      item: r.item,
      group: r.group,
      category: r.category ?? null,
      amount: 0,
    };
    e.amount += r.amount ?? 0;
    byItem.set(key, e);
  }
  const topItems = [...byItem.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);

  /* ยอดรายการต่อกลุ่ม — ต้องไม่นับแถวยอดรวมซ้ำกับลูกของมัน
   * ไม่งั้นกลุ่ม growing จะได้ 22.7 ล้าน ทั้งที่รายการจริงรวมกันแค่ 15.8 ล้าน */
  const detailTotals = {};
  for (const r of detailInRange) {
    if (breakdown.subtotalItems.has(r.item)) continue;
    detailTotals[r.group] = (detailTotals[r.group] ?? 0) + (r.amount ?? 0);
  }

  const byGroup = [
    { key: 'materialCost', amount: totals.materialCost },
    { key: 'farmExpense', amount: totals.farmExpense },
    { key: 'officeExpense', amount: totals.officeExpense },
  ].filter((g) => g.amount > 0);

  const year = months[0]?.slice(0, 4) ?? null;

  return {
    available: true,
    sheetAvailable: true,
    // ปีที่ถูกขอ (null = ไม่ได้กรอง) และปีที่ชีตมีทั้งหมด — UI ใช้ทั้งคู่ตอนเลือกปีที่ไม่มีข้อมูล
    requestedYear: yearFilter,
    years,
    year,
    months,
    lastActiveMonth: lastActive,
    // ช่วงที่ยอดใน `totals` ครอบคลุมจริง — UI ต้องเอาไปติดป้ายเสมอ ไม่ใช่เขียนว่า "ทั้งปี"
    coverage: months.length ? { from: months[0], to: lastActive ?? months[0] } : null,
    monthsWithValue,
    byMonth,
    totals,
    totalsFullYear,
    byGroup,
    topItems,
    // รายการย่อยแยกเป็นต้นทุนการปลูก (มีเลขข้อ) กับเบ็ดเตล็ด — ดู buildCostBreakdown()
    breakdown,
    detailTotals,
    // ช่องที่หน้าภาพรวมใช้ตรง ๆ — เดิมเป็น null เพราะยังไม่มีชีตไหนมีตัวเลขเงิน
    revenueByYear: totals.revenue,
    /* เดือนล่าสุดที่ **มีรายได้จริง** ไม่ใช่เดือนล่าสุดที่มีความเคลื่อนไหว
     * เดือนกรกฎาคมมีต้นทุนแต่ยังไม่มีรายได้ ถ้าใช้เดือนนั้นช่องรายได้จะขึ้น "—"
     * ทั้งที่เดือนก่อนหน้ามีตัวเลขอยู่ ซึ่งอ่านเหมือนระบบพัง */
    lastRevenueMonth,
    revenueByMonth: lastRevenueMonth ? at('revenue', lastRevenueMonth) : null,
    costByYear: totals.cost,
    costByMonth: lastActive
      ? sumOrNullList([
          at('materialCost', lastActive),
          at('farmExpense', lastActive),
          at('officeExpense', lastActive),
        ])
      : null,
  };
}

/** บวกโดยคืน null ถ้าไม่มีค่าที่ใช้ได้เลย — `0` กับ "ไม่มีข้อมูล" ต้องไม่ปนกัน */
function sumOrNullList(values) {
  const usable = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? usable.reduce((a, b) => a + b, 0) : null;
}

/** ต้องมีเดือนที่เบิกจบแล้วอย่างน้อยเท่านี้ ถึงจะพูดได้ว่าอะไรคือ "ปกติ" */
const MIN_BASELINE_MONTHS = 2;

/** เบิกมากกว่าปกติกี่เท่าถึงเรียกว่าผิดปกติ */
const HIGH_RATIO = 1.5;
const LOW_RATIO = 0.5;

/** ต่างจากที่คาดน้อยกว่านี้ถือว่าเป็นความผันผวนปกติ ไม่ต้องเตือน */
const MIN_ABS_DIFF = 2;

/**
 * หารายการที่เบิกผิดปกติในเดือนล่าสุด
 *
 * กับดักที่ต้องระวัง: **เดือนปัจจุบันยังไม่จบ** ถ้าเอายอดรวมของ 3 วันแรกของเดือน
 * ไปเทียบกับเดือนเต็ม ๆ ที่ผ่านมา ทุกอย่างจะดู "ต่ำผิดปกติ" หมดทั้งที่ยังไม่มีอะไรผิด
 * จึงเทียบเป็น **อัตราต่อวัน** แล้วบอกไปด้วยว่าเดือนนี้ผ่านมากี่วันแล้ว
 *
 * @param {{item:string, unit:string|null, byMonth:Record<string,number>}[]} usage
 * @param {string[]} months เดือนทั้งหมดที่ปรากฏในข้อมูล (รวมเดือนอนาคตที่ยังไม่มีการเบิก)
 * @param {string} asOf วันที่ล่าสุดที่มีข้อมูลจริง (YYYY-MM-DD)
 */
export function findUsageAnomalies(usage, months, asOf) {
  const currentMonth = (asOf || '').slice(0, 7);
  if (!currentMonth) {
    return { ready: false, monthsAvailable: 0, monthsNeeded: MIN_BASELINE_MONTHS + 1, items: [] };
  }

  // นับเฉพาะเดือนที่มีการเบิกจริง และไม่เลยวันที่ล่าสุดที่มีข้อมูล
  const withUsage = months
    .filter((m) => m <= currentMonth && usage.some((u) => (u.byMonth[m] ?? 0) > 0))
    .sort(comparePeriod);

  const baselineMonths = withUsage.filter((m) => m < currentMonth);
  const daysElapsed = Math.max(1, Number((asOf || '').slice(8, 10)) || 1);
  const isPartial = true; // เดือนล่าสุดคือเดือนที่ข้อมูลเดินมาถึง จึงยังไม่จบเสมอ

  if (baselineMonths.length < MIN_BASELINE_MONTHS) {
    return {
      ready: false,
      monthsAvailable: withUsage.length,
      monthsNeeded: MIN_BASELINE_MONTHS + 1,
      currentMonth,
      baselineMonths,
      items: [],
    };
  }

  const items = [];
  for (const row of usage) {
    const current = row.byMonth[currentMonth] ?? 0;
    const history = baselineMonths.map((m) => row.byMonth[m] ?? 0);
    const baseline = history.reduce((a, b) => a + b, 0) / history.length;
    if (baseline <= 0 && current <= 0) continue;

    /* เทียบเป็นอัตราต่อวัน เดือนก่อน ๆ คิดที่ 30 วัน ส่วนเดือนนี้คิดตามวันที่ผ่านมาจริง */
    const baselineRate = baseline / 30;
    const currentRate = current / daysElapsed;

    // คาดว่าถึงวันนี้ควรเบิกไปเท่าไร ถ้าใช้ในอัตราปกติ
    const expected = baselineRate * daysElapsed;
    const diff = current - expected;
    if (Math.abs(diff) < MIN_ABS_DIFF) continue;

    const ratio = baselineRate > 0 ? currentRate / baselineRate : null;
    let direction = null;
    if (ratio === null && current > 0) direction = 'new'; // ไม่เคยเบิกมาก่อน เพิ่งเริ่มเบิก
    else if (ratio !== null && ratio >= HIGH_RATIO) direction = 'high';
    else if (ratio !== null && ratio <= LOW_RATIO) direction = 'low';
    if (!direction) continue;

    items.push({
      item: row.item,
      unit: row.unit ?? null,
      current,
      expected: Math.round(expected * 10) / 10,
      baseline: Math.round(baseline * 10) / 10,
      ratio: ratio === null ? null : Math.round(ratio * 100) / 100,
      direction,
      byMonth: row.byMonth,
    });
  }

  // เรื่องที่ต้องรีบดูก่อนคือของที่เบิกพุ่งขึ้น เพราะแปลว่าของจะหมดเร็วกว่าที่วางแผนไว้
  const weight = { high: 0, new: 1, low: 2 };
  items.sort(
    (a, b) => weight[a.direction] - weight[b.direction] || (b.ratio ?? 99) - (a.ratio ?? 99)
  );

  return {
    ready: true,
    monthsAvailable: withUsage.length,
    monthsNeeded: MIN_BASELINE_MONTHS + 1,
    currentMonth,
    baselineMonths,
    daysElapsed,
    isPartial,
    items,
  };
}

/**
 * สร้าง KPI และชุดข้อมูลกราฟทั้งหมดที่ front-end ต้องใช้
 *
 * เบราว์เซอร์เรียกฟังก์ชันนี้ซ้ำทุกครั้งที่ตัวกรองเปลี่ยน โดยส่ง `sources` ที่กรองแล้วเข้ามา
 * (ดู viewKpi() ใน main.js) ตัวเลขบนการ์ดจึงตรงกับกราฟข้าง ๆ เสมอ
 *
 * @param {Record<string, object>} sources
 * @param {object} analysis
 * @param {{year?: string|null, purchaseRequests?: Array}} [options]
 *   `year` — ปีที่เลือกจากแถบตัวกรองกลาง ส่งต่อให้ buildCost()
 *   เพราะรายงานการเงินไม่ผ่าน applyFilters() (ดูเหตุผลใน buildCost)
 *   `purchaseRequests` — ทะเบียนใบขอซื้อ ใช้ติดสถานะ "รอของ" ให้รายการที่ต้องสั่งซื้อ
 *   **ไม่ส่ง options → ผลลัพธ์เหมือนเดิมทุกตัวอักษร**
 */
export function buildKpi(sources, analysis, options = {}) {
  const rowsOf = (key) => sources[key]?.rows ?? [];

  const daily = rowsOf('dailyTrim');
  const perCrop = rowsOf('perCrop');
  const outbound = rowsOf('outbound');
  const inbound = rowsOf('inbound');
  const sales = rowsOf('sales');
  const inventory = rowsOf('inventory');

  const harvested = perCrop.filter((r) => r.hasYield);
  const planned = perCrop.filter((r) => !r.hasYield);

  const cost = buildCost(sources.cost, options.year ?? null);

  const totalYield = sum(harvested.map((r) => r.flowerTotal));
  const totalPlants = sum(harvested.map((r) => r.plants));
  const gPerPlant = totalPlants > 0 ? totalYield / totalPlants : null;

  const stockByLocation = groupSum(inventory, (r) => r.location);
  const totalStock = sum(inventory.map((r) => r.flowerTotal));
  const totalStockNonFlower = sum(inventory.map((r) => r.nonFlowerTotal));

  const totalSold = sum(sales.map((r) => r.flowerTotal));
  const soldNonFlower = sum(sales.map((r) => r.nonFlowerTotal));
  const customers = new Set(sales.map((r) => r.customer).filter(Boolean));

  const headline = [
    {
      key: 'totalYield',
      labelTh: 'ผลผลิตดอกสะสม',
      labelEn: 'Total Flower Yield',
      value: totalYield,
      unit: 'g',
      hint: `${harvested.length} ครอปที่เก็บเกี่ยวแล้ว`,
      hintEn: `${harvested.length} harvested crops`,
    },
    {
      key: 'premiumPct',
      labelTh: 'สัดส่วนเกรด >M',
      labelEn: 'Premium Grade (>M)',
      value: premiumPct(harvested),
      unit: '%',
      hint: 'XXL + XL + L + M',
      hintEn: 'XXL + XL + L + M',
    },
    {
      key: 'gPerPlant',
      labelTh: 'ผลผลิตต่อต้น',
      labelEn: 'Yield per Plant',
      value: gPerPlant,
      unit: 'g',
      hint: `จาก ${totalPlants.toLocaleString('en-US')} ต้น`,
      hintEn: `across ${totalPlants.toLocaleString('en-US')} plants`,
    },
    {
      key: 'totalSold',
      labelTh: 'ยอดขายดอกสะสม',
      labelEn: 'Total Flower Sold',
      value: totalSold,
      unit: 'g',
      hint: `${customers.size} ลูกค้า`,
      hintEn: `${customers.size} customers`,
    },
    {
      key: 'totalStock',
      labelTh: 'สต็อกดอกคงเหลือ',
      labelEn: 'Flower in Stock',
      value: totalStock,
      unit: 'g',
      hint: stockByLocation.map((s) => s.key).join(' + ') || '—',
      hintEn: stockByLocation.map((s) => s.key).join(' + ') || '—',
    },
    {
      key: 'activeCrops',
      labelTh: 'ครอปที่กำลังปลูก',
      labelEn: 'Crops in Progress',
      value: planned.length,
      unit: '',
      hint: `รวมทั้งหมด ${perCrop.length} ครอป`,
      hintEn: `${perCrop.length} crops on record`,
    },
  ];

  // ครอปที่กำลังปลูก เรียงตามวันเก็บเกี่ยวที่ใกล้ที่สุด
  const upcoming = planned
    .filter((r) => r.cycle?.harvest)
    .sort((a, b) => a.cycle.harvest.localeCompare(b.cycle.harvest))
    .slice(0, 8)
    .map((r) => ({ crop: r.crop, quarter: r.quarter, cycle: r.cycle, plants: r.plants }));

  /* บล็อก exec = KPI 8 ตัวบนหน้า "ภาพรวมผู้บริหาร" ตามเอกสาร
   *
   * แยกจาก headline (ซึ่งคง 6 ตัวไว้เท่าเดิม) เพราะ headline เป็นแถบสรุปเดิม
   * ที่การ์ดและ test อ้างอิงอยู่ ส่วน exec เป็นชุดใหม่ที่ผูกกับเอกสารโดยตรง
   *
   * ผลผลิตรายปี/รายเดือนใช้ dailyTrim เพราะเป็นรายงานเดียวที่มีวันที่รายวันจริง
   * (perCrop เก็บเป็นไตรมาส/ครอป ไม่มีวันที่ของการทริมแต่ละครั้ง)
   */
  /* ปีของครอป: ใช้วันเก็บเกี่ยวก่อน ถ้าไม่มีค่อยถอยไปอ่านปีจากชื่อไตรมาส */
  const cropYear = (r) => r.cycle?.harvest?.slice(0, 4) ?? r.quarter?.match(/(\d{4})/)?.[1] ?? null;

  /* รายปีมาจาก perCrop เพราะเป็นบันทึกผลผลิตที่ครบที่สุด (ย้อนถึง Q2'2025)
   * ส่วนรายเดือนมาจาก dailyTrim เพราะเป็นรายงานเดียวที่มีวันที่รายวันจริง
   * — แต่เริ่มบันทึกแค่ มี.ค. 2026 เท่านั้น
   *
   * สองชุดนี้จึงมาจากคนละแหล่งและ **ยอดรวมไม่เท่ากัน** โดยธรรมชาติ
   * ต้องติด source/coverage ไปด้วยเสมอ เพื่อให้ UI บอกที่มาได้ ไม่ใช่ปล่อยให้
   * ผู้บริหารเข้าใจว่าเป็นตัวเลขชุดเดียวกันแล้วสงสัยว่าทำไมบวกไม่ลงตัว */
  const producedByYear = (() => {
    const map = new Map();
    for (const r of harvested) {
      const year = cropYear(r);
      if (!year) continue;
      const e = map.get(year) || { year, flower: 0, crops: 0 };
      e.flower += r.flowerTotal || 0;
      e.crops++;
      map.set(year, e);
    }
    return [...map.values()].sort((a, b) => comparePeriod(a.year, b.year));
  })();

  const monthly = monthlySeries(daily);
  const dailyDates = daily.map((r) => r.date).filter(Boolean).sort();

  const yieldPerPlantByYear = (() => {
    const map = new Map();
    for (const r of harvested) {
      const year = cropYear(r);
      if (!year) continue;
      const e = map.get(year) || { year, flower: 0, plants: 0 };
      e.flower += r.flowerTotal || 0;
      e.plants += r.plants || 0;
      map.set(year, e);
    }
    return [...map.values()]
      .map((e) => ({ ...e, gPerPlant: e.plants > 0 ? e.flower / e.plants : null }))
      .sort((a, b) => comparePeriod(a.year, b.year));
  })();

  return {
    headline,
    exec: {
      producedByYear,
      producedByYearSource: 'perCrop',
      producedByMonth: monthly,
      producedByMonthSource: 'dailyTrim',
      // ช่วงที่บันทึกรายวันครอบคลุมจริง — UI ต้องบอกผู้ใช้ ไม่ใช่ให้เดาเองว่าทำไมกราฟสั้น
      producedByMonthCoverage: dailyDates.length
        ? { from: dailyDates[0], to: dailyDates[dailyDates.length - 1] }
        : null,
      yieldPerPlantByYear,
      stockByLocation: stockByLocation.map((s) => ({
        location: s.key,
        flower: s.flower,
        nonFlower: s.nonFlower,
      })),
      totalStock,
      /* รายได้และต้นทุนมาจากชีต "แบบฟอร์มต้นทุน" (เพิ่มเข้ามาเป็นลิงก์ที่ 8)
       * ก่อนหน้านี้เป็น null เสมอเพราะไม่มีชีตไหนมีตัวเลขเงินเลย
       * ยังต้องเป็น null ได้อยู่ถ้าชีตโหลดไม่สำเร็จ — ห้ามใส่ 0 แทน
       * เพราะ 0 แปลว่า "ขายไม่ได้เลย" ซึ่งคนละความหมายกับ "ไม่มีข้อมูล" */
      revenueByYear: cost.revenueByYear,
      revenueByMonth: cost.revenueByMonth,
      costByYear: cost.costByYear,
      costByMonth: cost.costByMonth,
    },
    cost,
    // ทะเบียนใบขอซื้ออยู่ฝั่ง server เท่านั้น (data/) เบราว์เซอร์ได้ผลสำเร็จรูปมาใน payload
    supply: buildSupply(sources.supplyLog, options.purchaseRequests, options.today),
    dailyTrim: {
      totalFlower: sum(daily.map((r) => r.flowerTotal)),
      totalNonFlower: sum(daily.map((r) => r.nonFlowerTotal)),
      sizeMix: sizeMix(daily),
      nonFlowerMix: nonFlowerMix(daily),
      byCrop: groupSum(daily, (r) => r.crop).sort((a, b) => b.flower - a.flower),
      byStrain: groupSum(daily, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      series: dailySeries(daily),
      dayCount: new Set(daily.map((r) => r.date).filter(Boolean)).size,
    },
    perCrop: {
      totalFlower: totalYield,
      totalPlants,
      gPerPlant,
      harvestedCount: harvested.length,
      plannedCount: planned.length,
      sizeMix: sizeMix(harvested),
      byQuarter: groupSum(harvested, (r) => r.quarter)
        .map((q) => {
          const rows = harvested.filter((r) => r.quarter === q.key);
          const plants = sum(rows.map((r) => r.plants));
          return { ...q, plants, gPerPlant: plants > 0 ? q.flower / plants : null };
        })
        /* เรียงตามเวลาจริง ไม่ใช่ตามตัวอักษร
         * localeCompare จะได้ Q1'2026 มาก่อน Q2'2025 เพราะเทียบ "Q1" กับ "Q2" ก่อนถึงปี */
        .sort((a, b) => comparePeriod(a.key, b.key)),
      topCrops: harvested
        .filter((r) => r.gramsPerPlant !== null)
        .sort((a, b) => b.gramsPerPlant - a.gramsPerPlant)
        .slice(0, 10)
        .map((r) => ({
          crop: r.crop,
          quarter: r.quarter,
          flower: r.flowerTotal,
          plants: r.plants,
          gPerPlant: r.gramsPerPlant,
        })),
      upcoming,
    },
    outbound: {
      totalFlower: sum(outbound.map((r) => r.flowerTotal)),
      totalNonFlower: sum(outbound.map((r) => r.nonFlowerTotal)),
      sizeMix: sizeMix(outbound),
      byStrain: groupSum(outbound, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      byCrop: groupSum(outbound, (r) => r.crop).sort((a, b) => b.flower - a.flower),
      series: dailySeries(outbound),
      shipmentCount: new Set(outbound.map((r) => r.date).filter(Boolean)).size,
    },
    inbound: {
      totalFlower: sum(inbound.map((r) => r.flowerTotal)),
      totalNonFlower: sum(inbound.map((r) => r.nonFlowerTotal)),
      sizeMix: sizeMix(inbound),
      byStrain: groupSum(inbound, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      series: dailySeries(inbound),
      receiptCount: new Set(inbound.map((r) => r.date).filter(Boolean)).size,
      reconciliation: buildReconciliation(outbound, inbound),
    },
    sales: {
      totalFlower: totalSold,
      totalNonFlower: soldNonFlower,
      customerCount: customers.size,
      orderCount: new Set(sales.map((r) => `${r.date}|${r.customer}`).filter(Boolean)).size,
      sizeMix: sizeMix(sales),
      byCustomer: groupSum(sales, (r) => r.customer).sort((a, b) => b.flower - a.flower),
      byStrain: groupSum(sales, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      byMonth: monthlySeries(sales),
      series: dailySeries(sales),
    },
    inventory: {
      totalFlower: totalStock,
      totalNonFlower: totalStockNonFlower,
      byLocation: stockByLocation.sort((a, b) => b.flower - a.flower),
      byStrain: groupSum(inventory, (r) => r.strain).sort((a, b) => b.flower - a.flower),
      sizeMix: sizeMix(inventory),
      nonFlowerMix: nonFlowerMix(inventory),
      updatedAt: [
        ...new Set(inventory.map((r) => r.updatedText).filter(Boolean)),
      ],
      locations: [...new Set(inventory.map((r) => r.location).filter(Boolean))],
    },
    quality: {
      score: analysis.score,
      counts: analysis.counts,
      total: analysis.total,
      bySource: analysis.bySource,
    },
  };
}

/** เทียบยอดขนออกกับยอดรับเข้ารายวัน สำหรับการ์ด "รับดอกเข้ากรุงเทพ" */
function buildReconciliation(outbound, inbound) {
  const collect = (rows) => {
    const m = new Map();
    for (const r of rows) {
      if (!r.date) continue;
      m.set(r.date, (m.get(r.date) || 0) + (r.flowerTotal || 0));
    }
    return m;
  };
  const outMap = collect(outbound);
  const inMap = collect(inbound);
  const dates = [...new Set([...outMap.keys(), ...inMap.keys()])].sort();

  return dates.map((date) => {
    const shipped = outMap.get(date) ?? null;
    const received = inMap.get(date) ?? null;
    const diff = shipped !== null && received !== null ? received - shipped : null;
    return {
      date,
      shipped,
      received,
      diff,
      diffPct: shipped ? (diff / shipped) * 100 : null,
      matched: diff !== null && Math.abs(diff) < 0.5,
    };
  });
}
