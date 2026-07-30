/**
 * ui/loader.js — หน้าจอโหลดข้อมูล
 *
 * เดินตาม event จาก SSE (/api/progress) ทีละแหล่งข้อมูล
 * แล้วจบด้วยขั้น "กำลังวิเคราะห์ข้อมูล" ก่อนเปิดเผย Dashboard
 * ถ้า SSE ใช้ไม่ได้ จะ fallback เป็น progress จำลอง — ห้ามค้างที่ 0%
 */
import { t, pick } from '../i18n.js';
import { esc } from '../format.js';

const SOURCE_ORDER = ['dailyTrim', 'perCrop', 'outbound', 'inbound', 'sales', 'inventory'];

export class LoadingScreen {
  constructor(root) {
    this.root = root;
    this.statusEl = root.querySelector('#loader-status');
    this.fillEl = root.querySelector('#loader-fill');
    this.listEl = root.querySelector('#loader-sources');
    this.analysisEl = root.querySelector('#loader-analysis');
    this.rows = new Map();
    this.fakeTimer = null;
    this.progress = 0;
  }

  /** เตรียมรายการแหล่งข้อมูล (ก่อนรู้ชื่อจริงจาก server ใช้ key ไปก่อน) */
  reset(sources) {
    this.progress = 0;
    this.rows.clear();
    this.listEl.innerHTML = '';
    this.setProgress(2);
    this.statusEl.textContent = t('loader.connecting');
    this.analysisEl.dataset.state = 'idle';
    this.analysisEl.textContent = '';

    const list = sources?.length
      ? sources
      : SOURCE_ORDER.map((key) => ({ key, titleTh: key, titleEn: key }));

    for (const source of list) {
      const row = document.createElement('div');
      row.className = 'loader__source';
      row.dataset.state = 'pending';
      row.innerHTML = `<span class="loader__icon" aria-hidden="true"></span><span class="loader__name">${esc(
        pick(source, 'title') || source.key
      )}</span><span class="loader__count"></span>`;
      this.listEl.appendChild(row);
      this.rows.set(source.key, row);
    }
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
      case 'start':
        this.stopFallback();
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
        // แต่ละแหล่งกินสัดส่วน 90/จำนวนแหล่ง ที่เหลือไว้ให้ขั้นวิเคราะห์
        const per = 90 / Math.max(1, this.rows.size);
        const index = [...this.rows.keys()].indexOf(event.key);
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
