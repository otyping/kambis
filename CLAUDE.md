# CLAUDE.md — Kambis Executive Report Dashboard

Dashboard สรุปรายงานผู้บริหารของ Kambis อ่านข้อมูลสดจาก Google Sheets
เขียนด้วย HTML / CSS / Vanilla JavaScript / Three.js และ Node.js server แบบไม่มี dependency

---

## 1. กฎการอ่านค่ารายงาน (สำคัญที่สุด)

> **ลิงก์รายงานทุกอันต้องอ่านจากไฟล์ `แบบฟอร์มรายงาน Kambis.txt` เท่านั้น**

ไฟล์ `แบบฟอร์มรายงาน Kambis.txt` คือ **แหล่งความจริงเพียงแหล่งเดียว (single source of truth)**
ของลิงก์ Google Sheets ทั้งหมด ในนั้นมีลิงก์รายงานหลายอัน แต่ละอันเป็นคนละรายงานกัน

ขั้นตอนการอ่านค่า:

```
แบบฟอร์มรายงาน Kambis.txt          ← ไฟล์ต้นทาง (คนแก้ด้วยมือ)
        │  node scripts/sync-sources.js
        ▼
config/sources.json                 ← ไฟล์ generated (โค้ดอ่านจากตรงนี้)
        │  server/lib/fetcher.js
        ▼
https://docs.google.com/spreadsheets/d/{sheetId}/gviz/tq?tqx=out:csv&gid={gid}
        │  server/lib/csv.js → server/lib/parsers/*.js
        ▼
server/lib/analysis.js              ← ตรวจสอบความถูกต้องทุกครั้ง (บังคับ)
        ▼
GET /api/reports                    ← front-end ใช้
```

**ข้อห้าม**

- ❌ ห้ามเขียน URL ของ Google Sheets ลงในไฟล์ source ใด ๆ นอกจาก `config/sources.json`
  (ตรวจได้ด้วย `grep -rn "docs.google.com" server public scripts` — ต้องไม่เจอ)
- ❌ ห้ามแก้ไขไฟล์ `แบบฟอร์มรายงาน Kambis.txt` ด้วยโค้ด ไฟล์นี้คนเป็นคนแก้
- ❌ ห้าม commit ค่าข้อมูลจากชีตเป็น fixture ถาวร (cache ใน `data/` ถูก gitignore ไว้แล้ว)

**เมื่อลิงก์ในไฟล์ .txt เปลี่ยน / เพิ่ม / ลบ** ให้รัน:

```bash
node scripts/sync-sources.js
```

สคริปต์จะอ่านคู่ `ชื่อรายงาน:` + `URL` จากไฟล์ .txt แล้วไปสำรวจ tab ทั้งหมดของแต่ละ spreadsheet
(ผ่าน `…/htmlview`) และเขียน `config/sources.json` ใหม่
เซิร์ฟเวอร์จะเตือนตอนเริ่มทำงานถ้าไฟล์ .txt ถูกแก้หลัง `sources.json` ถูก generate
(เทียบกับฟิลด์ `sourceMtime` ในไฟล์ ไม่ใช่ mtime ของตัวไฟล์ เพราะเซิร์ฟเวอร์เขียนทับ `tabs` เองได้)

### แท็บใหม่ถูกค้นหาอัตโนมัติทุกครั้งที่รีเฟรช

`server/lib/loader.js` เรียก `discoverTabs()` ก่อนโหลดทุกรายงาน จึงรับแท็บที่เพิ่งเพิ่มในชีต
(เช่นเดือนใหม่ ครอปใหม่) ได้เองโดยไม่ต้องรัน `sync-sources.js`

| เหตุการณ์ในชีต | กด Refresh แล้วเห็นไหม |
|---|---|
| แก้ตัวเลข / เพิ่มแถวในแท็บเดิม | เห็นทันที |
| **เพิ่มแท็บใหม่** | **เห็นทันที** — และขึ้นแถบแจ้งบนหน้าเว็บว่าเจอแท็บอะไร |
| ลบหรือเปลี่ยนชื่อแท็บ | เห็นทันที พร้อมแจ้งเตือน |
| เพิ่มลิงก์ชีตใหม่ในไฟล์ .txt | **ต้องรัน `node scripts/sync-sources.js`** |

รายละเอียดการทำงาน:

- ค้นจาก `…/htmlview` ซึ่งเป็นหน้าเล็ก (~50 KB เพราะเนื้อตารางโหลดทีหลัง) ใช้เวลา ~0.6 วิ/ชีต
- ถ้าค้นไม่สำเร็จ (เน็ตล่ม / ชีตถูกปิดแชร์) จะ **fallback ไปใช้รายชื่อใน `config/sources.json`**
  แล้วรายงานสถานะเป็น `discovery: "config"` — ไม่ทำให้ทั้งรายงานล่ม
- ถ้าหน้าโหลดได้แต่ไม่เจอแท็บเลย ถือว่า **ล้มเหลว** ไม่ใช่ "ชีตนี้ไม่มีแท็บ"
  (ไม่งั้นข้อมูลทั้งรายงานจะหายเงียบ ๆ)
- เมื่อรายชื่อเปลี่ยน จะเขียนกลับลง `config/sources.json` แบบ atomic (เขียน `.tmp` แล้ว rename)
  เพื่อให้รายชื่อล่าสุดยังใช้ได้ตอนออฟไลน์

> `config/sources.json` ยังเป็นไฟล์ generated เหมือนเดิม — ส่วนที่เซิร์ฟเวอร์แตะได้มีแค่ `tabs[]`
> ส่วน `sheetId` / `parser` / ลิงก์ ยังมาจากไฟล์ .txt ผ่าน `sync-sources.js` เท่านั้น

---

## 2. กฎการวิเคราะห์ข้อมูล (บังคับทุกครั้งที่อัปเดต)

> **ทุกครั้งที่ Dashboard มีการอัปเดตข้อมูล ต้องรัน Data Analysis ตรวจและวิเคราะห์ความถูกต้องเสมอ**

`server/lib/analysis.js` จะทำงานอัตโนมัติทุกครั้งที่มีการดึงข้อมูล — ทั้งตอนเปิดหน้าเว็บ
และตอนกดปุ่ม Refresh — ไม่มี code path ไหนที่ข้ามได้

ผลลัพธ์ถูกแนบไปกับ payload ทุกครั้ง และแสดงบน UI 3 จุด:
badge คุณภาพข้อมูลบน header, chip บนการ์ดแต่ละใบ, และการ์ด "คุณภาพข้อมูล" ที่ลงรายละเอียดทุก finding

### หลักการวิเคราะห์

1. **คำนวณใหม่เสมอ ไม่เชื่อคอลัมน์ Total / % ในชีต** — sum เองจากคอลัมน์ขนาด แล้วเทียบกับที่ชีตบอก
2. **ห้ามซ่อมข้อมูลเงียบ ๆ** — ค่าดิบเก็บไว้ใน `raw.*`, ค่าที่คำนวณใหม่แสดงบน UI, ความต่างออกเป็น finding
3. **`-` และเซลล์ว่าง = `null` ไม่ใช่ `0`** — ในชีตนี้ `-` แปลว่าไม่มีข้อมูล การนับเป็น 0 ทำให้ค่าเฉลี่ยผิด

### กลุ่มการตรวจสอบ

| กลุ่ม | ตรวจอะไร |
|---|---|
| Structural | เข้าถึง tab ได้, หา header row เจอ, มีแถวข้อมูล, คอลัมน์ครบ |
| Arithmetic | Σ ขนาด = total ที่ชีตบอก (tol 0.5 g), % ที่คำนวณ = % ที่ชีตบอก, แถว Total = Σ แถวข้อมูล |
| Range | 0 ≤ % ≤ 100, น้ำหนัก ≥ 0, outlier > 3× median |
| Units | label บอกหน่วยหนึ่งแต่ค่าเป็นอีกหน่วย |
| Dates | parse ได้, เรียงถูก, ไม่เกิน 12 เดือนในอนาคต, ชื่อ tab ตรงกับวันที่ในชีต |
| Completeness | มีน้ำหนักแต่ total ว่าง, ไม่มี crop/strain, แถวซ้ำ |
| Cross-source | ขนออกจากฟาร์ม ≈ รับที่กรุงเทพ, Σ รายวัน ≈ ยอดต่อครอป, ยอดขาย ≤ ของที่รับเข้า |

### รูปแบบ finding

```js
{
  id, severity: 'critical'|'warning'|'info',
  source, tab, gid,          // ชีตต้นทาง + ชื่อ tab + gid ของ tab นั้น
  row, field,
  messageTh, messageEn,
  expected, actual, delta,
  related: [{ source, tab, gid }]   // ชีตอื่นที่ต้องเปิดดูประกอบ
}
```

`gid` ถูกเติมอัตโนมัติตอนท้ายของ `analyze()` โดยค้นจากชื่อ tab ใน `source.tabs`
front-end เอาไปทำลิงก์ `…/edit?gid=N#gid=N` ที่เปิดตรงไปยัง tab ที่มีปัญหาได้ทันที

`related` ใช้กับการตรวจข้ามรายงาน ซึ่งต้องเปิดดูมากกว่าหนึ่งชีตถึงจะเข้าใจปัญหา
เช่น `cross.shipmentMismatch` ต้องเทียบชีต "ขนย้ายออกจากฟาร์ม" กับ "รับดอกถึงกรุงเทพ"
จึงแนบลิงก์ทั้งสองฝั่งพร้อม tab ของวันนั้นมาให้ครบ

- `critical` — ตัวเลขขัดแย้งกันจนตัดสินใจผิดได้
- `warning` — ผิดหลักการแต่เดาเจตนาได้
- `info` — น่าสงสัยแต่อาจถูก

finding **ไม่บล็อกการแสดงผล** ข้อมูลยังขึ้นตามปกติ แต่ติดธงกำกับไว้

---

## 3. ทีม Agent

| Agent | หน้าที่ | ไฟล์ที่เป็นเจ้าของ |
|---|---|---|
| `data-analyst` | อ่าน แปลง และวิเคราะห์ความถูกต้องของข้อมูล | `server/lib/parsers/*`, `analysis.js`, `aggregate.js`, `normalize.js`, `tests/` |
| `ux-ui-designer` | ออกแบบ UX/UI, Glassmorphism, responsive, กราฟ, Three.js | `public/css/**`, `public/js/ui/**`, `public/js/charts/**`, `public/js/bg/**`, `index.html` |
| `backend-dev` | โครงสร้างเว็บ, API, cache, ความเสถียร | `server/server.js`, `server/lib/{csv,fetcher,cache}.js`, `scripts/sync-sources.js` |

นิยามอยู่ใน `.claude/agents/` เรียกใช้ผ่าน Task tool หรือพิมพ์ชื่อ agent

**การทำงานร่วมกัน:** `data-analyst` กำหนดว่าตัวเลขไหนเชื่อถือได้และแปลว่าอะไร →
`ux-ui-designer` กำหนดว่ามันหน้าตาอย่างไร → `backend-dev` กำหนดว่ามันเดินทางถึงเบราว์เซอร์อย่างไร
ห้าม agent หนึ่งแก้ไฟล์ของอีก agent โดยไม่แจ้ง

---

## 4. คำสั่ง

```bash
node scripts/sync-sources.js    # sync ลิงก์จาก .txt → config/sources.json
node server/server.js           # เปิดเซิร์ฟเวอร์ → http://localhost:5173
node --test tests/              # รัน smoke test ตรวจ parser

# จัดการผู้ใช้ที่เข้า Dashboard ได้
node scripts/manage-users.js add <ชื่อผู้ใช้> --role exec   # ใช้ผู้ช่วย AI ได้
node scripts/manage-users.js add <ชื่อผู้ใช้> --role viewer # ดูรายงานอย่างเดียว
node scripts/manage-users.js list
node scripts/manage-users.js passwd <ชื่อผู้ใช้>
node scripts/manage-users.js remove <ชื่อผู้ใช้>
```

ไม่มี build step ไม่มี npm install ไม่มี dependency

### ตัวแปรสภาพแวดล้อม

อ่านจากไฟล์ `.env` ที่โฟลเดอร์โปรเจกต์ (gitignore แล้ว) หรือตั้งใน shell ก็ได้
ค่าที่ตั้งใน shell ชนะค่าในไฟล์เสมอ — ดูตัวอย่างที่ `.env.example`

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `GOOGLE_API_KEY` | — | คีย์ Google AI Studio สำหรับผู้ช่วย AI (ไม่ตั้ง = ปิดแชท) |
| `PORT` | `5173` | พอร์ต |
| `HOST` | `127.0.0.1` | ตั้งเป็น `0.0.0.0` เพื่อเปิดให้เครื่องอื่นเข้า |
| `SESSION_HOURS` | `12` | อายุ session หลังล็อกอิน |
| `CHAT_QUOTA_PER_DAY` | `50` | โควตาคำถามผู้ช่วย AI ต่อคนต่อวัน |
| `TRUST_PROXY` | `0` | ตั้ง `1` **เฉพาะเมื่อมี** nginx/Caddy คั่นหน้าจริง ๆ |
| `ALLOW_NO_AUTH` | — | ตั้ง `1` เพื่อยอมเปิดสู่เครือข่ายทั้งที่ไม่มีล็อกอิน (ไม่แนะนำ) |

---

## 5. โครงสร้างโปรเจกต์

```
kambis/
├── CLAUDE.md
├── แบบฟอร์มรายงาน Kambis.txt      ← แหล่งความจริงของลิงก์ (คนแก้เท่านั้น)
├── .claude/agents/               ← นิยาม agent 3 ตัว
├── config/sources.json           ← GENERATED — ห้ามแก้มือ
├── config/users.json             ← ผู้ใช้ + hash รหัสผ่าน (gitignored, ห้าม commit)
├── .env                          ← API key (gitignored, ห้าม commit)
├── .env.example                  ← แม่แบบของ .env (commit ได้ ไม่มีค่าจริง)
├── scripts/
│   ├── sync-sources.js
│   └── manage-users.js           ← เพิ่ม/ลบ/เปลี่ยนรหัสผู้ใช้
├── server/
│   ├── server.js
│   └── lib/
│       ├── csv.js  fetcher.js  cache.js  normalize.js  env.js
│       ├── tabs.js               ← ค้นรายชื่อแท็บของ Google Sheet
│       ├── auth.js               ← ล็อกอิน / session / จำกัดการเดารหัส
│       ├── gemini.js             ← เรียก Google AI Studio
│       ├── chat-context.js       ← ย่อข้อมูลเป็นบริบทให้ผู้ช่วย AI
│       ├── parsers/{dailyTrim,perCrop,outbound,inbound,sales,inventory}.js
│       ├── analysis.js           ← Data Analysis engine
│       └── aggregate.js          ← KPI ผู้บริหาร
├── public/
│   ├── index.html  login.html
│   ├── assets/  vendor/  css/  js/{ui,charts,bg}
└── data/cache/                   ← gitignored
```

---

## 6. แหล่งข้อมูล 6 รายงาน

| key | รายงาน | tabs | ลักษณะข้อมูล |
|---|---|---|---|
| `dailyTrim` | แบบฟอร์มน้ำหนักดอกทริมรายวัน | ~22 (ครอปละ tab) | วันที่ × สายพันธุ์ × ขนาด + ของไม่ใช่ดอก, มีแถว Total |
| `perCrop` | แบบฟอร์มน้ำหนักดอกทริมต่อครอป | ~34 (+ `SUMMARY SHEET`) | ไตรมาส → ครอป → รอบปลูก (Clone/Veg/Flower/Harvest/Dry) + ผลผลิต + จำนวนต้น + g/ต้น |
| `outbound` | ขนย้ายออกจากฟาร์ม | ~28 (ตามวันขน) | ครอป × สายพันธุ์ × ขนาด (กรัม) |
| `inbound` | รับดอกถึงกรุงเทพ | ~22 (ตามวันรับ) | โครงเดียวกับ outbound |
| `sales` | แบบฟอร์มขายดอก | 5 (Feb-March…July) | วันที่ × ลูกค้า × ครอป × สายพันธุ์ × ขนาด |
| `inventory` | สินค้าคงเหลือ | 2 (`Stock หัวหิน`, `Stock กรุงเทพ`) | สายพันธุ์ × ขนาด ณ วันที่อัปเดต |

### รูปแบบ record มาตรฐาน (ทุก parser คืนหน้าตานี้)

```js
{
  date, crop, strain,
  sizes:     { XXL, XL, L, M, S, XS },
  nonFlower: { shake, shake2, sugarleaf, kief, dokPan, dokRon, sesDok },
  flowerTotal, nonFlowerTotal,          // คำนวณใหม่จาก sizes เสมอ
  source, tab, rowIndex,
  raw: { statedFlowerTotal, statedPct } // ค่าที่ชีตบอก เก็บไว้เทียบ
}
```

---

## 7. ข้อบกพร่องที่รู้แล้วในข้อมูลต้นทาง

ทั้งหมดนี้เป็นปัญหาใน **ชีตต้นทาง** ไม่ใช่บั๊กของ Dashboard — engine ต้องจับได้ทุกข้อ
ห้ามแก้ให้ตัวเลขดูดีขึ้น ให้รายงานตามจริง

1. `dailyTrim` คอลัมน์ % เพี้ยน — Shake % = 412.12 / 461.11 / 496.21, Sugarleaf = 1,320.00 ในช่อง %
2. `outbound` แถว Total เอา % มาบวกกัน → 203.84% / 103.10% / 193.06%
3. `perCrop` ครอป `G4/14FEB25`: Total = 77,405 แต่ ยอดน้ำหนักรวม = 67,405 (ต่างกัน 10,000 g)
4. `inbound` header เขียน `(Kg)` แต่ค่าจริงเป็นกรัม; tab ชื่อ `21/07/26` แต่ในชีตเขียน `21/06/26`
5. `inbound` มีคอลัมน์ `*XS*` ซ้ำกับ `XS`
6. `sales` หลายแถวมีน้ำหนักแต่ `Total Flower` ว่าง (เช่นแถว 02/03/2026)
7. `perCrop` ครอป `G1/3 - 17JUL26` วันที่ Veg = `7 Aug 28` (พิมพ์ผิด ควรเป็น 26)
8. เซลล์ merge หายเป็นค่าว่าง — `sales` มีวันที่/ลูกค้าเฉพาะแถวแรกของกลุ่ม,
   `Stock กรุงเทพ` หัวคอลัมน์ S/XS/Shake/Sugarleaf หาย → ต้อง forward-fill และ map ตามตำแหน่ง
   เทียบกับ header มาตรฐานของ `Stock หัวหิน`

---

## 8. API

| Route | คืนอะไร |
|---|---|
| `GET /api/reports` | `{ meta, sources, kpi, analysis }` (memory cache 5 นาที) |
| `GET /api/reports?refresh=1` | บังคับดึงใหม่ + วิเคราะห์ใหม่ |
| `GET /api/reports/:key` | รายงานเดียวแบบละเอียด |
| `GET /api/analysis` | ผลวิเคราะห์อย่างเดียว |
| `GET /api/progress` | SSE ความคืบหน้าการโหลด (ขับ loading screen) |
| `GET /api/health` | uptime, อายุ cache, คะแนนคุณภาพข้อมูล |
| `GET /api/auth/status` | เปิดระบบล็อกอินไหม + ใครล็อกอินอยู่ (เข้าได้โดยไม่ต้องล็อกอิน) |
| `POST /api/auth/login` | `{username, password}` → ตั้งคุกกี้ session |
| `POST /api/auth/logout` | ล้างคุกกี้ |
| `GET /api/auth/me` | ข้อมูลผู้ใช้ปัจจุบัน + โควตาแชทที่เหลือ |
| `GET /api/chat/models` | รายชื่อโมเดล Gemini ที่เลือกได้ + `canChat` |
| `POST /api/chat` | ถามผู้ช่วย AI |
| `GET /api/usage` | สถิติ token สะสมตั้งแต่เปิดเซิร์ฟเวอร์ |

`meta.sources[].status` = `ok` | `stale` (ใช้ cache เพราะดึงไม่ได้) | `error`
แหล่งข้อมูลพังหนึ่งอันต้องไม่ทำให้ทั้ง response พัง

`meta.tabChanges[]` = แท็บที่เพิ่ม/ลบ/เปลี่ยนชื่อในรอบนี้ (front-end เอาไปขึ้นแถบแจ้งเตือน)

**HTTP method:** รับ `POST` เฉพาะ `/api/chat`, `/api/auth/login`, `/api/auth/logout`
ที่เหลือเป็น `GET`/`HEAD` อย่างเดียว

---

## 8.5 ระบบล็อกอิน

> ออกแบบมาเพื่อให้เอาขึ้นเซิร์ฟเวอร์แล้วเปิดให้ผู้บริหารเข้าผ่าน domain ได้

**เปิดใช้งานเมื่อมีไฟล์ `config/users.json` ที่มีผู้ใช้อย่างน้อย 1 คน**
ถ้าไม่มีไฟล์ = ไม่มีล็อกอิน (โหมดรันบนเครื่องตัวเอง)

### ด่านตรวจ

`server.js` กั้น **ก่อน** ทุก route โดยตั้งใจ — endpoint ใหม่ที่เพิ่มทีหลังจะถูกกั้นอัตโนมัติ
ทางที่เปิดไว้มีเฉพาะหน้า login กับไฟล์ที่หน้านั้นต้องใช้ (`OPEN_PATHS` / `OPEN_PREFIXES` ใน `server.js`)

- ยังไม่ล็อกอิน + ขอหน้าเว็บ → `302` ไป `/login.html?next=…`
- ยังไม่ล็อกอิน + ขอ API → `401 {code:"AUTH_REQUIRED"}` (front-end พาไปหน้า login ให้)

### กลไก

| เรื่อง | วิธีทำ |
|---|---|
| รหัสผ่าน | `scrypt` + salt เฉพาะคน เก็บแต่ hash ไม่เคยเก็บรหัสจริง |
| session | คุกกี้เซ็นด้วย HMAC-SHA256 → รีสตาร์ทแล้วยังล็อกอินอยู่ |
| คุกกี้ | `HttpOnly` + `SameSite=Lax` + `Secure` เมื่อมาแบบ https |
| เดารหัส | ผิด 5 ครั้ง (ต่อ IP+ชื่อผู้ใช้) → ล็อก 15 นาที |
| ชื่อผู้ใช้ไม่มีจริง | ยังคำนวณ scrypt หลอกหนึ่งรอบ กันจับเวลาเดาว่าชื่อไหนมีอยู่ |
| ลบผู้ใช้ | session ที่ค้างอยู่ใช้ไม่ได้ทันที (ตรวจกับรายชื่อจริงทุกครั้ง) |
| เพิ่ม/ลบผู้ใช้ | มีผลภายใน 5 วินาที ไม่ต้องรีสตาร์ท (`refreshAuthIfChanged`) |

### role

| role | ดูรายงาน | ใช้ผู้ช่วย AI |
|---|---|---|
| `exec` | ได้ | ได้ (จำกัดโควตาต่อวัน) |
| `viewer` | ได้ | **ไม่ได้** — ทุกคำถามมีค่าใช้จ่ายจริง |

### กันพลาดตอน deploy

เซิร์ฟเวอร์ **ปฏิเสธที่จะเปิด** ถ้า `HOST` ไม่ใช่ localhost แต่ยังไม่มีผู้ใช้เลย
เพราะนั่นคือการเปิดยอดขาย ต้นทุน และรายชื่อลูกค้าให้ทั้งเครือข่ายโดยไม่มีอะไรกั้น
(ข้ามได้ด้วย `ALLOW_NO_AUTH=1` แต่ไม่ควรทำ)

**ยังไม่ได้ทำในโปรเจกต์นี้ ต้องเสริมตอน deploy จริง:** HTTPS (ใช้ reverse proxy เช่น Caddy),
ตัวคุมให้รันต่อเนื่อง (systemd/pm2), และการสำรอง `config/users.json`

---

## 9. ธีมและข้อจำกัด Front-end

palette: <https://colorhunt.co/palette/fbf5dde7e1b1306d290d530e>

| Token | Hex | ใช้ทำอะไร |
|---|---|---|
| `--paper` | `#FBF5DD` | ครีมสว่าง — พื้นหลังโหมดสว่าง / ตัวอักษรโหมดมืด |
| `--khaki` | `#E7E1B1` | ครีมเข้ม — สีเน้นในโหมดมืด |
| `--leaf` | `#306D29` | เขียว — สีแบรนด์ |
| `--forest` | `#0D530E` | เขียวเข้ม — สีเน้นในโหมดสว่าง / พื้นหลังโหมดมืด |

### โหมดสว่าง/มืด

Dashboard รองรับทั้งสองโหมด สลับด้วยปุ่มบน header

- ค่าเริ่มต้นเดินตาม `prefers-color-scheme` ของระบบ
- เมื่อผู้ใช้กดเลือกเอง ค่าจะถูกจำไว้ใน `localStorage` (`kambis.theme`) และชนะค่าจากระบบ
- `<html data-theme="light|dark">` ถูกตั้งใน `<head>` ก่อน paint เพื่อไม่ให้จอกระพริบตอนโหลด
- ตรรกะทั้งหมดอยู่ใน `public/js/theme.js` ค่าสีทั้งหมดอยู่ใน `public/css/tokens.css`

**กฎการเขียนสี:** ห้ามฮาร์ดโค้ดค่าสีใน CSS หรือ JS นอก `tokens.css` เด็ดขาด
ทุกที่ต้องอ้างผ่าน custom property ไม่งั้นโหมดใดโหมดหนึ่งจะพัง
ลำดับของกฎใน `tokens.css` มีความหมาย (`:root` → media query → `[data-theme]`) ห้ามสลับ

### สีของกราฟ

สีของกราฟ **ไม่ใช่** สี UI — เป็นชุดที่ derive มาแล้วและผ่านการตรวจ 6 ข้อ
(lightness band, chroma, CVD separation, normal-vision floor, contrast) แยกกันทั้งสองโหมด

| บทบาท | โหมดสว่าง | โหมดมืด |
|---|---|---|
| `--series-1` (ดอก) | `#93801A` | `#A89526` |
| `--series-2` (ไม่ใช่ดอก) | `#04724F` | `#2C8D64` |
| `--size-xxl` … `--size-xs` | ไล่เฉด 6 ขั้น lightness ลดต่อเนื่อง | ไล่เฉด 6 ขั้น |
| พื้นวางกราฟ `--chart-well` | `#FFFDF4` | `#0A2E0A` |

ถ้าจะเปลี่ยนสีกราฟ ต้องรัน validator ใหม่ทั้งสองโหมดก่อนเสมอ (ดู skill `dataviz`)
กราฟวาดลงบน canvas จึงไม่เปลี่ยนสีตาม CSS เอง — `main.js` วาดใหม่ทั้งหมดเมื่อสลับธีม

### ข้อจำกัดอื่น

- **Vanilla JS เท่านั้น** ห้าม framework ใด ๆ ยกเว้น Three.js (vendor ไว้ใน `public/vendor/`)
- **Zero npm dependencies** ทั้งฝั่ง server และ client
- Glassmorphism ลึกได้ 3 ชั้น: พื้นหลัง Three.js → การ์ด → modal
- Responsive 375 → 1920 ห้ามมี horizontal scroll ระดับหน้า
- เคารพ `prefers-reduced-motion: reduce` — ปิด Three.js ใช้ gradient นิ่ง
- ภาษา: ไทยเป็นค่าเริ่มต้น สลับ EN ได้ ทุกข้อความ chrome ต้องมีคีย์ครบสองภาษาใน `public/js/i18n.js`

---

## 10. การแสดง finding

ทุก finding บนการ์ด "คุณภาพข้อมูล" ต้องบอกให้ครบว่าปัญหาอยู่ตรงไหนของต้นทาง:

> 📄 **ชื่อไฟล์ Google Sheet › ชื่อ tab** (กดแล้วเปิดตรงไปที่ tab นั้น) · แถวที่ · ช่อง

- ชื่อไฟล์มาจาก `meta.sources[].titleTh/titleEn`, ลิงก์จาก `meta.sources[].sheetUrl`
  ทั้งคู่สืบมาจาก `config/sources.json` → `แบบฟอร์มรายงาน Kambis.txt`
- ลิงก์ต้องพาไปที่ tab โดยตรง: `{sheetUrl}?gid={gid}#gid={gid}`
  (Google Sheets ต้องมี gid ทั้งใน query และ fragment ถึงจะเด้งไป tab นั้นจริง)
- **finding ที่เกิดจากการเทียบข้ามรายงาน ต้องแนบลิงก์ครบทุกชีตที่เกี่ยวข้อง**
  ผู้ใช้ต้องเปิดดูทั้งสองฝั่งถึงจะตัดสินได้ว่าฝั่งไหนผิด — ให้ลิงก์เดียวไม่พอ

ห้ามแสดง finding โดยไม่บอกไฟล์ต้นทาง เพราะผู้ใช้จะตามไปแก้ไม่ได้


---

## 11. Chatbot วิเคราะห์ข้อมูล

ช่องแชทมุมขวาล่างให้ถามคำถามเกี่ยวกับข้อมูลใน Dashboard โดยเรียก **Gemini ผ่าน Google AI Studio**

### ส่วนไหนใช้ AI และส่วนไหนไม่ใช้

| ส่วน | ใช้ AI ไหม |
|---|---|
| ดึงข้อมูลจาก Google Sheets / กดรีเฟรช | **ไม่ใช้** — CSV parsing ด้วย JavaScript ล้วน ใช้ 0 token |
| ค้นหาแท็บใหม่ | **ไม่ใช้** — อ่าน HTML ของหน้า htmlview ด้วย regex |
| Data Analysis ตรวจความถูกต้อง | **ไม่ใช้** — เป็นกฎที่เขียนไว้ใน `analysis.js` |
| Chatbot ตอบคำถาม | **ใช้** — เรียก Gemini ทุกครั้งที่ถาม |

**อย่าทำช่องแสดง token ของการรีเฟรช** เพราะจะขึ้น 0 ตลอดและทำให้เข้าใจผิด
ตัวเลข usage ที่แสดงบน UI เป็นของ Chatbot เท่านั้น

### สถาปัตยกรรม

```
เบราว์เซอร์ ──POST /api/chat──▶ server/server.js
                                      │  ตรวจ role + โควตา แล้วประกอบ system
                                      ▼
                            server/lib/chat-context.js   สรุป payload เป็นข้อความ
                                      ▼
                            server/lib/gemini.js         เรียก generativelanguage.googleapis.com
```

- **API key อยู่ฝั่ง server เท่านั้น** อ่านจาก `GOOGLE_API_KEY` (หรือ `GEMINI_API_KEY`)
  ห้ามส่ง key ไปฝั่งเบราว์เซอร์เด็ดขาด ใครเปิดหน้าเว็บก็อ่านได้
- ไม่ใช้ SDK ของ Google เพราะโปรเจกต์ตั้งกฎ zero dependencies ไว้
  เรียก REST ตรงด้วย `node:https` แลกกับที่ต้องจัดการ retry/timeout เอง

### โมเดล

ตารางอยู่ที่ `server/lib/gemini.js` → `MODELS` ทุกตัว**ทดสอบกับ key จริงแล้วว่าเรียกได้**

| id | ลักษณะ |
|---|---|
| `gemini-3.5-flash-lite` | เร็วที่สุด ~1 วิ ไม่มีขั้นตอนคิด |
| `gemini-3.5-flash` | ค่าเริ่มต้น สมดุลความเร็วกับความละเอียด |
| `gemini-3.6-flash` | ละเอียดที่สุด เหมาะกับคำถามที่ต้องเทียบหลายตัวเลข |

**ไม่ใส่รุ่น Pro ในรายการ** เพราะบัญชี AI Studio ระดับฟรีไม่ได้รับโควตา Pro
เรียกแล้วได้ `429` ทันที (ถ้าอัปเกรดบัญชีเป็นแบบเสียเงินแล้วค่อยเพิ่มเข้าไป)

### สองข้อควรระวังของ Gemini ที่โค้ดนี้จัดการไว้แล้ว

1. **`maxOutputTokens` นับรวม token ที่ใช้คิดด้วย** ตั้งต่ำเกินไปจะได้ข้อความว่างกลับมา
   (คำถามเลขง่าย ๆ ใช้ token คิดไปเกือบพัน) จึงตั้งไว้ 8192 และถ้าเจอ
   `finishReason: MAX_TOKENS` พร้อมข้อความว่าง จะโยน error ที่อ่านรู้เรื่องแทนการส่งค่าว่าง
2. **ฝั่งผู้ช่วยเรียกว่า `model` ไม่ใช่ `assistant`** ต้องแปลง role ก่อนส่ง

### บริบทที่ส่งให้โมเดล

`buildDataContext()` สรุป payload เป็นข้อความประมาณ 8 พันตัวอักษร — ไม่ส่งข้อมูลดิบ
ทั้งก้อน (449KB) เพราะแพงและช้า ในบริบทมี KPI, ยอดรวมทุกรายงาน, สัดส่วนตามขนาด,
การจัดอันดับตามมิติต่าง ๆ, รอบปลูก, ผลเทียบยอดขนออก↔รับเข้า, finding ที่ร้ายแรง
และรายชื่อค่าที่มีจริง (สายพันธุ์/ลูกค้า/คลัง/ครอป)

### กฎของ Chatbot (อยู่ใน `SYSTEM_PROMPT`)

ตอบจากบริบทที่ให้เท่านั้น ห้ามเดาตัวเลข · อ้างหน่วยและชื่อรายงานกำกับเสมอ ·
เตือนเมื่อตัวเลขนั้นมีปัญหาคุณภาพ · `—` คือไม่มีข้อมูล ไม่ใช่ 0 ·
ถามเจาะจงคลัง/เดือน/ครอปไหน ต้องตอบของสิ่งนั้น ห้ามเอายอดรวมมาตอบแทน ·
"ขายดี" ดูจากรายงานการขาย ไม่ใช่รายงานสต็อก

### การนับ usage และโควตา

- `usageStats` ใน `server.js` นับ token สะสมตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน แยกรายโมเดล
  เก็บในหน่วยความจำอย่างเดียว รีสตาร์ทแล้วเริ่มนับใหม่ ดูที่ `GET /api/usage`
- **ไม่แปลง token เป็นเงิน** เพราะราคาขึ้นกับว่าบัญชี AI Studio เป็นระดับฟรีหรือแบบเสียเงิน
  ซึ่งเซิร์ฟเวอร์ไม่มีทางรู้เอง การเดาราคาแล้วแสดงเป็นตัวเลขจะทำให้เข้าใจผิด
- โควตารายวันแยกตามผู้ใช้ (`chatQuotaPerDay`) นับหลังเรียกสำเร็จเท่านั้น —
  API ล่มไม่ควรตัดสิทธิ์ผู้ใช้ รีเซ็ตตามวันแบบ UTC
