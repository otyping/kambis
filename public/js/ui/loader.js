/**
 * ui/loader.js — หน้าจอโหลดข้อมูล
 *
 * เดินตาม event จาก SSE (/api/progress) ทีละแหล่งข้อมูล
 * แล้วจบด้วยขั้น "กำลังวิเคราะห์ข้อมูล" ก่อนเปิดเผย Dashboard
 * ถ้า SSE ใช้ไม่ได้ จะ fallback เป็น progress จำลอง — ห้ามค้างที่ 0%
 */
import { t, pick } from '../i18n.js';
import { esc } from '../format.js';

/* ลิสต์สำรองชั้นสุดท้าย ใช้เฉพาะตอนที่ยังไม่เคยรู้จักรายงานเลยและ SSE ก็ต่อไม่ได้
 * เป็น key ภาษาอังกฤษและไม่มีทางครบ เพราะรายงานมาจากไฟล์ .txt ที่คนเพิ่มได้ตลอด
 * ทางปกติคือรายชื่อจริงจาก event 'sources' (server ส่งให้ทันทีที่ต่อ SSE ติด) */
const SOURCE_ORDER = [
  'dailyTrim',
  'perCrop',
  'outbound',
  'inbound',
  'sales',
  'inventory',
  'supplyLog',
  'cost',
];

/* จำรายชื่อล่าสุดไว้ข้ามการเปิดหน้า เพื่อไม่ให้เห็น key ภาษาอังกฤษวาบหนึ่ง
 * ก่อน event 'sources' จะมาถึงตอนเปิดหน้าครั้งถัดไป */
const CACHE_KEY = 'kambis.sourceNames';

function readCachedSources() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return Array.isArray(raw) && raw.length && raw.every((s) => s?.key) ? raw : null;
  } catch {
    return null; // localStorage ปิดอยู่ หรือค่าที่เก็บไว้เสีย
  }
}

function cacheSources(sources) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(sources));
  } catch {
    /* localStorage ปิดอยู่ — ไม่เป็นไร แค่จะเห็น key วาบหนึ่งตอนเปิดครั้งหน้า */
  }
}

export class LoadingScreen {
  constructor(root) {
    this.root = root;
    this.statusEl = root.querySelector('#loader-status');
    this.fillEl = root.querySelector('#loader-fill');
    this.listEl = root.querySelector('#loader-sources');
    this.analysisEl = root.querySelector('#loader-analysis');
    this.rows = new Map();
    // รายงานที่โหลดแบบ lazy — โชว์ในลิสต์ แต่ไม่นับเข้าสัดส่วนความคืบหน้า
    this.deferred = new Set();
    this.fakeTimer = null;
    this.progress = 0;
  }

  /** เตรียมรายการแหล่งข้อมูล — ชื่อไทยมาจากไฟล์ .txt ผ่าน config/sources.json */
  reset(sources) {
    this.progress = 0;
    this.setProgress(2);
    this.statusEl.textContent = t('loader.connecting');
    this.analysisEl.dataset.state = 'idle';
    this.analysisEl.textContent = '';

    /* ลำดับความน่าเชื่อถือของรายชื่อ: ที่ส่งมา → ที่เคยรู้จัก → ลิสต์สำรองที่ฮาร์ดโค้ด
     * ชั้นกลางทำให้เปิดหน้าครั้งที่สองเป็นต้นไปเห็นชื่อไทยตั้งแต่เฟรมแรก */
    const list =
      (sources?.length ? sources : null) ??
      readCachedSources() ??
      SOURCE_ORDER.map((key) => ({ key, titleTh: key, titleEn: key, lazy: key === 'supplyLog' }));

    this.rows.clear();
    this.listEl.innerHTML = '';
    this.renderRows(list);
  }

  /**
   * วาดแถวรายงาน — คงสถานะเดิมของแถวที่มีอยู่แล้วไว้
   *
   * ต้องคงไว้เพราะ event `sources` อาจมาถึงตอนที่บางรายงานโหลดไปแล้ว
   * (เช่นเปิด SSE ใหม่กลางคัน) ถ้าล้างทิ้ง ความคืบหน้าที่เห็นอยู่จะกระพริบหายไป
   */
  renderRows(list) {
    const prev = new Map();
    for (const [key, row] of this.rows) {
      prev.set(key, { state: row.dataset.state, count: row.querySelector('.loader__count').textContent });
    }

    this.rows.clear();
    this.deferred.clear();
    this.listEl.innerHTML = '';

    for (const source of list) {
      const was = prev.get(source.key);
      /* รายงานที่โหลดแบบ lazy (Log Stock 139 แท็บ) ไม่ได้ถูกดึงพร้อมชุดหลัก
       * ต้องบอกให้ชัดว่า "โหลดเบื้องหลัง" ไม่งั้นพอหน้าจอปิดทั้งที่แถวนี้ยังเป็นวงกลมเปล่า
       * จะดูเหมือนโหลดค้างหรือรายงานพัง */
      const lazy = Boolean(source.lazy);
      if (lazy) this.deferred.add(source.key);

      const row = document.createElement('div');
      row.className = 'loader__source';
      row.dataset.state = was?.state ?? (lazy ? 'deferred' : 'pending');
      const count = was?.count ?? (lazy ? t('loader.deferred') : '');
      row.innerHTML = `<span class="loader__icon" aria-hidden="true"></span><span class="loader__name">${esc(
        pick(source, 'title') || source.key
      )}</span><span class="loader__count">${esc(count)}</span>`;
      this.listEl.appendChild(row);
      this.rows.set(source.key, row);
    }
  }

  /** คีย์ของรายงานที่ถูกดึงพร้อมชุดหลักจริง ๆ — ใช้คิดสัดส่วนความคืบหน้า */
  activeKeys() {
    return [...this.rows.keys()].filter((key) => !this.deferred.has(key));
  }

  show() {
    this.root.hidden = false;
    this.root.classList.remove('is-hiding');
    this.root.setAttribute('aria-busy', 'true');
  }

  hide() {
    this.stopFallback();
    this.setProgress(100);
    this.root.classList.add('is-hiding');
    this.root.setAttribute('aria-busy', 'false');
    setTimeout(() => {
      this.root.hidden = true;
    }, 420);
  }

  setProgress(value) {
    this.progress = Math.max(this.progress, Math.min(100, value));
    this.fillEl.style.width = `${this.progress}%`;
  }

  /** รับ event จาก SSE */
  handle(event) {
    switch (event.type) {
      /* server ส่งรายชื่อรายงานให้ทันทีที่ต่อ SSE ติด โดยไม่ต้องรอให้เริ่มโหลด
       * เปลี่ยนแค่ชื่อแถว ไม่แตะความคืบหน้า เพราะ event นี้มาถึงได้ทุกจังหวะ */
      case 'sources':
        if (event.sources?.length) {
          cacheSources(event.sources);
          this.renderRows(event.sources);
        }
        break;

      case 'start':
        this.stopFallback();
        if (event.sources?.length) cacheSources(event.sources);
        this.reset(event.sources);
        break;

      case 'source:start': {
        const row = this.rows.get(event.key);
        if (row) {
          row.dataset.state = 'loading';
          row.querySelector('.loader__count').textContent = `0/${event.tabCount}`;
        }
        this.statusEl.textContent = `${t('loader.loading')} ${
          row?.querySelector('.loader__name')?.textContent ?? event.key
        }`;
        break;
      }

      case 'tab:done': {
        const row = this.rows.get(event.key);
        if (row) row.querySelector('.loader__count').textContent = `${event.done}/${event.total}`;
        /* แต่ละแหล่งกินสัดส่วน 90/จำนวนแหล่ง ที่เหลือไว้ให้ขั้นวิเคราะห์
         *
         * นับเฉพาะรายงานที่ดึงพร้อมชุดหลัก — ถ้าเอารายงาน lazy มาหารด้วย
         * แถบจะขึ้นได้สูงสุดแค่ 90×(7/8) = 79% แล้วกระโดดไป 92% ตอนเริ่มวิเคราะห์ */
        const active = this.activeKeys();
        const index = active.indexOf(event.key);
        if (index < 0) break; // event ของรายงาน lazy ที่ดึงเบื้องหลังหลังหน้าจอปิดไปแล้ว
        const per = 90 / Math.max(1, active.length);
        this.setProgress(index * per + (event.done / event.total) * per);
        break;
      }

      case 'source:done': {
        const row = this.rows.get(event.key);
        if (row) {
          row.dataset.state = event.status === 'error' ? 'error' : event.status;
          row.querySelector('.loader__count').textContent = `${event.rowCount} ${t('meta.rows')}`;
        }
        break;
      }

      case 'analysis:start':
        this.setProgress(92);
        this.statusEl.textContent = t('loader.analysing');
        this.analysisEl.dataset.state = 'running';
        this.analysisEl.textContent = t('loader.analysing');
        break;

      case 'analysis:done':
        this.setProgress(98);
        this.analysisEl.dataset.state = 'done';
        this.analysisEl.textContent = `${t('loader.analysed')} · ${t('quality.score')} ${event.score}/100`;
        break;

      case 'done':
        this.setProgress(100);
        this.statusEl.textContent = t('loader.done');
        break;

      case 'error':
        this.statusEl.textContent = `${t('loader.failed')}: ${event.message ?? ''}`;
        break;

      default:
        break;
    }
  }

  /**
   * progress จำลอง — ใช้เมื่อ SSE ต่อไม่ได้
   * ค่อย ๆ ไต่แต่ไม่เกิน 88% เพื่อไม่ให้ดูเหมือนเสร็จแล้วทั้งที่ยังไม่เสร็จ
   */
  startFallback() {
    this.stopFallback();
    this.statusEl.textContent = t('loader.connecting');
    this.fakeTimer = setInterval(() => {
      if (this.progress >= 88) return;
      this.setProgress(this.progress + Math.max(0.6, (88 - this.progress) * 0.06));
    }, 240);
  }

  stopFallback() {
    if (this.fakeTimer) {
      clearInterval(this.fakeTimer);
      this.fakeTimer = null;
    }
  }

  /** แสดงข้อผิดพลาดพร้อมปุ่มลองใหม่ */
  fail(message, onRetry) {
    this.stopFallback();
    this.statusEl.textContent = `${t('loader.failed')}${message ? `: ${message}` : ''}`;
    this.analysisEl.dataset.state = 'idle';
    this.analysisEl.innerHTML = '';
    const btn = document.createElement('button');
    btn.className = 'btn btn--primary';
    btn.textContent = t('loader.retry');
    btn.addEventListener('click', onRetry);
    this.analysisEl.appendChild(btn);
  }
}
