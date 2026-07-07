// ค่าตั้งสาธารณะของแอป — ช่องทางติดต่อใน "เกี่ยวกับเรา"
// GET: ทุกคนอ่านได้ (ข้อมูลติดต่อเป็น public); PATCH: เฉพาะครู แก้จากหน้า admin
import { sql } from './_lib/db.js';
import { requireTeacher } from './_lib/auth.js';

const CONTACT_KEYS = ['contact_line', 'contact_facebook', 'contact_maps'];

function isValidUrl(v) {
  if (v === '') return true; // ค่าว่าง = ซ่อนช่องทางนั้น
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const rows = await sql`SELECT key, value FROM app_settings WHERE key = ANY(${CONTACT_KEYS})`;
    const out = Object.fromEntries(CONTACT_KEYS.map(k => [k, '']));
    for (const r of rows) out[r.key] = r.value;
    return res.status(200).json(out);
  }

  if (req.method === 'PATCH') {
    const auth = await requireTeacher(req, res);
    if (!auth) return;

    const body = req.body || {};
    const updates = [];
    for (const key of CONTACT_KEYS) {
      if (!(key in body)) continue;
      const value = String(body[key] ?? '').trim();
      if (value.length > 500 || !isValidUrl(value)) {
        return res.status(400).json({ error: `ลิงก์ ${key} ไม่ถูกต้อง — ต้องขึ้นต้นด้วย http(s) หรือเว้นว่าง` });
      }
      updates.push({ key, value });
    }
    if (!updates.length) return res.status(400).json({ error: 'ไม่มีข้อมูลให้บันทึก' });

    for (const { key, value } of updates) {
      await sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
                ON CONFLICT (key) DO UPDATE SET value = ${value}`;
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).json({ error: 'method not allowed' });
}
