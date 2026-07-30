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
import { loadAll, loadFromSnapshot, loadConfig } from './lib/loader.js';
import { ask, MODELS, DEFAULT_MODEL, findModel, hasApiKey, estimateCost } from './lib/claude.js';
import { buildDataContext, SYSTEM_PROMPT } from './lib/chat-context.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const MEMORY_TTL_MS = 5 * 60 * 1000;

const STARTED_AT = Date.now();

// ─────────────────────────────────────────────────────────────
// สถานะในหน่วยความจำ
// ─────────────────────────────────────────────────────────────
let cached = null; // payload ล่าสุด
let cachedAt = 0;
let inFlight = null; // Promise ของการโหลดที่กำลังทำอยู่ (กันโหลดซ้อน)

/** ผู้ฟัง SSE ที่รอความคืบหน้าการโหลดอยู่ */
const progressClients = new Set();

/**
 * สถิติการใช้ Claude ตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน
 *
 * เก็บในหน่วยความจำอย่างเดียว รีสตาร์ทแล้วเริ่มนับใหม่
 * แยกรายโมเดลเพราะแต่ละตัวราคาต่างกัน
 */
const usageStats = {
  since: new Date().toISOString(),
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  byModel: {},
};

function recordUsage(model, usage) {
  const cost = estimateCost(model, usage);
  const bucket = (usageStats.byModel[model] ??= {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  });

  for (const target of [usageStats, bucket]) {
    target.requests += 1;
    target.inputTokens += usage.input_tokens ?? 0;
    target.outputTokens += usage.output_tokens ?? 0;
    target.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
    target.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    target.costUsd += cost;
  }
  return cost;
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
      cached = payload;
      cachedAt = Date.now();
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
// เส้นทาง API
// ─────────────────────────────────────────────────────────────
async function handleApi(req, res, url) {
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
    const force = url.searchParams.get('refresh') === '1';
    const payload = await getReports({ force });
    return sendJson(res, 200, payload);
  }

  const single = route.match(/^\/api\/reports\/([A-Za-z0-9_-]+)$/);
  if (single) {
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

  // ── Chatbot ──
  if (route === '/api/chat/models') {
    return sendJson(res, 200, {
      ready: hasApiKey(),
      defaultModel: DEFAULT_MODEL,
      models: MODELS.map((m) => ({
        id: m.id,
        label: m.label,
        descTh: m.descTh,
        descEn: m.descEn,
        pricing: m.pricing,
      })),
    });
  }

  if (route === '/api/usage') {
    return sendJson(res, 200, { ready: hasApiKey(), ...usageStats });
  }

  if (route === '/api/chat' && req.method === 'POST') {
    if (!hasApiKey()) {
      return sendJson(res, 503, {
        error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเครื่องที่รันเซิร์ฟเวอร์',
        code: 'NO_API_KEY',
      });
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

    /* ติด cache_control ที่บล็อกท้ายของ system
     *
     * คำสั่งระบบกับบริบทข้อมูลไม่เปลี่ยนตลอดการสนทนา (จนกว่าจะรีเฟรชข้อมูล)
     * การแคชไว้ทำให้เทิร์นถัด ๆ ไปจ่ายแค่ประมาณ 10% ของราคา input ปกติ
     */
    const system = [
      { type: 'text', text: SYSTEM_PROMPT },
      {
        type: 'text',
        text: buildDataContext(payload),
        cache_control: { type: 'ephemeral' },
      },
    ];

    try {
      const result = await ask({ model, system, messages: turns, maxTokens: 2048 });
      const cost = recordUsage(result.model, result.usage);

      if (result.refused) {
        return sendJson(res, 200, {
          refused: true,
          refusalCategory: result.refusalCategory,
          text: '',
          model: result.model,
          usage: result.usage,
          costUsd: cost,
          totals: usageStats,
        });
      }

      return sendJson(res, 200, {
        refused: false,
        text: result.text,
        model: result.model,
        stopReason: result.stopReason,
        usage: result.usage,
        costUsd: cost,
        totals: usageStats,
      });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      return sendJson(res, status, { error: err.message, code: err.code ?? err.apiType ?? null });
    }
  }

  return sendJson(res, 404, { error: 'ไม่พบ endpoint นี้' });
}

// ─────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // อนุญาต POST เฉพาะ endpoint ของ chatbot เท่านั้น ที่เหลืออ่านอย่างเดียว
  const isChatPost = req.method === 'POST' && url.pathname === '/api/chat';
  if (req.method !== 'GET' && req.method !== 'HEAD' && !isChatPost) {
    return sendJson(res, 405, { error: 'รองรับเฉพาะ GET' });
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('[error]', url.pathname, err.message);
    if (!res.headersSent) sendJson(res, 500, { error: err.message });
    else res.end();
  }
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
    console.log(`  รายงาน ${config.sources.length} รายการ / ${tabs} tabs`);
  } catch (err) {
    console.error(`\n  ✗ ${err.message}\n`);
    process.exit(1);
  }

  server.listen(PORT, HOST, () => {
    console.log(`  เปิดที่  http://${HOST}:${PORT}\n`);
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
