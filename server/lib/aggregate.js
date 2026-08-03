/**
 * aggregate.js — จุดเข้าถึง KPI ฝั่ง server
 *
 * ตัวสูตรจริงย้ายไปอยู่ที่ public/js/shared/kpi.js เพราะเบราว์เซอร์ต้องเรียก
 * ฟังก์ชันตัวเดียวกันนี้ตอนคำนวณใหม่จากข้อมูลที่ผ่านแถบตัวกรองกลางแล้ว
 * (เบราว์เซอร์โหลดไฟล์นอก public/ ไม่ได้ ส่วน server import จากพาธบนดิสก์ได้ตามปกติ)
 *
 * ไฟล์นี้คงไว้เพื่อให้โค้ดและเทสต์เดิมที่ import จาก './aggregate.js' ยังใช้ได้เหมือนเดิม
 */
export { buildKpi } from '../../public/js/shared/kpi.js';
export {
  sizeMix,
  nonFlowerMix,
  groupSum,
  monthlySeries,
  dailySeries,
  yearlySeries,
} from '../../public/js/shared/agg-core.js';
