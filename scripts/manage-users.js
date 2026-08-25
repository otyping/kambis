#!/usr/bin/env node
/**
 * manage-users.js — จัดการผู้ใช้ที่เข้า Dashboard ได้
 *
 *   node scripts/manage-users.js add somchai --name "คุณสมชาย" --role exec
 *   node scripts/manage-users.js list
 *   node scripts/manage-users.js passwd somchai
 *   node scripts/manage-users.js remove somchai
 *
 * รหัสผ่านพิมพ์ตอนรัน จะไม่แสดงบนจอและไม่ถูกบันทึกใน shell history
 * ถ้าต้องตั้งแบบอัตโนมัติ (เช่นในสคริปต์ deploy) ส่งผ่าน env KAMBIS_PASSWORD ได้
 *
 * ข้อมูลเก็บที่ config/users.json ซึ่ง gitignore ไว้แล้ว — ห้าม commit
 */
import {
  sameUsername,
  upsertUser,
  removeUser,
  listUsers,
  loadAuth,
  USERS_FILE,
  DEFAULT_CHAT_QUOTA,
} from '../server/lib/auth.js';

/* ความยาวรหัสผ่านขั้นต่ำ
 *
 * ผู้ใช้กำหนดเป็น 6 (ส.ค. 69) หลังรับทราบข้อเสียแล้ว — เป็นตัวเลขล้วนก็ได้
 * รหัส 6 หลักตัวเลขล้วนมีความเป็นไปได้แค่ 1,000,000 แบบ ตัวกันที่เหลืออยู่คือ
 * การล็อก 15 นาทีหลังผิด 5 ครั้ง ซึ่งนับแยกตาม IP+ชื่อผู้ใช้ (auth.js)
 * คนที่เปลี่ยน IP ไปเรื่อย ๆ จึงยังไล่เดาได้ — ดู deploy/README.md */
const MIN_PASSWORD = 6;

// รหัสอักขระควบคุมที่ต้องจัดการตอนอ่านรหัสผ่านแบบไม่แสดงผล
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const NEWLINE = 10;
const RETURN = 13;
const DELETE = 127;

/** รับข้อความจากคีย์บอร์ดโดยไม่แสดงบนจอ */
function promptHidden(question) {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) {
    // ไม่ใช่ terminal (เช่นถูก pipe เข้ามา) — อ่านหนึ่งบรรทัดตามปกติ
    return new Promise((resolve) => {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => (data += c));
      stdin.on('end', () => resolve(data.split('\n')[0]));
    });
  }

  return new Promise((resolve) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buf = '';
    const finish = (value) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      resolve(value);
    };

    const onData = (chunk) => {
      // การวางข้อความจะส่งมาหลายตัวอักษรในครั้งเดียว ต้องวนทีละตัว
      for (const ch of chunk) {
        const code = ch.codePointAt(0);

        if (code === NEWLINE || code === RETURN || code === CTRL_D) return finish(buf);

        if (code === CTRL_C) {
          stdin.setRawMode(false);
          stdout.write('\n');
          process.exit(130);
        }

        if (code === BACKSPACE || code === DELETE) {
          if (buf.length) {
            buf = buf.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }

        // ข้ามอักขระควบคุมอื่น ๆ (ปุ่มลูกศรจะส่ง escape sequence มา)
        if (code < 32) continue;

        buf += ch;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * รับข้อความหนึ่งบรรทัดแบบ **เห็นตอนพิมพ์**
 *
 * ต่างจาก promptHidden ตรงที่ชื่อคนไม่ใช่ความลับ และต้องเห็นเพื่อตรวจตัวสะกดก่อนกด Enter
 * (ชื่อนี้ไปโผล่บนเอกสารที่ปริ้นให้ผู้บริหารเซ็น พิมพ์ผิดแล้วรู้ตัวตอนกระดาษออกมาแล้ว)
 *
 * ไม่ใช่ terminal (ถูก pipe เข้ามา / รันในสคริปต์ deploy) → คืนค่าว่างทันที
 * **ห้ามค้างรอ** ไม่งั้นสคริปต์ deploy จะแขวนอยู่เฉย ๆ โดยไม่มีใครเห็นคำถามบนจอ
 */
function promptLine(question) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return Promise.resolve('');

  return new Promise((resolve) => {
    stdout.write(question);
    stdin.setEncoding('utf8');
    stdin.resume();

    let buf = '';
    const onData = (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return; // ข้อความที่วางมาถูกส่งเป็นหลายก้อนได้ ต้องรอจนจบบรรทัด
      stdin.removeListener('data', onData);
      stdin.pause();
      resolve(buf.slice(0, nl).replace(/\r$/, '').trim());
    };

    stdin.on('data', onData);
  });
}

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

/** ขอรหัสผ่านพร้อมยืนยันซ้ำ */
async function askPassword() {
  const fromEnv = process.env.KAMBIS_PASSWORD;
  if (fromEnv) {
    if (fromEnv.length < MIN_PASSWORD) {
      fail(`รหัสผ่านใน KAMBIS_PASSWORD สั้นเกินไป ต้องอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`);
    }
    return fromEnv;
  }

  const first = await promptHidden('  รหัสผ่าน: ');
  if (first.length < MIN_PASSWORD) {
    fail(`รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัวอักษร (ใส่มา ${first.length})`);
  }
  const again = await promptHidden('  พิมพ์อีกครั้ง: ');
  if (first !== again) fail('รหัสผ่านสองครั้งไม่ตรงกัน');
  return first;
}

/** แยก --flag value ออกจากรายการ argument */
function parseFlags(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else rest.push(argv[i]);
  }
  return { flags, rest };
}

const USAGE = `
  จัดการผู้ใช้ Kambis Dashboard

    node scripts/manage-users.js add <ชื่อผู้ใช้> [--name "ชื่อจริง"] [--role exec|viewer] [--quota 50]
    node scripts/manage-users.js passwd <ชื่อผู้ใช้>
    node scripts/manage-users.js remove <ชื่อผู้ใช้>
    node scripts/manage-users.js list

  name:  ชื่อจริงที่จะขึ้นช่อง "ชื่อ" บน**ใบขอซื้อ** และบนหัว Dashboard
         ไม่ใส่มาจะถูกถามตอนรัน — ไม่ใช่ของที่ลืมได้เงียบ ๆ
  role:  exec = ใช้ chatbot ได้  |  viewer = ดูรายงานอย่างเดียว
  quota: จำนวนคำถาม chatbot ต่อวัน (ค่าเริ่มต้น ${DEFAULT_CHAT_QUOTA})
`;

async function main() {
  const { flags, rest } = parseFlags(process.argv.slice(2));
  const [command, username] = rest;

  if (!command || command === 'help' || flags.help !== undefined) {
    console.log(USAGE);
    return;
  }

  await loadAuth({ force: true });

  if (command === 'list') {
    const users = listUsers();
    if (!users.length) {
      console.log('\n  ยังไม่มีผู้ใช้ — ระบบล็อกอินยังไม่เปิดใช้งาน');
      console.log('  เพิ่มคนแรกด้วย: node scripts/manage-users.js add <ชื่อผู้ใช้> --role exec\n');
      return;
    }
    console.log(`\n  ผู้ใช้ ${users.length} คน (${USERS_FILE})\n`);
    console.log('    ชื่อผู้ใช้         role    โควตา chatbot   ชื่อบนใบขอซื้อ');
    for (const u of users) {
      const role = u.role === 'exec' ? 'exec  ' : 'viewer';
      console.log(
        `    ${u.username.padEnd(16)} ${role}  chatbot ${String(u.chatQuotaPerDay).padStart(3)}/วัน   ${u.name}`
      );
    }
    console.log();
    return;
  }

  if (!username) fail(`คำสั่ง "${command}" ต้องระบุชื่อผู้ใช้ด้วย`);

  if (command === 'remove') {
    const removed = await removeUser(username);
    if (!removed) fail(`ไม่พบผู้ใช้ "${username}"`);
    console.log(`\n  ✓ ลบผู้ใช้ "${username}" แล้ว — session ที่ค้างอยู่ของคนนี้ใช้ไม่ได้ทันที\n`);
    return;
  }

  if (command === 'add' || command === 'passwd') {
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      fail('ชื่อผู้ใช้ต้องเป็น a-z A-Z 0-9 . _ - ยาว 3–32 ตัว');
    }

    /* ไม่สนตัวพิมพ์ ให้ตรงกับที่ auth.js ใช้ตอนล็อกอิน — ไม่งั้น `add supakorn`
     * จะดูเหมือนสร้างคนใหม่ ทั้งที่ upsertUser จะไปทับ Supakorn ของเดิม */
    const existing = listUsers().find((u) => sameUsername(u.username, username));
    if (command === 'add' && existing) {
      console.log(`\n  ผู้ใช้ "${username}" มีอยู่แล้ว — จะตั้งรหัสผ่านใหม่ให้`);
    }
    if (command === 'passwd' && !existing) fail(`ไม่พบผู้ใช้ "${username}"`);

    console.log(`\n  ตั้งรหัสผ่านให้ "${username}"`);
    const password = await askPassword();

    /* ชื่อบนใบขอซื้อ — ถามถ้าไม่ได้ส่ง --name มาตอน add
     *
     * เดิมปล่อยผ่านแล้ว upsertUser จะ fallback เป็น username **เงียบ ๆ**
     * ใบขอซื้อจึงขึ้นว่า "supakorn" แทนชื่อคน โดยไม่มีอะไรบอกจนกว่าจะปริ้นออกมา
     * ตอน passwd ไม่ถาม เพราะตั้งใจแก้แค่รหัส (ส่ง --name มาเองยังแก้ชื่อได้) */
    let name = flags.name;
    if (command === 'add' && !name && !existing) {
      name = await promptLine('  ชื่อที่จะขึ้นบนใบขอซื้อ (เช่น "Supakorn Arunsirinaphalai"): ');
      if (!name) {
        console.log(`  ⚠  ไม่ได้ใส่ชื่อ — ใบขอซื้อจะขึ้นเป็น "${username}" แก้ทีหลังได้ด้วย --name`);
      }
    }

    const role = flags.role ?? existing?.role ?? 'viewer';
    if (role !== 'exec' && role !== 'viewer') fail('role ต้องเป็น exec หรือ viewer');

    const user = await upsertUser({
      username,
      password,
      name,
      role,
      chatQuotaPerDay: flags.quota ? Number(flags.quota) : undefined,
    });

    console.log(`\n  ✓ บันทึกแล้ว: ${user.username}`);
    console.log(`    ชื่อบนใบขอซื้อ: ${user.name}`);
    console.log(`    role=${user.role}  chatbot ${user.chatQuotaPerDay}/วัน`);
    console.log(`    ไฟล์: ${USERS_FILE}`);
    console.log('    เซิร์ฟเวอร์ที่รันอยู่จะรับผู้ใช้คนนี้เองภายใน 5 วินาที ไม่ต้องรีสตาร์ท');
    console.log('    (ยกเว้นกรณีที่เพิ่งสร้างผู้ใช้คนแรก — ต้องรีสตาร์ทหนึ่งครั้งเพื่อเปิดระบบล็อกอิน)\n');
    return;
  }

  fail(`ไม่รู้จักคำสั่ง "${command}"\n${USAGE}`);
}

main().catch((err) => {
  console.error('\n  ✗', err.message, '\n');
  process.exit(1);
});
