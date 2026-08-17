#!/usr/bin/env node
/**
 * ui-audit.mjs — เปิดหน้าเว็บจริงด้วย Chrome headless แล้วตรวจสิ่งที่ "อ่านโค้ดแล้วไม่เห็น"
 *
 *   node .claude/skills/ui-craft/scripts/ui-audit.mjs http://127.0.0.1:5173/#/supply \
 *        --login=dev:dev --wait=.supply-filter-bar --width=1280 --theme=dark \
 *        --shot-of=.filter-asof --out=C:\tmp\asof.png
 *
 * ทำไมต้องมี: บั๊กที่แพงที่สุดของงาน UI คือบั๊กที่ **ไม่ error** — กรอบซ้อนกรอบ,
 * ตัวอักษรล้น, ปุ่มเล็กเกินนิ้ว, กราฟกว้าง 0 ทั้งหมดนี้ unit test มองไม่เห็น
 * และการอ่าน CSS ทีละกฎก็มองไม่เห็นเหมือนกัน เพราะปัญหาเกิดตอน **หลายกฎมาเจอกัน**
 *
 * zero dependency: Node 24 มี `WebSocket` กับ `fetch` เป็น global อยู่แล้ว
 *
 * ตัวเลือก
 *   --login=user:pass   ล็อกอินก่อน (ต้องมี DEV_LOGIN=1 หรือใช้บัญชีจริง)
 *   --wait=<selector>   รอจนกว่า selector นี้จะโผล่ (ค่าเริ่มต้น: รอ load + 1.5 วิ)
 *   --click=<selector>  กดปุ่มนี้ก่อนตรวจ — เอาไว้เปิด popup/แผ่นเลื่อน/เมนู
 *   --after=<selector>  รอ selector นี้หลังกด (คู่กับ --click)
 *   --width=1280        ความกว้างจอ (ใส่หลายค่าคั่นด้วย , เพื่อตรวจหลาย breakpoint)
 *   --theme=light|dark  โหมดสี (ตั้ง localStorage ก่อนหน้าโหลด)
 *   --shot-of=<sel>     ถ่ายรูปเฉพาะกล่องนั้น (พร้อมระยะขอบ 16px) — เอาไว้ "ดูด้วยตา"
 *   --out=<path>        ที่เก็บรูป (ค่าเริ่มต้น: %TEMP%\ui-audit-<width>-<theme>.png)
 *   --timeout=120       วินาที
 *   --json              พิมพ์ผลเป็น JSON
 *
 * exit code 1 เมื่อเจอปัญหาระดับ error
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/* ───────────────────────── อ่านตัวเลือก ───────────────────────── */
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--')) ?? 'http://127.0.0.1:5173/';
const opt = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const widths = String(opt('width', '1280'))
  .split(',')
  .map((w) => Number(w.trim()))
  .filter(Boolean);
const theme = opt('theme', '');
const waitSel = opt('wait', '');
const clickSel = opt('click', '');
const afterSel = opt('after', '');
const shotOf = opt('shot-of', '');
const outArg = opt('out', '');
const timeoutMs = Number(opt('timeout', '120')) * 1000;
const asJson = flag('json');

/* ───────────────────────── ตัวขับ Chrome ───────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('หา Chrome ไม่เจอ — ตั้ง CHROME env หรือแก้ CHROME_CANDIDATES');
  return process.env.CHROME || found;
}

async function launch(port, profileDir) {
  const child = spawn(
    chromePath(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars', // ไม่งั้น scrollbar ของ headless จะกินความกว้างจนวัด layout เพี้ยน
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  // รอจน endpoint ตอบ — ห้าม sleep ตายตัว เครื่องช้า/เร็วไม่เท่ากัน
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return { child, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      /* ยังไม่ขึ้น */
    }
    await sleep(150);
  }
  child.kill();
  throw new Error('Chrome ไม่ยอมเปิด debugging port ภายใน 20 วินาที');
}

/** ห่อ CDP ให้เรียกแบบ await ได้ */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let id = 0;

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(`${msg.error.message}`)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('ต่อ WebSocket ไม่ได้')), { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close: () => ws.close(),
  };
}

/* ───────────────────────── ตัวตรวจ (รันในหน้าเว็บ) ───────────────────────── */
/*
 * เขียนเป็นสตริงเพราะต้องวิ่งในบริบทของหน้า ไม่ใช่ของ Node
 *
 * กฎ "กรอบซ้อนกรอบ": กล่องที่มีกรอบครบสี่ด้าน อยู่ในกล่องที่มีกรอบครบสี่ด้านเหมือนกัน
 * และ **แนบไปกับกรอบนอกตลอดแกนใดแกนหนึ่ง** (ช่องว่าง ≤ 6px ทั้งสองฝั่งของแกนนั้น)
 * = ผู้ใช้เห็นเส้นสองเส้นวิ่งขนานกันโดยไม่ได้แบ่งอะไรเลย
 *
 * เส้นด้านเดียว (divider) ไม่นับ เพราะเป็น "ทางที่ควรใช้แทน" ไม่ใช่ปัญหา
 */
const AUDIT_FN = String.raw`
(() => {
  const vis = (w, c) => parseFloat(w) >= 0.5 && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);
  const framed = (cs) =>
    vis(cs.borderTopWidth, cs.borderTopColor) && vis(cs.borderRightWidth, cs.borderRightColor) &&
    vis(cs.borderBottomWidth, cs.borderBottomColor) && vis(cs.borderLeftWidth, cs.borderLeftColor);

  const SKIP = new Set(['TD', 'TH', 'TR', 'THEAD', 'TBODY', 'TFOOT', 'TABLE']);
  const path = (el) => {
    const bits = [];
    for (let n = el; n && n.nodeType === 1 && bits.length < 4; n = n.parentElement) {
      bits.unshift(n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : ''));
    }
    return bits.join(' > ');
  };

  const out = { nested: [], radius: [], overflow: [], tap: [], canvas: [], clipped: [], hscroll: null };
  const all = [...document.querySelectorAll('body *')];

  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    if (SKIP.has(el.tagName) || !framed(cs)) continue;

    // หากล่องที่มีกรอบใกล้ที่สุดที่อยู่เหนือขึ้นไป
    let outer = el.parentElement;
    while (outer && outer !== document.body && !(framed(getComputedStyle(outer)) && !SKIP.has(outer.tagName))) {
      outer = outer.parentElement;
    }
    if (!outer || outer === document.body) continue;

    const a = el.getBoundingClientRect();
    const b = outer.getBoundingClientRect();
    const gap = { top: a.top - b.top, bottom: b.bottom - a.bottom, left: a.left - b.left, right: b.right - a.right };
    const hugX = Math.max(gap.left, gap.right) <= 6;
    const hugY = Math.max(gap.top, gap.bottom) <= 6;
    if (hugX || hugY) {
      out.nested.push({
        inner: path(el), outer: path(outer),
        gap: { top: +gap.top.toFixed(1), right: +gap.right.toFixed(1), bottom: +gap.bottom.toFixed(1), left: +gap.left.toFixed(1) },
        axis: hugX && hugY ? 'ทั้งสองแกน' : hugX ? 'แนวนอน' : 'แนวตั้ง',
      });
    }

    // มุมมนของกล่องในต้องไม่กว้างกว่ากล่องนอก ไม่งั้นมุมจะเบียดกันดูเหมือนวาดพลาด
    const r = (v) => parseFloat(v) || 0;
    const ri = r(cs.borderTopLeftRadius);
    const ro = r(getComputedStyle(outer).borderTopLeftRadius);
    if (ri > ro + 1 && (hugX || hugY)) out.radius.push({ inner: path(el), innerRadius: ri, outerRadius: ro });
  }

  // ล้นขอบจอแนวนอน
  const de = document.documentElement;
  out.hscroll = de.scrollWidth - de.clientWidth;
  // ยืนยันว่าการปลอมอุปกรณ์สัมผัสมีผลจริง ไม่งั้นผลของเกณฑ์เป้ากดเชื่อไม่ได้เลย
  out.touchEmulated = matchMedia('(hover: none)').matches && matchMedia('(pointer: coarse)').matches;
  if (out.hscroll > 0) {
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > de.clientWidth + 1) out.overflow.push({ el: path(el), right: Math.round(r.right) });
      if (out.overflow.length > 12) break;
    }
  }

  /* เป้ากดเล็กเกินนิ้ว (ตรวจเฉพาะตอนสั่งจอมือถือ)
   *
   * วัดที่ <label> ที่ครอบอยู่ ไม่ใช่ที่ตัว control — กดที่ป้ายก็โฟกัสช่องได้อยู่แล้ว
   * ถ้าวัดแต่ตัว control จะฟ้องว่าช่องวันที่สูง 42px ทั้งที่เม็ดยาที่กดจริงสูง 44px
   * แล้วคนอ่านรายงานจะเลิกเชื่อตัวตรวจไปทั้งตัว
   *
   * รวมรายการซ้ำเป็นบรรทัดเดียว ตาราง 138 แถวมี checkbox 138 ตัวที่เป็นปัญหาเดียวกัน */
  const tapSeen = new Map();
  for (const el of document.querySelectorAll('button, a[href], select, input, [role="button"], [tabindex="0"]')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const host = el.closest('label') ?? el;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.height >= 44 && r.width >= 24) continue;
    const key = path(host) + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
    const hit = tapSeen.get(key);
    hit ? hit.count++ : tapSeen.set(key, { el: path(host), w: Math.round(r.width), h: Math.round(r.height), count: 1 });
  }
  out.tap = [...tapSeen.values()];

  // canvas กว้าง 0 = กราฟไม่ถูกวาด แต่ไม่มี error ให้เห็น
  for (const c of document.querySelectorAll('canvas')) {
    if (!c.width || !c.height) out.canvas.push({ el: path(c), w: c.width, h: c.height });
  }

  /* ปุ่มที่ถูกกล่องแม่ตัดหาย
   *
   * ตรวจเฉพาะของที่กดได้ — overflow:hidden ตัดของตกแต่งกับข้อความ ellipsis
   * เป็นเรื่องปกติ แต่ **ปุ่มที่โผล่ไม่พ้นขอบคือบั๊กเสมอ** ผู้ใช้ไม่มีทางรู้ว่ามันมีอยู่
   * (เจอจริงตอนทำปฏิทิน: ปุ่ม "ล้างวันที่" อยู่ในส่วนที่เลื่อนได้ พอปฏิทินสูงกว่าจอ
   * มันเลื่อนหายไปใต้ขอบล่างโดยไม่มีอะไรบอก)
   *
   * NOTE: บล็อกนี้อยู่ใน String.raw — **ห้ามใช้ backtick ในคอมเมนต์** มันจะปิด
   * template literal กลางคัน แล้วไฟล์ทั้งไฟล์ syntax error (เคยพลาดมาแล้ว) */
  const clipper = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      /* เจอกล่องที่เลื่อนได้ก่อน = ของชิ้นนั้นยังไปถึงได้ ไม่ใช่ของหาย
       * (ตอนแรกเขียนกฎนี้ผิด ไล่ฟ้องทุกอย่างที่อยู่ใต้ขอบล่างของกล่องที่เลื่อนได้
       * ซึ่งเป็นเรื่องปกติของทุกแผงที่ยาวกว่าจอ) */
      if (/(auto|scroll)/.test(cs.overflowY + ' ' + cs.overflowX)) return null;
      if (cs.overflow === 'hidden' || cs.overflowY === 'hidden' || cs.overflowX === 'hidden') return n;
    }
    return null;
  };
  const clipSeen = new Set();
  for (const el of document.querySelectorAll('button, a[href], input, select')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const box = clipper(el);
    if (!box) continue;
    const a = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (!a.width || !a.height) continue;
    const over = Math.max(b.top - a.top, a.bottom - b.bottom, b.left - a.left, a.right - b.right);
    if (over <= 2) continue;
    const key = path(el);
    if (clipSeen.has(key)) continue;
    clipSeen.add(key);
    out.clipped.push({ el: key, by: path(box), over: Math.round(over) });
  }

  return out;
})()
`;

/* ───────────────────────── ลงมือ ───────────────────────── */
const profileDir = mkdtempSync(join(tmpdir(), 'ui-audit-'));
const port = 9300 + Math.floor(process.pid % 90);
let chrome;
let bad = false;

try {
  const launched = await launch(port, profileDir);
  chrome = launched.child;
  const cdp = connect(launched.wsUrl);
  await cdp.ready;

  const errors = [];
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails?.text ?? 'exception'));
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') errors.push(p.args?.map((a) => a.value ?? a.description).join(' '));
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // ล็อกอินจาก Node แล้วโยนคุกกี้ให้เบราว์เซอร์ — ง่ายกว่าไปกรอกฟอร์มในหน้า
  const login = opt('login', '');
  if (login) {
    const [username, password] = login.split(':');
    const origin = new URL(url).origin;
    const res = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const raw = res.headers.getSetCookie?.() ?? [];
    if (!res.ok || !raw.length) throw new Error(`ล็อกอินไม่ผ่าน (${res.status}) — ตั้ง DEV_LOGIN=1 หรือใช้บัญชีจริง`);
    for (const line of raw) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      await cdp.send('Network.setCookie', {
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        url: origin,
        httpOnly: true,
      });
    }
  }

  const report = [];

  if (theme) {
    // ตั้งก่อนหน้าโหลดเพื่อไม่ให้เห็นจอกระพริบ และเพื่อให้ tokens.css เลือกชุดสีถูกตั้งแต่แรก
    // (เรียกครั้งเดียวนอกลูป — เรียกซ้ำทุกรอบจะสะสมสคริปต์ทับกันไปเรื่อย ๆ)
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('kambis.theme', ${JSON.stringify(theme)}); } catch {}`,
    });
  }

  for (const width of widths) {
    const touch = width < 768;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: touch,
    });

    /* จอแคบยังไม่พอ — เกณฑ์เป้ากด 44px ของโปรเจกต์นี้อยู่ใน `@media (hover: none)`
     * ซึ่ง `mobile: true` ของ CDP **ไม่ได้เปิดให้** ถ้าไม่ปลอม media query ตรงนี้
     * ตัวตรวจจะฟ้องว่าปุ่มเล็กเกินไป 78 จุด ทั้งที่ CSS มีกฎรองรับอยู่แล้ว
     * — ตัวตรวจผิดได้เหมือนกัน ก่อนเชื่อผลให้ไปอ่าน CSS ยืนยันเสมอ */
    // maxTouchPoints ต้องอยู่ระหว่าง 1–16 เสมอ แม้ตอนปิด ไม่งั้น CDP ปฏิเสธทั้งคำสั่ง
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
    const features = [];
    if (theme) features.push({ name: 'prefers-color-scheme', value: theme });
    if (touch) features.push({ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' });
    if (features.length) await cdp.send('Emulation.setEmulatedMedia', { features });

    const loaded = new Promise((r) => cdp.on('Page.loadEventFired', r));
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(timeoutMs)]);

    if (waitSel) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: `!!document.querySelector(${JSON.stringify(waitSel)})`,
          returnByValue: true,
        });
        if (result.value) break;
        if (Date.now() > deadline) throw new Error(`รอ ${waitSel} เกินเวลา — หน้าไม่ได้วาดสิ่งที่คาดไว้`);
        await sleep(250);
      }
    }

    /* กดปุ่มเพื่อเปิดของที่ต้องกดถึงจะเห็น (popup · แผ่นเลื่อน · เมนู)
     * ถ้าไม่มีทางนี้ ทุก popup ในเว็บจะไม่เคยถูกตรวจเลย — ซึ่งเป็นที่ที่กรอบซ้อนกรอบ
     * เกิดง่ายที่สุด เพราะกล่องลอยมีกรอบของตัวเองอยู่แล้ว */
    if (clickSel) {
      // คั่นด้วย , เพื่อกดต่อกันเป็นทอด ๆ (เปิด popup แล้วกางหัวข้อข้างในต่อ)
      for (const sel of clickSel.split(',').map((s) => s.trim()).filter(Boolean)) {
        const { result: hit } = await cdp.send('Runtime.evaluate', {
          expression: `(() => { const e = document.querySelector(${JSON.stringify(sel)});
            if (!e) return false; e.click(); return true; })()`,
          returnByValue: true,
        });
        if (!hit.value) throw new Error(`หา ${sel} ไม่เจอ กดไม่ได้`);
        await sleep(250);
      }
      if (afterSel) {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
          const { result } = await cdp.send('Runtime.evaluate', {
            expression: `!!document.querySelector(${JSON.stringify(afterSel)})`,
            returnByValue: true,
          });
          if (result.value) break;
          if (Date.now() > deadline) throw new Error(`กด ${clickSel} แล้วแต่ ${afterSel} ไม่โผล่`);
          await sleep(120);
        }
      }
    }

    await sleep(600); // ให้กราฟกับ ResizeObserver วาดจบก่อนวัด

    const { result } = await cdp.send('Runtime.evaluate', { expression: AUDIT_FN, returnByValue: true });
    report.push({ width, theme: theme || 'system', ...result.value, errors: [...errors] });

    if (shotOf || outArg) {
      let clip;
      if (shotOf) {
        const { result: box } = await cdp.send('Runtime.evaluate', {
          expression: `(() => { const e = document.querySelector(${JSON.stringify(shotOf)});
            if (!e) return null; const r = e.getBoundingClientRect();
            return { x: Math.max(0, r.left - 16), y: Math.max(0, r.top - 16), width: r.width + 32, height: r.height + 32, scale: 3 }; })()`,
          returnByValue: true,
        });
        if (!box.value) throw new Error(`หา ${shotOf} ไม่เจอ ถ่ายรูปไม่ได้`);
        clip = box.value;
      }
      /* `captureBeyondViewport` จำเป็นเมื่อของที่จะถ่ายอยู่ต่ำกว่าขอบจอ
       * (clip ใช้พิกัดของหน้า ไม่ใช่ของ viewport) ถ้าไม่ใส่ จะได้ **รูปเปล่า**
       * โดยไม่มี error อะไรเลย — เคยหลงคิดว่าคอมโพเนนต์หายไปเพราะเหตุนี้ */
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: Boolean(clip),
        ...(clip ? { clip } : {}),
      });
      const file = outArg || join(tmpdir(), `ui-audit-${width}-${theme || 'system'}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      report.at(-1).screenshot = file;
    }
  }

  /* ───── รายงาน ───── */
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const r of report) {
      console.log(`\n═══ ${r.width}px · ธีม ${r.theme} ═══`);
      const line = (label, arr, fmt) => {
        if (!arr.length) return console.log(`  ✔ ${label}`);
        console.log(`  ✘ ${label} — ${arr.length} จุด`);
        for (const x of arr.slice(0, 8)) console.log(`      ${fmt(x)}`);
      };
      line('ไม่มีกรอบซ้อนกรอบ', r.nested, (n) =>
        `${n.inner}\n         ในกรอบ ${n.outer} · แนบ${n.axis} · ช่องว่าง ${JSON.stringify(n.gap)}`);
      line('มุมมนกล่องในไม่กว้างกว่ากล่องนอก', r.radius, (x) => `${x.inner} (${x.innerRadius}px ใน ${x.outerRadius}px)`);
      console.log(`  ${r.hscroll > 0 ? '✘' : '✔'} ไม่มี horizontal scroll (${r.hscroll}px)`);
      if (r.overflow.length) for (const o of r.overflow.slice(0, 6)) console.log(`      ล้น: ${o.el} → x=${o.right}`);
      if (r.width < 768) {
        if (!r.touchEmulated) {
          console.log('  ⚠ ปลอมอุปกรณ์สัมผัสไม่สำเร็จ — ข้ามการตรวจเป้ากด (ผลจะไม่ตรงกับของจริง)');
        } else {
          line('เป้ากด ≥ 44px', r.tap, (x) => `${x.el} (${x.w}×${x.h})${x.count > 1 ? ` ×${x.count}` : ''}`);
        }
      }
      line('ไม่มีปุ่มถูกกล่องแม่ตัดหาย', r.clipped, (x) => `${x.el}\n         ถูกตัดโดย ${x.by} · เกิน ${x.over}px`);
      line('canvas ทุกตัวมีขนาด', r.canvas, (x) => `${x.el} (${x.w}×${x.h})`);
      line('ไม่มี exception', r.errors, (e) => e);
      if (r.screenshot) console.log(`  📷 ${r.screenshot}  ← เปิดดูด้วยตา อย่าเชื่อแค่ผลตรวจ`);
    }
  }

  bad = report.some(
    (r) => r.nested.length || r.hscroll > 0 || r.canvas.length || r.errors.length || r.clipped.length
  );
} finally {
  chrome?.kill();
  await sleep(300);
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    /* Windows ล็อกไฟล์ค้างได้ ไม่ใช่เรื่องคอขาดบาดตาย */
  }
}

process.exit(bad ? 1 : 0);
