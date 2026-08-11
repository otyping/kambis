/**
 * ui/notices.js — ประกอบข้อความแถบเตือนบนหัวเว็บ
 *
 * ทำไมแยกออกมาจาก main.js:
 *
 * 1. เดิมตรรกะนี้อยู่ใน `renderHeader()` ซึ่งแตะ DOM จึงไม่มีเทสต์คุมเลย
 *    แล้วมีสองเรื่องหลุดไปเงียบ ๆ: `discovery === 'config'` (server ส่งมาแล้วแต่ไม่มีใครอ่าน)
 *    และ `tabChanges` ของชีตวัสดุ (อยู่คนละ payload)
 * 2. ไฟล์นี้ import แค่ i18n กับ format จึงเรียกจาก Node ได้ตรง ๆ ใน tests/ui.js
 *
 * รับ `meta` ก้อนไหนก็ได้ — payload หลักหรือ payload ของรายงานที่โหลดแบบ lazy
 * ทั้งสองก้อนมีโครง `meta.sources[]` เหมือนกัน ต่างแค่จำนวนรายการ
 */
import { t, pick } from '../i18n.js';
import { ago, countdown } from '../format.js';

/**
 * @param {object|null|undefined} meta
 * @param {{scope?: 'supply'|null}} [opts] scope ใส่คำนำหน้าให้รู้ว่าเป็นของชีตไหน
 * @returns {string[]} ข้อความพร้อมแสดง (ผู้เรียกเป็นคน esc เอง)
 */
export function collectNotices(meta, { scope = null } = {}) {
  if (!meta) return [];
  const out = [];
  const tag = scope === 'supply' ? `${t('notice.scopeSupply')}: ` : '';

  // ── ดึงสดไม่ได้เลย กำลังเสิร์ฟชุดที่ดีล่าสุด ──
  if (meta.degraded) out.push(tag + t('notice.servedLastGood'));

  /* ── รายงานบางอันอ่านข้อมูลไม่ได้เลย ──
   *
   * `failedSources` ถูกตั้งเฉพาะตอน degraded (เสิร์ฟชุดสำรอง) แต่ยังมีอีกกรณีที่
   * เงียบกว่านั้น: health เป็น `partial` คือดึงสดสำเร็จ แต่มีรายงานที่ได้ 0 แถว
   * ถ้าไม่บอก ผู้ใช้จะเห็นแค่ยอด 0 แล้วเข้าใจว่าเป็นคำตอบจริง
   * (เคยเกิดกับสต็อกหัวหิน/กรุงเทพ ที่หายไปทั้งรายงานเพราะชีตเปลี่ยนชื่อแท็บ) */
  const failed = meta.failedSources?.length ? meta.failedSources : (meta.health?.failed ?? []);
  if (failed.length) {
    out.push(`${tag}${t('notice.partialSources')} (${failed.join(', ')})`);
  }

  if (meta.sources?.some((s) => s.status === 'stale')) out.push(tag + t('notice.stale'));

  if (meta.configOutdated) out.push(t('notice.configOutdated'));

  /* ลิงก์ในไฟล์ .txt ที่ระบบยังไม่รู้จัก — ถ้าไม่บอก รายงานที่คนเพิ่งเพิ่มเข้ามา
   * จะหายเงียบโดยไม่มีอะไรฟ้อง */
  if (meta.unmatchedLabels?.length) {
    out.push(`${t('notice.unmatched')}: ${meta.unmatchedLabels.join(', ')}`);
  }

  /* ── ค้นรายชื่อแท็บสดไม่สำเร็จ กำลังใช้รายชื่อเก่า ──
   *
   * สำคัญกว่าที่เห็น: ระบบยังทำงานต่อได้ปกติ แต่ **แท็บที่เพิ่งเพิ่มในชีตจะถูกมองข้าม**
   * ถ้าไม่บอก ผู้ใช้จะสรุปว่า "เพิ่มแท็บแล้วยอดไม่ขึ้น = Dashboard พัง" */
  const fallback = (meta.sources ?? []).filter((s) => s.discovery === 'config');
  if (fallback.length) {
    const names = fallback.map((s) => pick(s, 'title') || s.key).join(', ');
    out.push(`${tag}${t('notice.tabDiscoveryFallback')}: ${names}`);
  }

  // ── แท็บที่เพิ่ม/หาย/เปลี่ยนชื่อในรอบนี้ ──
  for (const change of meta.tabChanges ?? []) {
    const title = pick(change, 'title');
    if (change.added?.length) {
      out.push(`${t('tabs.newFound')} — ${title}: ${change.added.map((x) => x.name).join(', ')}`);
    }
    if (change.removed?.length) {
      out.push(`${t('tabs.removed')} — ${title}: ${change.removed.map((x) => x.name).join(', ')}`);
    }
    if (change.renamed?.length) {
      out.push(
        `${t('tabs.renamed')} — ${title}: ${change.renamed.map((x) => `${x.from} → ${x.to}`).join(', ')}`
      );
    }
  }

  // ── กดรีเฟรชแต่ยังไม่ถึงเวลาดึงรอบใหม่ ──
  const r = meta.refresh;
  if (r?.requested && !r.applied) {
    out.push(
      `${t('notice.refreshCooldown', { ago: ago(meta.fetchedAt), wait: countdown(r.waitMs) })} · ` +
        t('notice.refreshShared')
    );
  }

  return out;
}
