// โปรไฟล์ผู้ใช้ที่ล็อกอินอยู่ + ความคืบหน้า — แหล่งเดียว ใช้ร่วมทุกหน้า
import { api } from './api.js';

export const state = {
  user: null,       // { id, display_name, role, xp, level, streak_days, voice_low_midi, ... }
  progress: [],     // [{ game_id, level, best_score, best_stars, plays }]
  badges: [],       // [{ badge_id, earned_at }]
};

export async function loadProfile() {
  const data = await api('/api/me');
  state.user = data.user;
  state.progress = data.progress;
  state.badges = data.badges;
  window.dispatchEvent(new CustomEvent('profile:updated'));
  return data;
}

export function bestStars(gameId, level) {
  const row = state.progress.find(p => p.game_id === gameId && p.level === level);
  return row ? row.best_stars : 0;
}

// ด่านสูงสุดที่เล่นได้ = (ด่านสูงสุดที่เคยได้ ≥2 ดาว) + 1
export function unlockedLevel(gameId, maxLevel) {
  const cleared = state.progress
    .filter(p => p.game_id === gameId && p.best_stars >= 2)
    .reduce((a, p) => Math.max(a, p.level), 0);
  return Math.min(cleared + 1, maxLevel);
}

export function totalStars(gameId) {
  return state.progress
    .filter(p => p.game_id === gameId)
    .reduce((a, p) => a + p.best_stars, 0);
}
