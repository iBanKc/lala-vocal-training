// เกมร้องเพลงเต็ม — 2 โหมด:
//
// 🎬 YouTube (ค่าเริ่มต้น): ผู้เล่นวางลิงก์เพลงที่อยากร้อง วิดีโอเล่นผ่าน YouTube IFrame
//    Player อย่างเป็นทางการ + เนื้อเพลงคาราโอเกะ (LRC/ข้อความ) — YouTube ไม่ยอมให้อ่าน
//    สตรีมเสียงจาก embed จึง "เทียบทำนองต้นฉบับ" ไม่ได้ → โหมดนี้ให้คะแนนจาก
//    "ความตรงโน้ต + ความนิ่ง" ของเสียงผู้เล่นล้วน ๆ (intonation) ซึ่งวัดได้แม่น ±3¢
//    (แนะนำหูฟัง — ไมค์จะได้ยินเฉพาะเสียงผู้เล่น)
//
// 🎙️ เพลงฝึกเสียง: เทียบต้นฉบับเต็มรูปแบบ (Compare v2 เดิม): เพลง+ไมค์บน clock เดียวกัน,
//    octave-invariant fold ±600¢, DTW-lite ±3 เฟรม, latency compensation
import {
  MicSession, SegmentTracker, decodeAndAnalyse, foldCents, scoreFromCents,
  freqToNoteInfo, midiToNoteName, NOTE_NAMES,
} from '../pitch-engine.js';
import { PianoRoll } from '../piano-roll.js';

const HOP = 0.05;          // วินาทีต่อเฟรม ref (ตรงกับ analyseBuffer)
const LATENCY = 0.12;      // ชดเชยความหน่วงปาก→ไมค์ (โหมดเทียบต้นฉบับ)
const DTW_SPAN = 3;        // เทียบ ref เฟรม ±3
const MIN_SING_SEC = 15;   // โหมด YouTube ต้องร้องรวมอย่างน้อยเท่านี้

const cache = { builtin: null, builtinAudio: null };

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

async function loadBuiltin(statusEl) {
  if (cache.builtin) return cache.builtin;
  statusEl.textContent = '⏳ กำลังวิเคราะห์เพลงต้นฉบับ...';
  const resp = await fetch('reference.mp3');
  const buf = await resp.arrayBuffer();
  cache.builtinAudio = buf.slice(0);
  cache.builtin = await decodeAndAnalyse(buf);
  statusEl.textContent = '✅ พร้อมร้องแล้ว';
  return cache.builtin;
}

export async function run({ level, stage, signal, voiceLow, voiceHigh }) {
  stage.innerHTML = `
    <div class="sc-setup" id="scSetup">
      <div class="source-tabs">
        <button class="source-tab active" id="scTabYt">🎬 YouTube</button>
        <button class="source-tab" id="scTabBuiltin">🎙️ เพลงฝึกเสียง</button>
      </div>

      <!-- โหมด YouTube: เพลงของผู้เล่นเอง -->
      <div id="scYtPanel">
        <input id="scYtUrl" class="login-input" type="url" inputmode="url"
               placeholder="วางลิงก์เพลง YouTube เช่น https://youtu.be/..." />
        <div class="sc-video-wrap hidden" id="scVideoWrap"><div id="scYtPlayer"></div></div>
        <textarea id="scLyricsIn" class="login-input sc-lyrics-in" rows="3"
          placeholder="วางเนื้อเพลงที่นี่ (ไม่บังคับ) — ถ้าเป็นแบบ LRC [00:12.34] จะวิ่งตามเพลงแบบคาราโอเกะ"></textarea>
        <p class="return-info">🎧 <strong>ใส่หูฟัง</strong>เพื่อผลแม่นที่สุด · โหมดนี้วัด<strong>ความตรงโน้ตและความนิ่ง</strong>ของเสียงคุณ (ไม่เทียบทำนองต้นฉบับ — YouTube ไม่อนุญาตให้อ่านเสียงจากวิดีโอ)</p>
      </div>

      <!-- โหมดเพลงฝึกเสียง: เทียบต้นฉบับ -->
      <div id="scBuiltinPanel" class="hidden">
        <div class="ref-track-card">
          <div class="ref-track-info">
            <div class="ref-track-icon">🎙️</div>
            <div>
              <div class="ref-track-name">5 Minute Vocal Warm Up</div>
              <div class="ref-track-artist">เพลงฝึกเสียงของโรงเรียน — เทียบกับต้นฉบับเต็มรูปแบบ</div>
            </div>
          </div>
        </div>
        <p class="note-text">🎧 แนะนำให้ใส่หูฟัง เพื่อไม่ให้ไมค์จับเสียงเพลงแทนเสียงร้อง</p>
      </div>

      <div class="status-msg" id="scStatus"></div>
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

  let source = 'youtube';
  let ytPlayer = null;
  let ytVideoId = null;

  // ── สลับแท็บ ──
  const tabYt = el('scTabYt'), tabB = el('scTabBuiltin');
  function setSource(s) {
    source = s;
    tabYt.classList.toggle('active', s === 'youtube');
    tabB.classList.toggle('active', s === 'builtin');
    el('scYtPanel').classList.toggle('hidden', s !== 'youtube');
    el('scBuiltinPanel').classList.toggle('hidden', s !== 'builtin');
    startBtn.disabled = s === 'youtube' ? !ytPlayer : !cache.builtin;
    statusEl.textContent = s === 'youtube' && !ytPlayer ? 'วางลิงก์เพลง YouTube ก่อนนะ' : statusEl.textContent;
  }
  tabYt.addEventListener('click', () => setSource('youtube'));
  tabB.addEventListener('click', () => {
    setSource('builtin');
    loadBuiltin(statusEl).then(() => { if (source === 'builtin') startBtn.disabled = false; })
      .catch(() => { statusEl.textContent = '⚠️ โหลดเพลงต้นฉบับไม่สำเร็จ'; });
  });

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
    if (source === 'youtube') startBtn.disabled = false;
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

  if (source === 'youtube') {
    const lyrics = el('scLyricsIn').value;
    return runYoutube({ stage, signal, voiceLow, voiceHigh, player: ytPlayer, videoId: ytVideoId, lyricsText: lyrics, el, setupEl, playEl, noteEl, instrEl });
  }
  return runBuiltin({ stage, signal, el, setupEl, playEl, noteEl, instrEl });
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

// ═══════════ โหมดเพลงฝึกเสียง: เทียบต้นฉบับ (Compare v2 เดิม) ═══════════
async function runBuiltin({ stage, signal, el, setupEl, playEl, noteEl, instrEl }) {
  const refFrames = cache.builtin;
  const audioData = cache.builtinAudio;
  if (!refFrames || !audioData) return null;

  setupEl.classList.add('hidden');
  playEl.classList.remove('hidden');

  const canvas = el('scCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;

  const refVoiced = refFrames.filter(f => f.midi !== null);
  const refMidis = refVoiced.map(f => f.midi);
  const refCenter = refMidis.length ? refMidis.reduce((a, b) => a + b) / refMidis.length : 60;
  const viewLow = Math.min(...refMidis, refCenter - 6) - 2;
  const viewHigh = Math.max(...refMidis, refCenter + 6) + 2;
  const yOf = m => H - ((m - viewLow) / (viewHigh - viewLow)) * H;
  const PX_PER_SEC = W / 6;
  const NOW_X = W * 0.3;

  const userTrace = [];

  function draw(nowSec) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f0f6ff';
    ctx.fillRect(0, 0, W, H);
    for (let m = Math.ceil(viewLow); m <= viewHigh; m++) {
      if (m % 12 !== 0) continue;
      const y = yOf(m);
      ctx.strokeStyle = 'rgba(33,150,243,0.14)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(74,101,133,0.5)';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(NOTE_NAMES[0] + (Math.floor(m / 12) - 1), 4, y - 3);
    }
    ctx.strokeStyle = 'rgba(25,118,210,0.6)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    let started = false;
    const i0 = Math.max(0, Math.floor((nowSec - 2) / HOP));
    const i1 = Math.min(refFrames.length - 1, Math.ceil((nowSec + 4.5) / HOP));
    for (let i = i0; i <= i1; i++) {
      const f = refFrames[i];
      if (f.midi === null) { started = false; continue; }
      const x = NOW_X + (f.time - nowSec) * PX_PER_SEC;
      const y = yOf(f.midi);
      if (!started) { ctx.beginPath(); ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
      if (started && (i === i1 || refFrames[i + 1]?.midi === null)) ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(220,38,38,0.85)';
    ctx.lineWidth = 2.5;
    started = false;
    for (const p of userTrace) {
      if (p.t < nowSec - 2) continue;
      if (p.midi === null) { started = false; continue; }
      const x = NOW_X + (p.t - nowSec) * PX_PER_SEC;
      const y = yOf(p.midi);
      if (!started) { ctx.beginPath(); ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    if (started) ctx.stroke();
    ctx.strokeStyle = 'rgba(13,27,46,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(NOW_X, 0); ctx.lineTo(NOW_X, H); ctx.stroke();
  }

  const userBuckets = new Map();
  let playStartPerf = null;
  let srcNode = null;

  const mic = new MicSession({
    processed: true,
    onStatus: s => {
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      if (playStartPerf === null) return;
      const songT = (frame.time - playStartPerf) / 1000 - LATENCY;
      if (songT < 0) return;
      if (frame.voiced) {
        const b = Math.floor(songT / HOP);
        if (!userBuckets.has(b)) userBuckets.set(b, []);
        userBuckets.get(b).push(frame.midi);
        const disp = frame.midi + 12 * Math.round((refCenter - frame.midi) / 12);
        userTrace.push({ t: songT, midi: disp });
        const info = freqToNoteInfo(frame.freq);
        noteEl.textContent = `${info.note}${info.octave}`;
      } else {
        userTrace.push({ t: songT, midi: null });
      }
      while (userTrace.length && userTrace[0].t < songT - 3) userTrace.shift();
      draw(songT);
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => { mic.stop(); try { srcNode?.stop(); } catch (_) {} };
  signal.addEventListener('abort', onAbort);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  while (mic.running && !mic.calibrated) {
    if (signal.aborted) return null;
    await wait(100);
  }

  instrEl.textContent = '🎵 เพลงกำลังเริ่ม ร้องตามเลย!';
  const decoded = await mic.audioCtx.decodeAudioData(audioData.slice(0));
  srcNode = mic.audioCtx.createBufferSource();
  srcNode.buffer = decoded;
  srcNode.connect(mic.audioCtx.destination);

  const stopPromise = new Promise(resolve => {
    el('scStop').addEventListener('click', resolve, { once: true });
    srcNode.onended = resolve;
    signal.addEventListener('abort', resolve, { once: true });
  });

  srcNode.start();
  playStartPerf = performance.now();

  await stopPromise;
  try { srcNode.stop(); } catch (_) { /* จบไปแล้ว */ }
  const sungSec = (performance.now() - playStartPerf) / 1000;
  signal.removeEventListener('abort', onAbort);
  mic.stop();
  if (signal.aborted) return null;

  let counted = 0, inTune = 0, slightOff = 0, off = 0, centsSum = 0, scoreSum = 0;
  const mismatches = [];
  for (const [b, midis] of [...userBuckets.entries()].sort((a, z) => a[0] - z[0])) {
    const userMidi = midis.sort((x, y) => x - y)[midis.length >> 1];
    let best = null;
    let bestRef = null;
    for (let j = Math.max(0, b - DTW_SPAN); j <= Math.min(refFrames.length - 1, b + DTW_SPAN); j++) {
      const rf = refFrames[j];
      if (rf.midi === null) continue;
      const d = Math.abs(foldCents((userMidi - rf.midi) * 100));
      if (best === null || d < best) { best = d; bestRef = rf; }
    }
    if (best === null) continue;
    counted++;
    centsSum += best;
    scoreSum += scoreFromCents(best);
    if (best <= 20) inTune++;
    else if (best <= 50) slightOff++;
    else {
      off++;
      mismatches.push({ time: b * HOP, refMidi: bestRef.midi, userMidi, cents: Math.round(best) });
    }
  }

  if (counted < 60) {
    return {
      score: 0,
      accuracy_pct: 0,
      avg_cents_off: null,
      details: { mode: 'builtin', sung_sec: Math.round(sungSec), counted, note: 'ร้องสั้นเกินไป' },
    };
  }

  const score = scoreSum / counted;
  const groups = [];
  let g = null;
  for (const m of mismatches) {
    if (!g || m.time - g.end > 0.5) {
      if (g) groups.push(g);
      g = { start: m.time, end: m.time, ref: midiToNoteName(Math.round(m.refMidi)), cents: [m.cents] };
    } else { g.end = m.time; g.cents.push(m.cents); }
  }
  if (g) groups.push(g);

  return {
    score,
    accuracy_pct: (inTune / counted) * 100,
    avg_cents_off: centsSum / counted,
    details: {
      mode: 'builtin',
      song: 'builtin_warmup',
      sung_sec: Math.round(sungSec),
      in_tune: inTune, slight_off: slightOff, off,
      worst_spots: groups.slice(0, 10).map(x => ({
        at: Math.round(x.start), ref: x.ref,
        avg_cents: Math.round(x.cents.reduce((a, b) => a + b) / x.cents.length),
      })),
    },
  };
}
