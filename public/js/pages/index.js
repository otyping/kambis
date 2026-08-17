/**
 * pages/index.js — ทะเบียนหน้า
 * คีย์ตรงกับ `<report>/<page>` ของ router
 */
import * as overview from './overview.js';
import * as production from './production.js';
import * as stock from './stock.js';
import * as sales from './sales.js';
import * as cost from './cost.js';
import * as supply from './supply.js';

export const PAGES = {
  'dryflower/overview': overview,
  'dryflower/production': production,
  'dryflower/stock': stock,
  'dryflower/sales': sales,
  'dryflower/cost': cost,
  // Supply ใช้ไฟล์เดียววาดทั้งสามหน้า — แยกด้วย `route.page` ข้างใน เพราะทั้งสามหน้า
  // ใช้ payload · ตัวกรอง · ตัวช่วยชุดเดียวกันหมด ต่างแค่ว่าวาดแผงไหน
  'supply/order': supply,
  'supply/stock': supply,
  'supply/usage': supply,
};

export function getPage(report, page) {
  return PAGES[`${report}/${page}`] ?? PAGES['dryflower/overview'];
}
