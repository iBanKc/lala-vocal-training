import { sql } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import {
  GAME_IDS, MAX_LEVEL, levelFromXp, starsFromScore, xpForRound,
  bangkokDate, nextStreak, newBadges,
} from './_lib/gamification.js';

export default async function handler(req, res) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT game_id, level, score, stars, accuracy_pct, avg_cents_off, duration_sec, xp_earned, created_at
      FROM game_sessions WHERE user_id = ${auth.userId}
      ORDER BY created_at DESC LIMIT 50
    `;
    return res.json({ sessions: rows });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── validate ฝั่ง server — client เชื่อไม่ได้ ──────────
  const b = req.body || {};
  const gameId = b.game_id;
  const level = Number(b.level);
  const score = Math.round(Number(b.score));

  if (!GAME_IDS.includes(gameId)) return res.status(400).json({ error: 'game_id ไม่ถูกต้อง' });
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL[gameId])
    return res.status(400).json({ error: 'level ไม่ถูกต้อง' });
  if (!Number.isFinite(score) || score < 0 || score > 100)
    return res.status(400).json({ error: 'score ไม่ถูกต้อง' });

  const num = (v, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : null);
  const accuracyPct = num(b.accuracy_pct, 0, 100);
  const avgCentsOff = num(b.avg_cents_off, 0, 1200);
  const durationSec = num(b.duration_sec, 0, 3600);
  const details = b.details && JSON.stringify(b.details).length <= 8192 ? b.details : null;

  // ── ด่านต้องปลดล็อกแล้ว: เล่นได้ถึง (ด่านสูงสุดที่ได้ ≥2 ดาว) + 1 ──
  const [user] = await sql`
    SELECT xp, streak_days, last_practice_date FROM users WHERE id = ${auth.userId} AND is_active
  `;
  if (!user) return res.status(401).json({ error: 'ไม่พบบัญชีผู้ใช้' });

  const [unlock] = await sql`
    SELECT COALESCE(MAX(level), 0) AS max_cleared
    FROM game_progress WHERE user_id = ${auth.userId} AND game_id = ${gameId} AND best_stars >= 2
  `;
  const maxPlayable = Math.min(Number(unlock.max_cleared) + 1, MAX_LEVEL[gameId]);
  if (level > maxPlayable) return res.status(400).json({ error: 'ด่านนี้ยังไม่ปลดล็อก' });

  const stars = starsFromScore(score);
  const xpEarned = xpForRound(score, level, gameId);
  const streak = nextStreak(user.last_practice_date, user.streak_days);
  const today = bangkokDate();
  const newXp = user.xp + xpEarned;

  await sql.transaction([
    sql`
      INSERT INTO game_sessions (user_id, game_id, level, score, stars, accuracy_pct, avg_cents_off, duration_sec, xp_earned, details)
      VALUES (${auth.userId}, ${gameId}, ${level}, ${score}, ${stars}, ${accuracyPct}, ${avgCentsOff}, ${durationSec}, ${xpEarned}, ${details})
    `,
    sql`
      INSERT INTO game_progress (user_id, game_id, level, best_score, best_stars, plays)
      VALUES (${auth.userId}, ${gameId}, ${level}, ${score}, ${stars}, 1)
      ON CONFLICT (user_id, game_id, level) DO UPDATE SET
        best_score = GREATEST(game_progress.best_score, EXCLUDED.best_score),
        best_stars = GREATEST(game_progress.best_stars, EXCLUDED.best_stars),
        plays = game_progress.plays + 1,
        updated_at = now()
    `,
    sql`
      UPDATE users SET xp = ${newXp}, streak_days = ${streak}, last_practice_date = ${today}
      WHERE id = ${auth.userId}
    `,
  ]);

  // ── ตรวจ badge หลังบันทึก ───────────────────────────────
  const [[agg], owned] = await Promise.all([
    sql`
      SELECT COUNT(*)::int AS total_sessions, COUNT(DISTINCT game_id)::int AS distinct_games
      FROM game_sessions WHERE user_id = ${auth.userId}
    `,
    sql`SELECT badge_id FROM user_badges WHERE user_id = ${auth.userId}`,
  ]);

  const earned = newBadges({
    totalSessions: agg.total_sessions,
    distinctGames: agg.distinct_games,
    streak, xp: newXp, score, stars, gameId, details,
  }, owned.map(r => r.badge_id));

  if (earned.length) {
    await sql.transaction(earned.map(id =>
      sql`INSERT INTO user_badges (user_id, badge_id) VALUES (${auth.userId}, ${id}) ON CONFLICT DO NOTHING`
    ));
  }

  res.json({
    score, stars,
    xp_earned: xpEarned,
    new_xp: newXp,
    level: levelFromXp(newXp),
    streak,
    new_badges: earned,
    unlocked_next: stars >= 2 && level === Number(unlock.max_cleared) + 1 && level < MAX_LEVEL[gameId],
  });
}
