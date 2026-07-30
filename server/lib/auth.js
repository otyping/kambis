/**
 * auth.js — ระบบล็อกอินสำหรับเปิด Dashboard ให้ผู้บริหารเข้าผ่าน domain
 *
 * ไม่มี dependency ใช้แค่ node:crypto
 *
 * รูปแบบที่เลือกใช้และเหตุผล
 *   - รหัสผ่านเก็บเป็น scrypt hash + salt เฉพาะคน ไม่เคยเก็บรหัสจริง
 *   - session เป็นคุกกี้ที่เซ็นด้วย HMAC (stateless) รีสตาร์ทเซิร์ฟเวอร์แล้วยังล็อกอินอยู่
 *   - คุกกี้เป็น HttpOnly เสมอ — JavaScript บนหน้าเว็บอ่านไม่ได้ กัน XSS ขโมย session
 *   - ล็อกอินผิดซ้ำ ๆ จะโดนหน่วง กัน brute force
 *
 * ไฟล์ผู้ใช้อยู่ที่ config/users.json และถูก gitignore ไว้ — ห้าม commit เด็ดขาด
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';
import { readFile, writeFile, rename, chmod, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCb);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const USERS_FILE = path.join(ROOT, 'config', 'users.json');

const COOKIE_NAME = 'kambis_session';
const KEYLEN = 64;
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;

// ล็อกอินผิดได้กี่ครั้งก่อนโดนหน่วง และหน่วงนานเท่าไร
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

/** โควตาคำถาม chatbot ต่อคนต่อวัน — คุมค่า API ไม่ให้บานปลาย */
export const DEFAULT_CHAT_QUOTA = Number(process.env.CHAT_QUOTA_PER_DAY) || 50;

// ─────────────────────────────────────────────────────────────
// การอ่าน/เขียนไฟล์ผู้ใช้
// ─────────────────────────────────────────────────────────────
let store = null; // { secret, users: [] }
let loaded = false;

let storeMtime = 0;
let lastFreshCheck = 0;

/** ตรวจไฟล์ผู้ใช้ซ้ำถี่แค่ไหน — กันไม่ให้ stat ทุก request */
const RELOAD_CHECK_MS = 5000;

/**
 * อ่าน config/users.json เข้าหน่วยความจำ
 * ไม่มีไฟล์ = ยังไม่ได้เปิดใช้ระบบล็อกอิน (โหมดรันบนเครื่องตัวเอง)
 */
export async function loadAuth({ force = false } = {}) {
  if (loaded && !force) return store;
  try {
    const raw = JSON.parse(await readFile(USERS_FILE, 'utf8'));
    const next = {
      secret: raw.secret,
      users: Array.isArray(raw.users) ? raw.users : [],
    };
    // ไฟล์ที่อ่านได้แต่ไม่มีผู้ใช้เลย ไม่ควรลบสถานะเดิมทิ้ง
    if (next.secret && next.users.length > 0) store = next;
    else if (!loaded) store = null;
    storeMtime = (await stat(USERS_FILE)).mtimeMs;
  } catch {
    if (!loaded) store = null; // อ่านไม่ได้ตั้งแต่ตอนเริ่ม = ยังไม่ได้ตั้งระบบล็อกอิน
  }
  loaded = true;
  return store;
}

/**
 * โหลดรายชื่อผู้ใช้ใหม่ถ้าไฟล์ถูกแก้ไป
 *
 * ทำให้เพิ่ม/ลบผู้ใช้ด้วย manage-users.js มีผลทันทีโดยไม่ต้องรีสตาร์ท
 * สำคัญตอนใช้งานจริง เพราะการรีสตาร์ทจะไปตัดจังหวะผู้บริหารที่กำลังเปิดดูอยู่
 *
 * ข้อสำคัญ: เปิดระบบล็อกอินแล้วจะไม่ยอมปิดเองเด็ดขาด
 * ไฟล์หายหรือพังไม่ควรกลายเป็น "ใครก็เข้าได้" โดยไม่มีใครรู้ตัว
 */
export async function refreshAuthIfChanged() {
  if (Date.now() - lastFreshCheck < RELOAD_CHECK_MS) return store;
  lastFreshCheck = Date.now();

  try {
    const { mtimeMs } = await stat(USERS_FILE);
    if (mtimeMs !== storeMtime) await loadAuth({ force: true });
  } catch {
    /* ไฟล์หายไป — คงสถานะเดิมไว้ */
  }
  return store;
}

async function saveStore(next) {
  const body = JSON.stringify({ version: 1, ...next }, null, 2) + '\n';
  const tmp = `${USERS_FILE}.tmp`;
  await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, USERS_FILE);
  // ตั้งสิทธิ์ให้เจ้าของอ่านเขียนได้คนเดียว (มีผลบนลินุกซ์/แมค บนวินโดวส์ถูกเมิน)
  await chmod(USERS_FILE, 0o600).catch(() => {});
  store = { secret: next.secret, users: next.users };
  loaded = true;
}

/** เปิดใช้ระบบล็อกอินอยู่หรือไม่ */
export function isAuthEnabled() {
  return store !== null;
}

/** ผู้ใช้ทั้งหมด (ไม่มี hash ติดไปด้วย) */
export function listUsers() {
  return (store?.users ?? []).map(publicUser);
}

function publicUser(u) {
  return {
    username: u.username,
    name: u.name ?? u.username,
    role: u.role ?? 'viewer',
    chatQuotaPerDay: u.chatQuotaPerDay ?? DEFAULT_CHAT_QUOTA,
    createdAt: u.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────
// รหัสผ่าน
// ─────────────────────────────────────────────────────────────
async function hashPassword(password, salt) {
  return (await scrypt(password.normalize('NFKC'), salt, KEYLEN)).toString('hex');
}

/**
 * เพิ่มหรือแก้ผู้ใช้ (ใช้จาก scripts/manage-users.js เท่านั้น)
 * สร้าง secret ให้อัตโนมัติถ้ายังไม่มี
 */
export async function upsertUser({ username, password, name, role = 'viewer', chatQuotaPerDay }) {
  await loadAuth({ force: true });
  const salt = randomBytes(16).toString('hex');
  const hash = await hashPassword(password, salt);

  const users = [...(store?.users ?? [])];
  const idx = users.findIndex((u) => u.username === username);
  const record = {
    username,
    name: name || users[idx]?.name || username,
    role,
    salt,
    hash,
    chatQuotaPerDay: chatQuotaPerDay ?? users[idx]?.chatQuotaPerDay ?? DEFAULT_CHAT_QUOTA,
    createdAt: idx >= 0 ? users[idx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) users[idx] = record;
  else users.push(record);

  await saveStore({ secret: store?.secret ?? randomBytes(32).toString('hex'), users });
  return publicUser(record);
}

/** ลบผู้ใช้ — คืน true ถ้าเจอและลบแล้ว */
export async function removeUser(username) {
  await loadAuth({ force: true });
  if (!store) return false;
  const users = store.users.filter((u) => u.username !== username);
  if (users.length === store.users.length) return false;
  await saveStore({ secret: store.secret, users });
  return true;
}

// ─────────────────────────────────────────────────────────────
// การจำกัดจำนวนครั้งที่ล็อกอินผิด
// ─────────────────────────────────────────────────────────────
const attempts = new Map(); // key -> { count, firstAt, lockedUntil }

function attemptKey(ip, username) {
  return `${ip}|${String(username).toLowerCase()}`;
}

/** เหลือเวลาโดนล็อกอีกกี่มิลลิวินาที (0 = ไม่โดนล็อก) */
export function lockRemaining(ip, username) {
  const rec = attempts.get(attemptKey(ip, username));
  if (!rec?.lockedUntil) return 0;
  const left = rec.lockedUntil - Date.now();
  if (left <= 0) {
    attempts.delete(attemptKey(ip, username));
    return 0;
  }
  return left;
}

function noteFailure(ip, username) {
  const key = attemptKey(ip, username);
  const rec = attempts.get(key) ?? { count: 0, firstAt: Date.now(), lockedUntil: 0 };
  // นับใหม่ถ้าครั้งแรกผ่านมานานกว่าเวลาล็อกแล้ว
  if (Date.now() - rec.firstAt > LOCK_MS) {
    rec.count = 0;
    rec.firstAt = Date.now();
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) rec.lockedUntil = Date.now() + LOCK_MS;
  attempts.set(key, rec);
  return rec;
}

function clearFailures(ip, username) {
  attempts.delete(attemptKey(ip, username));
}

/** เก็บกวาดรายการที่หมดอายุ — server เรียกเป็นระยะ */
export function sweepAttempts() {
  const now = Date.now();
  for (const [key, rec] of attempts) {
    if (now - rec.firstAt > LOCK_MS && (!rec.lockedUntil || rec.lockedUntil < now)) {
      attempts.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ตรวจสอบการล็อกอิน
// ─────────────────────────────────────────────────────────────
/**
 * @returns {{ok:true, user:object} | {ok:false, error:string, lockedMs?:number}}
 */
export async function verifyLogin(username, password, ip = 'unknown') {
  if (!store) return { ok: false, error: 'ยังไม่ได้ตั้งค่าผู้ใช้บนเซิร์ฟเวอร์' };

  const lockedMs = lockRemaining(ip, username);
  if (lockedMs > 0) {
    return {
      ok: false,
      error: `ใส่รหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก ${Math.ceil(lockedMs / 60000)} นาที`,
      lockedMs,
    };
  }

  const user = store.users.find((u) => u.username === String(username).trim());

  /* ไม่เจอผู้ใช้ก็ยังคำนวณ scrypt หลอกไว้หนึ่งรอบ
   * ถ้าไม่ทำ การตอบกลับจะเร็วกว่ากรณีที่มีผู้ใช้จริงอย่างเห็นได้ชัด
   * คนที่ลองสุ่มจะจับจังหวะได้ว่าชื่อไหนมีอยู่จริง */
  if (!user) {
    await hashPassword(String(password ?? ''), 'dummy-salt-for-timing');
    noteFailure(ip, username);
    return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  const candidate = await hashPassword(String(password ?? ''), user.salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  const match = a.length === b.length && timingSafeEqual(a, b);

  if (!match) {
    const rec = noteFailure(ip, username);
    const left = MAX_ATTEMPTS - rec.count;
    return {
      ok: false,
      error:
        left > 0
          ? `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${left} ครั้ง)`
          : `ใส่รหัสผิดหลายครั้งเกินไป ลองใหม่ในอีก ${Math.ceil(LOCK_MS / 60000)} นาที`,
    };
  }

  clearFailures(ip, username);
  return { ok: true, user: publicUser(user) };
}

// ─────────────────────────────────────────────────────────────
// session (คุกกี้ที่เซ็นด้วย HMAC)
// ─────────────────────────────────────────────────────────────
function sign(data) {
  return createHmac('sha256', store.secret).update(data).digest('base64url');
}

/** สร้างค่าคุกกี้ session สำหรับผู้ใช้คนหนึ่ง */
export function createSession(user) {
  const payload = Buffer.from(
    JSON.stringify({ u: user.username, exp: Date.now() + SESSION_HOURS * 3600_000 })
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/**
 * ตรวจคุกกี้ session
 * @returns {object|null} ข้อมูลผู้ใช้ หรือ null ถ้าไม่ถูกต้อง/หมดอายุ
 */
export function verifySession(value) {
  if (!store || typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = value.slice(0, dot);
  const given = value.slice(dot + 1);
  const expected = sign(payload);

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data.exp || data.exp < Date.now()) return null;

  // ผู้ใช้ที่ถูกลบไปแล้วต้องเข้าไม่ได้ทันที แม้คุกกี้จะยังไม่หมดอายุ
  const user = store.users.find((u) => u.username === data.u);
  return user ? publicUser(user) : null;
}

// ─────────────────────────────────────────────────────────────
// คุกกี้
// ─────────────────────────────────────────────────────────────
export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function getSessionCookie(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME];
}

/**
 * @param {string} value ค่าคุกกี้ (ส่ง '' เพื่อสั่งลบ)
 * @param {{secure:boolean}} opts
 */
export function buildSetCookie(value, { secure }) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    value ? `Max-Age=${SESSION_HOURS * 3600}` : 'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * คำขอนี้มาถึงแบบ https หรือไม่
 * เช็ค x-forwarded-proto ด้วยเพราะเวลา deploy จริงจะมี nginx/Caddy คั่นอยู่หน้า
 */
export function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

/** IP ของผู้เรียก — ถ้ามี reverse proxy ให้เชื่อ x-forwarded-for ตัวแรก */
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export { COOKIE_NAME, SESSION_HOURS };
