#!/usr/bin/env node
/**
 * server.js — เซิร์ฟเวอร์ของ Kambis Executive Report Dashboard
 *
 * ไม่มี dependency ใช้เฉพาะ Node.js built-in
 *   node server/server.js
 *
 * ทำสองอย่าง: เสิร์ฟไฟล์ static จาก public/ และให้ API ที่ผ่าน Data Analysis แล้วเสมอ
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/env.js';

/* อ่าน .env เข้ามาเป็น environment variable
 *
 * import ของ ES module ถูกยกขึ้นไปทำงานก่อนบรรทัดนี้เสมอ บรรทัดนี้จึงไม่ได้
 * รันก่อนโมดูลอื่นถูกโหลด — ใช้ได้เพราะ gemini.js อ่าน process.env ตอนถูกเรียก
 * ไม่ใช่ตอนโหลดโมดูล ถ้าจะเพิ่มโมดูลที่อ่าน key ตอนโหลด ต้องย้ายมาทำที่นี่ก่อน */
const envLoaded = loadDotEnv();

import { loadAll, loadFromSnapshot, loadConfig, loadLazySource } from './lib/loader.js';
import { ask, MODELS, DEFAULT_MODEL, findModel, hasApiKey, KEY_ENV_NAME } from './lib/gemini.js';
import { buildDataContext, SYSTEM_PROMPT } from './lib/chat-context.js';
import {
  createPurchaseRequests,
  validateItems,
  readRequestIndex,
  requestFilePath,
} from './lib/purchase-request.js';
import { createRefreshGate } from './lib/refresh-gate.js';
import {
  loadAuth,
  refreshAuthIfChanged,
  isAuthEnabled,
  verifyLogin,
  createSession,
  verifySession,
  getSessionCookie,
  buildSetCookie,
  isSecureRequest,
  clientIp,
  sweepAttempts,
  listUsers,
  initDevLogin,
  isDevLogin,
  isLoopbackHost,
  SESSION_HOURS,
  DEFAULT_CHAT_QUOTA,
} from './lib/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const MEMORY_TTL_MS = 5 * 60 * 1000;

/* เชื่อ X-Forwarded-For หรือไม่
 *
 * ตั้ง TRUST_PROXY=1 เฉพาะเมื่อมี nginx/Caddy คั่นอยู่หน้าจริง ๆ
 * ถ้าเปิดทั้งที่ไม่มี proxy ใครก็ปลอม header นี้เพื่อหนีการนับล็อกอินผิดได้ */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const STARTED_AT = Date.now();

// ─────────────────────────────────────────────────────────────
// สถานะในหน่วยความจำ
// ─────────────────────────────────────────────────────────────
let cached = null; // payload ล่าสุด (อาจเป็นชุดที่ไม่สมบูรณ์ก็ได้)
let cachedAt = 0;
let inFlight = null; // Promise ของการโหลดที่กำลังทำอยู่ (กันโหลดซ้อน)

/* payload ชุดล่าสุดที่ "ดีจริง" — เอาไว้เสิร์ฟแทนเมื่อดึงสดแล้วได้ของว่าง
 * แยกจาก `cached` โดยตั้งใจ เพราะ `cached` ต้องสะท้อนสิ่งที่เพิ่งส่งออกไปจริง ๆ
 * ส่วนตัวนี้ต้องไม่ถูกแตะจนกว่าจะมีชุดใหม่ที่ผ่านเกณฑ์ payloadHealth() */
let lastGood = null;

/** ผู้ฟัง SSE ที่รอความคืบหน้าการโหลดอยู่ */
const progressClients = new Set();

/**
 * สถิติการใช้ Gemini ตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน
 *
 * เก็บในหน่วยความจำอย่างเดียว รีสตาร์ทแล้วเริ่มนับใหม่
 * นับเป็น token ไม่แปลงเป็นเงิน เพราะราคาขึ้นกับว่าบัญชี AI Studio
 * ที่ใช้อยู่เป็นระดับฟรีหรือแบบเสียเงิน ซึ่งเซิร์ฟเวอร์ไม่มีทางรู้เอง
 */
const usageStats = {
  since: new Date().toISOString(),
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  byModel: {},
};

function recordUsage(model, usage) {
  const bucket = (usageStats.byModel[model] ??= {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
  });

  for (const target of [usageStats, bucket]) {
    target.requests += 1;
    target.inputTokens += usage.inputTokens ?? 0;
    target.outputTokens += usage.outputTokens ?? 0;
    target.thoughtTokens += usage.thoughtTokens ?? 0;
    target.cachedTokens += usage.cachedTokens ?? 0;
    target.totalTokens += usage.totalTokens ?? 0;
  }
}

/**
 * โควตาคำถาม chatbot รายวัน แยกตามผู้ใช้
 *
 * ทุกคำถามมีค่าใช้จ่ายจริงกับ Anthropic ถ้าไม่จำกัดไว้ คนเดียวถามรัว ๆ
 * ก็ทำให้บิลบานปลายได้ นับแบบ UTC วันต่อวัน เก็บในหน่วยความจำ
 */
const chatUsageByUser = new Map(); // username -> { day, count }

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/** @returns {{allowed:boolean, used:number, limit:number}} */
function checkChatQuota(username, limit) {
  const day = todayKey();
  const rec = chatUsageByUser.get(username);
  if (!rec || rec.day !== day) {
    chatUsageByUser.set(username, { day, count: 0 });
    return { allowed: limit > 0, used: 0, limit };
  }
  return { allowed: rec.count < limit, used: rec.count, limit };
}

function noteChatUse(username) {
  const day = todayKey();
  const rec = chatUsageByUser.get(username);
  if (!rec || rec.day !== day) chatUsageByUser.set(username, { day, count: 1 });
  else rec.count += 1;
}

/* ── คูลดาวน์ปุ่มรีเฟรช ──
 *
 * ใช้ร่วมกันทุกคนทุก role เพราะสิ่งที่ปกป้องคือโควตาฝั่ง Google ที่ใช้ร่วมกัน
 * (เหตุผลเต็มอยู่ใน lib/refresh-gate.js)
 *
 * **ต้อง ≤ MEMORY_TTL_MS** ไม่งั้นคำขอที่โดนบล็อกจะไปเจอแคชที่หมดอายุพอดี
 * แล้วโหลดเต็มรอบอยู่ดี — คูลดาวน์จะไม่มีความหมายเลย
 */
const REFRESH_COOLDOWN_MS = Math.min(
  Number(process.env.REFRESH_COOLDOWN_SEC ?? 120) * 1000,
  MEMORY_TTL_MS
);
const refreshGate = createRefreshGate({ cooldownMs: REFRESH_COOLDOWN_MS });

/**
 * ตัดสินว่าคำขอนี้ได้ดึงสดจริงไหม แล้วคืนสถานะไปให้หน้าเว็บบอกผู้ใช้
 *
 * **กดก่อนครบเวลายังได้ 200 พร้อมข้อมูลล่าสุด ไม่ใช่ 429** เพราะ getJson() ฝั่งเบราว์เซอร์
 * โยน error ทุกสถานะที่ไม่ใช่ 2xx แล้วเด้งไปหน้าจอ "โหลดไม่สำเร็จ" เต็มจอ
 * ซึ่งผู้บริหารจะอ่านว่าระบบพัง ทั้งที่แค่ยังไม่ถึงเวลาดึงรอบใหม่
 */
function gateRefresh(url, scope) {
  const requested = url.searchParams.get('refresh') === '1';
  if (!requested) {
    return { force: false, refresh: { requested: false, applied: false, waitMs: 0, cooldownMs: REFRESH_COOLDOWN_MS } };
  }
  const gate = refreshGate.check(scope);
  // จดก่อนโหลด ไม่ใช่หลังโหลดสำเร็จ — ดูเหตุผลใน refresh-gate.js
  if (gate.allowed) refreshGate.note(scope);
  return {
    force: gate.allowed,
    refresh: {
      requested: true,
      applied: gate.allowed,
      waitMs: gate.waitMs,
      cooldownMs: REFRESH_COOLDOWN_MS,
    },
  };
}

/** อ่าน body ของ POST พร้อมจำกัดขนาด กัน request ใหญ่เกินจนกินหน่วยความจำ */
function readJsonBody(req, limitBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('เนื้อหาที่ส่งมาใหญ่เกินกำหนด'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('รูปแบบ JSON ไม่ถูกต้อง'));
      }
    });
    req.on('error', reject);
  });
}

function broadcast(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of progressClients) {
    try {
      res.write(line);
    } catch {
      progressClients.delete(res);
    }
  }
}

/**
 * ดึงข้อมูล — ใช้ cache ในหน่วยความจำถ้ายังไม่หมดอายุ
 * ถ้าดึงสดไม่ได้เลย จะตกไปใช้ snapshot บนดิสก์ (ทำงานได้ตอนออฟไลน์)
 */
async function getReports({ force = false } = {}) {
  const fresh = cached && Date.now() - cachedAt < MEMORY_TTL_MS;
  if (fresh && !force) {
    return { ...cached, meta: { ...cached.meta, cacheHit: true } };
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const payload = await loadAll(broadcast);

      /* ดึงมาได้แต่ไม่มีข้อมูลเลยสักรายงาน = แย่กว่าไม่ดึง
       *
       * เกิดได้จริงเมื่อ Google ตอบ 200 พร้อมหน้า login หรือ CSV ว่าง — payload
       * จะมี status 'ok' ครบทุกรายงานแต่ 0 แถว ถ้าปล่อยผ่าน ผู้บริหารจะเห็นเลข 0
       * ทั้งจอโดยไม่มีอะไรบอกว่ามันไม่จริง จึงเสิร์ฟชุดที่ดีล่าสุดแทนพร้อมติดธง */
      if (payload.meta.health?.level === 'bad') {
        const fallback = lastGood ?? (await loadFromSnapshot());
        if (fallback) {
          const served = {
            ...fallback,
            meta: {
              ...fallback.meta,
              cacheHit: true,
              degraded: true,
              loadError: 'ดึงข้อมูลสดไม่สำเร็จทั้งหมด',
              failedSources: payload.meta.health.failed,
              /* เอา health ของ "รอบที่เพิ่งพยายาม" มาใช้ ไม่ใช่ของชุดสำรอง
               * ไม่งั้น /api/health จะรายงาน good ทั้งที่ระบบกำลังดึงข้อมูลไม่ได้
               * ตัวเฝ้าระวังภายนอกต้องเห็นว่าตอนนี้ดึงไม่ได้ ไม่ใช่ว่าข้อมูลที่โชว์อยู่ดี */
              health: payload.meta.health,
            },
          };
          /* ต้องตั้ง cachedAt ด้วย ไม่งั้นตอน Google ล่มจะไม่มี TTL คุมเลย
           * ทุกคนที่เปิดหน้าจะยิงเต็มรอบใหม่ทันทีตอนที่ปลายทางกำลังแย่ที่สุด */
          cached = served;
          cachedAt = Date.now();
          return served;
        }
        // ไม่เคยมีชุดที่ดีเลย — ส่งของที่ได้ไปดีกว่าจอขาว
      }

      cached = payload;
      cachedAt = Date.now();
      if (payload.meta.health?.level === 'good') lastGood = payload;
      return payload;
    } catch (err) {
      broadcast({ type: 'error', message: err.message });
      // ดึงสดไม่ได้ → ลองใช้ snapshot ที่เคยบันทึกไว้
      const snapshot = await loadFromSnapshot();
      if (snapshot) {
        cached = snapshot;
        cachedAt = Date.now();
        return {
          ...snapshot,
          meta: { ...snapshot.meta, cacheHit: true, degraded: true, loadError: err.message },
        };
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/* cache แยกสำหรับรายงานที่โหลดแบบ lazy
 *
 * TTL ยาวกว่า payload หลักเพราะชีตวัสดุถูกแก้วันละครั้ง ไม่ใช่ตลอดเวลา
 * และการโหลดแต่ละครั้งกิน 139 คำขอ จึงไม่ควรให้หมดอายุบ่อย */
const LAZY_TTL_MS = 15 * 60 * 1000;
const lazyCache = new Map(); // key → { payload, at }
const lazyInFlight = new Map(); // key → Promise
const lazyLastGood = new Map(); // key → payload ชุดล่าสุดที่ผ่านเกณฑ์ (ดู lastGood ด้านบน)

async function getLazySource(key, { force = false } = {}) {
  const hit = lazyCache.get(key);
  if (hit && !force && Date.now() - hit.at < LAZY_TTL_MS) {
    return { ...hit.payload, meta: { ...hit.payload.meta, cacheHit: true } };
  }
  if (lazyInFlight.has(key)) return lazyInFlight.get(key);

  const job = (async () => {
    try {
      const payload = await loadLazySource(key, broadcast);

      // เหตุผลเดียวกับ getReports() — ของว่างต้องไม่ไปแทนของดีที่ยังมีอยู่
      if (payload.meta.health?.level === 'bad') {
        const fallback = lazyLastGood.get(key) ?? (await loadFromSnapshot(`snapshot.${key}`));
        if (fallback) {
          const served = {
            ...fallback,
            meta: {
              ...fallback.meta,
              cacheHit: true,
              degraded: true,
              loadError: 'ดึงข้อมูลสดไม่สำเร็จทั้งหมด',
              failedSources: payload.meta.health.failed,
              /* เอา health ของ "รอบที่เพิ่งพยายาม" มาใช้ ไม่ใช่ของชุดสำรอง
               * ไม่งั้น /api/health จะรายงาน good ทั้งที่ระบบกำลังดึงข้อมูลไม่ได้
               * ตัวเฝ้าระวังภายนอกต้องเห็นว่าตอนนี้ดึงไม่ได้ ไม่ใช่ว่าข้อมูลที่โชว์อยู่ดี */
              health: payload.meta.health,
            },
          };
          lazyCache.set(key, { payload: served, at: Date.now() });
          return served;
        }
      }

      lazyCache.set(key, { payload, at: Date.now() });
      if (payload.meta.health?.level === 'good') lazyLastGood.set(key, payload);
      return payload;
    } catch (err) {
      broadcast({ type: 'error', message: err.message });
      const snapshot = await loadFromSnapshot(`snapshot.${key}`);
      if (snapshot) {
        lazyCache.set(key, { payload: snapshot, at: Date.now() });
        return {
          ...snapshot,
          meta: { ...snapshot.meta, cacheHit: true, degraded: true, loadError: err.message },
        };
      }
      throw err;
    } finally {
      lazyInFlight.delete(key);
    }
  })();

  lazyInFlight.set(key, job);
  return job;
}

/** คีย์ของรายงานที่ตั้ง lazy ไว้ใน config — อ่านครั้งเดียวแล้วจำไว้ */
let lazyKeysCache = null;
async function lazyKeys() {
  if (!lazyKeysCache) {
    const config = await loadConfig();
    lazyKeysCache = new Set(config.sources.filter((s) => s.lazy).map((s) => s.key));
  }
  return lazyKeysCache;
}

// ─────────────────────────────────────────────────────────────
// ตัวช่วยตอบกลับ
// ─────────────────────────────────────────────────────────────
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const target = path.resolve(PUBLIC_DIR, '.' + rel);

  // กัน path traversal — ต้องอยู่ใต้ public/ เท่านั้น
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) throw new Error('directory');

    const ext = path.extname(target).toLowerCase();

    // ETag จากขนาดไฟล์ + เวลาที่แก้ล่าสุด — เปลี่ยนไฟล์เมื่อไหร่ค่านี้เปลี่ยนทันที
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    const lastModified = info.mtime.toUTCString();

    /* ใช้ no-cache ไม่ใช่ max-age
     *
     * no-cache = เก็บได้ แต่ต้องถามเซิร์ฟเวอร์ทุกครั้งว่าไฟล์เปลี่ยนหรือยัง
     * ถ้าไม่เปลี่ยนจะได้ 304 ซึ่งเบาพอ ๆ กับใช้ของในแคช
     *
     * ถ้าใช้ max-age เบราว์เซอร์จะไม่ถามเลยจนกว่าจะหมดอายุ ทำให้แก้ CSS/JS
     * แล้วผู้ใช้ยังเห็นของเก่าอยู่ — เป็นปัญหาจริงที่เคยเกิดตอนเปลี่ยนธีม
     */
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);

    const noneMatch = req.headers['if-none-match'];
    const modifiedSince = req.headers['if-modified-since'];
    const fresh =
      (noneMatch && noneMatch === etag) ||
      (!noneMatch && modifiedSince && new Date(modifiedSince) >= new Date(lastModified));

    if (fresh) {
      res.writeHead(304);
      res.end();
      return;
    }

    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>404</title><p>ไม่พบหน้าที่ต้องการ</p>');
  }
}

// ─────────────────────────────────────────────────────────────
// การล็อกอิน
// ─────────────────────────────────────────────────────────────

/** เส้นทางที่เข้าได้โดยยังไม่ต้องล็อกอิน */
const OPEN_PATHS = new Set([
  '/login.html',
  '/js/login.js',
  '/js/theme.js',
  '/api/auth/login',
  '/api/auth/status',
  '/favicon.ico',
]);
const OPEN_PREFIXES = ['/css/', '/assets/'];

function isOpenPath(pathname) {
  return OPEN_PATHS.has(pathname) || OPEN_PREFIXES.some((p) => pathname.startsWith(p));
}

async function handleAuthRoute(req, res, url, user) {
  const route = url.pathname;

  if (route === '/api/auth/status') {
    return sendJson(res, 200, {
      enabled: isAuthEnabled(),
      devLogin: isDevLogin(),
      user: user ?? null,
      sessionHours: SESSION_HOURS,
    });
  }

  if (route === '/api/auth/me') {
    if (!user) return sendJson(res, 401, { error: 'ยังไม่ได้ล็อกอิน', code: 'AUTH_REQUIRED' });
    const quota = checkChatQuota(user.username, user.chatQuotaPerDay ?? DEFAULT_CHAT_QUOTA);
    return sendJson(res, 200, { user, chatQuota: quota });
  }

  if (route === '/api/auth/login' && req.method === 'POST') {
    if (!isAuthEnabled()) {
      return sendJson(res, 400, {
        error: 'เซิร์ฟเวอร์นี้ยังไม่ได้เปิดระบบล็อกอิน',
        code: 'AUTH_DISABLED',
      });
    }

    let body;
    try {
      body = await readJsonBody(req, 8 * 1024);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const ip = clientIp(req, { trustProxy: TRUST_PROXY });
    const result = await verifyLogin(body.username, body.password, ip);

    if (!result.ok) {
      console.warn(`[auth] ล็อกอินไม่สำเร็จ user="${body.username}" ip=${ip}`);
      return sendJson(res, 401, { error: result.error, code: 'BAD_CREDENTIALS' });
    }

    console.log(`[auth] ${result.user.username} ล็อกอินสำเร็จ ip=${ip}`);
    res.setHeader(
      'Set-Cookie',
      buildSetCookie(createSession(result.user), { secure: isSecureRequest(req) })
    );
    return sendJson(res, 200, { user: result.user });
  }

  if (route === '/api/auth/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', buildSetCookie('', { secure: isSecureRequest(req) }));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'ไม่พบ endpoint นี้' });
}

// ─────────────────────────────────────────────────────────────
// เส้นทาง API
// ─────────────────────────────────────────────────────────────
async function handleApi(req, res, url, user) {
  const route = url.pathname;

  if (route === '/api/health') {
    const config = await loadConfig().catch(() => null);
    return sendJson(res, 200, {
      ok: true,
      uptimeMs: Date.now() - STARTED_AT,
      cacheAgeMs: cached ? Date.now() - cachedAt : null,
      lastFetchedAt: cached?.meta?.fetchedAt ?? null,
      analysisScore: cached?.analysis?.score ?? null,
      analysisCounts: cached?.analysis?.counts ?? null,
      sourceCount: config?.sources?.length ?? null,
      configOutdated: config?.outdated ?? null,
      /* good / partial / bad — บอกว่าชุดที่เสิร์ฟอยู่ตอนนี้ครบแค่ไหน
       * ใช้เป็นตัวเฝ้าระวังจากภายนอกได้ (uptime monitor เรียกดูค่านี้) */
      dataHealth: cached?.meta?.health?.level ?? null,
      degraded: cached?.meta?.degraded ?? false,
      refreshCooldownMs: REFRESH_COOLDOWN_MS,
    });
  }

  // SSE — ต้องลงทะเบียนก่อนที่ client จะสั่งโหลด เพื่อไม่ให้พลาด event แรก
  if (route === '/api/progress') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    progressClients.add(res);

    /* ส่งรายชื่อรายงานให้ทันทีที่ต่อติด — ไม่ต้องรอ event 'start'
     *
     * 'start' ถูกยิงตอน loadAll() เริ่มทำงาน ซึ่งเบราว์เซอร์สั่งทันทีหลัง subscribe
     * ถ้าตอนนั้น EventSource ยังต่อไม่เสร็จ event แรกจะหายไปเลย แล้วหน้าจอโหลด
     * ต้องใช้ลิสต์สำรองที่ฮาร์ดโค้ดไว้ ซึ่งเป็น key ภาษาอังกฤษและตกรายงานใหม่ ๆ
     * (เจอจริง: ขึ้น dailyTrim/perCrop/… และไม่มี cost)
     *
     * ชื่อมาจาก config/sources.json ซึ่งสืบมาจากไฟล์ .txt ตามกฎข้อ 1
     * อ่านไม่ได้ก็ข้ามไป หน้าจอโหลดยังมีลิสต์สำรองของตัวเองอยู่ */
    loadConfig()
      .then((config) => {
        /* ส่งครบทุกรายงานตามไฟล์ .txt รวมรายงานที่โหลดแบบ lazy ด้วย
         * ผู้ใช้นับจากลิงก์ในไฟล์ ถ้าหน้าจอโหลดโชว์ไม่ครบจะดูเหมือนมีรายงานหาย
         * ติดธง lazy ไปด้วยเพื่อให้หน้าจอบอกได้ว่าอันนั้นโหลดเบื้องหลัง ไม่ใช่ค้าง */
        const sources = config.sources.map((s) => ({
          key: s.key,
          titleTh: s.titleTh,
          titleEn: s.titleEn,
          lazy: Boolean(s.lazy),
        }));
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
        }
      })
      .catch(() => {});

    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(ping);
      }
    }, 20000);

    req.on('close', () => {
      clearInterval(ping);
      progressClients.delete(res);
    });
    return undefined;
  }

  if (route === '/api/reports') {
    const { force, refresh } = gateRefresh(url, 'reports');
    const payload = await getReports({ force });
    return sendJson(res, 200, { ...payload, meta: { ...payload.meta, refresh } });
  }

  const single = route.match(/^\/api\/reports\/([A-Za-z0-9_-]+)$/);
  if (single) {
    // รายงาน lazy ไม่ได้อยู่ใน payload หลัก — โหลดแยกพร้อม cache/TTL ของตัวเอง
    if ((await lazyKeys()).has(single[1])) {
      // คูลดาวน์แยก scope เพราะเป็นคนละชุดคำขอกัน (140 vs 125)
      const { force, refresh } = gateRefresh(url, single[1]);
      const lazy = await getLazySource(single[1], { force });
      return sendJson(res, 200, { ...lazy, meta: { ...lazy.meta, refresh } });
    }
    const payload = await getReports();
    const source = payload.sources[single[1]];
    if (!source) return sendJson(res, 404, { error: `ไม่พบรายงาน "${single[1]}"` });
    return sendJson(res, 200, {
      meta: payload.meta.sources.find((s) => s.key === single[1]) ?? null,
      source,
      kpi: payload.kpi[single[1]] ?? null,
      findings: payload.analysis.findings.filter((f) => f.source === single[1]),
    });
  }

  if (route === '/api/analysis') {
    const payload = await getReports();
    return sendJson(res, 200, payload.analysis);
  }

  // ── ใบขอซื้อวัสดุ ──
  if (route === '/api/supply/purchase-request' && req.method === 'POST') {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    // เทียบรายการที่ขอกับข้อมูลจริงจากชีตเสมอ — ราคาก็เอาจากชีต ไม่เอาจากเบราว์เซอร์
    const supply = await getLazySource('supplyLog');
    const { items, errors } = validateItems(body?.items, supply?.kpi?.items);
    if (!items.length) {
      return sendJson(res, 400, { error: errors[0] ?? 'ไม่มีรายการที่ขอซื้อ', errors });
    }

    /* ปุ๋ยใช้แบบฟอร์มคนละแบบกับวัสดุทั่วไป เลือกปนกันมาจึงได้หลายใบ
     *
     * ตอบเป็น JSON ไม่ใช่ไฟล์ดิบเหมือนเดิม เพราะ (ก) ต้องส่งได้หลายไฟล์
     * (ข) ของเดิมส่งรายการที่ตกหล่นมาทาง header `X-Skipped` ซึ่งหน้าเว็บไม่เคยอ่าน
     * ผู้ใช้จึงไม่มีทางรู้ว่ามีรายการหายไปจากใบ */
    const { documents, indexed } = await createPurchaseRequests({
      items,
      requestedBy: user?.username ?? null,
      note: body?.note ?? '',
    });

    for (const doc of documents) {
      console.log(
        `[pr] ${doc.docNo} · ${doc.form} · ${doc.items.length} รายการ · ` +
          `${doc.totalAmount.toLocaleString()} บาท${doc.savedTo ? '' : ' (เก็บสำเนาไม่สำเร็จ)'}`
      );
    }
    if (!indexed) console.warn('[pr] ออกใบแล้วแต่จดทะเบียนไม่สำเร็จ — ระบบจะจำไม่ได้ว่าเคยขอ');

    return sendJson(res, 200, {
      documents: documents.map((d) => ({
        docNo: d.docNo,
        form: d.form,
        fileName: d.fileName,
        itemCount: d.items.length,
        totalAmount: d.totalAmount,
        missingPrice: d.missingPrice,
        // ไฟล์เล็ก (~5KB) base64 จึงพอไหว และได้ส่งหลายไฟล์ในคำตอบเดียว
        base64: d.buffer.toString('base64'),
      })),
      // จดทะเบียนไม่สำเร็จ = ครั้งหน้าระบบจะจำไม่ได้ว่าเคยขอ ต้องบอกผู้ใช้
      indexed,
      skipped: errors,
    });
  }

  /* ── ดาวน์โหลดใบขอซื้อที่เคยออก ──
   *
   * เลขที่เอกสารรันต่อไปเรื่อย ๆ ไม่มีการใช้เลขซ้ำ เพราะเลขหนึ่งเลข = กระดาษหนึ่งใบ
   * ที่อาจถูกส่งไปให้ CEO เซ็นแล้ว ถ้าออกเลขซ้ำจะแยกไม่ออกว่าอนุมัติใบไหน
   * "ทำไฟล์หาย" จึงต้องแก้ด้วยการเอาสำเนาเดิมกลับมา ไม่ใช่กดออกใบใหม่
   *
   * ชื่อไฟล์มาจาก URL — ตรวจรูปแบบก่อนแตะดิสก์เสมอ (requestFilePath) */
  const prDoc = route.match(/^\/api\/supply\/purchase-request\/(.*)$/);
  if (prDoc) {
    const docNo = decodeURIComponent(prDoc[1]);
    const target = requestFilePath(docNo);
    if (!target) return sendJson(res, 400, { error: 'เลขที่ใบขอซื้อไม่ถูกต้อง', code: 'BAD_DOC_NO' });

    let buffer;
    try {
      buffer = await readFile(target.fullPath);
    } catch {
      /* แยกสองกรณีให้ชัด — "ไม่มีใบนี้" แปลว่าพิมพ์เลขผิด ส่วน "มีในทะเบียนแต่ไฟล์หาย"
       * แปลว่าต้องออกใบใหม่จริง ๆ (ตอนออกใบ savedTo เป็น null ได้ถ้าเขียนดิสก์ไม่สำเร็จ) */
      const index = await readRequestIndex();
      const known = index.requests.some((r) => r.docNo === docNo);
      return sendJson(res, 404, {
        error: known
          ? `ใบขอซื้อ ${docNo} อยู่ในทะเบียน แต่ไฟล์สำเนาหายไปจากเซิร์ฟเวอร์`
          : `ไม่พบใบขอซื้อเลขที่ ${docNo}`,
        code: known ? 'FILE_MISSING' : 'NOT_FOUND',
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': buffer.length,
      'Content-Disposition': `attachment; filename="${target.fileName}"`,
      'Cache-Control': 'no-store',
    });
    return res.end(req.method === 'HEAD' ? undefined : buffer);
  }

  // ── ทะเบียนใบขอซื้อที่เคยออก ──
  if (route === '/api/supply/purchase-requests') {
    const index = await readRequestIndex();
    // ใหม่ก่อน — คนเปิดดูเพื่อตอบคำถามว่า "เพิ่งขออะไรไป" ไม่ใช่ไล่ตั้งแต่ใบแรก
    const requests = [...index.requests].sort((a, b) =>
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
    );
    return sendJson(res, 200, { requests });
  }

  // ── Chatbot ──
  if (route === '/api/chat/models') {
    return sendJson(res, 200, {
      ready: hasApiKey(),
      provider: 'Google AI Studio',
      keyEnvName: KEY_ENV_NAME,
      defaultModel: DEFAULT_MODEL,
      canChat: !user || user.role === 'exec',
      models: MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        descTh: m.descTh,
        descEn: m.descEn,
        thinking: m.thinking,
      })),
    });
  }

  if (route === '/api/usage') {
    const quota = user
      ? checkChatQuota(user.username, user.chatQuotaPerDay ?? DEFAULT_CHAT_QUOTA)
      : null;
    return sendJson(res, 200, { ready: hasApiKey(), ...usageStats, chatQuota: quota });
  }

  if (route === '/api/chat' && req.method === 'POST') {
    if (!hasApiKey()) {
      return sendJson(res, 503, {
        error: `ยังไม่ได้ตั้งค่า ${KEY_ENV_NAME} บนเครื่องที่รันเซิร์ฟเวอร์`,
        code: 'NO_API_KEY',
      });
    }

    // เมื่อเปิดระบบล็อกอิน chatbot สงวนไว้ให้ role exec — ทุกคำถามมีค่าใช้จ่ายจริง
    if (user) {
      if (user.role !== 'exec') {
        return sendJson(res, 403, {
          error: 'บัญชีนี้ดูรายงานได้อย่างเดียว ยังไม่ได้เปิดสิทธิ์ใช้ผู้ช่วย AI',
          code: 'CHAT_FORBIDDEN',
        });
      }
      const quota = checkChatQuota(user.username, user.chatQuotaPerDay ?? DEFAULT_CHAT_QUOTA);
      if (!quota.allowed) {
        return sendJson(res, 429, {
          error: `ใช้ครบโควตาวันนี้แล้ว (${quota.used}/${quota.limit} คำถาม) พรุ่งนี้เริ่มนับใหม่`,
          code: 'QUOTA_EXCEEDED',
          chatQuota: quota,
        });
      }
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const model = body.model || DEFAULT_MODEL;
    if (!findModel(model)) return sendJson(res, 400, { error: `ไม่รู้จักโมเดล "${model}"` });

    const history = Array.isArray(body.messages) ? body.messages : [];
    const turns = history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
      .slice(-20); // เก็บ 20 เทิร์นล่าสุดพอ ไม่ให้บริบทบวมไปเรื่อย ๆ

    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      return sendJson(res, 400, { error: 'ต้องมีข้อความจากผู้ใช้เป็นรายการสุดท้าย' });
    }

    const payload = await getReports();

    /* ข้อมูลวัสดุสิ้นเปลืองแนบไปด้วยถ้ามีอยู่ใน cache แล้ว
     *
     * ไม่บังคับโหลดสด เพราะจะทำให้คำถามแรกของทุกวันช้าไปอีก 8 วินาที
     * ทั้งที่ส่วนใหญ่ถามเรื่องดอก — ถ้ายังไม่มี ผู้ช่วยจะบอกเองว่ายังไม่มีข้อมูลส่วนนี้ */
    let supplyPayload = null;
    for (const key of await lazyKeys()) {
      const hit = lazyCache.get(key);
      if (hit) supplyPayload = hit.payload;
    }

    // Gemini รับคำสั่งระบบเป็นข้อความก้อนเดียว จึงต่อคำสั่งกับบริบทข้อมูลเข้าด้วยกัน
    const system = `${SYSTEM_PROMPT}\n\n${buildDataContext(payload, supplyPayload)}`;

    try {
      const result = await ask({ model, system, messages: turns });
      recordUsage(result.model, result.usage);

      // นับโควตาหลังเรียกสำเร็จเท่านั้น — ถ้า API ล่มไม่ควรตัดสิทธิ์ผู้ใช้
      let chatQuota = null;
      if (user) {
        noteChatUse(user.username);
        chatQuota = checkChatQuota(user.username, user.chatQuotaPerDay ?? DEFAULT_CHAT_QUOTA);
      }

      return sendJson(res, 200, {
        refused: result.refused,
        refusalCategory: result.refusalCategory ?? null,
        text: result.text,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        totals: usageStats,
        chatQuota,
      });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      return sendJson(res, status, { error: err.message, code: err.code ?? err.apiType ?? null });
    }
  }

  return sendJson(res, 404, { error: 'ไม่พบ endpoint นี้' });
}

// ─────────────────────────────────────────────────────────────
/** endpoint ที่รับ POST ได้ — ที่เหลืออ่านอย่างเดียว */
const POST_ROUTES = new Set([
  '/api/chat',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/supply/purchase-request',
]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  const isAllowedPost = req.method === 'POST' && POST_ROUTES.has(url.pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isAllowedPost) {
    return sendJson(res, 405, { error: 'รองรับเฉพาะ GET' });
  }

  try {
    // รับรายชื่อผู้ใช้ที่เพิ่งเพิ่ม/ลบ โดยไม่ต้องรีสตาร์ทเซิร์ฟเวอร์
    await refreshAuthIfChanged();

    const user = isAuthEnabled() ? verifySession(getSessionCookie(req)) : null;

    /* ด่านตรวจ — ทุกอย่างต้องล็อกอินก่อน ยกเว้นหน้า login กับไฟล์ที่หน้านั้นต้องใช้
     *
     * วางไว้ก่อนทุก route โดยตั้งใจ ถ้าเพิ่ม endpoint ใหม่ในอนาคต
     * มันจะถูกกั้นให้อัตโนมัติ ไม่ต้องไปไล่ใส่ทีละอัน */
    if (isAuthEnabled() && !user && !isOpenPath(url.pathname)) {
      if (url.pathname.startsWith('/api/')) {
        return sendJson(res, 401, { error: 'กรุณาล็อกอินก่อน', code: 'AUTH_REQUIRED' });
      }
      const next = encodeURIComponent(url.pathname + url.search);
      res.writeHead(302, { Location: `/login.html?next=${next}`, 'Cache-Control': 'no-store' });
      return res.end();
    }

    // ล็อกอินอยู่แล้วแต่ยังเปิดหน้า login — ส่งกลับเข้า dashboard
    if (user && url.pathname === '/login.html') {
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (url.pathname.startsWith('/api/auth/')) {
      await handleAuthRoute(req, res, url, user);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url, user);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[error]', url.pathname, err.message);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
});

// เก็บกวาดสถิติล็อกอินผิดที่หมดอายุ ไม่ให้ Map โตไปเรื่อย ๆ
setInterval(sweepAttempts, 10 * 60 * 1000).unref();

/* ─── กันเซิร์ฟเวอร์ดับเงียบ ๆ ───────────────────────────────
 *
 * เซิร์ฟเวอร์นี้ต้องรันค้างโดยไม่มีคนเฝ้า แต่ Node ตั้งแต่ v15 **ปิดโปรเซสทันที**
 * เมื่อมี promise ที่ reject แล้วไม่มีใครรับ ถ้าไม่ดักไว้ งานเบื้องหลังที่พลาด
 * เพียงครั้งเดียว (เช่นดึงชีตไม่สำเร็จตอน Google ล่ม) จะทำให้เว็บทั้งเว็บล่ม
 * โดยไม่ทิ้งข้อความอะไรไว้เลย — เคยเกิดจริงแล้ว ดับทุก 5–25 นาทีหาสาเหตุไม่ได้
 *
 * แยกการรับมือสองแบบโดยตั้งใจ:
 *   - rejection ที่ไม่มีใครรับ = เกือบทั้งหมดคือ fetch ที่ล้มเหลว → บันทึกแล้วไปต่อ
 *     เพราะการดึงชีตพลาดหนึ่งครั้งไม่ควรทำให้ผู้บริหารเปิดเว็บไม่ได้
 *   - exception ที่ไม่มีใครรับ = สถานะภายในอาจเสียแล้ว → บันทึกแล้วออก
 *     ให้ตัวคุม (scripts/start-server.ps1) เปิดใหม่ด้วยสถานะที่สะอาด
 */
process.on('unhandledRejection', (reason) => {
  console.error(
    `[${new Date().toISOString()}] promise rejection ที่ไม่มีใครรับ — เซิร์ฟเวอร์ทำงานต่อ:`,
    reason instanceof Error ? reason.stack : reason
  );
});

process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] exception ที่ไม่มีใครรับ — กำลังปิดเพื่อเปิดใหม่:`, err);
  process.exit(1);
});

/* บันทึกว่าใครสั่งปิด
 *
 * เคยเจอว่าเซิร์ฟเวอร์ดับทุก 20–55 นาทีโดย stderr ว่างเปล่าสนิท ไม่มีทั้ง
 * exception และ rejection แปลว่าไม่ได้พังเอง แต่ถูกสั่งปิดจากข้างนอก
 * ถ้าไม่จดไว้ตรงนี้ จะแยกไม่ออกเลยว่า "โดนสัญญาณปิด" กับ "ถูกฆ่าดื้อ ๆ" ต่างกันยังไง
 *
 *   มีบรรทัด "ได้รับสัญญาณ …"  = มีใครสั่งปิดอย่างสุภาพ (Ctrl+C, ปิดหน้าต่าง, logoff)
 *   ไม่มีบรรทัดนี้เลย          = ถูก TerminateProcess ฆ่าตรง ๆ ไม่มีทางกันได้
 */
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => {
    console.error(`[${new Date().toISOString()}] ได้รับสัญญาณ ${sig} — กำลังปิดเซิร์ฟเวอร์`);
    process.exit(0);
  });
}

process.on('exit', (code) => {
  console.error(`[${new Date().toISOString()}] โปรเซสจบการทำงาน exit=${code}`);
});

// ─────────────────────────────────────────────────────────────
async function start() {
  try {
    const config = await loadConfig();
    if (config.outdated) {
      console.warn(
        '\n  ⚠  "แบบฟอร์มรายงาน Kambis.txt" ถูกแก้ไขหลังจาก config/sources.json ถูกสร้าง'
      );
      console.warn('     รัน `node scripts/sync-sources.js` เพื่ออัปเดตรายชื่อรายงานก่อน\n');
    }
    const tabs = config.sources.reduce((n, s) => n + s.tabs.length, 0);
    console.log(`  Kambis Executive Report Dashboard`);
    console.log(`  รายงาน ${config.sources.length} รายการ / ${tabs} tabs (ค้นแท็บใหม่ทุกครั้งที่รีเฟรช)`);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }

  await loadAuth({ force: true });

  if (envLoaded) console.log(`  โหลดค่าจาก .env ${envLoaded} รายการ`);

  // เปิดโหมดทดสอบถ้าขอมา — จะโยน error ถ้า HOST ไม่ใช่ localhost
  try {
    initDevLogin(HOST);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }

  if (isDevLogin()) {
    console.log('');
    console.log('  ╔════════════════════════════════════════════════════════════╗');
    console.log('  ║  DEV_LOGIN=1 — โหมดทดสอบ พิมพ์ชื่อผู้ใช้/รหัสอะไรก็เข้าได้        ║');
    console.log('  ║  เท่ากับ "ไม่มีระบบล็อกอิน" — ใช้ดูระบบบนเครื่องตัวเองเท่านั้น      ║');
    console.log('  ║  ก่อนขึ้นเซิร์ฟเวอร์จริง ต้องเอา DEV_LOGIN ออกจาก .env           ║');
    console.log('  ╚════════════════════════════════════════════════════════════╝');
    console.log('');
  } else if (isAuthEnabled()) {
    const users = listUsers();
    const execs = users.filter((u) => u.role === 'exec').length;
    console.log(`  ล็อกอิน: เปิดใช้งาน — ผู้ใช้ ${users.length} คน (ใช้ผู้ช่วย AI ได้ ${execs} คน)`);
  } else {
    console.log('  ล็อกอิน: ปิดอยู่ — ใครเข้าถึงพอร์ตนี้ได้ก็เห็นข้อมูลทั้งหมด');
  }

  /* กันพลาดครั้งใหญ่: เปิดให้ทั้งเครือข่ายเข้าได้ทั้งที่ยังไม่มีระบบล็อกอิน
   *
   * ข้อมูลในนี้คือยอดขาย ต้นทุน ลูกค้า และสต็อกจริงของบริษัท
   * ถ้าเผลอรันด้วย HOST=0.0.0.0 โดยยังไม่ได้สร้างผู้ใช้ ทุกคนในออฟฟิศ
   * (หรือทั้งอินเทอร์เน็ต ถ้า forward port ไว้) เปิดดูได้ทันทีโดยไม่ต้องล็อกอิน */
  if (!isLoopbackHost(HOST) && !isAuthEnabled()) {
    console.error(`\n  ✗ ปฏิเสธการเปิดที่ ${HOST} เพราะยังไม่ได้ตั้งระบบล็อกอิน\n`);
    console.error('    ข้อมูลชุดนี้มียอดขาย ต้นทุน และรายชื่อลูกค้าจริง');
    console.error('    สร้างผู้ใช้อย่างน้อยหนึ่งคนก่อน:\n');
    console.error('      node scripts/manage-users.js add <ชื่อผู้ใช้> --role exec\n');
    console.error('    ถ้าต้องการเปิดแบบไม่มีล็อกอินจริง ๆ (ไม่แนะนำ) ตั้ง ALLOW_NO_AUTH=1\n');
    if (process.env.ALLOW_NO_AUTH !== '1') process.exit(1);
    console.error('    ALLOW_NO_AUTH=1 ถูกตั้งไว้ — เปิดต่อทั้งที่ไม่มีล็อกอิน\n');
  }

  if (!hasApiKey()) {
    console.log(`  ผู้ช่วย AI: ปิดอยู่ — ยังไม่ได้ตั้ง ${KEY_ENV_NAME}`);
  }

  server.listen(PORT, HOST, () => {
    console.log(`\n  เปิดที่  http://${HOST}:${PORT}\n`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ พอร์ต ${PORT} ถูกใช้งานอยู่ — ตั้ง PORT=<เลขอื่น> แล้วลองใหม่\n`);
    process.exit(1);
  }
  throw err;
});

start();
