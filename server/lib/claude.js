/**
 * claude.js — ตัวเรียก Claude Messages API แบบไม่มี dependency
 *
 * โปรเจกต์นี้ตั้งกฎ zero npm dependencies ไว้ จึงเรียก REST API ตรงด้วย node:https
 * แทนการใช้ @anthropic-ai/sdk — แลกกับที่ต้องจัดการ retry และ error เอง
 *
 * API key อ่านจาก ANTHROPIC_API_KEY เท่านั้น และอยู่ฝั่ง server เสมอ
 * ห้ามส่ง key ไปฝั่งเบราว์เซอร์เด็ดขาด ใครเปิดหน้าเว็บก็อ่านได้
 */
import https from 'node:https';

const API_HOST = 'api.anthropic.com';
const API_PATH = '/v1/messages';
const API_VERSION = '2023-06-01';
const TIMEOUT_MS = 120000;

/**
 * โมเดลที่ให้ผู้ใช้เลือกได้ พร้อมราคาต่อ 1 ล้าน token
 *
 * ราคาอ้างอิง ณ 2026-06-24 — Sonnet 5 อยู่ในช่วงราคาแนะนำตัวถึง 2026-08-31
 * (ปกติ $3.00/$15.00) ถ้าเลยวันนั้นแล้วต้องอัปเดตตารางนี้
 *
 * effort: Haiku 4.5 ไม่รองรับพารามิเตอร์ effort (ส่งไปแล้ว error)
 * thinking: Opus 5 และ Sonnet 5 คิดโดยอัตโนมัติอยู่แล้ว ไม่ต้องตั้งค่า
 */
export const MODELS = [
  {
    id: 'claude-haiku-4-5',
    label: 'Haiku 4.5',
    descTh: 'เร็วและถูกที่สุด เหมาะกับคำถามยอดรวมตรงไปตรงมา',
    descEn: 'Fastest and cheapest — best for direct lookups',
    pricing: { input: 1.0, output: 5.0 },
    supportsEffort: false,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    descTh: 'สมดุลระหว่างคุณภาพกับราคา ใช้ได้กับคำถามส่วนใหญ่',
    descEn: 'Balanced quality and cost — good for most questions',
    pricing: { input: 2.0, output: 10.0, introUntil: '2026-08-31', listed: { input: 3.0, output: 15.0 } },
    supportsEffort: true,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    descTh: 'ตอบได้ลึกที่สุด เหมาะกับคำถามวิเคราะห์ที่ต้องคิดหลายชั้น',
    descEn: 'Deepest reasoning — best for multi-step analysis',
    pricing: { input: 5.0, output: 25.0 },
    supportsEffort: true,
  },
];

export const DEFAULT_MODEL = 'claude-sonnet-5';

/** ค้นข้อมูลโมเดลจาก id — คืน null ถ้าไม่อยู่ในรายการที่อนุญาต */
export function findModel(id) {
  return MODELS.find((m) => m.id === id) ?? null;
}

/** มี API key ให้ใช้ไหม */
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * คิดค่าใช้จ่ายจาก usage ที่ API คืนมา
 *
 * token ที่อ่านจากแคชคิดประมาณ 0.1 เท่าของราคาปกติ
 * ส่วน token ที่เขียนลงแคชคิด 1.25 เท่า (แคชอายุ 5 นาที)
 */
export function estimateCost(model, usage) {
  const spec = findModel(model);
  if (!spec || !usage) return 0;
  const { input, output } = spec.pricing;
  const perToken = (rate) => rate / 1_000_000;

  return (
    (usage.input_tokens ?? 0) * perToken(input) +
    (usage.cache_read_input_tokens ?? 0) * perToken(input) * 0.1 +
    (usage.cache_creation_input_tokens ?? 0) * perToken(input) * 1.25 +
    (usage.output_tokens ?? 0) * perToken(output)
  );
}

/** ยิง POST /v1/messages หนึ่งครั้ง */
function request(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: API_HOST,
        path: API_PATH,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': API_VERSION,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            return reject(new Error(`อ่านคำตอบจาก Claude API ไม่ได้ (HTTP ${res.statusCode})`));
          }
          if (res.statusCode !== 200) {
            const err = new Error(parsed?.error?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            err.apiType = parsed?.error?.type ?? null;
            return reject(err);
          }
          resolve(parsed);
        });
        res.on('error', reject);
      }
    );

    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`Claude API ไม่ตอบใน ${TIMEOUT_MS / 1000} วินาที`)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ควรลองใหม่ไหม — เฉพาะ rate limit, overload และ error ฝั่งเซิร์ฟเวอร์ */
function isRetryable(err) {
  return err.status === 429 || err.status === 529 || (err.status >= 500 && err.status < 600);
}

/**
 * ส่งข้อความไปถาม Claude
 *
 * @param {object} opts
 * @param {string} opts.model
 * @param {Array<{type:string,text:string,cache_control?:object}>} opts.system  บล็อกระบบ (บล็อกท้ายควรติด cache_control)
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<{text:string, usage:object, model:string, stopReason:string}>}
 */
export async function ask({ model, system, messages, maxTokens = 2048 }) {
  if (!hasApiKey()) {
    const err = new Error('ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเครื่องที่รันเซิร์ฟเวอร์');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const spec = findModel(model);
  if (!spec) {
    const err = new Error(`ไม่รู้จักโมเดล "${model}"`);
    err.code = 'BAD_MODEL';
    throw err;
  }

  const body = {
    model: spec.id,
    max_tokens: maxTokens,
    system,
    messages,
  };

  // Haiku 4.5 ไม่รองรับ effort — ส่งไปจะได้ 400 กลับมา
  // ส่วน Opus 5 / Sonnet 5 คิดเองอัตโนมัติอยู่แล้ว ใช้ effort คุมความลึกและค่าใช้จ่าย
  if (spec.supportsEffort) {
    body.output_config = { effort: 'medium' };
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(body);

      // safety classifier ปฏิเสธคำถาม — คืน 200 แต่ content ว่าง ต้องเช็คก่อนอ่าน
      if (res.stop_reason === 'refusal') {
        return {
          text: '',
          refused: true,
          refusalCategory: res.stop_details?.category ?? null,
          usage: res.usage ?? {},
          model: res.model ?? spec.id,
          stopReason: res.stop_reason,
        };
      }

      const text = (res.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();

      return {
        text,
        refused: false,
        usage: res.usage ?? {},
        model: res.model ?? spec.id,
        stopReason: res.stop_reason ?? null,
      };
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === 2) break;
      await sleep(600 * 2 ** attempt);
    }
  }
  throw lastErr;
}
