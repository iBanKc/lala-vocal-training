// รันไฟล์ SQL กับ Neon: node scripts/run-sql.mjs schema.sql
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

function loadEnvLocal() {
  try {
    for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* ไม่มีไฟล์ก็ใช้ env ปกติ */ }
}

loadEnvLocal();
const file = process.argv[2];
if (!file) { console.error('ใช้: node scripts/run-sql.mjs <file.sql>'); process.exit(1); }

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.error('ไม่พบ DATABASE_URL — รัน `vercel env pull .env.local` ก่อน'); process.exit(1); }

const sql = neon(url);
const text = readFileSync(file, 'utf8');
// แยกเป็น statement ต่อคำสั่ง (Neon HTTP driver รันได้ทีละคำสั่ง)
const statements = text.split(/;\s*\n/).map(s => s.trim()).filter(s => s && !s.startsWith('--'));
for (const st of statements) {
  await sql.query(st);
  console.log('✅', st.split('\n')[0].slice(0, 70));
}
console.log('เสร็จสิ้น');
