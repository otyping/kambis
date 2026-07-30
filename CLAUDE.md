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
```

ไม่มี build step ไม่มี npm install ไม่มี dependency

---

## 5. โครงสร้างโปรเจกต์

```
kambis/
├── CLAUDE.md
├── แบบฟอร์มรายงาน Kambis.txt      ← แหล่งความจริงของลิงก์ (คนแก้เท่านั้น)
├── .claude/agents/               ← นิยาม agent 3 ตัว
├── config/sources.json           ← GENERATED — ห้ามแก้มือ
├── scripts/sync-sources.js
├── server/
│   ├── server.js
│   └── lib/
│       ├── csv.js  fetcher.js  cache.js  normalize.js
│       ├── parsers/{dailyTrim,perCrop,outbound,inbound,sales,inventory}.js
│       ├── analysis.js           ← Data Analysis engine
│       └── aggregate.js          ← KPI ผู้บริหาร
├── public/
│   ├── index.html
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

`meta.sources[].status` = `ok` | `stale` (ใช้ cache เพราะดึงไม่ได้) | `error`
แหล่งข้อมูลพังหนึ่งอันต้องไม่ทำให้ทั้ง response พัง

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

ช่องแชทมุมขวาล่างให้ถามคำถามเกี่ยวกับข้อมูลใน Dashboard โดยเรียก Claude API จริง

### สิ่งที่ใช้ Claude และสิ่งที่ไม่ใช้

| ส่วน | ใช้ Claude ไหม |
|---|---|
| ดึงข้อมูลจาก Google Sheets / กดรีเฟรช | **ไม่ใช้** — เป็น CSV parsing ด้วย JavaScript ล้วน ใช้ 0 token |
| Data Analysis ตรวจความถูกต้อง | **ไม่ใช้** — เป็นกฎที่เขียนไว้ใน `analysis.js` ไม่ใช่ AI |
| Chatbot ตอบคำถาม | **ใช้** — เรียก Messages API ทุกครั้งที่ถาม |

**อย่าทำช่องแสดง token ของการรีเฟรช** เพราะจะขึ้น 0 ตลอดและทำให้เข้าใจผิด
ตัวเลข usage ที่แสดงบน UI เป็นของ Chatbot เท่านั้น

### สถาปัตยกรรม

```
เบราว์เซอร์ ──POST /api/chat──▶ server/server.js
                                      │  ประกอบ system + บริบทข้อมูล
                                      ▼
                            server/lib/chat-context.js   สรุป payload เป็นข้อความ
                                      ▼
                            server/lib/claude.js         เรียก api.anthropic.com ด้วย node:https
```

- **API key อยู่ฝั่ง server เท่านั้น** อ่านจาก `ANTHROPIC_API_KEY`
  ห้ามส่ง key ไปฝั่งเบราว์เซอร์เด็ดขาด ใครเปิดหน้าเว็บก็อ่านได้
- ไม่ใช้ `@anthropic-ai/sdk` เพราะโปรเจกต์ตั้งกฎ zero dependencies ไว้
  เรียก REST ตรงด้วย `node:https` แลกกับที่ต้องจัดการ retry/timeout เอง
- `POST` เปิดเฉพาะ `/api/chat` เท่านั้น endpoint อื่นยังเป็น GET อย่างเดียว

### บริบทที่ส่งให้โมเดล

`buildDataContext()` สรุป payload เป็นข้อความประมาณ 4–6 พัน token — ไม่ส่งข้อมูลดิบ
ทั้งก้อน (449KB) เพราะแพงและช้า ในบริบทมี KPI, ยอดรวมทุกรายงาน, สัดส่วนตามขนาด,
การจัดอันดับตามมิติต่าง ๆ, รอบปลูก, ผลเทียบยอดขนออก↔รับเข้า, finding ที่ร้ายแรง
และรายชื่อค่าที่มีจริง (สายพันธุ์/ลูกค้า/คลัง/ครอป)

บล็อกท้ายของ `system` ติด `cache_control` ไว้ เทิร์นถัด ๆ ไปในบทสนทนาเดียวกัน
จึงจ่ายค่า input แค่ประมาณ 10% ของราคาปกติ

### กฎของ Chatbot (อยู่ใน `SYSTEM_PROMPT`)

ตอบจากบริบทที่ให้เท่านั้น ห้ามเดาตัวเลข · อ้างหน่วยและชื่อรายงานกำกับเสมอ ·
เตือนเมื่อตัวเลขนั้นมีปัญหาคุณภาพ · `—` คือไม่มีข้อมูล ไม่ใช่ 0

### โมเดลและราคา

ผู้ใช้เลือกเองจาก dropdown ราคาต่อล้าน token แสดงข้างชื่อโมเดล ตารางอยู่ใน
`server/lib/claude.js` → `MODELS` **ถ้าราคาเปลี่ยนต้องแก้ที่นั่นที่เดียว**
(Sonnet 5 อยู่ในช่วงราคาแนะนำตัวถึง 2026-08-31 หลังจากนั้นต้องอัปเดต)

Haiku 4.5 ไม่รองรับพารามิเตอร์ `effort` — ส่งไปจะได้ 400 กลับมา จึงมีธง
`supportsEffort` กำกับไว้ในตาราง

### การนับ usage

`usageStats` ใน `server.js` นับสะสมตั้งแต่เซิร์ฟเวอร์เริ่มทำงาน แยกรายโมเดล
เก็บในหน่วยความจำอย่างเดียว รีสตาร์ทแล้วเริ่มนับใหม่ ดูได้ที่ `GET /api/usage`
และบนหัวแผงแชท ค่าใช้จ่ายเป็นค่าประมาณจากตารางราคา ไม่ใช่ยอดเรียกเก็บจริง
