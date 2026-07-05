import { sql } from '../_lib/db.js';
import { requireTeacher, hashPassword } from '../_lib/auth.js';
import { levelFromXp } from '../_lib/gamification.js';

export default async function handler(req, res) {
  const auth = await requireTeacher(req, res);
  if (!auth) return;

  // ── GET: ภาพรวมห้องเรียน + กิจกรรมล่าสุด ──────────────
  if (req.method === 'GET') {
    const [students, activity] = await Promise.all([
      sql`
        SELECT u.id, u.username, u.display_name, u.xp, u.streak_days, u.is_active,
               u.voice_low_midi, u.voice_high_midi, u.created_at,
               MAX(s.created_at) AS last_active,
               COUNT(s.id)::int AS sessions_total,
               COUNT(s.id) FILTER (WHERE s.created_at > now() - interval '7 days')::int AS sessions_7d,
               ROUND(AVG(s.accuracy_pct) FILTER (WHERE s.created_at > now() - interval '7 days')::numeric, 1) AS acc_7d,
               ROUND(AVG(s.avg_cents_off) FILTER (WHERE s.created_at > now() - interval '7 days')::numeric, 1) AS cents_7d
        FROM users u
        LEFT JOIN game_sessions s ON s.user_id = u.id
        WHERE u.role = 'student'
        GROUP BY u.id
        ORDER BY u.display_name
      `,
      sql`
        SELECT s.created_at, s.game_id, s.level, s.score, s.stars, u.display_name, u.id AS user_id
        FROM game_sessions s JOIN users u ON u.id = s.user_id
        ORDER BY s.created_at DESC LIMIT 50
      `,
    ]);
    return res.json({
      students: students.map(s => ({ ...s, level: levelFromXp(s.xp) })),
      activity,
    });
  }

  // ── POST: สร้างบัญชีนักเรียน ───────────────────────────
  if (req.method === 'POST') {
    const { username, display_name, password } = req.body || {};
    const uname = String(username || '').toLowerCase().trim();
    if (!/^[a-z0-9_.-]{3,20}$/.test(uname))
      return res.status(400).json({ error: 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, _ . - ยาว 3-20 ตัว' });
    if (!display_name || !String(display_name).trim())
      return res.status(400).json({ error: 'กรอกชื่อที่แสดง' });
    if (!password || String(password).length < 6)
      return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });

    const hash = await hashPassword(String(password));
    try {
      const [row] = await sql`
        INSERT INTO users (username, display_name, password_hash, role)
        VALUES (${uname}, ${String(display_name).trim()}, ${hash}, 'student')
        RETURNING id, username, display_name
      `;
      return res.status(201).json({ student: row });
    } catch (err) {
      if (String(err.message).includes('users_username_key'))
        return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
      throw err;
    }
  }

  // ── PATCH: รีเซ็ตรหัสผ่าน / เปิด-ปิดใช้งาน ─────────────
  if (req.method === 'PATCH') {
    const { id, action, password, active } = req.body || {};
    const sid = Number(id);
    if (!Number.isInteger(sid)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });

    const [target] = await sql`SELECT id, role FROM users WHERE id = ${sid}`;
    if (!target || target.role !== 'student')
      return res.status(404).json({ error: 'ไม่พบนักเรียนคนนี้' });

    if (action === 'reset_password') {
      if (!password || String(password).length < 6)
        return res.status(400).json({ error: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' });
      const hash = await hashPassword(String(password));
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${sid}`;
      return res.json({ ok: true });
    }
    if (action === 'set_active') {
      await sql`UPDATE users SET is_active = ${Boolean(active)} WHERE id = ${sid}`;
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'action ไม่ถูกต้อง' });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
