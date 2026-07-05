import { sql } from './_lib/db.js';
import { verifyPassword, signToken } from './_lib/auth.js';
import { levelFromXp } from './_lib/gamification.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'กรอกชื่อผู้ใช้และรหัสผ่าน' });

  const rows = await sql`
    SELECT id, username, display_name, password_hash, role, xp, streak_days,
           voice_low_midi, voice_high_midi
    FROM users
    WHERE username = ${String(username).toLowerCase().trim()} AND is_active
  `;
  const user = rows[0];
  const ok = user && await verifyPassword(String(password), user.password_hash);
  if (!ok) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });

  const token = await signToken(user);
  const { password_hash, ...pub } = user;
  res.json({ token, user: { ...pub, level: levelFromXp(user.xp) } });
}
