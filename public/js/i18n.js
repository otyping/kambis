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
  // ช่วงเวลาที่ตัวเลขบนการ์ดครอบคลุมจริง — แต่ละชีตเริ่มบันทึกไม่พร้อมกัน
  'label.coverage': ['ช่วงข้อมูล', 'Covers'],
  'label.search': ['ค้นหา…', 'Search…'],
  'label.allCrops': ['ทุกครอป', 'All crops'],
  'label.allTabs': ['ทุกชีตย่อย', 'All tabs'],
  'label.other': ['อื่น ๆ', 'Other'],
  // บรรทัดย่อยใน tooltip ของกราฟแท่งซ้อน — แตกยอดของหมวดหนึ่งออกตามที่มา
  'label.noCrop': ['ไม่ระบุครอป', 'Crop not given'],
  'label.noData': ['ไม่มีข้อมูลให้แสดง', 'No data to display'],
  'label.top': ['สูงสุด', 'Top'],

  'loader.title': ['กำลังโหลดข้อมูล', 'Loading data'],
  'loader.connecting': ['กำลังเชื่อมต่อ Google Sheets…', 'Connecting to Google Sheets…'],
  'loader.loading': ['กำลังอ่าน', 'Reading'],
  'loader.analysing': ['กำลังวิเคราะห์ความถูกต้องของข้อมูล…', 'Validating data accuracy…'],
  'loader.analysed': ['วิเคราะห์ข้อมูลเสร็จแล้ว', 'Data validation complete'],
  'loader.done': ['เสร็จสิ้น', 'Done'],
  // รายงานที่ตั้งใจดึงทีหลัง (Log Stock 139 แท็บ) — ต้องบอก ไม่งั้นดูเหมือนโหลดค้าง
  'loader.deferred': ['โหลดเบื้องหลัง', 'loads in background'],
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
  'auth.devMode': [
    'โหมดทดสอบ — ยังไม่มีการตรวจรหัสผ่านจริง',
    'Test mode — passwords are not actually checked',
  ],
  'auth.expired': ['เซสชันหมดอายุ กำลังพากลับไปหน้าล็อกอิน…', 'Session expired, returning to sign-in…'],

  'label.topCrops': ['ครอปเด่น', 'Top crops'],
  'quality.bySeverity': ['ตามความรุนแรง', 'By severity'],
  'quality.bySheet': ['ชีตไหนมีปัญหา', 'Which sheet has issues'],
  'quality.bySource': ['ตามรายงาน', 'By report'],

  'ctl.view': ['มุมมอง', 'View'],
  'ctl.sort': ['จัดเรียง', 'Sort'],
  'ctl.filter': ['กรอง', 'Filter'],
  'ctl.showAll': ['แสดงทั้งหมด', 'Show all'],
  'ctl.onlyWithData': ['เฉพาะที่มีข้อมูล', 'With data only'],
  'ctl.top5': ['5 อันดับแรก', 'Top 5'],
  'ctl.reset': ['ล้างตัวกรอง', 'Clear filters'],
  'ctl.from': ['ตั้งแต่', 'From'],
  'ctl.to': ['ถึง', 'To'],

  'sort.valueDesc': ['มาก → น้อย', 'Highest first'],
  'sort.valueAsc': ['น้อย → มาก', 'Lowest first'],
  'sort.timeAsc': ['เก่า → ใหม่', 'Oldest first'],
  'sort.timeDesc': ['ใหม่ → เก่า', 'Newest first'],
  'sort.nameAsc': ['ชื่อ ก → ฮ', 'Name A → Z'],
  'sort.nameDesc': ['ชื่อ ฮ → ก', 'Name Z → A'],

  'tabs.newFound': ['พบแท็บใหม่ในชีต', 'New sheet tabs found'],
  'tabs.removed': ['แท็บที่หายไป', 'Tabs removed'],
  'tabs.renamed': ['แท็บที่เปลี่ยนชื่อ', 'Tabs renamed'],

  'footer.source': [
    'ลิงก์รายงานทั้งหมดอ่านจากไฟล์ "แบบฟอร์มรายงาน Kambis.txt"',
    'All report links are read from "แบบฟอร์มรายงาน Kambis.txt"',
  ],
  // ── เมนูสองชั้น ──
  // ── แถบแจ้งเตือนบนหัวเว็บ (ui/notices.js) ──
  'notice.servedLastGood': [
    'ดึงข้อมูลสดจาก Google ไม่สำเร็จเลย — กำลังแสดงชุดข้อมูลดีล่าสุดที่บันทึกไว้',
    'Could not fetch any live data — showing the last known-good snapshot',
  ],
  'notice.partialSources': [
    'ดึงข้อมูลไม่สำเร็จบางรายงาน ตัวเลขในหน้านี้ยังไม่ครบ',
    'Some reports failed to load — figures on this page are incomplete',
  ],
  'notice.tabDiscoveryFallback': [
    'ค้นรายชื่อแท็บสดไม่สำเร็จ กำลังใช้รายชื่อที่บันทึกไว้ครั้งก่อน — แท็บที่เพิ่งเพิ่มในชีตอาจยังไม่ถูกอ่าน',
    'Could not list sheet tabs live; using the saved list — tabs added recently may be missing',
  ],
  'notice.scopeSupply': ['ชีตวัสดุสิ้นเปลือง', 'Supply sheet'],
  'notice.refreshCooldown': [
    'ข้อมูลนี้เพิ่งอัปเดตไป{ago} กำลังแสดงชุดล่าสุด — ดึงใหม่จาก Google ได้อีกครั้งในอีก {wait}',
    'This data was refreshed {ago}; showing the latest copy — you can pull from Google again in {wait}',
  ],
  'notice.refreshShared': [
    'คูลดาวน์นี้ใช้ร่วมกันทุกคน เพื่อไม่ให้ยิงคำขอไป Google Sheets ถี่เกินไป',
    'The cooldown is shared by everyone so we do not hammer Google Sheets',
  ],
  'nav.menu': ['เมนู', 'Menu'],
  'nav.dryflower': ['KAMBIS DRYFLOWER STOCK', 'KAMBIS DRYFLOWER STOCK'],
  'nav.supply': ['KAMBIS SUPPLY STOCK', 'KAMBIS SUPPLY STOCK'],
  'nav.overview': ['1. ภาพรวมผู้บริหาร', '1. Executive Overview'],
  'nav.production': ['2. การผลิต', '2. Production'],
  'nav.stock': ['3. สต็อก', '3. Stock'],
  'nav.sales': ['4. การขาย', '4. Sales'],
  'nav.cost': ['5. ต้นทุน', '5. Cost'],
  // ── หัวข้อของแต่ละหน้า ──
  'page.overview.title': ['ภาพรวมผู้บริหาร', 'Executive Overview'],
  'page.overview.sub': ['ตัวเลขระดับสูงสุดสำหรับดูสุขภาพธุรกิจในภาพเดียว', 'Top-level KPIs for an instant health check'],
  'page.production.title': ['การผลิต', 'Production Analytics'],
  'page.production.sub': ['ผลผลิต คุณภาพ และความสม่ำเสมอของแต่ละครอป', 'Yield, quality and batch consistency across crops'],
  'page.stock.title': ['สต็อก', 'Stock Analytics'],
  'page.stock.sub': ['ของคงเหลือแยกตามคลัง สายพันธุ์ และขนาด', 'Inventory by location, strain and size'],
  'page.sales.title': ['การขาย', 'Sales Analytics'],
  'page.sales.sub': ['ปริมาณที่ขายแยกตามเวลา ลูกค้า และสายพันธุ์', 'Volume sold over time, by customer and strain'],
  'page.cost.title': ['ต้นทุน', 'Cost'],
  'page.cost.sub': [
    'งบรายรับ-รายจ่ายรายเดือน จากชีตต้นทุน · ต้นทุนวัสดุสิ้นเปลืองแยกอยู่ท้ายหน้า',
    'Monthly P&L from the cost sheet · consumable supply cost is a separate section below',
  ],
  'page.supply.title': ['สต็อกวัสดุสิ้นเปลือง', 'Supply Stock'],
  'page.supply.sub': ['ของใช้ในฟาร์ม การเบิก และรายการที่ต้องสั่งซื้อ', 'Farm consumables, usage and reorder list'],
  'page.renderFailed': ['แสดงหน้านี้ไม่สำเร็จ — ดูรายละเอียดใน console', 'Could not render this page — see console for details'],
  // ── แถบตัวกรองกลาง ──
  'filter.title': ['ตัวกรองข้อมูล', 'Data filters'],
  'filter.year': ['ปี', 'Year'],
  'filter.allYears': ['ทุกปี', 'All years'],
  'filter.yearDefault': ['ปีล่าสุด', 'latest year'],
  'filter.yearHint': [
    'ค่าเริ่มต้นคือปีล่าสุดที่มีข้อมูล เลือก "ทุกปี" เพื่อดูย้อนหลังทั้งหมด',
    'Defaults to the most recent year with data — pick “All years” to see the full history',
  ],
  'filter.dateRange': ['ช่วงวันที่', 'Date range'],
  'filter.from': ['ตั้งแต่วันที่', 'From date'],
  'filter.to': ['ถึงวันที่', 'To date'],
  'filter.location': ['สถานที่', 'Location'],
  'filter.allLocations': ['ทุกสถานที่', 'All locations'],
  'filter.huahin': ['หัวหิน', 'Hua Hin'],
  'filter.bangkok': ['กรุงเทพ', 'Bangkok'],
  'filter.strain': ['สายพันธุ์', 'Strain'],
  'filter.crop': ['ครอป', 'Crop'],
  'filter.size': ['ขนาดดอก', 'Flower size'],
  'filter.reset': ['ล้างตัวกรอง', 'Clear filters'],
  'filter.open': ['ตัวกรอง', 'Filters'],
  'filter.active': ['ตัวกรองที่ใช้อยู่', 'Active filters'],
  'filter.remove': ['ลบตัวกรอง', 'Remove filter'],
  'filter.all': ['ทั้งหมด', 'All'],
  'filter.items': ['รายการ', 'selected'],
  'filter.selectAll': ['เลือกทั้งหมด', 'Select all'],
  'filter.clearSel': ['ล้าง', 'Clear'],
  'filter.search': ['ค้นหา…', 'Search…'],
  'filter.noneHint': ['ไม่เลือกเลย = แสดงทั้งหมด', 'Select none to show everything'],
  'filter.noOptions': ['ไม่มีตัวเลือก', 'No options'],
  'filter.noMatch': ['ไม่พบรายการที่ค้นหา', 'No matches'],
  'filter.done': ['เสร็จสิ้น', 'Done'],
  // ── ภาพรวมผู้บริหาร ──
  'exec.produced': ['ผลผลิตดอกแห้ง', 'Dryflower produced'],
  'exec.revenue': ['รายได้', 'Revenue'],
  'exec.cost': ['ต้นทุน', 'Cost'],
  'exec.supplyCost': ['ต้นทุนวัสดุสิ้นเปลือง', 'Supply cost'],
  'exec.supplyCostHint': ['จากตารางสั่งของรายเดือน', 'From the monthly order tab'],
  'exec.supplyCostPending': ['เปิดหน้า Supply เพื่อโหลดข้อมูล', 'Open the Supply report to load'],
  'exec.stockHuaHin': ['สต็อกคงเหลือ หัวหิน', 'Stock on hand · Hua Hin'],
  'exec.stockBangkok': ['สต็อกคงเหลือ กรุงเทพ', 'Stock on hand · Bangkok'],
  'exec.yieldPerPlant': ['ผลผลิตเฉลี่ยต่อต้น', 'Average yield per plant'],
  'exec.fromPerCrop': ['จากรายงานต่อครอป', 'From the per-crop report'],
  'exec.fromDailyTrim': ['จากรายงานทริมรายวัน', 'From the daily trim report'],
  // ── หน้าการผลิต ──
  'prod.overTime': ['ผลผลิตตามช่วงเวลา แยกตามสายพันธุ์', 'Production over time by strain'],
  'prod.overTimeNote': [
    'แต่ละแท่งคือยอดรวมทั้งเดือนของทุกครอป · ชี้ที่แท่งเพื่อดูว่าเดือนนั้นทริมสายพันธุ์ไหน จากครอปไหน ครอปละเท่าไร',
    'Each bar is the whole month across every crop · hover a bar for the strains trimmed, their crops, and how much came from each',
  ],
  'prod.sizeTrend': ['สัดส่วนขนาดดอกต่อครอป', 'Size distribution by crop'],
  'prod.sizeTrendNote': [
    'เรียงตามวันที่ทริม ล่าสุดอยู่ขวาสุด · ชี้ที่แท่งเพื่อดูดอกใหญ่ทีละขนาด',
    'Ordered by trim date, latest on the right · hover a bar for the large-bud sizes one by one',
  ],
  // ตัดให้เหลือ 10 แท่งต้องบอกด้วยว่าตัดจากทั้งหมดกี่ครอป ไม่งั้นเข้าใจว่านี่คือทั้งหมด
  'prod.showingLatest': ['แสดง {n} ครอปล่าสุดจาก {total} ครอป', 'Showing the latest {n} of {total} crops'],
  'prod.cropTable': ['เปรียบเทียบรายครอป', 'Crop performance breakdown'],
  'prod.cropTableNote': ['กดหัวตารางเพื่อเรียงลำดับ', 'Click a header to sort'],
  'prod.bigBuds': ['ดอกใหญ่ (≥M)', 'Big buds (≥M)'],
  // ตารางเปรียบเทียบรายครอปใช้วันทริม (= วันเก็บเกี่ยวในชีตต่อครอป) แทนป้ายไตรมาส
  // และแยก S กับ XS เป็นคนละคอลัมน์ คีย์ prod.smallBuds ที่รวมสองขนาดจึงไม่มีใครใช้แล้ว
  'prod.trimDate': ['วันที่ทริม', 'Trim date'],
  'prod.strainUnknown': ['ครอปนี้ยังไม่มีบันทึกในรายงานทริมรายวัน จึงยังไม่รู้สายพันธุ์', 'This crop has no daily-trim record yet, so the strain is unknown'],
  // ── หน้าสต็อก ──
  'stock.snapshot': ['สัดส่วนสต็อกระหว่างคลัง', 'Stock split between locations'],
  'stock.snapshotNote': ['ณ วันที่นับล่าสุดของแต่ละคลัง', 'As of each location latest count'],
  'stock.sizeMix': ['สัดส่วนตามขนาด', 'Size mix'],
  'stock.overTime': ['ยอดคงเหลือตามเวลา', 'Stock balance over time'],
  // ตัดเหลือ 3 เดือนล่าสุดเพื่อให้ป้ายวันที่ไม่เบียดกัน — ตัดแล้วต้องบอกว่าเหลือช่วงไหน
  'stock.overTimeWindow': [
    '{n} เดือนล่าสุด · {from} – {to}',
    'Last {n} months · {from} – {to}',
  ],
  'stock.estimateNote': ['คำนวณจากผลผลิต ขนออก รับเข้า และการขายสะสม แล้วปรับให้ปลายเส้นตรงกับยอดที่นับได้จริง — ไม่ใช่ตัวเลขที่บันทึกไว้ในชีต', 'Derived from cumulative production, transfers and sales, anchored to the latest counted balance — not recorded in the sheet'],
  'stock.notEnoughFlow': ['ข้อมูลการเคลื่อนไหวยังไม่พอสร้างเส้นแนวโน้ม', 'Not enough movement data to build a trend line'],
  'stock.agingTable': ['สต็อกแยกตามสายพันธุ์และขนาด', 'Stock by strain and size'],
  'stock.agingNote': ['คอลัมน์อายุสต็อกต้องรอข้อมูลวันที่รับเข้า', 'The age column needs received-date data'],
  'stock.daysInInventory': ['อายุสต็อก (วัน)', 'Days in inventory'],
  // ── หน้าการขาย ──
  'sales.overTime': ['ปริมาณที่ขายรายเดือน แยกตามสายพันธุ์', 'Grams sold per month by strain'],
  'sales.overTimeNote': ['หน่วยเป็นกรัม — ชีตขายยังไม่มีคอลัมน์ราคา จึงยังคิดเป็นเงินไม่ได้', 'In grams — the sales sheet has no price column yet, so value cannot be computed'],
  'sales.byCustomer': ['ยอดขายแยกตามลูกค้า', 'Sales by customer'],
  'sales.byStrain': ['ยอดขายแยกตามสายพันธุ์', 'Sales by strain'],
  // ── หน้าต้นทุน ──
  'cost.supplyTotal': ['มูลค่าวัสดุตามตารางสั่งซื้อ', 'Supply value per order table'],
  'cost.itemsWithPrice': ['รายการที่มีราคา', 'items with a price'],
  'cost.labour': ['ค่าแรง', 'Labour'],
  'cost.utilities': ['ค่าน้ำค่าไฟ', 'Utilities'],
  'cost.nutrients': ['ปุ๋ยและสารเคมี', 'Nutrients & chemicals'],
  'cost.logistics': ['ค่าขนส่ง', 'Logistics'],
  /* แท็บ "ต้นทุน" แยกสองกลุ่มตามโครงของชีต — หัวข้อที่มีเลขข้อคือต้นทุนการปลูก
   * ที่เหลือเป็นเบ็ดเตล็ด (ดู buildCostBreakdown ใน shared/kpi.js) */
  'cost.growingItems': ['ต้นทุนการปลูก', 'Growing cost'],
  'cost.miscItems': ['ต้นทุนเบ็ดเตล็ด', 'Miscellaneous cost'],
  'cost.topItems': ['วัสดุที่มีมูลค่าสูงสุด', 'Highest-value supplies'],
  'cost.topItemsNote': ['หน่วยเป็นบาท', 'In baht'],
  'cost.table': ['รายการวัสดุทั้งหมด', 'All supply items'],
  // ── หน้า Supply Stock ──
  'supply.loadingTitle': ['กำลังโหลดข้อมูลวัสดุ', 'Loading supply data'],
  'supply.loading': ['ชีตนี้มี 139 แท็บ จึงโหลดแยกจากรายงานอื่น ใช้เวลาราว 8 วินาที', 'This sheet has 139 tabs so it loads separately — about 8 seconds'],
  'supply.loadFailed': ['โหลดข้อมูลวัสดุไม่สำเร็จ', 'Could not load supply data'],
  'supply.trackedItems': ['รายการที่ติดตาม', 'Items tracked'],
  'supply.fromLog': ['จากชีต Log Stock', 'From the Log Stock sheet'],
  'supply.needReorder': ['ต้องสั่งซื้อ', 'Need reordering'],
  'supply.belowMinimum': ['คงเหลือถึงหรือต่ำกว่าขั้นต่ำ', 'At or below the minimum'],
  'supply.orderValue': ['มูลค่าตามตารางสั่งซื้อ', 'Order table value'],
  'supply.fromOrderTab': ['จากแท็บสั่งของรายเดือน', 'From the monthly order tab'],
  'supply.asOf': ['ข้อมูล ณ วันที่', 'Data as of'],
  'supply.reorderTitle': ['ของที่ต้องสั่งซื้อ', 'Stock that needs to be reordered'],
  'supply.reorderNote': ['เรียงจากที่ขาดหนักที่สุด · แก้จำนวนได้ก่อนออกเอกสาร', 'Most depleted first · quantities are editable before issuing'],
  'supply.nothingToReorder': ['ตอนนี้ยังไม่มีของที่ต่ำกว่าขั้นต่ำ', 'Nothing is below its minimum right now'],
  'supply.date': ['วันที่', 'Date'],
  'supply.item': ['รายการ', 'Item'],
  'supply.unit': ['หน่วย', 'Unit'],
  'supply.balance': ['คงเหลือ', 'Amount left'],
  'supply.minimum': ['ขั้นต่ำ', 'Minimum'],
  'supply.orderQty': ['จำนวนสั่งซื้อ', 'Order qty'],
  'supply.orderQtyEditable': ['จำนวนที่ขอซื้อ', 'Qty to request'],
  'supply.unitPrice': ['ราคา/หน่วย', 'Unit price'],
  'supply.amount': ['มูลค่า', 'Amount'],
  'supply.lifetime': ['ระยะเวลาใช้งาน', 'Lasts for'],
  'supply.selectAll': ['เลือกทั้งหมด', 'Select all'],
  'supply.selected': ['เลือกไว้', 'Selected'],
  'supply.itemsUnit': ['รายการ', 'items'],
  'supply.estTotal': ['มูลค่ารวมโดยประมาณ', 'Estimated total'],
  'supply.createPR': ['สร้างใบขอซื้อ (.xlsx)', 'Create purchase request (.xlsx)'],
  'supply.creating': ['กำลังสร้างเอกสาร…', 'Creating document…'],
  'supply.created': ['สร้างแล้ว', 'Created'],
  'supply.createFailed': ['สร้างไม่สำเร็จ', 'Could not create'],
  'supply.noPriceTip': ['ไม่มีราคาในแท็บสั่งของรายเดือน', 'No price in the monthly order tab'],
  'supply.missingPriceWarn': ['มี {n} รายการที่ยังไม่มีราคาในชีต มูลค่ารวมจึงยังไม่ครบ', '{n} items have no price in the sheet, so the total is incomplete'],
  'supply.unpricedNote': ['(ไม่รวม {n} รายการที่ไม่มีราคา)', '(excludes {n} items with no price)'],
  'supply.usageTitle': ['จำนวนเบิกต่อเดือน', 'Stock usage summary'],
  'supply.usageNote': ['แถวคือรายการ คอลัมน์คือเดือน', 'Rows are items, columns are months'],
  'supply.noUsage': ['ยังไม่มีการเบิกในช่วงที่มีข้อมูล', 'No withdrawals in the recorded period'],
  'supply.noUsageInYear': ['ยังไม่มีการเบิกในปี {year}', 'No withdrawals recorded in {year}'],
  'supply.leadTime': ['รอของ (วัน)', 'Lead time (d)'],
  'supply.leadTimeTip': [
    'ระยะเวลารอของหลังสั่งซื้อ — อ่านจากบรรทัด "Lead Time" ในหัวตารางของแท็บนั้น',
    'Days to wait after ordering — read from the “Lead Time” line in that tab’s table header',
  ],
  'supply.noLeadTimeTip': [
    'แท็บนี้ไม่ได้เขียน Lead Time ไว้ในหัวตาราง',
    'This tab has no Lead Time written in its header',
  ],
  'supply.searchItem': ['ค้นหารายการ…', 'Search items…'],
  'supply.group': ['หมวด', 'Category'],
  'supply.groupItem': ['วัสดุทั่วไป', 'General supplies'],
  'supply.groupNutrient': ['ปุ๋ยและสารเคมี', 'Nutrients & chemicals'],
  'supply.priceFilter': ['ราคา', 'Price'],
  'supply.hasPrice': ['เฉพาะที่มีราคา', 'Priced only'],
  'supply.noPriceOnly': ['เฉพาะที่ไม่มีราคา', 'Unpriced only'],
  'supply.stockTable': ['รายการสต๊อกปัจจุบัน', 'Current stock list'],
  'supply.stockTableNote': [
    'คงเหลือจากแท็บ log ของแต่ละรายการ · มูลค่า = คงเหลือ × ราคา/หน่วย · ราคามาจากตารางสั่งซื้อรายเดือนซึ่งมีไม่ครบทุกรายการ',
    'Balances from each item’s log tab · value = balance × unit price · prices come from the monthly order tab, which does not cover every item',
  ],
  'supply.noPrice': ['*ยังไม่ใส่ราคา', '*price not set'],
  'exec.fromCostSheet': ['จากชีตต้นทุน', 'From the cost sheet'],
  /* เดิมเขียนว่า "กำไรขั้นต้น (ทั้งปี)" — ผิดสองชั้น
   * ยอดถูกตัดที่เดือนล่าสุดที่มีความเคลื่อนไหวจริง (ไม่ใช่ทั้งปี) และตอนนี้ยังผูกกับ
   * ปีที่เลือกบนแถบตัวกรองด้วย ช่วงเวลาจริงจึงต่อท้ายป้ายจาก costSpan() แทน */
  'exec.grossProfit': ['กำไรขั้นต้น', 'Gross profit'],
  'exec.grossProfitHint': ['รายได้ − ต้นทุนการปลูก', 'Revenue − growing cost'],
  'exec.noCostYear': ['ชีตต้นทุนไม่มีข้อมูลปี {year}', 'No cost data for {year}'],
  // ── หน้าต้นทุน: งบรายรับ-รายจ่ายจากชีต "แบบฟอร์มต้นทุน" ──
  'cost.revenue': ['รายได้', 'Revenue'],
  'cost.totalCost': ['ต้นทุนการปลูก', 'Growing cost'],
  'cost.growingOnly': ['วัตถุดิบ + Farm + Office', 'Materials + Farm + Office'],
  'cost.grossProfit': ['กำไรขั้นต้น', 'Gross profit'],
  'cost.ofRevenue': ['ของรายได้', 'of revenue'],
  /* คำกำกับตัวเลขติดลบ — สีแดงอย่างเดียวไม่พอ ใต้ตาบอดสีแดง-เขียวจะเห็นว่า
   * "มีการทำเครื่องหมายไว้" แต่ไม่รู้ว่าแปลว่าอะไร และแคปหน้าจอขาวดำก็หายไปเลย */
  'cost.loss': ['ขาดทุน', 'Loss'],
  'cost.ebitda': ['EBITDA', 'EBITDA'],
  'cost.ebit': ['EBIT', 'EBIT'],
  'cost.depreciation': ['ค่าเสื่อมราคา', 'Depreciation'],
  'cost.material': ['ต้นทุนวัตถุดิบ', 'Materials'],
  'cost.farm': ['ค่าใช้จ่าย Farm', 'Farm expense'],
  'cost.office': ['ค่าใช้จ่าย Office', 'Office expense'],
  'cost.pnlTitle': ['รายได้ ต้นทุน และกำไรขั้นต้นรายเดือน', 'Revenue, cost and gross profit by month'],
  'cost.pnlNote': [
    'จากแท็บ "สรุป" ของชีตต้นทุน · กำไรขั้นต้นคำนวณใหม่จากรายได้ − ต้นทุน · แสดงถึงเดือนล่าสุดที่มีความเคลื่อนไหว',
    'From the “สรุป” tab of the cost sheet · gross profit recomputed as revenue − cost · shown up to the last month with activity',
  ],
  'cost.coverageNote': [
    'ยอดด้านบนคิดถึง {span} เท่านั้น — ชีตกรอกค่าเสื่อมราคาและค่าใช้จ่าย Office ไว้ล่วงหน้าจนถึงสิ้นปี ถ้าบวกครบ 12 เดือนจะได้ EBIT {full} ซึ่งเป็นการเอารายได้ที่มีไปหักค่าใช้จ่ายของเดือนที่ยังไม่ถึง',
    'The figures above cover {span} only — the sheet pre-fills depreciation and office costs to year end. Summing all 12 months gives EBIT {full}, which offsets actual revenue against months that have not happened yet',
  ],
  'cost.split': ['สัดส่วนต้นทุน', 'Cost split'],
  /* เดิมเขียนว่า "ทั้งปีตามงบสรุป" — ยอดตัดที่เดือนล่าสุดที่มีความเคลื่อนไหว
   * และผูกกับปีที่เลือกบนแถบตัวกรอง จึงไม่ใช่ทั้งปีทั้งสองความหมาย */
  'cost.splitNote': [
    'ตามงบสรุป · ถึงเดือนล่าสุดที่มีความเคลื่อนไหว',
    'Per the summary tab · through the last month with activity',
  ],
  'cost.monthTable': ['งบรายเดือน', 'Monthly P&L'],
  'cost.monthTableNote': [
    'กำไรขั้นต้นคำนวณใหม่จาก รายได้ − ต้นทุน ไม่ได้อ่านจากช่องในชีต',
    'Gross profit is recomputed from revenue − cost, not read from the sheet',
  ],
  'cost.supplyScopeNote': [
    'คนละชีตกับงบด้านบน เป็นของใช้ในฟาร์ม ห้ามนำไปบวกกับต้นทุนการปลูก',
    'A different sheet from the P&L above — farm consumables, not to be added to growing cost',
  ],
  'cost.noSheet': ['ยังอ่านชีตต้นทุนไม่ได้', 'Cost sheet unavailable'],
  'cost.noSheetNote': [
    'ยังดึงข้อมูลจากชีต "แบบฟอร์มต้นทุน" ไม่สำเร็จ — ดูรายละเอียดที่การ์ดคุณภาพข้อมูลท้ายหน้า',
    'Could not read the cost sheet — see the data quality card at the bottom of this page',
  ],
  // {has} เป็นรายการปีคั่นด้วยจุลภาค — ชีตมีได้มากกว่าหนึ่งปี
  'cost.otherYear': [
    'ชีตต้นทุนมีข้อมูลปี {has} · ตอนนี้เลือกดูปี {year} อยู่',
    'The cost sheet covers {has}; you are viewing {year}',
  ],
  // ── การ์ดรอข้อมูล ──
  'awaiting.badge': ['รอข้อมูล', 'Awaiting data'],
  'awaiting.needs': ['ต้องเพิ่มข้อมูลต่อไปนี้ก่อน', 'Needs the following to be added first'],
  'awaiting.estimated': ['ประมาณการ', 'estimated'],
  'awaiting.revenue.title': ['รายได้ (รายปี / รายเดือน)', 'Revenue (yearly / monthly)'],
  'awaiting.revenue.why': ['ตรวจชีตขายดอกครบทั้ง 5 แท็บแล้ว ไม่มีคอลัมน์ราคาหรือมูลค่าเลย มีแต่จำนวนกรัม', 'All five tabs of the sales sheet were checked — there is no price or amount column, only grams'],
  'awaiting.salesValue.title': ['ยอดขายเป็นเงิน', 'Sales value'],
  'awaiting.salesValue.why': ['คำนวณเป็นบาทไม่ได้จนกว่าชีตขายจะมีคอลัมน์ราคา', 'Cannot be computed in baht until the sales sheet carries a price column'],
  'awaiting.asp.title': ['ราคาขายเฉลี่ยต่อกรัม (ASP)', 'Average selling price per gram (ASP)'],
  'awaiting.asp.why': ['เป็นค่าที่ได้จากราคา จึงต้องมีราคาก่อน และถ้าต้องการแยกตามขนาดก็ต้องมีราคาต่อขนาด', 'Derived from price, so price is required first — a per-size breakdown needs per-size prices'],
  'awaiting.cost.title': ['ต้นทุนการผลิต', 'Production cost'],
  'awaiting.cost.why': ['ยังไม่มีชีตต้นทุนในระบบเลย มีเพียงต้นทุนวัสดุสิ้นเปลืองเท่านั้น', 'There is no cost sheet in the system yet — only consumable supply cost exists'],
  'awaiting.cost.newSheet': ['ชีตใหม่: ต้นทุนการผลิต', 'New sheet: production cost'],
  'awaiting.prodCost.title': ['ต้นทุนส่วนที่เหลือ', 'Remaining cost components'],
  'awaiting.prodCost.why': ['ตัวเลขด้านบนเป็นต้นทุนวัสดุสิ้นเปลืองเท่านั้น ห้ามนำไปเรียกว่าต้นทุนรวม', 'The figures above cover consumable supplies only — they are not total cost'],
  'awaiting.stockHistory.title': ['ยอดคงเหลือย้อนหลัง', 'Historical stock balance'],
  'awaiting.stockHistory.why': ['ชีตคงเหลือเป็นภาพนิ่งวันเดียวที่ถูกเขียนทับทุกครั้งที่นับใหม่ จึงไม่มีประวัติให้ดูย้อนหลัง', 'The inventory sheet is a single snapshot overwritten at each count, so there is no history'],
  'awaiting.aging.title': ['อายุสต็อก (Days in Inventory)', 'Stock aging (days in inventory)'],
  'awaiting.aging.why': ['ไม่มีวันที่รับเข้าราย lot จึงคำนวณอายุของแต่ละกองไม่ได้', 'Without a per-lot received date the age of each lot cannot be computed'],
  'awaiting.col.pricePerGram': ['ราคา/กรัม', 'Price per gram'],
  'awaiting.col.lineAmount': ['มูลค่ารวมต่อแถว', 'Line amount'],
  'awaiting.col.pricePerSize': ['ราคาแยกตามขนาด', 'Price by size'],
  'awaiting.col.labour': ['ค่าแรง', 'Labour'],
  'awaiting.col.utilities': ['ค่าน้ำค่าไฟ', 'Utilities'],
  'awaiting.col.nutrients': ['ปุ๋ยและสารเคมี', 'Nutrients'],
  'awaiting.col.logistics': ['ค่าขนส่ง', 'Logistics'],
  'awaiting.col.depreciation': ['ค่าเสื่อมราคา', 'Depreciation'],
  'awaiting.col.perCropOrMonth': ['ระบุต่อครอปหรือต่อเดือน', 'Per crop or per month'],
  'awaiting.col.snapshotDaily': ['บันทึกยอดคงเหลือต่อท้ายรายวัน แทนการเขียนทับ', 'Append the balance daily instead of overwriting'],
  'awaiting.revenueSplit.title': ['รายได้แยกตามลูกค้า / สายพันธุ์', 'Revenue by customer / strain'],
  'awaiting.revenueSplit.why': [
    'รายได้รวมรายเดือนมีแล้วจากชีตต้นทุน แต่ชีตขายดอกยังไม่มีคอลัมน์ราคา จึงบอกไม่ได้ว่ารายได้ก้อนนี้มาจากลูกค้าคนไหนหรือสายพันธุ์ใด',
    'Monthly revenue now comes from the cost sheet, but the sales sheet still has no price column — so revenue cannot be attributed to a customer or strain',
  ],
  'awaiting.col.summaryTab': ['แท็บ "สรุป" ที่อ่านได้', 'A readable “สรุป” tab'],
  'awaiting.costPerGram.title': ['ต้นทุนต่อกรัม', 'Cost per gram'],
  'awaiting.costPerGram.why': [
    'มีทั้งต้นทุนรายเดือนและผลผลิตรายเดือนแล้ว แต่ยังหารกันตรง ๆ ไม่ได้ เพราะต้นทุนของเดือนหนึ่งเป็นของครอปที่เก็บเกี่ยวอีกเดือนหนึ่ง ต้องมีคนกำหนดก่อนว่าจะผูกต้นทุนกับครอปอย่างไร',
    'Monthly cost and monthly yield both exist, but dividing them is wrong: a month’s cost belongs to a crop harvested in another month — someone must define how cost maps to crops first',
  ],
  'awaiting.costPerGram.sheet': [
    'ชีตต้นทุน — แท็บ "ต้นทุน ต่อ กรัม 2026" (ตอนนี้ยังเป็นสำเนาของแท็บ Office)',
    'Cost sheet — the “ต้นทุน ต่อ กรัม 2026” tab (currently still a copy of Office)',
  ],
  'awaiting.col.gramsPerMonth': [
    'กรัมที่ผลิตได้ต่อเดือน หรือวิธีผูกต้นทุนเข้ากับครอป',
    'Grams produced per month, or a rule mapping cost to crops',
  ],
  'awaiting.col.receivedDate': ['วันที่รับเข้า', 'Received date'],
  'awaiting.col.lot': ['เลข lot', 'Lot number'],
  'awaiting.cropStrain.title': ['สายพันธุ์ในรายงานต่อครอป', 'Strain in the per-crop report'],
  'awaiting.cropStrain.why': [
    'SUMMARY SHEET ไม่มีคอลัมน์สายพันธุ์ ตอนนี้เดาจากรายงานทริมรายวันแทน ครอปที่ยังไม่มีในรายงานรายวันจึงขึ้น —',
    'The SUMMARY SHEET has no strain column; it is currently joined from the daily trim report, so crops not yet in that report show —',
  ],
  'awaiting.col.strain': ['สายพันธุ์', 'Strain'],
  'awaiting.supplyPrice.title': ['ราคาต่อหน่วยของทุกรายการ', 'Unit price for every item'],
  'awaiting.supplyPrice.why': [
    'ตารางสั่งของรายเดือนมีราคาแค่ราว 60 รายการ แต่มีแท็บ log 138 รายการ ของที่เหลือจึงคิดมูลค่าไม่ได้ และยอดรวมในใบขอซื้อจะต่ำกว่าจริง',
    'The monthly order tab prices only ~60 items while there are 138 item tabs, so the rest carry no value and purchase-request totals read lower than reality',
  ],
  'awaiting.supplyIssueValue.title': ['มูลค่าของที่เบิกออกไป', 'Value of stock issued'],
  'awaiting.supplyIssueValue.why': [
    'ชีตบันทึกการเบิกเป็นจำนวนชิ้นอย่างเดียว จึงบอกไม่ได้ว่าเดือนนี้ใช้วัสดุไปกี่บาท บอกได้แค่กี่ชิ้น',
    'Withdrawals are logged as quantities only, so monthly consumption can be reported in pieces but never in baht',
  ],
  'awaiting.supplyBaseline.title': ['เดือนสำหรับเทียบการเบิกผิดปกติ', 'Months needed to flag unusual usage'],
  'awaiting.supplyBaseline.why': [
    'ต้องมีเดือนที่เบิกจบแล้วอย่างน้อย 2 เดือนถึงจะบอกได้ว่าเดือนนี้เบิกมากผิดปกติ — ข้อมูลจะครบเองเมื่อเวลาผ่านไป ไม่ต้องแก้ชีต',
    'At least two completed months of withdrawals are required before this month can be called unusual — this fills itself in over time, no sheet change needed',
  ],
  'awaiting.supplyLeadTime.title': ['ระยะเวลารอของที่ยังเขียนไม่ครบ', 'Lead time not filled in everywhere'],
  'awaiting.supplyLeadTime.why': [
    'ระยะเวลารอของถูกเขียนแทรกไว้ในหัวตารางของแท็บ (บรรทัด "Lead Time – 5 Days") ไม่ใช่คอลัมน์ แท็บที่ไม่ได้เขียนไว้จึงขึ้น — และบอกไม่ได้ว่าต้องสั่งล่วงหน้ากี่วัน',
    'Lead time is written inline in each tab’s table header (“Lead Time – 5 Days”), not as a column — tabs without that line show — and cannot say how far ahead to order',
  ],
  'awaiting.supplySupplier.title': ['ผู้ขายและวันที่สั่งซื้อจริง', 'Supplier and actual order dates'],
  'awaiting.supplySupplier.why': [
    'ไม่มีชื่อผู้ขาย วันที่สั่ง และวันที่ของเข้าจริง จึงตามไม่ได้ว่าของที่สั่งไปแล้วถึงไหน และเทียบไม่ได้ว่าผู้ขายส่งช้ากว่าที่บอกไว้ไหม',
    'Without supplier, order date and actual receipt date there is no way to track an outstanding order or check whether a supplier is slower than promised',
  ],
  'awaiting.col.priceEveryItem': ['ราคาต่อหน่วยของทุกแท็บรายการ', 'Unit price on every item tab'],
  'awaiting.col.issueValue': ['มูลค่าต่อการเบิกหนึ่งครั้ง', 'Value per withdrawal'],
  'awaiting.col.moreMonths': ['รอให้มีเดือนที่เบิกจบแล้วครบ 2 เดือน', 'Wait for two completed months of withdrawals'],
  'awaiting.col.supplier': ['ผู้ขาย', 'Supplier'],
  'awaiting.col.leadTime': ['ระยะเวลารอของ (วัน)', 'Lead time (days)'],
  'awaiting.col.orderedAt': ['วันที่สั่ง / วันที่ของเข้า', 'Ordered at / received at'],
  // ── หมายเหตุ "ข้อมูลที่ยังขาด" บนการ์ดคุณภาพข้อมูล ──
  'quality.gaps': ['ข้อมูลที่ยังขาด', 'Missing data'],
  'quality.gapsTitle': ['หมายเหตุ: ข้อมูลที่ยังขาดสำหรับทำ Dashboard', 'Note: data still missing for this dashboard'],
  'quality.gapsNote': [
    'หัวข้อเหล่านี้ทำไม่ได้เพราะชีตต้นทางยังไม่มีข้อมูล ไม่ใช่เพราะ Dashboard ยังไม่ได้ทำ — ตัวเลขที่ขาดจะขึ้นเองทันทีที่ชีตมีข้อมูล',
    'These items are blocked by the source sheets, not by unfinished dashboard work — each one appears automatically once the sheet carries the data',
  ],
  'gap.none': ['ข้อมูลครบทุกหัวข้อที่ Dashboard ต้องใช้', 'Every field this dashboard needs is present'],
  'gap.page.overview': ['ภาพรวมผู้บริหาร', 'Executive overview'],
  'gap.page.production': ['การผลิต', 'Production'],
  'gap.page.stock': ['สต็อก', 'Stock'],
  'gap.page.sales': ['การขาย', 'Sales'],
  'gap.page.cost': ['ต้นทุน', 'Cost'],
  'gap.page.supply': ['วัสดุสิ้นเปลือง', 'Supplies'],
  'gap.detail.noPrice': [
    'ตอนนี้ {n} จาก {total} รายการที่ต้องสั่งซื้อยังไม่มีราคาในชีต',
    'Right now {n} of {total} items that need reordering have no price in the sheet',
  ],
  'gap.detail.costSheetDown': [
    'ตอนนี้ยังอ่านชีตต้นทุนไม่ได้ ตัวเลขเงินทั้งหมดจึงหายไปด้วย',
    'The cost sheet cannot be read right now, so every money figure is missing too',
  ],
  'gap.detail.leadTime': [
    'ตอนนี้เขียนไว้แล้ว {have} จาก {total} รายการ',
    'Currently written for {have} of {total} items',
  ],
  'gap.detail.baseline': [
    'ตอนนี้มีเดือนที่เบิกจบแล้ว {have} เดือน ต้องมี {need} เดือน',
    'Currently {have} completed month(s) of withdrawals; {need} are required',
  ],
  // ── เบ็ดเตล็ด ──
  'label.size': ['ขนาด', 'Size'],
  'label.plantUnit': ['ต้น', 'plant'],
  'action.retry': ['ลองใหม่', 'Retry'],
  'notice.unmatched': ['มีลิงก์รายงานในไฟล์ .txt ที่ระบบยังไม่รู้จัก', 'The .txt file has report links the system does not recognise yet'],
  'label.byYear': ['รายปี', 'by year'],
  'label.byMonth': ['รายเดือน', 'by month'],
  // ── Supply: คอลัมน์ Index และการเบิกผิดปกติ ──
  'supply.index': ['Index', 'Index'],
  'supply.indexTip': ['คงเหลือ − ขั้นต่ำ · ติดลบแปลว่าต้องสั่งซื้อ', 'Balance − minimum · negative means it needs reordering'],
  'supply.anomalyTitle': ['การเบิกที่ผิดปกติ', 'Unusual usage'],
  'supply.anomalyNote': ['เทียบอัตราการเบิกของเดือนล่าสุดกับค่าเฉลี่ยของเดือนก่อน ๆ', 'Compares this month usage rate against the average of previous months'],
  'supply.anomalyNotReady': ['ยังเทียบไม่ได้ — ต้องมีเดือนที่มีการเบิกอย่างน้อย {need} เดือน ตอนนี้มี {have} เดือน หน้านี้จะเริ่มทำงานเองเมื่อข้อมูลครบ', 'Not enough history yet — needs at least {need} months with usage, currently {have}. This will start working on its own once the data is there'],
  'supply.anomalyScope': ['เดือนล่าสุด {month} (ผ่านมา {days} วัน) เทียบกับค่าเฉลี่ยของ {base} · คิดเป็นอัตราต่อวัน เดือนที่ยังไม่จบจึงเทียบได้อย่างเป็นธรรม', 'Latest month {month} ({days} days in) vs the average of {base} · compared as a per-day rate so an incomplete month is judged fairly'],
  'supply.anomalyNone': ['เดือนนี้ยังไม่มีรายการที่เบิกผิดปกติ', 'No unusual usage this month'],
  'supply.anomalyStatus': ['สถานะ', 'Status'],
  'supply.anomalyHigh': ['เบิกมากกว่าปกติ', 'Higher than usual'],
  'supply.anomalyLow': ['เบิกน้อยกว่าปกติ', 'Lower than usual'],
  'supply.anomalyNew': ['เพิ่งเริ่มเบิก', 'Newly used'],
  'supply.anomalyCurrent': ['เบิกเดือนนี้', 'This month'],
  'supply.anomalyExpected': ['ควรจะเป็น', 'Expected'],
  'supply.anomalyBaseline': ['เฉลี่ยต่อเดือน', 'Monthly average'],
  'supply.anomalyRatio': ['เทียบปกติ', 'vs normal'],
};

const LANG_KEY = 'kambis.lang';

let current = 'th';
const listeners = new Set();

/**
 * ตั้ง `<html lang>` เท่าที่ทำได้
 *
 * ไฟล์นี้ถูก import โดยโมดูลที่ไม่แตะ DOM (ui/notices.js, ui/gaps.js, ui/supply-filters.js)
 * ซึ่ง tests/ui.js เรียกใช้จาก Node ตรง ๆ — ถ้าเขียน `document` ดื้อ ๆ เทสต์จะพัง
 * ด้วยเหตุผลเดียวกับที่ localStorage ถูกครอบ try/catch ไว้อยู่แล้ว
 */
function setHtmlLang(lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
}

/** อ่านภาษาที่ผู้ใช้เลือกไว้ */
export function initLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'th' || saved === 'en') current = saved;
  } catch {
    /* localStorage ปิดอยู่ — ใช้ค่าเริ่มต้น */
  }
  setHtmlLang(current);
  return current;
}

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (lang !== 'th' && lang !== 'en') return;
  if (lang === current) return;
  current = lang;
  setHtmlLang(lang);
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

/**
 * แปลคีย์เป็นข้อความตามภาษาปัจจุบัน
 *
 * ใส่ค่าลงในช่อง `{name}` ได้ด้วย เช่น `t('notice.refreshCooldown', { wait: '2 นาที' })`
 * จำเป็นเพราะลำดับคำไทยกับอังกฤษไม่ตรงกัน การต่อสตริงเอาจึงได้ประโยคที่อ่านไม่รู้เรื่อง
 * ในภาษาใดภาษาหนึ่งเสมอ — ไม่ส่ง `vars` = พฤติกรรมเดิมทุกประการ
 */
export function t(key, vars) {
  const entry = STRINGS[key];
  if (!entry) return key;
  const text = current === 'en' ? entry[1] : entry[0];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
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
