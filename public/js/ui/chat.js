/**
 * ui/chat.js — ช่องแชท AI ถามตอบเกี่ยวกับข้อมูลใน Dashboard
 *
 * ทุกคำถามส่งไปที่ /api/chat ฝั่ง server แล้ว server เป็นคนเรียก Claude
 * API key อยู่ฝั่ง server เท่านั้น ไม่เคยถูกส่งมาที่เบราว์เซอร์
 *
 * ทุกคำตอบแสดง token ที่ใช้และค่าใช้จ่ายโดยประมาณกำกับไว้
 */
import { t, getLang, pick } from '../i18n.js';
import { esc, n } from '../format.js';

const els = {};
let models = [];
let ready = false;
let busy = false;
let history = []; // { role: 'user'|'assistant', content: string }

/** คำถามตัวอย่าง ช่วยให้ผู้ใช้เริ่มต้นได้ */
const HINTS = {
  th: [
    'สรุปภาพรวมผลผลิตและยอดขายให้หน่อย',
    'สายพันธุ์ไหนขายดีที่สุด และคิดเป็นกี่เปอร์เซ็นต์ของยอดขายทั้งหมด',
    'ครอปไหนให้ผลผลิตต่อต้นสูงสุด เพราะอะไรถึงต่างจากครอปอื่น',
    'ข้อมูลตรงไหนที่น่ากังวลที่สุด และควรไปแก้ที่ชีตไหน',
  ],
  en: [
    'Give me an overview of yield and sales',
    'Which strain sells best, and what share of total sales is it?',
    'Which crop has the highest yield per plant, and why does it differ?',
    'What data issue is most concerning, and which sheet should I fix?',
  ],
};

/**
 * แปลง markdown แบบจำกัดให้เป็น HTML
 *
 * escape ทุกอย่างก่อนเสมอ แล้วค่อยเปิดเฉพาะ **ตัวหนา**, `โค้ด` และ bullet
 * ห้ามเอาข้อความจากโมเดลใส่ innerHTML ตรง ๆ เด็ดขาด
 */
function renderMarkdown(text) {
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  const html = [];
  let list = null;

  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);

    if (bullet) {
      list ??= [];
      list.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) {
      html.push(`<ul>${list.join('')}</ul>`);
      list = null;
    }
    if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  if (list) html.push(`<ul>${list.join('')}</ul>`);

  return html.join('') || `<p>${inline(text)}</p>`;
}

/** จัดรูปค่าใช้จ่ายเป็นดอลลาร์ — ตัวเลขน้อยมากจึงต้องทศนิยมเยอะ */
function money(usd) {
  if (!Number.isFinite(usd) || usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function scrollToEnd() {
  els.log.scrollTop = els.log.scrollHeight;
}

/** เพิ่มข้อความลงในบทสนทนา */
function appendMessage(role, text, meta) {
  const div = document.createElement('div');
  div.className = `chat-msg chat-msg--${role}`;
  div.innerHTML = role === 'user' ? `<p>${esc(text)}</p>` : renderMarkdown(text);

  if (meta) {
    const bar = document.createElement('div');
    bar.className = 'chat-msg__meta';
    bar.textContent = meta;
    div.appendChild(bar);
  }
  els.log.appendChild(div);
  scrollToEnd();
  return div;
}

function showTyping(on) {
  els.typing.style.display = on ? 'flex' : 'none';
  if (on) scrollToEnd();
}

/** ปรับความสูง textarea ตามเนื้อหา */
function autoGrow() {
  els.input.style.height = 'auto';
  els.input.style.height = `${Math.min(els.input.scrollHeight, 130)}px`;
}

/** อัปเดตตัวเลข usage สะสมบนหัวแผง */
function renderUsage(totals) {
  if (!totals) return;
  const tokens = totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  els.usage.innerHTML = `${t('chat.usage')} <b>${n(tokens)}</b> ${t('chat.tokens')} · <b>${money(totals.costUsd)}</b>`;
  els.usage.title =
    `${t('chat.usageDetail')}\n` +
    `${t('chat.inputTokens')}: ${n(totals.inputTokens)}\n` +
    `${t('chat.outputTokens')}: ${n(totals.outputTokens)}\n` +
    `${t('chat.cacheRead')}: ${n(totals.cacheReadTokens)}\n` +
    `${t('chat.cacheWrite')}: ${n(totals.cacheWriteTokens)}\n` +
    `${t('chat.requests')}: ${n(totals.requests)}`;
}

/** เติมคำถามตัวอย่างตอนเริ่มต้น */
function renderHints() {
  const box = document.createElement('div');
  box.className = 'chat-msg chat-msg--bot';
  box.innerHTML = `<p>${esc(t('chat.welcome'))}</p>`;

  const hints = document.createElement('div');
  hints.className = 'chat-hints';
  for (const q of HINTS[getLang()] ?? HINTS.th) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-hint';
    btn.textContent = q;
    btn.addEventListener('click', () => {
      els.input.value = q;
      autoGrow();
      send();
    });
    hints.appendChild(btn);
  }
  box.appendChild(hints);
  els.log.appendChild(box);
}

/** แสดงวิธีตั้งค่า API key เมื่อ server ยังไม่มี key */
function renderSetup() {
  els.log.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'chat-setup';
  box.innerHTML = `
    <h4>${esc(t('chat.setupTitle'))}</h4>
    <p>${esc(t('chat.setupBody'))}</p>
    <code>ANTHROPIC_API_KEY=sk-ant-... node server/server.js</code>
    <p>${esc(t('chat.setupNote'))}</p>`;
  els.log.appendChild(box);
  els.input.disabled = true;
  els.send.disabled = true;
  els.model.disabled = true;
}

/** ส่งคำถาม */
async function send() {
  if (busy || !ready) return;
  const text = els.input.value.trim();
  if (!text) return;

  els.input.value = '';
  autoGrow();
  appendMessage('user', text);
  history.push({ role: 'user', content: text });

  busy = true;
  els.send.disabled = true;
  showTyping(true);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: els.model.value, messages: history }),
    });
    const data = await res.json();
    showTyping(false);

    if (!res.ok) {
      appendMessage('error', `${t('chat.error')}: ${data.error ?? res.status}`);
      history.pop();
      return;
    }

    if (data.refused) {
      appendMessage('error', t('chat.refused'));
      history.pop();
      return;
    }

    const u = data.usage ?? {};
    const used = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const cached = u.cache_read_input_tokens ?? 0;
    const meta =
      `${data.model} · ${n(used)} ${t('chat.tokens')} · ${money(data.costUsd)}` +
      (cached ? ` · ${t('chat.fromCache')} ${n(cached)}` : '');

    appendMessage('bot', data.text || '—', meta);
    history.push({ role: 'assistant', content: data.text });
    renderUsage(data.totals);
  } catch (err) {
    showTyping(false);
    appendMessage('error', `${t('chat.error')}: ${err.message}`);
    history.pop();
  } finally {
    busy = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

function open() {
  els.panel.classList.add('is-open');
  els.fab.hidden = true;
  if (ready) els.input.focus();
}

function close() {
  els.panel.classList.remove('is-open');
  els.fab.hidden = false;
}

/** เริ่มต้นช่องแชท — เรียกครั้งเดียวตอนโหลดหน้า */
export async function initChat() {
  els.fab = document.getElementById('chat-fab');
  els.panel = document.getElementById('chat-panel');
  els.log = document.getElementById('chat-log');
  els.typing = document.getElementById('chat-typing');
  els.input = document.getElementById('chat-input');
  els.send = document.getElementById('chat-send');
  els.model = document.getElementById('chat-model');
  els.usage = document.getElementById('chat-usage');
  els.close = document.getElementById('chat-close');

  els.fab.addEventListener('click', open);
  els.close.addEventListener('click', close);
  els.send.addEventListener('click', send);
  els.input.addEventListener('input', autoGrow);
  els.input.addEventListener('keydown', (e) => {
    // Enter ส่ง / Shift+Enter ขึ้นบรรทัดใหม่
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.panel.classList.contains('is-open')) close();
  });

  try {
    const [cfg, usage] = await Promise.all([
      fetch('/api/chat/models').then((r) => r.json()),
      fetch('/api/usage').then((r) => r.json()),
    ]);

    models = cfg.models ?? [];
    ready = Boolean(cfg.ready);

    els.model.innerHTML = models
      .map((m) => {
        // ย่อให้พอดีความกว้าง dropdown — ราคาเต็มอยู่ใน title
        return `<option value="${esc(m.id)}">${esc(m.label)} · $${m.pricing.input}/$${m.pricing.output}</option>`;
      })
      .join('');
    els.model.value = cfg.defaultModel;
    els.model.title = models.map((m) => `${m.label}: ${pick(m, 'desc')}`).join('\n');

    renderUsage(usage);
    if (!ready) renderSetup();
    else renderHints();
  } catch {
    renderSetup();
  }

}

/** ล้างบทสนทนา — เรียกเมื่อรีเฟรชข้อมูลหรือสลับภาษา เพราะบริบทเปลี่ยนไปแล้ว */
export function resetChat() {
  history = [];
  if (!els.log || !ready) return;
  els.log.innerHTML = '';
  renderHints();
}
