// hub — หน้าหลักของนักเรียน: ระดับ/XP/streak, การ์ดเกม, เหรียญ
import { state, totalStars, unlockedLevel } from './state.js';
import { GAMES, openGame, showPage } from './game-core.js';
import { BADGE_INFO, levelTitle } from './badges.js';
import { runCalibration } from './calibrate.js';
import { midiToNoteName } from './pitch-engine.js';

const hubEl = () => document.getElementById('pageHub');

function render() {
  const u = state.user;
  if (!u) return;

  const xpPct = Math.min(100, Math.round((u.xp_this_level / u.xp_next_level) * 100));
  const earned = new Set(state.badges.map(b => b.badge_id));
  const range = u.voice_low_midi !== null
    ? `${midiToNoteName(u.voice_low_midi)} – ${midiToNoteName(u.voice_high_midi)}`
    : 'ยังไม่ได้วัด';

  hubEl().innerHTML = `
    <section class="hub-profile">
      <div class="hub-greeting">สวัสดี, <strong>${u.display_name}</strong> 👋</div>
      <div class="hub-level-row">
        <span class="hub-level">ระดับ ${u.level} · ${levelTitle(u.level)}</span>
        <span class="hub-streak" title="ฝึกติดต่อกัน">🔥 ${u.streak_days} วัน</span>
      </div>
      <div class="xp-bar"><div class="xp-bar-fill" style="width:${xpPct}%"></div></div>
      <div class="xp-text">${u.xp_this_level} / ${u.xp_next_level} XP สู่ระดับ ${u.level + 1}</div>
      <button class="hub-range-btn" id="hubRangeBtn">🎙️ ช่วงเสียง: ${range}</button>
    </section>

    <section class="hub-games">
      <div class="section-title">เกมฝึกร้อง</div>
      <div class="game-cards">
        ${Object.entries(GAMES).map(([id, g]) => {
          const stars = totalStars(id);
          const lv = unlockedLevel(id, g.maxLevel);
          return `<button class="game-card ${g.available ? '' : 'coming-soon'}" data-game="${id}" ${g.available ? '' : 'disabled'}>
            <span class="game-card-icon">${g.icon}</span>
            <span class="game-card-title">${g.title}</span>
            <span class="game-card-desc">${g.desc}</span>
            <span class="game-card-meta">${g.available
              ? `⭐ ${stars}/${g.maxLevel * 3} · ด่าน ${lv}/${g.maxLevel}`
              : 'เร็ว ๆ นี้'}</span>
          </button>`;
        }).join('')}
      </div>
    </section>

    <section class="hub-badges">
      <div class="section-title">เหรียญของฉัน (${earned.size}/${Object.keys(BADGE_INFO).length})</div>
      <div class="badge-shelf">
        ${Object.entries(BADGE_INFO).map(([id, b]) =>
          `<div class="badge-chip ${earned.has(id) ? 'earned' : ''}" title="${b.name}: ${b.desc}">
            <span>${b.emoji}</span><small>${b.name}</small>
          </div>`).join('')}
      </div>
    </section>`;

  hubEl().querySelectorAll('.game-card:not(.coming-soon)').forEach(card =>
    card.addEventListener('click', () => openGame(card.dataset.game)));
  hubEl().querySelector('#hubRangeBtn').addEventListener('click', async () => {
    await runCalibration();
    render();
  });
}

window.addEventListener('profile:updated', render);
window.addEventListener('auth:ready', () => { render(); showPage('pageHub'); });
