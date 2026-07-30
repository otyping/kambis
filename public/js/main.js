/**
 * main.js — จุดเริ่มต้นของ Dashboard
 *
 * ลำดับการทำงาน:
 *   1. เริ่มฉากหลัง Three.js (ถ้าใช้ได้)
 *   2. เปิด SSE รับความคืบหน้า → ขับ loading screen
 *   3. ดึงข้อมูลจาก /api/reports (server รัน Data Analysis ให้แล้ว)
 *   4. วาด KPI + การ์ด 8 ใบ
 */
import { initLang, getLang, setLang, onLangChange, t, pick } from './i18n.js';
import { dateTime, ago, n, esc } from './format.js';
import { fetchReports, subscribeProgress } from './api.js';
import { initBackground, refreshBackground } from './bg/three-bg.js';
import { initTheme, getTheme, toggleTheme, onThemeChange } from './theme.js';
import { LoadingScreen } from './ui/loader.js';
import { renderKpiStrip, renderCards, qualityLevel } from './ui/cards.js';
import { initModal, openCard, close as closeModal } from './ui/modal.js';
import { initChat, resetChat } from './ui/chat.js';

const el = {
  loader: document.getElementById('loader'),
  kpi: document.getElementById('kpi-strip'),
  cards: document.getElementById('card-grid'),
  refresh: document.getElementById('btn-refresh'),
  lang: document.getElementById('lang-toggle'),
  theme: document.getElementById('theme-toggle'),
  health: document.getElementById('health-badge'),
  updated: document.getElementById('updated-at'),
  notice: document.getElementById('notice'),
  footerMeta: document.getElementById('footer-meta'),
  canvas: document.getElementById('three-canvas'),
  logout: document.getElementById('btn-logout'),
  userName: document.getElementById('user-name'),
};

let payload = null;
let loading = false;
let unsubscribe = null;
const screen = new LoadingScreen(el.loader);

/** ─── header ─── */
function renderHeader() {
  if (!payload) return;
  const { analysis, meta } = payload;

  const level = qualityLevel(analysis.counts);
  el.health.dataset.level = level;
  el.health.innerHTML = `<span class="health-badge__dot" aria-hidden="true"></span>${t(
    'quality.score'
  )} ${analysis.score}/100`;
  el.health.title = `${analysis.counts.critical} ${t('quality.critical')} · ${
    analysis.counts.warning
  } ${t('quality.warning')} · ${analysis.counts.info} ${t('quality.info')}`;

  el.updated.textContent = `${t('meta.updated')} ${ago(meta.fetchedAt)}`;
  el.updated.title = dateTime(meta.fetchedAt);

  // แจ้งเตือนเมื่อข้อมูลมาจากแคช หรือ config ล้าสมัย
  const messages = [];
  if (meta.degraded || meta.sources.some((s) => s.status === 'stale')) messages.push(t('notice.stale'));
  if (meta.configOutdated) messages.push(t('notice.configOutdated'));

  /* แท็บที่เพิ่ม/หาย/เปลี่ยนชื่อในชีตตั้งแต่รีเฟรชครั้งก่อน
   * สำคัญกับผู้ใช้เพราะแปลว่าตัวเลขรวมขยับด้วยเหตุผลที่ไม่ใช่การแก้ข้อมูล */
  for (const change of meta.tabChanges ?? []) {
    const title = pick(change, 'title');
    if (change.added?.length) {
      messages.push(`${t('tabs.newFound')} — ${title}: ${change.added.map((x) => x.name).join(', ')}`);
    }
    if (change.removed?.length) {
      messages.push(`${t('tabs.removed')} — ${title}: ${change.removed.map((x) => x.name).join(', ')}`);
    }
    if (change.renamed?.length) {
      messages.push(
        `${t('tabs.renamed')} — ${title}: ${change.renamed.map((x) => `${x.from} → ${x.to}`).join(', ')}`
      );
    }
  }

  if (messages.length) {
    el.notice.hidden = false;
    el.notice.innerHTML = `<span aria-hidden="true">⚠</span><span>${messages
      .map(esc)
      .join(' · ')}</span>`;
  } else {
    el.notice.hidden = true;
  }

  const totalTabs = meta.sources.reduce((sum, s) => sum + s.tabCount, 0);
  const totalRows = meta.sources.reduce((sum, s) => sum + s.rowCount, 0);
  el.footerMeta.textContent = `${meta.sources.length} ${t('label.records')} · ${n(totalTabs)} ${t(
    'meta.tabs'
  )} · ${n(totalRows)} ${t('meta.rows')}`;
}

/** ─── วาดทั้งหน้า ─── */
function render() {
  if (!payload) return;
  renderHeader();
  renderKpiStrip(el.kpi, payload.kpi);
  renderCards(el.cards, payload, (key, trigger) => openCard(key, payload, trigger));
}

/** ─── โหลดข้อมูล (ทุกครั้งที่โหลด server จะรัน Data Analysis ให้) ─── */
async function load({ refresh = false } = {}) {
  if (loading) return;
  loading = true;
  el.refresh.classList.add('is-busy');
  el.refresh.disabled = true;
  closeModal();

  screen.reset(payload?.meta?.sources ?? null);
  screen.show();
  screen.startFallback();

  // SSE จะส่ง event ทันทีที่ server เริ่มดึง — ต้องต่อก่อนเรียก fetch
  unsubscribe?.();
  unsubscribe = subscribeProgress((event) => screen.handle(event));

  try {
    payload = await fetchReports({ refresh });
    render();
    // ข้อมูลเปลี่ยนแล้ว บทสนทนาเดิมอ้างตัวเลขเก่า จึงต้องเริ่มใหม่
    if (refresh) resetChat();
    screen.hide();
  } catch (err) {
    screen.fail(err.message, () => load({ refresh: true }));
  } finally {
    loading = false;
    el.refresh.classList.remove('is-busy');
    el.refresh.disabled = false;
    unsubscribe?.();
    unsubscribe = null;
  }
}

/** ─── ข้อความคงที่ที่ต้องเปลี่ยนตามภาษา ─── */
function applyStaticText() {
  document.title = `Kambis · ${t('app.title')}`;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  }
  el.lang.querySelectorAll('button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lang === getLang()));
  });

  // ปุ่มธีมบอกว่า "จะสลับไปโหมดอะไร" ไม่ใช่โหมดปัจจุบัน
  const dark = getTheme() === 'dark';
  el.theme.setAttribute('aria-pressed', String(dark));
  el.theme.title = dark ? t('action.themeLight') : t('action.themeDark');
}

/** ─── แสดงว่าใครล็อกอินอยู่ + ปุ่มออกจากระบบ ─── */
async function initAuthChrome() {
  let status;
  try {
    status = await fetch('/api/auth/status').then((r) => r.json());
  } catch {
    return; // ถามไม่ได้ก็ไม่ต้องแสดงอะไร ไม่ใช่ของจำเป็น
  }
  if (!status.enabled || !status.user) return;

  el.userName.textContent = status.user.name;
  el.logout.hidden = false;
  el.logout.title = `${status.user.username} · ${t('auth.logout')}`;

  el.logout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/login.html');
  });
}

/** ─── เริ่มทำงาน ─── */
function start() {
  initLang();
  initTheme();
  applyStaticText();
  initModal();

  initAuthChrome().catch(() => {});

  // ฉากหลังไม่ใช่ของจำเป็น — ล้มเหลวก็ใช้ gradient จาก CSS ต่อได้
  initBackground(el.canvas).catch(() => {});

  // ช่องแชทก็ไม่ใช่ของจำเป็น — ถ้าไม่มี API key จะแสดงวิธีตั้งค่าแทน
  initChat().catch(() => {});

  el.refresh.addEventListener('click', () => load({ refresh: true }));

  el.theme.addEventListener('click', () => toggleTheme());

  onThemeChange(() => {
    applyStaticText();
    // กราฟวาดลง canvas จึงไม่เปลี่ยนสีตาม CSS เอง ต้องวาดใหม่ทั้งหมด
    render();
    refreshBackground(el.canvas).catch(() => {});
  });

  el.lang.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-lang]');
    if (btn) setLang(btn.dataset.lang);
  });

  onLangChange(() => {
    applyStaticText();
    closeModal();
    resetChat();
    render();
  });

  // อัปเดตข้อความ "อัปเดตเมื่อ …" ให้เดินตามเวลาจริง
  setInterval(() => {
    if (payload && !loading) {
      el.updated.textContent = `${t('meta.updated')} ${ago(payload.meta.fetchedAt)}`;
    }
  }, 60000);

  load();
}

start();
