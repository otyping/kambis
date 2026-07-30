/**
 * loader.js — ตัวประสานงาน: อ่าน config → ดึงทุก tab → แปลง → ตรวจสอบ
 *
 * เป็นทางเดียวที่ข้อมูลเข้าสู่ระบบ ทุกเส้นทางต้องผ่านที่นี่
 * และทุกครั้งที่โหลดเสร็จต้องรัน Data Analysis (บังคับตาม CLAUDE.md ข้อ 2)
 */
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, csvUrl, mapLimit } from './fetcher.js';
import { parseCsv, trimTrailingEmptyRows } from './csv.js';
import { writeTabCache, readTabCache, writeSnapshot, readSnapshot } from './cache.js';
import { getParser } from './parsers/index.js';
import { analyze, verifyPresentation } from './analysis.js';
import { buildKpi } from './aggregate.js';
import { discoverTabs, diffTabs } from './tabs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG = path.join(ROOT, 'config', 'sources.json');
const SOURCE_TXT = path.join(ROOT, 'แบบฟอร์มรายงาน Kambis.txt');

const TAB_CONCURRENCY = 4;

/** อ่าน config/sources.json พร้อมเตือนถ้าไฟล์ .txt ใหม่กว่า */
export async function loadConfig() {
  let raw;
  try {
    raw = await readFile(CONFIG, 'utf8');
  } catch {
    throw new Error(
      'ไม่พบ config/sources.json — รัน `node scripts/sync-sources.js` ก่อนเริ่มเซิร์ฟเวอร์'
    );
  }
  const config = JSON.parse(raw);

  /* เทียบกับ sourceMtime ที่ sync-sources.js บันทึกไว้ ไม่ใช่ mtime ของตัวไฟล์ config
   *
   * เพราะ refreshTabs() ด้านล่างเขียนทับ config เองเวลาเจอแท็บใหม่
   * ถ้าเทียบด้วย mtime ของไฟล์ การเขียนนั้นจะกลบร่องรอยว่า .txt ถูกแก้ไปแล้ว */
  let outdated = false;
  try {
    const txtStat = await stat(SOURCE_TXT);
    outdated = config.sourceMtime
      ? txtStat.mtimeMs > new Date(config.sourceMtime).getTime() + 1000
      : txtStat.mtimeMs > (await stat(CONFIG)).mtimeMs;
  } catch {
    /* ไม่มีไฟล์ .txt ก็ปล่อยผ่าน — sync ครั้งหน้าจะฟ้องเอง */
  }

  return { ...config, outdated };
}

/**
 * เขียนรายชื่อแท็บที่ค้นเจอใหม่กลับลง config/sources.json
 *
 * config ยังคงถูก "สร้าง" จากไฟล์ .txt เหมือนเดิม — ที่นี่แตะเฉพาะ tabs[]
 * ซึ่งเป็นข้อมูลที่ค้นจาก Google ไม่ใช่ลิงก์ที่มนุษย์เป็นคนกำหนด
 * เขียนกลับเพื่อให้ตอนออฟไลน์ (ค้นแท็บไม่ได้) ยังมีรายชื่อล่าสุดใช้
 *
 * @param {Record<string,{gid:string,name:string}[]>} tabsByKey
 */
async function persistTabs(tabsByKey) {
  const keys = Object.keys(tabsByKey);
  if (!keys.length) return;

  try {
    const config = JSON.parse(await readFile(CONFIG, 'utf8'));
    for (const source of config.sources) {
      if (tabsByKey[source.key]) {
        source.tabs = tabsByKey[source.key];
        source.tabDiscoveryError = null;
      }
    }
    config.tabsRefreshedAt = new Date().toISOString();

    // เขียนลงไฟล์ชั่วคราวก่อนแล้วค่อย rename — กัน config พังถ้าดับกลางคัน
    const tmp = `${CONFIG}.tmp`;
    await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
    await rename(tmp, CONFIG);
  } catch (err) {
    // เขียนไม่ได้ก็ไม่เป็นไร ข้อมูลรอบนี้ใช้รายชื่อสดไปแล้ว
    console.warn('[tabs] อัปเดต config/sources.json ไม่สำเร็จ:', err.message);
  }
}

/**
 * ขอรายชื่อแท็บสดจาก Google — ถ้าล้มเหลวใช้รายชื่อใน config แทน
 * @returns {{tabs, discovery:'live'|'config', diff:object|null, error:string|null}}
 */
async function resolveTabs(source) {
  try {
    const live = await discoverTabs(source.sheetId, { timeoutMs: 20000, retries: 1 });
    const diff = diffTabs(source.tabs ?? [], live);
    return { tabs: live, discovery: 'live', diff, error: null };
  } catch (err) {
    return { tabs: source.tabs ?? [], discovery: 'config', diff: null, error: err.message };
  }
}

/**
 * ดึง CSV ของ tab หนึ่ง — ถ้าดึงไม่ได้ให้ตกไปใช้ cache
 * @returns {{gid, name, rows, status:'ok'|'stale'|'error', cachedAt?:string, error?:string}}
 */
async function loadTab(source, tab) {
  try {
    const text = await fetchText(csvUrl(source.sheetId, tab.gid));
    await writeTabCache(source.key, tab.gid, text);
    return {
      gid: tab.gid,
      name: tab.name,
      rows: trimTrailingEmptyRows(parseCsv(text)),
      status: 'ok',
    };
  } catch (err) {
    const cached = await readTabCache(source.key, tab.gid);
    if (cached) {
      return {
        gid: tab.gid,
        name: tab.name,
        rows: trimTrailingEmptyRows(parseCsv(cached.text)),
        status: 'stale',
        cachedAt: cached.cachedAt,
        error: err.message,
      };
    }
    return { gid: tab.gid, name: tab.name, rows: [], status: 'error', error: err.message };
  }
}

/**
 * โหลดและแปลงข้อมูลของรายงานหนึ่ง
 * @param {object} source รายการจาก config/sources.json
 * @param {(event:object)=>void} [onProgress]
 */
export async function loadSource(source, onProgress) {
  const started = Date.now();

  /* ค้นรายชื่อแท็บสดก่อนเสมอ — ถ้าไม่ทำ แท็บของเดือนใหม่ที่เพิ่งเพิ่มในชีต
   * จะถูกมองข้ามเงียบ ๆ จนกว่าจะมีคนรัน sync-sources.js ด้วยมือ */
  onProgress?.({ type: 'source:tabs', key: source.key });
  const resolved = await resolveTabs(source);
  const tabList = resolved.tabs;

  onProgress?.({
    type: 'source:start',
    key: source.key,
    tabCount: tabList.length,
    discovery: resolved.discovery,
    tabsAdded: resolved.diff?.added.map((t) => t.name) ?? [],
  });

  let done = 0;
  const tabs = await mapLimit(tabList, TAB_CONCURRENCY, async (tab) => {
    const result = await loadTab(source, tab);
    done++;
    onProgress?.({
      type: 'tab:done',
      key: source.key,
      done,
      total: tabList.length,
      tabName: tab.name,
      status: result.status,
    });
    return result;
  });

  const errors = tabs.filter((t) => t.status === 'error');
  const stales = tabs.filter((t) => t.status === 'stale');

  let parsed = { rows: [], tabs: [], warnings: [] };
  let parseError = null;
  try {
    parsed = getParser(source.parser)({ tabs, sourceKey: source.key });
  } catch (err) {
    parseError = err.message;
  }

  // ผสมสถานะการดึงข้อมูลเข้ากับสรุป tab จาก parser
  const statusByGid = new Map(tabs.map((t) => [t.gid, t]));
  const tabInfo = parsed.tabs.map((t) => {
    const fetched = statusByGid.get(t.gid);
    return { ...t, fetchStatus: fetched?.status ?? 'unknown', fetchError: fetched?.error ?? null };
  });

  const status = parseError || errors.length === tabs.length ? 'error' : stales.length ? 'stale' : 'ok';

  const result = {
    key: source.key,
    parser: source.parser,
    icon: source.icon,
    titleTh: source.titleTh,
    titleEn: source.titleEn,
    sheetUrl: source.sheetUrl,
    status,
    rows: parsed.rows,
    tabs: tabInfo,
    warnings: parsed.warnings,
    error: parseError || (errors.length ? `${errors.length} tab ดึงไม่สำเร็จ` : null),
    tabCount: tabList.length,
    tabsOk: tabs.filter((t) => t.status === 'ok').length,
    tabsStale: stales.length,
    tabsError: errors.length,
    rowCount: parsed.rows.length,
    durationMs: Date.now() - started,

    // ผลการค้นหาแท็บ — loadAll เอาไปสรุปรวมและบันทึกกลับลง config
    discovery: resolved.discovery,
    discoveryError: resolved.error,
    tabDiff: resolved.diff,
    resolvedTabs: tabList,
  };

  onProgress?.({
    type: 'source:done',
    key: source.key,
    status,
    rowCount: result.rowCount,
    durationMs: result.durationMs,
  });

  return result;
}

/**
 * โหลดข้อมูลทั้งหมด แปลง รวม KPI และ **วิเคราะห์ความถูกต้องเสมอ**
 * @param {(event:object)=>void} [onProgress]
 */
export async function loadAll(onProgress) {
  const started = Date.now();
  const config = await loadConfig();

  onProgress?.({
    type: 'start',
    sources: config.sources.map((s) => ({ key: s.key, titleTh: s.titleTh, titleEn: s.titleEn })),
  });

  // โหลดทีละรายงานตามลำดับ เพื่อให้ progress บน loading screen เดินเป็นระเบียบ
  // และไม่ยิง Google พร้อมกันเกิน TAB_CONCURRENCY
  const sources = {};
  const tabsToPersist = {};
  const tabChanges = [];

  for (const source of config.sources) {
    const result = await loadSource(source, onProgress);

    // แยกผลการค้นแท็บออกจาก payload ที่ส่งให้ browser — ใช้เฉพาะฝั่ง server
    const { resolvedTabs, tabDiff, ...rest } = result;

    if (result.discovery === 'live' && tabDiff?.changed) {
      tabsToPersist[source.key] = resolvedTabs;
      tabChanges.push({
        key: source.key,
        titleTh: source.titleTh,
        titleEn: source.titleEn,
        sheetUrl: source.sheetUrl,
        added: tabDiff.added,
        removed: tabDiff.removed,
        renamed: tabDiff.renamed,
      });
      const added = tabDiff.added.map((t) => t.name).join(', ');
      if (added) console.log(`[tabs] ${source.key}: เจอแท็บใหม่ — ${added}`);
    }

    sources[source.key] = rest;
  }

  await persistTabs(tabsToPersist);

  onProgress?.({ type: 'analysis:start' });

  /* ตรวจสองชั้น
   * 1. analyze()            — ข้อมูลที่อ่านเข้ามาถูกต้องไหม
   * 2. verifyPresentation() — ตัวเลขที่จัดกลุ่มและเรียงแล้ว "นำเสนอ" ถูกไหม
   *
   * ชั้นที่สองมีเพราะความผิดพลาดที่เกิดตอนจัดลำดับ (เช่นเรียงไตรมาสตามตัวอักษร
   * จนได้ Q1'2026 มาก่อน Q2'2025) ไม่มีอะไรจับได้เลย ทั้งที่ทำให้อ่านแนวโน้มผิดทันที */
  let analysis = analyze(sources);
  const kpi = buildKpi(sources, analysis);
  analysis = verifyPresentation(analysis, kpi);

  onProgress?.({ type: 'analysis:done', score: analysis.score, counts: analysis.counts });

  const payload = {
    meta: {
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      cacheHit: false,
      configGeneratedAt: config.generatedAt,
      configOutdated: config.outdated,

      // แท็บที่เพิ่ม/ลบ/เปลี่ยนชื่อในรอบนี้ — หน้าเว็บเอาไปขึ้นแถบแจ้งเตือน
      tabChanges,
      sources: Object.values(sources).map((s) => ({
        key: s.key,
        titleTh: s.titleTh,
        titleEn: s.titleEn,
        icon: s.icon,
        sheetUrl: s.sheetUrl,
        status: s.status,
        tabCount: s.tabCount,
        tabsOk: s.tabsOk,
        tabsStale: s.tabsStale,
        tabsError: s.tabsError,
        rowCount: s.rowCount,
        durationMs: s.durationMs,
        error: s.error,
        discovery: s.discovery,
        discoveryError: s.discoveryError,
      })),
    },
    sources,
    kpi,
    analysis,
  };

  await writeSnapshot(payload);
  onProgress?.({ type: 'done', durationMs: payload.meta.durationMs });
  return payload;
}

/** อ่าน payload ล่าสุดจากดิสก์ (ใช้ตอนออฟไลน์) */
export async function loadFromSnapshot() {
  const snap = await readSnapshot();
  if (!snap) return null;
  return {
    ...snap.data,
    meta: { ...snap.data.meta, cacheHit: true, snapshotAt: snap.cachedAt },
  };
}
