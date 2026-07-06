import { sql } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { levelFromXp, xpForLevel } from './_lib/gamification.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  // PATCH: บันทึกช่วงเสียงจากการ calibrate
  if (req.method === 'PATCH') {
    const { voice_low_midi, voice_high_midi } = req.body || {};
    const low = Number(voice_low_midi), high = Number(voice_high_midi);
    // ช่วงเสียงมนุษย์ที่สมเหตุสมผล: C2 (36) ถึง C7 (96) และกว้างอย่างน้อย 5 semitones
    if (!Number.isInteger(low) || !Number.isInteger(high) || low < 36 || high > 96 || high - low < 5) {
      return res.status(400).json({ error: 'ช่วงเสียงไม่ถูกต้อง' });
    }
    await sql`UPDATE users SET voice_low_midi = ${low}, voice_high_midi = ${high} WHERE id = ${auth.userId}`;
    return res.json({ ok: true, voice_low_midi: low, voice_high_midi: high });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rows = await sql`
    SELECT id, username, display_name, role, is_guest, xp, streak_days, last_practice_date,
           voice_low_midi, voice_high_midi
    FROM users WHERE id = ${auth.userId} AND is_active
  `;
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });

  const [progress, badges] = await Promise.all([
    sql`SELECT game_id, level, best_score, best_stars, plays FROM game_progress WHERE user_id = ${auth.userId}`,
    sql`SELECT badge_id, earned_at FROM user_badges WHERE user_id = ${auth.userId} ORDER BY earned_at`,
  ]);

  const level = levelFromXp(user.xp);
  res.json({
    user: { ...user, level, xp_this_level: user.xp - xpForLevel(level), xp_next_level: xpForLevel(level + 1) - xpForLevel(level) },
    progress,
    badges,
  });
}
