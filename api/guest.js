import { randomBytes } from 'node:crypto';
import { sql } from './_lib/db.js';
import { signToken } from './_lib/auth.js';
import { levelFromXp } from './_lib/gamification.js';

// สร้างบัญชีผู้เยี่ยมชม (ไม่มีรหัสผ่าน — เข้าผ่าน token ในเครื่องเท่านั้น)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const nickname = String(req.body?.nickname ?? '').trim();
  if (!nickname || nickname.length > 20)
    return res.status(400).json({ error: 'ตั้งชื่อเล่น 1-20 ตัวอักษร' });

  const username = 'guest_' + randomBytes(4).toString('hex');
  // hash สุ่มที่ login ด้วยรหัสผ่านไม่ได้ (ไม่ใช่ bcrypt format — verify ล้มเหลวเสมอ)
  const unusable = '!guest!' + randomBytes(16).toString('hex');

  const [user] = await sql`
    INSERT INTO users (username, display_name, password_hash, role, is_guest)
    VALUES (${username}, ${nickname}, ${unusable}, 'student', true)
    RETURNING id, username, display_name, role, xp, streak_days, voice_low_midi, voice_high_midi
  `;

  const token = await signToken(user, '180d');
  res.status(201).json({ token, user: { ...user, level: levelFromXp(user.xp) } });
}
