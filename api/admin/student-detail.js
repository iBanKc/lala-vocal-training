import { sql } from '../_lib/db.js';
import { requireTeacher } from '../_lib/auth.js';
import { levelFromXp } from '../_lib/gamification.js';

export default async function handler(req, res) {
  const auth = await requireTeacher(req, res);
  if (!auth) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sid = Number(req.query.id);
  if (!Number.isInteger(sid)) return res.status(400).json({ error: 'id ไม่ถูกต้อง' });

  const [user] = await sql`
    SELECT id, username, display_name, xp, streak_days, last_practice_date,
           voice_low_midi, voice_high_midi, is_active, created_at
    FROM users WHERE id = ${sid} AND role = 'student'
  `;
  if (!user) return res.status(404).json({ error: 'ไม่พบนักเรียนคนนี้' });

  const [daily, progress, sessions, badges] = await Promise.all([
    // ค่าเฉลี่ยรายวัน 60 วัน (ปฏิทินไทย) — เทรนด์ avg_cents_off ที่ลดลง = ทักษะดีขึ้นจริง
    sql`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
             ROUND(AVG(accuracy_pct)::numeric, 1) AS acc,
             ROUND(AVG(avg_cents_off)::numeric, 1) AS cents,
             COUNT(*)::int AS rounds
      FROM game_sessions
      WHERE user_id = ${sid} AND created_at > now() - interval '60 days'
      GROUP BY day ORDER BY day
    `,
    sql`
      SELECT game_id, level, best_score, best_stars, plays
      FROM game_progress WHERE user_id = ${sid} ORDER BY game_id, level
    `,
    sql`
      SELECT game_id, level, score, stars, accuracy_pct, avg_cents_off, duration_sec, details, created_at
      FROM game_sessions WHERE user_id = ${sid} ORDER BY created_at DESC LIMIT 20
    `,
    sql`SELECT badge_id, earned_at FROM user_badges WHERE user_id = ${sid} ORDER BY earned_at`,
  ]);

  res.json({
    user: { ...user, level: levelFromXp(user.xp) },
    daily, progress, sessions, badges,
  });
}
