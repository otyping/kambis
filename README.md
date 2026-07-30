# Kambis Executive Report Dashboard

Dashboard สรุปรายงานผู้บริหารของ Kambis อ่านข้อมูลสดจาก Google Sheets 6 รายงาน (118 ชีตย่อย)
พร้อมตรวจสอบความถูกต้องของข้อมูลอัตโนมัติทุกครั้งที่อัปเดต

สร้างด้วย HTML / CSS / Vanilla JavaScript / Three.js และ Node.js server — **ไม่มี dependency ใด ๆ**

## เริ่มใช้งาน

```bash
node scripts/sync-sources.js    # อ่านลิงก์จาก "แบบฟอร์มรายงาน Kambis.txt" (ครั้งแรก / เมื่อลิงก์เปลี่ยน)
node server/server.js           # เปิด http://localhost:5173
```

ตรวจ parser และ engine วิเคราะห์ข้อมูล:

```bash
node --test tests/smoke.js
```

## กฎสำคัญ 2 ข้อ

1. **ลิงก์รายงานทุกอันอ่านจาก `แบบฟอร์มรายงาน Kambis.txt` เท่านั้น**
   ห้ามเขียน URL ของ Google Sheets ลงในโค้ด — ทุกอย่างผ่าน `config/sources.json` ที่ generate จากไฟล์ .txt
2. **ทุกครั้งที่อัปเดตข้อมูล ต้องรัน Data Analysis**
   `server/lib/analysis.js` ทำงานอัตโนมัติทุกครั้งที่ดึงข้อมูล ผลลัพธ์แนบไปกับ API และแสดงบน UI เสมอ

รายละเอียดทั้งหมดอยู่ใน [CLAUDE.md](CLAUDE.md)

## ทีม Agent

| Agent | หน้าที่ |
|---|---|
| [`data-analyst`](.claude/agents/data-analyst.md) | อ่าน แปลง และวิเคราะห์ความถูกต้องของข้อมูล |
| [`ux-ui-designer`](.claude/agents/ux-ui-designer.md) | ออกแบบ UX/UI, Glassmorphism, responsive, กราฟ, Three.js |
| [`backend-dev`](.claude/agents/backend-dev.md) | โครงสร้างเว็บ, API, cache, ความเสถียร |

## คุณสมบัติ

- การ์ดกระจก Glassmorphism 8 ใบ แยกตามส่วนของข้อมูลชัดเจน กดเพื่อดูรายละเอียดได้ทุกใบ
- ฉากหลัง Three.js (ละอองลอย + ดวงแสง) พร้อม fallback เป็น gradient เมื่อ WebGL ใช้ไม่ได้
- Loading Screen เดินตามความคืบหน้าจริงผ่าน SSE ทีละแหล่งข้อมูล จบด้วยขั้นวิเคราะห์ข้อมูล
- Responsive 375px → 1920px, สลับภาษา ไทย/อังกฤษ
- กราฟ Canvas 2D เขียนเอง: โดนัท, เส้น, แท่งแนวนอน, แท่งจับคู่, ไทม์ไลน์รอบปลูก
- ทำงานได้แม้ Google ล่ม โดยใช้แคชล่าสุดพร้อมติดธงแจ้งผู้ใช้
- **Chatbot วิเคราะห์ข้อมูล** ถามคำถามเกี่ยวกับตัวเลขใน Dashboard ได้ เลือกโมเดลเองได้ พร้อมแสดง token และค่าใช้จ่ายทุกคำตอบ

## Chatbot (ไม่บังคับ)

ช่องแชทมุมขวาล่างเรียก Claude API จริง จึงต้องมี API key จาก
[console.anthropic.com](https://console.anthropic.com) — **คนละอย่างกับบัญชี Claude Code**

```bash
ANTHROPIC_API_KEY=sk-ant-... node server/server.js
```

ไม่ตั้งค่าก็ใช้ Dashboard ได้ตามปกติ ช่องแชทจะแสดงวิธีตั้งค่าแทน
key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่ถูกส่งมาที่เบราว์เซอร์

เลือกโมเดลได้ 3 ตัว (Haiku 4.5 / Sonnet 5 / Opus 5) ราคาต่อล้าน token แสดงข้างชื่อ
และทุกคำตอบบอก token ที่ใช้กับค่าใช้จ่ายโดยประมาณกำกับไว้

> **หมายเหตุ:** การกดรีเฟรช Dashboard **ไม่ใช้ Claude เลย** — เป็นการอ่าน CSV
> แล้ว parse ด้วย JavaScript ล้วน ตัวเลข usage ที่แสดงเป็นของ Chatbot เท่านั้น

## ธีมสี

[colorhunt.co/palette/fbf5dde7e1b1306d290d530e](https://colorhunt.co/palette/fbf5dde7e1b1306d290d530e)

`#FBF5DD` · `#E7E1B1` · `#306D29` · `#0D530E`

รองรับทั้ง **โหมดสว่างและโหมดมืด** สลับด้วยปุ่มบน header
ค่าเริ่มต้นเดินตามการตั้งค่าของระบบ เมื่อผู้ใช้เลือกเองจะถูกจำไว้ใน `localStorage`

สีของกราฟเป็นชุดที่ derive จากธีมและผ่านการตรวจ contrast กับความต่างสำหรับตาบอดสี (CVD)
แยกกันทั้งสองโหมด — ดูรายละเอียดใน `public/css/tokens.css`
