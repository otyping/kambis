/**
 * gemini.js — ตัวเรียก Google AI Studio (Gemini API) แบบไม่มี dependency
 *
 * ใช้ node:https ตรง ๆ ตามหลักของโปรเจกต์ที่ไม่ติดตั้ง npm package
 *
 * API key อ่านจาก environment เท่านั้น (GOOGLE_API_KEY หรือ GEMINI_API_KEY)
 * และอยู่ฝั่งเซิร์ฟเวอร์เสมอ — ห้ามส่งไปฝั่งเบราว์เซอร์เด็ดขาด
 * ใครเปิดหน้าเว็บก็กด View Source อ่านได้ทันทีถ้าหลุดไป
 *
 * เอกสาร: https://ai.google.dev/api/generate-content
 */
import https from 'node:https';

const HOST = 'generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';

/**
 * โมเดลที่เปิดให้เลือก — ทดสอบกับ key ของโปรเจกต์นี้แล้วว่าเรียกได้จริง
 *
 * รุ่น Pro (gemini-3-pro-preview ฯลฯ) ตอบ 429 เพราะบัญชีระดับฟรีของ AI Studio
 * ไม่ได้รับโควตา Pro จึงไม่ใส่ไว้ให้เลือก กันผู้ใช้เจอ error โดยไม่จำเป็น
 *
 * thinkingLevel ปรับได้เฉพาะรุ่นที่คิดก่อนตอบ รุ่น lite ไม่มีขั้นตอนคิด
 */
export const MODELS = [
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Flash Lite 3.5',
    descTh: 'เร็วที่สุด (~1 วินาที) เหมาะกับคำถามตรงไปตรงมา',
    descEn: 'Fastest (~1s), best for direct questions',
    thinking: false,
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Flash 3.5',
    descTh: 'สมดุลระหว่างความเร็วกับความละเอียด',
    descEn: 'Balanced speed and depth',
    thinking: true,
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Flash 3.6',
    descTh: 'ตอบละเอียดที่สุด เหมาะกับคำถามที่ต้องเทียบหลายตัวเลข',
    descEn: 'Most thorough, best for multi-number comparisons',
    thinking: true,
  },
];

export const DEFAULT_MODEL = 'gemini-3.5-flash';

export function findModel(id) {
  return MODELS.find((m) => m.id === id) ?? null;
}

export function hasApiKey() {
  return Boolean(apiKey());
}

function apiKey() {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
}

/** ชื่อ env ที่กำลังใช้อยู่ — เอาไปแสดงในข้อความบอกวิธีตั้งค่า */
export const KEY_ENV_NAME = 'GOOGLE_API_KEY';

// ─────────────────────────────────────────────────────────────
// การเรียก API
// ─────────────────────────────────────────────────────────────
function postJson(pathname, payload, { timeoutMs = 90000 } = {}) {
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: HOST,
        path: pathname,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey(),
          'content-length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* ตอบกลับมาไม่ใช่ JSON — ปล่อยให้ผู้เรียกจัดการ */
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Gemini ไม่ตอบกลับภายใน ${Math.round(timeoutMs / 1000)} วินาที`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ควรลองใหม่ไหม — เฉพาะที่เป็นปัญหาชั่วคราว ไม่ใช่ key ผิดหรือ request ผิด */
function isRetryable(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * ถาม Gemini หนึ่งครั้ง
 *
 * @param {object} opts
 * @param {string} opts.model
 * @param {string} opts.system คำสั่งระบบ + บริบทข้อมูล
 * @param {{role:'user'|'assistant', content:string}[]} opts.messages
 * @param {number} [opts.maxTokens] รวม token ที่ใช้คิดด้วย ไม่ใช่แค่คำตอบ
 * @param {'low'|'high'} [opts.thinkingLevel]
 */
export async function ask({ model, system, messages, maxTokens = 8192, thinkingLevel = 'low' }) {
  if (!hasApiKey()) {
    const err = new Error(`ยังไม่ได้ตั้งค่า ${KEY_ENV_NAME}`);
    err.code = 'NO_API_KEY';
    throw err;
  }

  const spec = findModel(model);

  const payload = {
    system_instruction: { parts: [{ text: system }] },
    // Gemini เรียกฝั่งผู้ช่วยว่า "model" ไม่ใช่ "assistant"
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      /* maxOutputTokens นับรวม token ที่โมเดลใช้คิดก่อนตอบด้วย
       * ตั้งต่ำเกินไปจะเจออาการคิดจนหมดโควตาแล้วคืนข้อความว่าง
       * (ทดสอบแล้ว: คำถามเลขง่าย ๆ ใช้ token คิดไปเกือบพัน) */
      maxOutputTokens: maxTokens,
      temperature: 0.2, // งานนี้ต้องการความคงเส้นคงวา ไม่ใช่ความสร้างสรรค์
    },
  };

  if (spec?.thinking && thinkingLevel) {
    payload.generationConfig.thinkingConfig = { thinkingLevel };
  }

  const path = `/${API_VERSION}/models/${encodeURIComponent(model)}:generateContent`;

  let lastError = null;
  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) await sleep(Math.min(600 * 2 ** (attempt - 1), 4000));

    let res;
    try {
      res = await postJson(path, payload);
    } catch (err) {
      lastError = err;
      continue; // ปัญหาระดับเครือข่าย ลองใหม่ได้
    }

    if (res.status === 200 && res.json) return shape(res.json, model);

    const apiMessage = res.json?.error?.message ?? res.text?.slice(0, 300) ?? '';
    const status = res.json?.error?.status ?? '';

    if (isRetryable(res.status) && attempt < 3) {
      lastError = new Error(apiMessage || `HTTP ${res.status}`);
      continue;
    }

    throw toFriendlyError(res.status, status, apiMessage);
  }

  const err = new Error(`เรียก Gemini ไม่สำเร็จ: ${lastError?.message ?? 'ไม่ทราบสาเหตุ'}`);
  err.status = 502;
  throw err;
}

/** แปลง error ของ Google ให้เป็นข้อความที่ผู้ใช้อ่านรู้เรื่อง */
function toFriendlyError(httpStatus, apiStatus, message) {
  let friendly = message || `Gemini ตอบกลับ HTTP ${httpStatus}`;

  if (httpStatus === 400 && /API key not valid/i.test(message)) {
    friendly = 'API key ของ Google AI Studio ไม่ถูกต้อง ตรวจสอบค่าใน .env อีกครั้ง';
  } else if (httpStatus === 403) {
    friendly = 'API key นี้ไม่มีสิทธิ์เรียกโมเดลที่เลือก';
  } else if (httpStatus === 429) {
    friendly = 'ใช้เกินโควตาของ Google AI Studio แล้ว รอสักครู่แล้วลองใหม่ หรือเลือกโมเดลที่เบากว่า';
  } else if (httpStatus === 404) {
    friendly = 'ไม่พบโมเดลนี้ในบัญชี AI Studio ที่ใช้อยู่ ลองเลือกโมเดลอื่น';
  }

  const err = new Error(friendly);
  err.status = httpStatus;
  err.code = apiStatus || null;
  return err;
}

/** จัดรูปคำตอบให้เป็นทรงเดียวกับที่ server.js ใช้ */
function shape(json, model) {
  const candidate = json.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;

  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
    .trim();

  const u = json.usageMetadata ?? {};
  const usage = {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    thoughtTokens: u.thoughtsTokenCount ?? 0,
    cachedTokens: u.cachedContentTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };

  // คำถามถูกปฏิเสธตั้งแต่ยังไม่ประมวลผล
  const blockReason = json.promptFeedback?.blockReason ?? null;
  if (blockReason) {
    return { refused: true, refusalCategory: blockReason, text: '', model, finishReason, usage };
  }

  if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
    return { refused: true, refusalCategory: finishReason, text: '', model, finishReason, usage };
  }

  /* คิดจนหมดโควตา token เลยไม่เหลือที่ให้เขียนคำตอบ
   * ไม่ควรส่งข้อความว่างกลับไปให้ผู้ใช้งงเอง */
  if (!text && finishReason === 'MAX_TOKENS') {
    const err = new Error('คำตอบยาวเกินขีดจำกัด ลองถามให้แคบลง หรือเลือกโมเดล Flash Lite');
    err.status = 502;
    throw err;
  }

  return { refused: false, text, model, finishReason, usage };
}
