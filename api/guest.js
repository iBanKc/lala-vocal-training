import { randomInt } from 'node:crypto';
import { sql } from './_lib/db.js';
import { signToken, hashPassword, requireAuth } from './_lib/auth.js';
import { levelFromXp } from './_lib/gamification.js';

// รหัสผ่านอ่านง่าย พิมพ์ง่ายบนมือถือ: พยัญชนะ-สระสลับ 3 คู่ + เลข 2 ตัว (เช่น kupomi42)
function friendlyPassword() {
  const c = 'bcdfghjkmnprstvw', v = 'aeiou';
  let pw = '';
  for (let i = 0; i < 3; i++) pw += c[randomInt(c.length)] + v[randomInt(v.length)];
  return pw + String(randomInt(10, 100));
}

export default async function handler(req, res) {
  // ── POST: สร้างบัญชีผู้เยี่ยมชม พร้อม "บัตรกลับเข้าเล่น" (username+password จริง) ──
  if (req.method === 'POST') {
    const nickname = String(req.body?.nickname ?? '').trim();
    if (!nickname || nickname.length > 20)
      return res.status(400).json({ error: 'ตั้งชื่อเล่น 1-20 ตัวอักษร' });

    const password = friendlyPassword();
    const hash = await hashPassword(password);

    // username จำง่าย: s + เลข 5 หลัก — วนสุ่มใหม่ถ้าชน
    let user = null;
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      const username = 's' + String(randomInt(10000, 100000));
      try {
        [user] = await sql`
          INSERT INTO users (username, display_name, password_hash, role, is_guest)
          VALUES (${username}, ${nickname}, ${hash}, 'student', true)
          RETURNING id, username, display_name, role, is_guest, xp, streak_days, voice_low_midi, voice_high_midi
        `;
      } catch (err) {
        if (!String(err.message).includes('users_username_key')) throw err;
      }
    }
    if (!user) return res.status(500).json({ error: 'สร้างบัญชีไม่สำเร็จ ลองอีกครั้ง' });

    const token = await signToken(user, '180d');
    return res.status(201).json({
      token,
      user: { ...user, level: levelFromXp(user.xp) },
      credentials: { username: user.username, password }, // แสดงครั้งเดียว — ไม่เก็บ plaintext
    });
  }

  // ── PATCH: guest ที่ login อยู่ ขอรหัสใหม่ (ลืมรหัส / บัญชี guest รุ่นเก่าไม่มีรหัส) ──
  if (req.method === 'PATCH') {
    const auth = await requireAuth(req, res);
    if (!auth) return;
    const [user] = await sql`SELECT id, username, is_guest FROM users WHERE id = ${auth.userId} AND is_active`;
    if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });
    if (!user.is_guest) return res.status(403).json({ error: 'เฉพาะบัญชีผู้เยี่ยมชม — นักเรียนติดต่อครูเพื่อรีเซ็ตรหัส' });

    const password = friendlyPassword();
    const hash = await hashPassword(password);
    await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;
    return res.json({ credentials: { username: user.username, password } });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
