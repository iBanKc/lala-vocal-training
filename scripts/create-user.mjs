// สร้างบัญชีผู้ใช้ (ครูคนแรก / นักเรียนทดสอบ) จากเครื่อง dev
// ใช้: node scripts/create-user.mjs <role> <username> <password> [display_name]
// อ่าน DATABASE_URL จาก .env.local (สร้างด้วย `vercel env pull .env.local`)

import { readFileSync } from 'node:fs';
import net from 'node:net';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

// เครือข่ายไทย → us-east-1 มี RTT ~300ms ซึ่งเกิน Happy-Eyeballs timeout เริ่มต้น (250ms)
net.setDefaultAutoSelectFamilyAttemptTimeout?.(3000);

function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* ไม่มีไฟล์ก็ใช้ env ปกติ */ }
}

loadEnvLocal();
const [role, username, password, displayName] = process.argv.slice(2);

if (!['teacher', 'student'].includes(role) || !username || !password) {
  console.error('ใช้: node scripts/create-user.mjs <teacher|student> <username> <password> [display_name]');
  process.exit(1);
}
if (password.length < 6) {
  console.error('รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร');
  process.exit(1);
}

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) {
  console.error('ไม่พบ DATABASE_URL — รัน `vercel env pull .env.local` ก่อน');
  process.exit(1);
}

const sql = neon(url);
const hash = await bcrypt.hash(password, 10);
const name = displayName || username;

const rows = await sql`
  INSERT INTO users (username, display_name, password_hash, role)
  VALUES (${username.toLowerCase().trim()}, ${name}, ${hash}, ${role})
  ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true
  RETURNING id, username, role
`;
console.log('✅ สร้าง/อัปเดตแล้ว:', rows[0]);
