// กติกาเกมฝั่ง server — ค่าใน DB ต้องมาจากที่นี่เท่านั้น (client แค่แสดงผล)

export const GAME_IDS = ['note_match', 'note_hold', 'melody_echo', 'pitch_glide', 'song_compare'];

export const MAX_LEVEL = {
  note_match: 10,
  note_hold: 8,
  melody_echo: 12,
  pitch_glide: 10,
  song_compare: 1,
};

// level ผู้เล่นคำนวณจาก XP: L2 @100, L3 @400, L4 @900, ...
export function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export function xpForLevel(level) {
  return 100 * (level - 1) ** 2;
}

export function starsFromScore(score) {
  if (score >= 90) return 3;
  if (score >= 75) return 2;
  if (score >= 50) return 1;
  return 0;
}

export function xpForRound(score, level, gameId) {
  const mult = gameId === 'song_compare' ? 2 : 1;
  return Math.max(5, Math.round(score * (1 + 0.15 * (level - 1)) * mult));
}

// วันที่ตามปฏิทินไทย (Asia/Bangkok) รูปแบบ YYYY-MM-DD
export function bangkokDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

// streak ใหม่จากวันฝึกล่าสุด: วันนี้ → คงเดิม, เมื่อวาน → +1, อื่น ๆ → 1
export function nextStreak(lastPracticeDate, currentStreak) {
  const today = bangkokDate();
  if (!lastPracticeDate) return 1;
  const last = typeof lastPracticeDate === 'string' ? lastPracticeDate : bangkokDate(lastPracticeDate);
  if (last === today) return Math.max(1, currentStreak);
  const yesterday = bangkokDate(new Date(Date.now() - 24 * 3600 * 1000));
  return last === yesterday ? currentStreak + 1 : 1;
}

// นิยาม badge — ตรวจหลังบันทึก session (ctx มาจาก query ใน sessions.js)
export const BADGES = {
  first_step:    ctx => ctx.totalSessions >= 1,
  streak_3:      ctx => ctx.streak >= 3,
  streak_7:      ctx => ctx.streak >= 7,
  streak_30:     ctx => ctx.streak >= 30,
  xp_1000:       ctx => ctx.xp >= 1000,
  xp_5000:       ctx => ctx.xp >= 5000,
  perfect_score: ctx => ctx.score >= 98,
  three_stars:   ctx => ctx.stars === 3,
  all_games:     ctx => ctx.distinctGames >= GAME_IDS.length,
  song_master:   ctx => ctx.gameId === 'song_compare' && ctx.score >= 80,
  sessions_50:   ctx => ctx.totalSessions >= 50,
  hold_15:       ctx => ctx.gameId === 'note_hold' && (ctx.details?.held_sec ?? 0) >= 15,
};

export function newBadges(ctx, ownedIds) {
  const owned = new Set(ownedIds);
  return Object.entries(BADGES)
    .filter(([id, test]) => !owned.has(id) && test(ctx))
    .map(([id]) => id);
}
