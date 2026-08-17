/**
 * router.js — เส้นทางของ Dashboard (hash router)
 *
 * ทำไมใช้ hash ไม่ใช่ History API หรือแยกไฟล์ HTML:
 *
 *   - แยกไฟล์ HTML → ทุกครั้งที่สลับรายงานต้อง boot ใหม่หมด: WebGL context ใหม่,
 *     ดึงและแปลง payload 460 KB ใหม่, ต่อ SSE ใหม่, loading screen เต็มจอทุกครั้ง
 *   - History API → ต้องเพิ่ม SPA rewrite ใน serveStatic และชนกับ 302 ของหน้า login
 *     ที่ส่ง ?next= จาก pathname+search
 *   - hash ไม่เคยเดินทางถึงเซิร์ฟเวอร์ จึงรอดจาก redirect ของ login โดยไม่ต้องแตะ server เลย
 *
 * รูปแบบ: #/<report>/<page>?<ตัวกรอง>
 *   #/dryflower/overview · #/dryflower/production · … · #/supply
 */

/** รายงานและหน้าย่อยที่มีจริง — route ที่ไม่อยู่ในนี้จะถูกส่งกลับหน้าแรก */
export const ROUTES = {
  dryflower: ['overview', 'production', 'stock', 'sales', 'cost'],
  /* Supply เคยเป็นหน้าเดียว (`main`) แล้วยาว 3,710px ≈ 4.1 หน้าจอ
   * แยกเป็น 3 หน้าตามงานที่คนมาทำ ไม่ใช่ตามชนิดของตาราง:
   *   order — วันนี้ต้องสั่งอะไร (รวมใบขอซื้อที่เคยออก เพราะแท็ก PR ในตารางลิงก์ไปหามัน)
   *   stock — ตอนนี้มีของเท่าไร
   *   usage — เบิกไปเท่าไร ผิดปกติไหม
   * ลิงก์เก่า `#/supply` ยังใช้ได้ เพราะ parseHash คืนหน้าแรกให้เมื่อไม่ระบุหน้า */
  supply: ['order', 'stock', 'usage'],
};

export const DEFAULT_ROUTE = { report: 'dryflower', page: 'overview' };

const listeners = new Set();
let current = { ...DEFAULT_ROUTE, params: new URLSearchParams() };

/** แปลง hash เป็น route — คืนค่าเริ่มต้นเมื่อรูปแบบไม่ถูกต้อง */
export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [report, page] = path.split('/').filter(Boolean);
  const params = new URLSearchParams(query);

  if (!report || !ROUTES[report]) return { ...DEFAULT_ROUTE, params, unknown: Boolean(raw) };

  const pages = ROUTES[report];
  // รายงานที่มีหน้าเดียวไม่ต้องระบุหน้าใน URL
  if (pages.length === 1) return { report, page: pages[0], params };
  if (!page) return { report, page: pages[0], params };
  if (!pages.includes(page)) return { ...DEFAULT_ROUTE, params, unknown: true };

  return { report, page, params };
}

/** ประกอบ route กลับเป็น hash */
export function toHash({ report, page, params }) {
  const pages = ROUTES[report] ?? [];
  const path = pages.length === 1 ? `#/${report}` : `#/${report}/${page}`;
  const q = params ? String(params) : '';
  return q ? `${path}?${q}` : path;
}

export function currentRoute() {
  return current;
}

/** เปลี่ยนหน้า — เขียนลง history เพื่อให้ปุ่มย้อนกลับใช้ได้ */
export function navigate(report, page, params = current.params) {
  const next = toHash({ report, page, params });
  if (location.hash === next) return;
  location.hash = next;
}

/**
 * เปลี่ยนเฉพาะตัวกรอง โดยอยู่หน้าเดิม — ใช้ replaceState ไม่ให้ประวัติรก
 *
 * `history.replaceState` ไม่ยิง event `hashchange` จึงต้อง emit เอง
 * ไม่งั้น URL เปลี่ยนแต่หน้าไม่วาดใหม่ ตัวกรองจะดูเหมือนกดแล้วไม่มีอะไรเกิดขึ้น
 */
export function replaceParams(params, { silent = false } = {}) {
  const next = toHash({ ...current, params });
  if (location.hash === next) return;
  current = { ...current, params };
  history.replaceState(null, '', next);

  /* silent = อัปเดต URL อย่างเดียว ไม่สั่งวาดหน้าใหม่
   *
   * ใช้กับหน้าที่วาดเฉพาะส่วนของตัวเองได้อยู่แล้ว (แถบตัวกรองของ Supply)
   * ช่องค้นหาพิมพ์ทีละตัวอักษร ถ้าวาดทั้งหน้าใหม่ทุกครั้ง โฟกัสจะหลุดจากช่องพิมพ์
   * ทันทีที่กดตัวแรก — URL ยังถูกต้องและส่งลิงก์ต่อได้เหมือนเดิม */
  if (!silent) emit();
}

function emit() {
  for (const fn of listeners) fn(current);
}

function handleHashChange() {
  const parsed = parseHash(location.hash);

  /* route ที่พิมพ์ผิดไม่ควรทิ้งร่องรอยไว้ในประวัติ ไม่งั้นกดย้อนกลับแล้ว
   * จะวนกลับไปที่ URL ผิดเดิมแล้วเด้งออกมาอีก กลายเป็นกดย้อนกลับไม่ได้ */
  if (parsed.unknown) {
    history.replaceState(null, '', toHash(parsed));
  }

  const changed =
    parsed.report !== current.report ||
    parsed.page !== current.page ||
    String(parsed.params) !== String(current.params);

  current = parsed;
  if (changed) emit();
}

/** เริ่มทำงาน — ตั้ง hash เริ่มต้นถ้ายังว่าง แล้วคืน route ปัจจุบัน */
export function initRouter() {
  window.addEventListener('hashchange', handleHashChange);
  const parsed = parseHash(location.hash);
  if (!location.hash || parsed.unknown) {
    history.replaceState(null, '', toHash(parsed));
  }
  current = parsed;
  return current;
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
