# Kambis Executive Report Dashboard
#
# ไม่มี dependency และไม่มี build step — image จึงเป็น single-stage
# ไม่มี `npm install` ให้รอ และไม่มี node_modules ให้ขนไปด้วย
FROM node:24-alpine

# ── เขตเวลา ─────────────────────────────────────────────────────────
# container ตั้งต้นเป็น UTC แต่ทั้งระบบตัดสินใจด้วย "เวลาท้องถิ่น":
#   · เลขที่ใบขอซื้อ PR-YYYYMMDD-NNN
#   · "แถวล่าสุดที่วันที่ <= วันนี้" ที่ใช้หายอดคงเหลือ (stockAt)
#   · จำนวนวันที่รอของ · การรีเซ็ตโควตาแชทรายวัน
# ถ้าเป็น UTC ใบที่ออกช่วงเที่ยงคืนถึง 7 โมงเช้าจะได้วันที่ของ "เมื่อวาน"
# และยอดสต็อกจะเลื่อนไปหนึ่งวันโดยไม่มีอะไรเตือน
#
# alpine ไม่มี tzdata ติดมา — ตั้ง TZ เฉย ๆ จะไม่มีผลและไม่มี error ให้เห็นด้วย
RUN apk add --no-cache tzdata
ENV TZ=Asia/Bangkok

ENV NODE_ENV=production
# ในคอนเทนเนอร์ต้องผูก 0.0.0.0 ไม่งั้น port mapping มองไม่เห็น
# ปลอดภัยเพราะพอร์ตถูก bind ไว้ที่ 127.0.0.1 ของโฮสต์ (docker-compose.yml)
# และเซิร์ฟเวอร์จะไม่ยอมสตาร์ทถ้ายังไม่มีบัญชีผู้ใช้
ENV HOST=0.0.0.0
ENV PORT=5173

WORKDIR /app

# ผู้ใช้ node (uid 1000) มีมากับ image อยู่แล้ว — ไม่รันเป็น root
# สองโฟลเดอร์นี้ถูก mount ทับด้วย volume ตอนรันจริง สร้างไว้ให้สิทธิ์ถูกตั้งแต่แรก
COPY --chown=node:node . .
RUN mkdir -p /app/data /app/config && chown -R node:node /app
USER node

EXPOSE 5173

# ยิง /api/health แล้ว **นับ 401 ว่าสุขภาพดีด้วย**
#
# endpoint นี้อยู่หลังด่านล็อกอิน (server.js กั้นก่อนทุก route โดยตั้งใจ) การยิงจาก
# ในคอนเทนเนอร์โดยไม่มีคุกกี้จึงได้ 401 เสมอ — ถ้าเช็คแค่ r.ok คอนเทนเนอร์จะถูก
# มาร์กเป็น unhealthy ตลอดกาลทั้งที่ทำงานปกติดี (เจอตอนรันจริง ไม่ใช่ตอนเขียน)
#
# 401 พิสูจน์ได้ครบว่าโปรเซสยังอยู่ · HTTP ตอบได้ · ด่านล็อกอินทำงาน
# ส่วนที่ไม่ครอบคือคุณภาพข้อมูล ซึ่งมี dataHealth ใน payload ให้ตัวเฝ้าระวัง
# ภายนอกอ่านอยู่แล้ว (ต้องล็อกอิน — ดู deploy/README.md)
#
# start-period ยาวเพราะรอบโหลดแรกดึง Google Sheets หลายร้อยแท็บ
HEALTHCHECK --interval=60s --timeout=10s --start-period=180s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/api/health').then(r=>process.exit(r.status===200||r.status===401?0:1)).catch(()=>process.exit(1))"

# เรียก node ตรง ๆ ไม่ผ่าน npm — ไม่งั้นจะมี process ซ้อนที่กิน SIGTERM แทน
# แล้ว docker stop จะต้องรอ timeout ทุกครั้งก่อนฆ่าทิ้ง
CMD ["node", "server/server.js"]
