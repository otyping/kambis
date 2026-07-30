/**
 * parsers/index.js — ทะเบียนตัวแปลงข้อมูล
 * key ตรงกับฟิลด์ `parser` ใน config/sources.json
 */
import { parse as dailyTrim } from './dailyTrim.js';
import { parse as perCrop } from './perCrop.js';
import { parse as transfer } from './transfer.js';
import { parse as sales } from './sales.js';
import { parse as inventory } from './inventory.js';

export const PARSERS = {
  dailyTrim,
  perCrop,
  sales,
  inventory,
  // ขนย้ายออกจากฟาร์ม และ รับดอกถึงกรุงเทพ ใช้ฟอร์มเดียวกัน
  outbound: (args) => transfer({ ...args, sourceKey: args.sourceKey || 'outbound' }),
  inbound: (args) => transfer({ ...args, sourceKey: args.sourceKey || 'inbound' }),
};

export function getParser(name) {
  const fn = PARSERS[name];
  if (!fn) throw new Error(`ไม่รู้จัก parser "${name}"`);
  return fn;
}
