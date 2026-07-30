/**
 * fetcher.js — ดึงข้อมูลจาก Google Sheets อย่างทนทาน
 *
 * ใช้เฉพาะ Node.js built-in ไม่มี dependency
 * ทุก request มี timeout + retry แบบ exponential backoff และจำกัด concurrency
 */
import https from 'node:https';
import { URL } from 'node:url';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 3;
const MAX_REDIRECTS = 5;

/** ดึงข้อความจาก URL หนึ่งครั้ง (ไม่ retry) — ตาม redirect ให้เอง */
function requestOnce(url, { timeoutMs, redirectsLeft = MAX_REDIRECTS }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          // Google ตอบ 401/หน้า login ถ้าไม่มี UA ที่ดูเหมือนเบราว์เซอร์
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'text/csv,text/html,*/*',
          'Accept-Language': 'th,en;q=0.9',
        },
      },
      (res) => {
        const { statusCode, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('redirect เยอะเกินไป'));
          const next = new URL(headers.location, url).toString();
          return resolve(requestOnce(next, { timeoutMs, redirectsLeft: redirectsLeft - 1 }));
        }

        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout หลัง ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ดึงข้อความพร้อม retry แบบ exponential backoff
 * @param {string} url
 * @param {{timeoutMs?:number, retries?:number}} opts
 * @returns {Promise<string>}
 */
export async function fetchText(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await requestOnce(url, { timeoutMs });
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      // 400ms, 800ms, 1600ms …
      await sleep(400 * 2 ** attempt);
    }
  }
  throw new Error(`ดึงข้อมูลไม่สำเร็จหลังลอง ${retries + 1} ครั้ง: ${lastErr.message}`);
}

/**
 * สร้าง URL สำหรับดึง tab เป็น CSV
 *
 * ใช้ endpoint gviz เพราะคืน 200 พร้อม CORS header ตรง ๆ
 * ส่วน /export?format=csv จะ 307 redirect ซึ่งเบราว์เซอร์จัดการยากกว่า
 */
export function csvUrl(sheetId, gid) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

/**
 * รันงาน async หลายชิ้นพร้อมกันแบบจำกัดจำนวน
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number) => Promise<R>} worker
 * @returns {Promise<R[]>} ผลลัพธ์เรียงตามลำดับ input
 */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
