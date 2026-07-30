/**
 * api.js — คุยกับ API ของเซิร์ฟเวอร์
 *
 * เซิร์ฟเวอร์รับประกันว่าทุก payload ผ่าน Data Analysis มาแล้ว
 * ฝั่ง client จึงไม่ต้องคำนวณอะไรซ้ำ แค่แสดงผล
 */

const BASE = '';

/** เปิด SSE รับความคืบหน้าการโหลด — คืนฟังก์ชันปิด */
export function subscribeProgress(onEvent) {
  if (typeof EventSource === 'undefined') return () => {};

  let source;
  try {
    source = new EventSource(`${BASE}/api/progress`);
  } catch {
    return () => {};
  }

  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ข้าม event ที่อ่านไม่ได้ */
    }
  };

  // ไม่ต้องแจ้ง error — loading screen มี progress สำรองอยู่แล้ว
  source.onerror = () => {};

  return () => {
    try {
      source.close();
    } catch {
      /* ปิดไปแล้ว */
    }
  };
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });

  /* เซสชันหมดอายุระหว่างเปิดหน้าค้างไว้
   * พากลับไปล็อกอินเลยดีกว่าปล่อยให้ขึ้น "HTTP 401" ซึ่งผู้ใช้ไม่รู้ว่าต้องทำอะไร */
  if (res.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`/login.html?next=${next}`);
    throw new Error('เซสชันหมดอายุ');
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      /* ไม่ใช่ JSON */
    }
    throw new Error(detail);
  }
  return res.json();
}

/** ดึงข้อมูลทั้งหมด (พร้อมผลวิเคราะห์) */
export function fetchReports({ refresh = false } = {}) {
  return getJson(`/api/reports${refresh ? '?refresh=1' : ''}`);
}

/** ดึงรายงานเดียวแบบละเอียด */
export function fetchReport(key) {
  return getJson(`/api/reports/${encodeURIComponent(key)}`);
}

/** ดึงผลวิเคราะห์อย่างเดียว */
export function fetchAnalysis() {
  return getJson('/api/analysis');
}

export function fetchHealth() {
  return getJson('/api/health');
}
