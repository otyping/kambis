/**
 * i18n.js — ข้อความสองภาษา
 * ไทยเป็นค่าเริ่มต้น ตัวเลือกภาษาถูกจำไว้ใน localStorage
 * ชื่อสายพันธุ์ / ครอป / ลูกค้า คงตามต้นฉบับ ไม่แปล
 */

const STRINGS = {
  'app.title': ['รายงานผู้บริหาร', 'Executive Report'],
  'app.subtitle': ['ระบบรายงานฟาร์มและการขาย Kambis', 'Kambis farm & sales reporting'],

  'action.refresh': ['รีเฟรชข้อมูล', 'Refresh'],
  'action.theme': ['สลับโหมดสว่าง/มืด', 'Toggle light/dark mode'],
  'action.themeLight': ['โหมดสว่าง', 'Light mode'],
  'action.themeDark': ['โหมดมืด', 'Dark mode'],
  'action.refreshing': ['กำลังรีเฟรช…', 'Refreshing…'],
  'action.close': ['ปิด', 'Close'],
  'action.openSheet': ['เปิดชีตต้นทาง', 'Open source sheet'],
  'action.detail': ['ดูรายละเอียด', 'View details'],

  'meta.updated': ['อัปเดตเมื่อ', 'Updated'],
  'meta.never': ['ยังไม่เคยโหลด', 'not loaded yet'],
  'meta.rows': ['แถว', 'rows'],
  'meta.tabs': ['ชีตย่อย', 'tabs'],
  'meta.of': ['จาก', 'of'],

  'quality.title': ['คุณภาพข้อมูล', 'Data Quality'],
  'quality.score': ['คะแนนคุณภาพข้อมูล', 'Data quality score'],
  'quality.critical': ['ร้ายแรง', 'Critical'],
  'quality.warning': ['ควรตรวจสอบ', 'Warning'],
  'quality.info': ['ข้อสังเกต', 'Info'],
  'quality.clean': ['ไม่พบความผิดปกติ', 'No issues found'],
  'quality.checked': ['ตรวจแล้ว', 'Checked'],
  'quality.ranAt': ['วิเคราะห์เมื่อ', 'Analysed at'],
  'quality.all': ['ทั้งหมด', 'All'],
  'quality.desc': [
    'ผลการตรวจสอบความถูกต้องของข้อมูล รันอัตโนมัติทุกครั้งที่อัปเดต',
    'Validation results, run automatically on every data update',
  ],
  'quality.sourceNote': [
    'ปัญหาทั้งหมดอยู่ในชีตต้นทาง ไม่ใช่ข้อผิดพลาดของ Dashboard',
    'All issues originate in the source sheets, not in this dashboard',
  ],

  'kpi.title': ['ตัวเลขสำคัญ', 'Key figures'],

  'card.overview.title': ['ภาพรวมผู้บริหาร', 'Executive Overview'],
  'card.overview.sub': ['สรุปทั้งระบบจาก 6 รายงาน', 'Consolidated view of all 6 reports'],
  'card.dailyTrim.sub': ['น้ำหนักดอกที่ทริมได้รายวัน แยกตามครอป', 'Daily trimmed flower weight by crop'],
  'card.perCrop.sub': ['ผลผลิตและรอบปลูกรายครอป', 'Yield and grow cycle per crop'],
  'card.outbound.sub': ['ดอกที่ขนออกจากฟาร์ม', 'Flower shipped out of the farm'],
  'card.inbound.sub': ['ดอกที่รับเข้าคลังกรุงเทพ', 'Flower received into Bangkok'],
  'card.sales.sub': ['ยอดขายแยกตามลูกค้าและสายพันธุ์', 'Sales by customer and strain'],
  'card.inventory.sub': ['สินค้าคงเหลือแต่ละคลัง', 'Stock on hand by location'],

  'label.flower': ['น้ำหนักดอก', 'Flower'],
  'label.nonFlower': ['ไม่ใช่ดอก', 'Non-flower'],
  'label.total': ['รวม', 'Total'],
  'label.premium': ['เกรด >M', 'Grade >M'],
  'label.sizeMix': ['สัดส่วนตามขนาด', 'Size mix'],
  'label.byStrain': ['แยกตามสายพันธุ์', 'By strain'],
  'label.byCrop': ['แยกตามครอป', 'By crop'],
  'label.byCustomer': ['แยกตามลูกค้า', 'By customer'],
  'label.byLocation': ['แยกตามคลัง', 'By location'],
  'label.byQuarter': ['แยกตามไตรมาส', 'By quarter'],
  'label.trend': ['แนวโน้มตามเวลา', 'Trend over time'],
  'label.monthly': ['ยอดรายเดือน', 'Monthly total'],
  'label.date': ['วันที่', 'Date'],
  'label.crop': ['ครอป', 'Crop'],
  'label.strain': ['สายพันธุ์', 'Strain'],
  'label.customer': ['ลูกค้า', 'Customer'],
  'label.location': ['คลัง', 'Location'],
  'label.quarter': ['ไตรมาส', 'Quarter'],
  'label.plants': ['จำนวนต้น', 'Plants'],
  'label.gPerPlant': ['กรัม/ต้น', 'g/plant'],
  'label.tab': ['ชีตย่อย', 'Tab'],
  'label.row': ['แถว', 'Row'],
  'label.field': ['ช่อง', 'Field'],
  'label.days': ['จำนวนวัน', 'Days'],
  'label.shipments': ['เที่ยวขน', 'Shipments'],
  'label.receipts': ['ครั้งที่รับ', 'Receipts'],
  'label.orders': ['ครั้งที่ขาย', 'Orders'],
  'label.customers': ['ลูกค้า', 'Customers'],
  'label.crops': ['ครอป', 'Crops'],
  'label.harvested': ['เก็บเกี่ยวแล้ว', 'Harvested'],
  'label.inProgress': ['กำลังปลูก', 'In progress'],
  'label.upcoming': ['ครอปที่กำลังปลูก', 'Crops in progress'],
  'label.cycle': ['รอบปลูก', 'Grow cycle'],
  'label.clone': ['โคลน', 'Clone'],
  'label.veg': ['เร่งใบ', 'Veg'],
  'label.flowerPhase': ['ทำดอก', 'Flower'],
  'label.harvest': ['เก็บเกี่ยว', 'Harvest'],
  'label.dryReady': ['ดอกพร้อม', 'Dry ready'],
  'label.reconciliation': ['เทียบยอดขนออกกับยอดรับเข้า', 'Shipped vs received'],
  'label.shipped': ['ขนออก', 'Shipped'],
  'label.received': ['รับเข้า', 'Received'],
  'label.diff': ['ส่วนต่าง', 'Difference'],
  'label.matched': ['ตรงกัน', 'Matched'],
  'label.records': ['รายการ', 'Records'],
  'label.updatedAt': ['ข้อมูล ณ วันที่', 'Data as of'],
  'label.search': ['ค้นหา…', 'Search…'],
  'label.allCrops': ['ทุกครอป', 'All crops'],
  'label.allTabs': ['ทุกชีตย่อย', 'All tabs'],
  'label.other': ['อื่น ๆ', 'Other'],
  'label.noData': ['ไม่มีข้อมูลให้แสดง', 'No data to display'],
  'label.top': ['สูงสุด', 'Top'],

  'loader.title': ['กำลังโหลดข้อมูล', 'Loading data'],
  'loader.connecting': ['กำลังเชื่อมต่อ Google Sheets…', 'Connecting to Google Sheets…'],
  'loader.loading': ['กำลังอ่าน', 'Reading'],
  'loader.analysing': ['กำลังวิเคราะห์ความถูกต้องของข้อมูล…', 'Validating data accuracy…'],
  'loader.analysed': ['วิเคราะห์ข้อมูลเสร็จแล้ว', 'Data validation complete'],
  'loader.done': ['เสร็จสิ้น', 'Done'],
  'loader.failed': ['โหลดข้อมูลไม่สำเร็จ', 'Failed to load data'],
  'loader.retry': ['ลองใหม่', 'Retry'],

  'notice.stale': [
    'กำลังแสดงข้อมูลจากแคช เพราะดึงข้อมูลสดจาก Google ไม่สำเร็จ',
    'Showing cached data — could not reach Google Sheets',
  ],
  'notice.configOutdated': [
    'ไฟล์ "แบบฟอร์มรายงาน Kambis.txt" ถูกแก้ไขหลังจาก sync ครั้งล่าสุด — รัน node scripts/sync-sources.js',
    'The report link file changed after the last sync — run node scripts/sync-sources.js',
  ],

  'chat.ask': ['ถาม AI', 'Ask AI'],
  'chat.title': ['ผู้ช่วยวิเคราะห์ข้อมูล', 'Data Assistant'],
  'chat.subtitle': ['ถามเกี่ยวกับข้อมูลใน Dashboard', 'Ask about the dashboard data'],
  'chat.model': ['โมเดล', 'Model'],
  'chat.send': ['ส่งคำถาม', 'Send'],
  'chat.placeholder': ['พิมพ์คำถามเกี่ยวกับข้อมูล…', 'Ask about the data…'],
  'chat.welcome': [
    'ถามอะไรก็ได้เกี่ยวกับข้อมูลใน Dashboard นี้ — ผมตอบจากตัวเลขที่ดึงมาจริงเท่านั้น ไม่เดา',
    'Ask anything about this dashboard — I answer only from the loaded figures, never guesses',
  ],
  'chat.usage': ['ใช้ไป', 'Used'],
  'chat.usageDetail': [
    'การใช้งาน Google AI Studio ตั้งแต่เปิดเซิร์ฟเวอร์',
    'Google AI Studio usage since server start',
  ],
  'chat.tokens': ['tokens', 'tokens'],
  'chat.inputTokens': ['token ขาเข้า', 'Input tokens'],
  'chat.outputTokens': ['token ขาออก', 'Output tokens'],
  'chat.thoughtTokens': ['token ที่ใช้คิด', 'Thinking tokens'],
  'chat.requests': ['จำนวนครั้งที่ถาม', 'Requests'],
  'chat.thinking': ['คิด', 'thinking'],
  'chat.quota': ['โควตาวันนี้', "Today's quota"],
  'chat.error': ['เกิดข้อผิดพลาด', 'Error'],
  'chat.refused': [
    'คำถามนี้ถูกระบบความปลอดภัยของ Google ปฏิเสธ ลองถามใหม่ด้วยคำอื่น',
    'Google’s safety system declined this request. Try rephrasing the question.',
  ],
  'chat.setupTitle': ['ยังใช้งานไม่ได้ — ต้องตั้งค่า API key ก่อน', 'Not available — API key required'],
  'chat.setupBody': [
    'ช่องแชทนี้เรียก Gemini ผ่าน Google AI Studio จึงต้องมี API key จาก aistudio.google.com/apikey ใส่ไว้ในไฟล์ .env แล้วเปิดเซิร์ฟเวอร์ใหม่',
    'This chat calls Gemini via Google AI Studio, so it needs an API key from aistudio.google.com/apikey. Put it in .env and restart the server.',
  ],
  'chat.setupNote': [
    'key จะอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ถูกส่งมาที่เบราว์เซอร์',
    'The key stays server-side and is never sent to the browser.',
  ],
  'chat.forbidden': [
    'บัญชีนี้ดูรายงานได้อย่างเดียว ยังไม่ได้เปิดสิทธิ์ใช้ผู้ช่วย AI',
    'This account is view-only and cannot use the AI assistant.',
  ],

  'auth.logout': ['ออกจากระบบ', 'Sign out'],
  'auth.expired': ['เซสชันหมดอายุ กำลังพากลับไปหน้าล็อกอิน…', 'Session expired, returning to sign-in…'],

  'tabs.newFound': ['พบแท็บใหม่ในชีต', 'New sheet tabs found'],
  'tabs.removed': ['แท็บที่หายไป', 'Tabs removed'],
  'tabs.renamed': ['แท็บที่เปลี่ยนชื่อ', 'Tabs renamed'],

  'footer.source': [
    'ลิงก์รายงานทั้งหมดอ่านจากไฟล์ "แบบฟอร์มรายงาน Kambis.txt"',
    'All report links are read from "แบบฟอร์มรายงาน Kambis.txt"',
  ],
};

const LANG_KEY = 'kambis.lang';

let current = 'th';
const listeners = new Set();

/** อ่านภาษาที่ผู้ใช้เลือกไว้ */
export function initLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'th' || saved === 'en') current = saved;
  } catch {
    /* localStorage ปิดอยู่ — ใช้ค่าเริ่มต้น */
  }
  document.documentElement.lang = current;
  return current;
}

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (lang !== 'th' && lang !== 'en') return;
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ไม่เป็นไร */
  }
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** แปลคีย์เป็นข้อความตามภาษาปัจจุบัน */
export function t(key) {
  const entry = STRINGS[key];
  if (!entry) return key;
  return current === 'en' ? entry[1] : entry[0];
}

/** เลือกฟิลด์ th/en จาก object ที่ server ส่งมา (เช่น titleTh/titleEn) */
export function pick(obj, base) {
  if (!obj) return '';
  const key = current === 'en' ? `${base}En` : `${base}Th`;
  return obj[key] ?? obj[`${base}Th`] ?? obj[base] ?? '';
}

/** เลือกข้อความ finding ตามภาษา */
export function pickMessage(finding) {
  return current === 'en' ? finding.messageEn : finding.messageTh;
}
