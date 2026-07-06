// เกมร้องเพลงเต็ม — ผู้เล่นวางลิงก์เพลงที่อยากร้อง วิดีโอเล่นผ่าน YouTube IFrame
// Player อย่างเป็นทางการ + เนื้อเพลงคาราโอเกะ (LRC/ข้อความ) — YouTube ไม่ยอมให้อ่าน
// สตรีมเสียงจาก embed จึง "เทียบทำนองต้นฉบับ" ไม่ได้ → ให้คะแนนจาก
// "ความตรงโน้ต + ความนิ่ง" ของเสียงผู้เล่นล้วน ๆ (intonation) ซึ่งวัดได้แม่น ±3¢
// (แนะนำหูฟัง — ไมค์จะได้ยินเฉพาะเสียงผู้เล่น)
import {
  MicSession, SegmentTracker, scoreFromCents, freqToNoteInfo,
} from '../pitch-engine.js';
import { PianoRoll } from '../piano-roll.js';

const MIN_SING_SEC = 15;   // ต้องร้องรวมอย่างน้อยเท่านี้

// ── ฟังก์ชัน pure (มี unit test) ────────────────────────
// ดึง video id จากลิงก์ YouTube ทุกรูปแบบหลัก — ไม่ใช่ลิงก์ YouTube → null
export function parseYoutubeId(url) {
  if (!url) return null;
  const m = String(url).trim().match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})(?=[^A-Za-z0-9_-]|$)/);
  return m ? m[1] : null;
}

// แปลงเนื้อเพลง LRC → [{t วินาที, line}] เรียงเวลา; ไม่มี timestamp เลย → null
export function parseLrc(text) {
  if (!text) return null;
  const out = [];
  for (const raw of String(text).split('\n')) {
    const times = [...raw.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!times.length) continue;
    const line = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!line) continue;
    for (const t of times) {
      out.push({ t: +t[1] * 60 + +t[2] + (t[3] ? +('0.' + t[3]) : 0), line });
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ── YouTube IFrame API loader ──────────────────────────
let ytApiPromise = null;
function loadYtApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!ytApiPromise) {
    ytApiPromise = new Promise(res => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    });
  }
  return ytApiPromise;
}

export async function run({ level, stage, signal, voiceLow, voiceHigh }) {
  stage.innerHTML = `
    <div class="sc-setup" id="scSetup">
      <div id="scYtPanel">
        <input id="scYtUrl" class="login-input" type="url" inputmode="url"
               placeholder="วางลิงก์เพลง YouTube เช่น https://youtu.be/..." />
        <div class="sc-video-wrap hidden" id="scVideoWrap"><div id="scYtPlayer"></div></div>
        <textarea id="scLyricsIn" class="login-input sc-lyrics-in" rows="3"
          placeholder="วางเนื้อเพลงที่นี่ (ไม่บังคับ) — ถ้าเป็นแบบ LRC [00:12.34] จะวิ่งตามเพลงแบบคาราโอเกะ"></textarea>
        <p class="return-info">🎧 <strong>ใส่หูฟัง</strong>เพื่อผลแม่นที่สุด · โหมดนี้วัด<strong>ความตรงโน้ตและความนิ่ง</strong>ของเสียงคุณ (ไม่เทียบทำนองต้นฉบับ — YouTube ไม่อนุญาตให้อ่านเสียงจากวิดีโอ)</p>
      </div>

      <div class="status-msg" id="scStatus">วางลิงก์เพลง YouTube ก่อนนะ</div>
      <button class="btn-start" id="scStart" disabled>🎤 เริ่มร้อง</button>
    </div>

    <div class="sc-play hidden" id="scPlay">
      <div class="sc-video-slot" id="scVideoSlot"></div>
      <div class="nm-top">
        <div class="nm-note" id="scNote" style="font-size:2rem">—</div>
        <div class="nm-instruction" id="scInstruction"></div>
      </div>
      <div class="sc-lyrics hidden" id="scLyrics">
        <div class="sc-lyric-line current" id="scLyricNow"></div>
        <div class="sc-lyric-line" id="scLyricNext"></div>
      </div>
      <div class="sc-lyrics-plain hidden" id="scLyricsPlain"></div>
      <div class="pg-canvas-wrap"><canvas id="scCanvas" class="pg-canvas"></canvas></div>
      <button class="btn-stop" id="scStop">⏹ จบเพลง / พอแค่นี้</button>
    </div>`;

  const el = id => stage.querySelector('#' + id);
  const statusEl = el('scStatus'), startBtn = el('scStart');
  const setupEl = el('scSetup'), playEl = el('scPlay');
  const noteEl = el('scNote'), instrEl = el('scInstruction');

  let ytPlayer = null;
  let ytVideoId = null;

  // ── วางลิงก์ → สร้าง player ──
  async function buildPlayer(videoId) {
    statusEl.textContent = '⏳ กำลังโหลดวิดีโอ...';
    await loadYtApi();
    if (signal.aborted) return;
    el('scVideoWrap').classList.remove('hidden');
    if (ytPlayer) { try { ytPlayer.destroy(); } catch (_) {} ytPlayer = null; }
    await new Promise(res => {
      ytPlayer = new YT.Player('scYtPlayer', {
        videoId,
        playerVars: { playsinline: 1, rel: 0 },
        events: { onReady: res },
      });
    });
    ytVideoId = videoId;
    statusEl.textContent = '✅ วิดีโอพร้อม — ใส่หูฟังแล้วกดเริ่มร้องได้เลย';
    startBtn.disabled = false;
  }

  el('scYtUrl').addEventListener('change', () => {
    const id = parseYoutubeId(el('scYtUrl').value);
    if (!id) {
      statusEl.textContent = '⚠️ ลิงก์ไม่ใช่ YouTube — ลองก็อปลิงก์จากปุ่มแชร์ของ YouTube';
      return;
    }
    buildPlayer(id).catch(() => { statusEl.textContent = '⚠️ โหลดวิดีโอไม่สำเร็จ ลองลิงก์อื่น'; });
  });

  // test hook สำหรับ headless (วิดีโอจริงเล่นไม่ได้ใน CI): window.__scTestPlayer
  if (window.__scTestPlayer) { ytPlayer = window.__scTestPlayer; ytVideoId = 'test00000ab'; startBtn.disabled = false; }

  // ── รอผู้เล่นกดเริ่ม ──
  await new Promise((resolve, reject) => {
    startBtn.addEventListener('click', resolve, { once: true });
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }).catch(() => null);
  if (signal.aborted) return null;

  const lyrics = el('scLyricsIn').value;
  return runYoutube({ stage, signal, voiceLow, voiceHigh, player: ytPlayer, videoId: ytVideoId, lyricsText: lyrics, el, setupEl, playEl, noteEl, instrEl });
}

// ═══════════ โหมด YouTube: วัด intonation ของเสียงผู้เล่น ═══════════
async function runYoutube({ stage, signal, voiceLow, voiceHigh, player, videoId, lyricsText, el, setupEl, playEl, noteEl, instrEl }) {
  setupEl.classList.add('hidden');
  playEl.classList.remove('hidden');

  // ย้ายวิดีโอมาหน้าเล่น (เห็น MV ระหว่างร้อง)
  const wrap = el('scVideoWrap');
  wrap.classList.remove('hidden');
  el('scVideoSlot').appendChild(wrap);

  // เนื้อเพลง: LRC → คาราโอเกะ sync, ธรรมดา → แผงเลื่อน
  const lrc = parseLrc(lyricsText);
  const plain = !lrc && lyricsText && lyricsText.trim() ? lyricsText.trim() : null;
  if (lrc) el('scLyrics').classList.remove('hidden');
  if (plain) {
    const p = el('scLyricsPlain');
    p.textContent = plain;
    p.classList.remove('hidden');
  }

  const roll = new PianoRoll(el('scCanvas'), { lowMidi: voiceLow, highMidi: voiceHigh, piano: true });
  const segments = [];
  const segTracker = new SegmentTracker({ onSegment: s => segments.push(s) });

  const mic = new MicSession({
    processed: true, // ลดเสียงลำโพงรั่วเข้าไมค์กรณีไม่ใส่หูฟัง
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      segTracker.push(frame);
      roll.pushPitch(frame.voiced ? frame.midi : null);
      roll.draw();
      if (frame.voiced) {
        const info = freqToNoteInfo(frame.freq);
        noteEl.textContent = `${info.note}${info.octave}`;
      }
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => { mic.stop(); try { player.pauseVideo?.(); } catch (_) {} };
  signal.addEventListener('abort', onAbort);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  while (mic.running && !mic.calibrated) {
    if (signal.aborted) return null;
    await wait(100);
  }

  instrEl.textContent = '🎤 ร้องตามเพลงได้เลย!';
  try { player.playVideo(); } catch (_) { /* test hook อาจไม่มี */ }
  const t0 = performance.now();

  // poll: เนื้อเพลงคาราโอเกะ + วิดีโอจบ (state 0)
  let stopRequested = false;
  el('scStop').addEventListener('click', () => { stopRequested = true; }, { once: true });
  while (!stopRequested && !signal.aborted) {
    await wait(200);
    let vt = null, state = null;
    try { vt = player.getCurrentTime?.(); state = player.getPlayerState?.(); } catch (_) {}
    if (lrc && vt !== null && vt !== undefined) {
      let idx = -1;
      for (let i = 0; i < lrc.length; i++) { if (lrc[i].t <= vt) idx = i; else break; }
      el('scLyricNow').textContent = idx >= 0 ? lrc[idx].line : '♪ ...';
      el('scLyricNext').textContent = lrc[idx + 1]?.line || '';
    }
    if (state === 0) break;                                  // วิดีโอจบ
    if (performance.now() - t0 > 10 * 60 * 1000) break;      // เพดาน 10 นาที
  }
  const sungTotalMs = performance.now() - t0;
  signal.removeEventListener('abort', onAbort);
  try { player.pauseVideo?.(); } catch (_) {}
  segTracker.end();
  mic.stop();
  if (signal.aborted) return null;

  // ── คะแนน intonation: ต่อ segment เทียบโน้ตที่ใกล้ที่สุด (curve เดิม) + ความนิ่ง ──
  const scored = segments
    .map(seg => seg.stats(null))
    .filter(st => st && st.durMs >= 300)
    .map(st => {
      const dev = Math.abs((st.medianMidi - Math.round(st.medianMidi)) * 100);
      return {
        durMs: st.durMs,
        dev,
        stddev: st.stddevCents,
        score: 0.75 * scoreFromCents(dev) + 0.25 * Math.max(0, 100 - st.stddevCents * 2.5),
      };
    });
  const voicedSec = scored.reduce((a, s) => a + s.durMs, 0) / 1000;

  if (voicedSec < MIN_SING_SEC) {
    return {
      score: 0,
      accuracy_pct: 0,
      avg_cents_off: null,
      details: { mode: 'youtube', video_id: videoId, sung_sec: Math.round(voicedSec), note: 'ร้องสั้นเกินไป (ต้องอย่างน้อย 15 วิ)' },
    };
  }

  const totalDur = scored.reduce((a, s) => a + s.durMs, 0);
  const score = scored.reduce((a, s) => a + s.score * s.durMs, 0) / totalDur;
  const avgDev = scored.reduce((a, s) => a + s.dev * s.durMs, 0) / totalDur;
  return {
    score,
    accuracy_pct: (scored.filter(s => s.dev <= 20).reduce((a, s) => a + s.durMs, 0) / totalDur) * 100,
    avg_cents_off: avgDev,
    details: {
      mode: 'youtube',
      video_id: videoId,
      sung_sec: Math.round(voicedSec),
      total_sec: Math.round(sungTotalMs / 1000),
      segments: scored.length,
      avg_dev_cents: Math.round(avgDev * 10) / 10,
      has_lyrics: !!(lrc || plain),
    },
  };
}
