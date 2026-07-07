// วงจรชีวิตของเกม: เลือกด่าน → เล่น → หน้าคะแนน → ส่งผลขึ้น server
import { api } from './api.js';
import { state, loadProfile, bestStars, unlockedLevel } from './state.js';
import { ensureCalibrated } from './calibrate.js';
import { BADGE_INFO } from './badges.js';
import { BOOK, BOOK_EXERCISES, WARMUP_ROUTINES } from './curriculum.js';
import { watchFit } from './fit-guard.js';

export const GAMES = {
  note_match:   { title: 'จับคู่โน้ต',   icon: '🎯', desc: 'ฟังโน้ตแล้วร้องตามให้ตรง', maxLevel: 10, available: true,  load: () => import('./games/note-match.js') },
  note_hold:    { title: 'เสียงนิ่ง',    icon: '🧘', desc: 'ลากเสียงให้นิ่ง — สูงขึ้น ยาวขึ้น ยากขึ้น', maxLevel: 8, available: true, load: () => import('./games/note-hold.js') },
  melody_echo:  { title: 'ร้องตามทำนอง', icon: '🦜', desc: 'ฟังทำนองแล้วร้องตาม',    maxLevel: 12, available: true,  load: () => import('./games/melody-echo.js') },
  pitch_glide:  { title: 'เสียงพาบิน',   icon: '🎈', desc: 'ใช้เสียงบังคับลูกโป่งลอดห่วง', maxLevel: 10, available: true,  load: () => import('./games/pitch-glide.js') },
  song_compare: { title: 'ร้องเพลงเต็ม', icon: '🎤', desc: 'ร้องเพลงโปรดจาก YouTube วัดความตรงโน้ต',  maxLevel: 1,  available: true,  load: () => import('./games/song-compare.js') },
  warmup_routine: { title: 'วอร์มพื้นฐาน', icon: '🤸', desc: 'ท่าวอร์มร่างกาย ลม ลิ้น จาก Blues Dot Music', maxLevel: WARMUP_ROUTINES.length, available: true, noCalibration: true, schoolOnly: true, load: () => import('./games/warmup-routine.js') },
};

const pageGame = () => document.getElementById('pageGame');
const gameRoot = () => document.getElementById('gameRoot');

let activeAbort = null; // ยกเลิกเกมที่ค้างอยู่เมื่อออกกลางคัน
let stageGuard = null;  // fit-guard เฉพาะสนามเกมระหว่างเล่น (หน้าเลือกด่าน scroll ได้ตามเดิม)

export function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.page === pageId));
}

export function abortActiveGame() {
  if (activeAbort) { activeAbort.abort(); activeAbort = null; }
}

// ออกจากหน้าเกมเมื่อกด nav ไปหน้าอื่น
document.querySelectorAll('.nav-btn').forEach(btn =>
  btn.addEventListener('click', abortActiveGame));

// ข้อความใหญ่กลางจอ ค้าง 2 วิแล้วหายไป (ใช้แจ้งสิทธิ์/เตือนสั้น ๆ)
export function flashNotice(text, holdMs = 2000) {
  const el = document.createElement('div');
  el.className = 'flash-notice';
  el.innerHTML = `<span>${text}</span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 350);
  }, holdMs);
}

// ── หน้าเลือกด่าน ──────────────────────────────────────
export async function openGame(gameId) {
  const game = GAMES[gameId];
  if (!game || !game.available) return;

  // เกมเฉพาะบัญชีโรงเรียน (นักเรียน/ครู) — guest เห็นข้อความแจ้งแล้วอยู่หน้าเดิม
  if (game.schoolOnly && state.user?.is_guest) {
    flashNotice('เฉพาะนักเรียน Blues Dot Music');
    return;
  }

  // วอร์มมีเสียงบรรยาย — โหมดเงียบของ iOS จะ mute เสียงทั้งหมด เตือนก่อนเข้า
  if (gameId === 'warmup_routine') flashNotice('🔔 ปิดโหมดเงียบ<br>เพื่อฟังเสียงบรรยาย');

  if (!game.noCalibration && !(await ensureCalibrated())) return; // ต้องรู้ช่วงเสียงก่อน

  // เกมด่านเดียว (เช่น ร้องเพลงเต็ม): เข้าเล่นทันที ไม่ผ่านหน้าเลือกด่าน
  if (game.maxLevel === 1) {
    showPage('pageGame');
    startRound(gameId, 1);
    return;
  }

  showPage('pageGame');
  const maxPlayable = unlockedLevel(gameId, game.maxLevel);
  const bookList = BOOK_EXERCISES[gameId] || [];

  // วอร์มพื้นฐาน: ทุก routine ปลดล็อก แสดงชื่อแทนตัวเลข
  const levelButtons = gameId === 'warmup_routine'
    ? WARMUP_ROUTINES.map(r => {
        const stars = bestStars(gameId, r.level);
        return `<button class="level-btn routine-btn" data-level="${r.level}">
          <span class="level-num">${r.icon}</span>
          <span class="routine-name">${r.name}</span>
          <span class="level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
        </button>`;
      }).join('')
    : Array.from({ length: game.maxLevel }, (_, i) => {
        const lv = i + 1;
        const locked = lv > maxPlayable;
        const stars = bestStars(gameId, lv);
        return `<button class="level-btn ${locked ? 'locked' : ''}" data-level="${lv}" ${locked ? 'disabled' : ''}>
          <span class="level-num">${locked ? '🔒' : lv}</span>
          <span class="level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
        </button>`;
      }).join('');

  gameRoot().innerHTML = `
    <div class="game-header">
      <button class="btn-back" id="gameBack">‹ กลับ</button>
      <div class="game-title">${game.icon} ${game.title}</div>
    </div>
    <p class="game-desc">${game.desc}</p>
    <div class="level-grid ${gameId === 'warmup_routine' ? 'routine-grid' : ''}">${levelButtons}</div>
    ${bookList.length ? `
      <div class="section-title book-section-title">📖 แบบฝึกจาก Blues Dot Music</div>
      <div class="book-list">
        ${bookList.map((ex, i) => {
          const lv = 101 + i;
          const stars = bestStars(gameId, lv);
          return `<button class="book-btn" data-level="${lv}">
            <span class="book-btn-name">${ex.name}</span>
            <span class="book-btn-desc">${ex.desc}</span>
            <span class="level-stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
          </button>`;
        }).join('')}
      </div>` : ''}`;

  gameRoot().querySelector('#gameBack').addEventListener('click', () => showPage('pageHub'));
  gameRoot().querySelectorAll('.level-btn:not(.locked), .book-btn').forEach(btn =>
    btn.addEventListener('click', () => startRound(gameId, Number(btn.dataset.level))));
}

// ── เล่นหนึ่งรอบ ───────────────────────────────────────
export async function startRound(gameId, level) {
  const game = GAMES[gameId];
  abortActiveGame();
  const abort = new AbortController();
  activeAbort = abort;

  // ด่านพิเศษจากคลังแบบฝึก (101+) / routine วอร์ม → ส่ง def เข้าโมดูลเกม
  const exercise = level > 100 ? (BOOK_EXERCISES[gameId] || [])[level - 101] : null;
  const routine = gameId === 'warmup_routine' ? WARMUP_ROUTINES[level - 1] : null;
  const title = exercise ? `${BOOK.credit.slice(0, 2)} ${exercise.name}`
    : routine ? `${routine.icon} ${routine.name}`
    : `${game.icon} ${game.title} · ด่าน ${level}`;

  gameRoot().innerHTML = `
    <div class="game-header">
      <button class="btn-back" id="gameBack">‹ ออก</button>
      <div class="game-title">${title}</div>
    </div>
    ${exercise ? `<p class="game-desc book-tip">💡 ${exercise.tip}<br><small>${BOOK.credit}</small></p>` : ''}
    <div id="gameStage" class="game-stage"></div>`;
  gameRoot().querySelector('#gameBack').addEventListener('click', () => {
    abort.abort();
    // เกมด่านเดียวไม่มีหน้าเลือกด่าน — ออกแล้วกลับหน้าหลักเลย (กันวนกลับเข้าเกม)
    if (game.maxLevel === 1) showPage('pageHub');
    else openGame(gameId);
  });

  const stage = gameRoot().querySelector('#gameStage');
  stageGuard?.stop();
  stageGuard = watchFit(stage);
  const startedAt = performance.now();

  let result = null;
  try {
    const mod = await game.load();
    result = await mod.run({
      level,
      stage,
      signal: abort.signal,
      voiceLow: state.user.voice_low_midi,
      voiceHigh: state.user.voice_high_midi,
      exercise,
      routine,
    });
  } catch (err) {
    if (!abort.signal.aborted) {
      stage.innerHTML = `<p class="game-error">⚠️ ${err.message || 'เกิดข้อผิดพลาด'}</p>`;
    }
    return;
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }

  if (!result || abort.signal.aborted) return;
  result.duration_sec = Math.round((performance.now() - startedAt) / 100) / 10;
  await showScoreScreen(gameId, level, result);
}

// ── หน้าคะแนน + ส่งผล ──────────────────────────────────
function clientStars(score) { return score >= 90 ? 3 : score >= 75 ? 2 : score >= 50 ? 1 : 0; }

async function showScoreScreen(gameId, level, result) {
  stageGuard?.stop();
  stageGuard = null;
  const game = GAMES[gameId];
  const score = Math.round(result.score);
  const stars = clientStars(score);
  const label = score >= 90 ? '🌟 ยอดเยี่ยมมาก!' : score >= 75 ? '👍 ดีมาก!' : score >= 50 ? '💪 พอใช้ได้!' : '🎵 ฝึกต่อไปนะ';

  gameRoot().innerHTML = `
    <div class="score-screen">
      <div class="score-stars">
        ${[1, 2, 3].map(i => `<span class="star ${i <= stars ? 'earned' : ''}" style="animation-delay:${i * 0.25}s">★</span>`).join('')}
      </div>
      <div class="score-big">${score}</div>
      <div class="score-label">${label}</div>
      ${result.avg_cents_off != null ? `<div class="score-detail">เพี้ยนเฉลี่ย ${Math.round(result.avg_cents_off)} cents</div>` : ''}
      <div class="score-submit" id="scoreSubmit">⏳ กำลังบันทึกผล...</div>
      <div class="score-actions">
        <button class="btn-start" id="btnRetry">🔁 เล่นอีกครั้ง</button>
        <button class="btn-start hidden" id="btnNext">➡️ ด่านถัดไป</button>
        <button class="btn-secondary" id="btnHome">🏠 หน้าหลัก</button>
      </div>
    </div>`;

  gameRoot().querySelector('#btnRetry').addEventListener('click', () => startRound(gameId, level));
  gameRoot().querySelector('#btnHome').addEventListener('click', () => showPage('pageHub'));

  // ปุ่ม "ด่านถัดไป" — แสดงทุกครั้งที่ด่านถัดไปเล่นได้ (รวมเล่นซ้ำด่านที่ผ่านแล้ว)
  // ไม่ผูกกับ "เพิ่งปลดล็อก" อีกต่อไป; ด่านพิเศษ 101+ ไม่อยู่ในลำดับด่าน จึงไม่แสดง
  const showNextIfPlayable = () => {
    const nextPlayable = level < 100 && level < game.maxLevel && (
      gameId === 'warmup_routine' || // วอร์ม: ทุก routine เปิดเสมอ
      level + 1 <= unlockedLevel(gameId, game.maxLevel)
    );
    if (!nextPlayable) return;
    const nextBtn = gameRoot().querySelector('#btnNext');
    if (!nextBtn || !nextBtn.classList.contains('hidden')) return; // ออกจากหน้าไปแล้ว/แสดงแล้ว
    nextBtn.classList.remove('hidden');
    nextBtn.addEventListener('click', () => startRound(gameId, level + 1));
  };

  const submitEl = gameRoot().querySelector('#scoreSubmit');
  try {
    const resp = await api('/api/sessions', {
      method: 'POST',
      body: {
        game_id: gameId, level, score,
        accuracy_pct: result.accuracy_pct,
        avg_cents_off: result.avg_cents_off,
        duration_sec: result.duration_sec,
        details: result.details,
      },
    });
    submitEl.innerHTML = `<span class="xp-pop">+${resp.xp_earned} XP</span>` +
      (resp.streak > 1 ? ` <span class="streak-pop">🔥 ${resp.streak} วันติด</span>` : '');
    await loadProfile(); // อัปเดต hub/XP bar + สถานะปลดล็อกล่าสุด (รวมที่เพิ่งปลดรอบนี้)
    showNextIfPlayable();
    if (resp.new_badges?.length) showBadgePopup(resp.new_badges);
  } catch (err) {
    submitEl.textContent = '⚠️ บันทึกผลไม่สำเร็จ: ' + (err.message || '');
    showNextIfPlayable(); // เล่นต่อได้จาก state ล่าสุดแม้บันทึกพลาด
  }
}

function showBadgePopup(badgeIds) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-card badge-popup">
      <h2>🎉 ได้เหรียญใหม่!</h2>
      ${badgeIds.map(id => {
        const b = BADGE_INFO[id] || { emoji: '🏅', name: id, desc: '' };
        return `<div class="badge-award"><span class="badge-emoji">${b.emoji}</span>
          <div><div class="badge-name">${b.name}</div><div class="badge-desc">${b.desc}</div></div></div>`;
      }).join('')}
      <button class="btn-start" id="badgeOk">เยี่ยมไปเลย!</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#badgeOk').addEventListener('click', () => overlay.remove());
}
