// เกมร้องเพลงเต็ม (Compare v2) — ร้องตามเพลงต้นฉบับ เทียบ pitch แบบตรงเวลา
// จุดต่างจากระบบเดิม (ที่วัดไม่ตรงความจริง):
//   1. เล่นเพลงบน AudioContext เดียวกับที่เปิดไมค์ → เวลาเพลงกับเวลาเสียงร้องตรงกันจริง
//   2. octave-invariant (fold ±600¢) → ร้องอ็อกเทฟของตัวเองได้ ไม่โดนลงโทษ
//   3. DTW-lite: เทียบกับ ref เฟรม ±3 ช่อง (±150ms) เลือกค่าดีสุด → ทนความคลาดเล็กน้อย
//   4. latency compensation 120ms (ปาก→ไมค์ + reaction)
//   5. เทียบเฉพาะช่วงที่ทั้งเพลงและผู้ร้องมีเสียง
import {
  MicSession, decodeAndAnalyse, foldCents, scoreFromCents,
  freqToNoteInfo, midiToNoteName, NOTE_NAMES,
} from '../pitch-engine.js';

const HOP = 0.05;          // วินาทีต่อเฟรม ref (ตรงกับ analyseBuffer)
const LATENCY = 0.12;      // ชดเชยความหน่วงปาก→ไมค์
const DTW_SPAN = 3;        // เทียบ ref เฟรม ±3

const cache = { builtin: null, upload: null, uploadName: null };

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

export async function run({ level, stage, signal }) {
  stage.innerHTML = `
    <div class="sc-setup" id="scSetup">
      <div class="source-tabs">
        <button class="source-tab active" id="scTabBuiltin">🎙️ เพลงฝึกเสียง</button>
        <button class="source-tab" id="scTabUpload">📂 อัปโหลดเพลง</button>
      </div>
      <div id="scBuiltinPanel">
        <div class="ref-track-card">
          <div class="ref-track-info">
            <div class="ref-track-icon">🎙️</div>
            <div>
              <div class="ref-track-name">5 Minute Vocal Warm Up</div>
              <div class="ref-track-artist">Jacobs Vocal Academy</div>
            </div>
          </div>
        </div>
      </div>
      <div id="scUploadPanel" class="hidden">
        <label class="upload-label" id="scUploadLabel">
          <span id="scUploadText">📁 แตะเพื่อเลือกไฟล์เสียง (MP3, WAV, M4A)</span>
          <input type="file" id="scFileInput" accept="audio/*" hidden />
        </label>
      </div>
      <div class="status-msg" id="scStatus"></div>
      <p class="note-text">🎧 แนะนำให้ใส่หูฟัง เพื่อไม่ให้ไมค์จับเสียงเพลงแทนเสียงร้อง</p>
      <button class="btn-start" id="scStart" disabled>🎤 เริ่มร้อง</button>
    </div>
    <div class="sc-play hidden" id="scPlay">
      <div class="nm-top">
        <div class="nm-note" id="scNote" style="font-size:2rem">—</div>
        <div class="nm-instruction" id="scInstruction"></div>
      </div>
      <div class="pg-canvas-wrap"><canvas id="scCanvas" class="pg-canvas"></canvas></div>
      <button class="btn-stop" id="scStop">⏹ จบเพลง / พอแค่นี้</button>
    </div>`;

  const statusEl = stage.querySelector('#scStatus');
  const startBtn = stage.querySelector('#scStart');
  const setupEl = stage.querySelector('#scSetup');
  const playEl = stage.querySelector('#scPlay');
  const noteEl = stage.querySelector('#scNote');
  const instrEl = stage.querySelector('#scInstruction');

  let source = 'builtin';
  let refFrames = null;
  let audioData = null; // ArrayBuffer ของเพลง

  // ── เลือกแหล่งเพลง ──
  const tabB = stage.querySelector('#scTabBuiltin');
  const tabU = stage.querySelector('#scTabUpload');
  tabB.addEventListener('click', () => {
    source = 'builtin';
    tabB.classList.add('active'); tabU.classList.remove('active');
    stage.querySelector('#scBuiltinPanel').classList.remove('hidden');
    stage.querySelector('#scUploadPanel').classList.add('hidden');
    startBtn.disabled = !cache.builtin;
  });
  tabU.addEventListener('click', () => {
    source = 'upload';
    tabU.classList.add('active'); tabB.classList.remove('active');
    stage.querySelector('#scUploadPanel').classList.remove('hidden');
    stage.querySelector('#scBuiltinPanel').classList.add('hidden');
    startBtn.disabled = !cache.upload;
  });

  stage.querySelector('#scUploadLabel').addEventListener('click', () => stage.querySelector('#scFileInput').click());
  stage.querySelector('#scFileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    stage.querySelector('#scUploadText').textContent = `🎵 ${file.name}`;
    statusEl.textContent = '⏳ กำลังวิเคราะห์เพลง...';
    startBtn.disabled = true;
    try {
      const buf = await file.arrayBuffer();
      cache.uploadAudio = buf.slice(0);
      cache.upload = await decodeAndAnalyse(buf);
      cache.uploadName = file.name;
      statusEl.textContent = '✅ พร้อมร้องแล้ว';
      startBtn.disabled = false;
    } catch {
      statusEl.textContent = '⚠️ อ่านไฟล์ไม่สำเร็จ ลองไฟล์อื่น';
    }
  });

  // โหลด builtin ทันที
  loadBuiltin(statusEl).then(() => { if (source === 'builtin') startBtn.disabled = false; })
    .catch(() => { statusEl.textContent = '⚠️ โหลดเพลงต้นฉบับไม่สำเร็จ'; });

  // ── รอผู้ใช้กดเริ่ม ──
  await new Promise((resolve, reject) => {
    startBtn.addEventListener('click', resolve, { once: true });
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }).catch(() => null);
  if (signal.aborted) return null;

  refFrames = source === 'builtin' ? cache.builtin : cache.upload;
  audioData = source === 'builtin' ? cache.builtinAudio : cache.uploadAudio;
  if (!refFrames || !audioData) return null;

  setupEl.classList.add('hidden');
  playEl.classList.remove('hidden');

  // ── canvas karaoke view ──
  const canvas = stage.querySelector('#scCanvas');
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

  const userTrace = []; // [{t, midi(display)}]

  function draw(nowSec) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f0f6ff';
    ctx.fillRect(0, 0, W, H);
    // เส้น C
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
    // เส้นเพลงต้นฉบับ (ล่วงหน้า)
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
    // เส้นเสียงผู้ร้อง
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
    // เส้น "ตอนนี้"
    ctx.strokeStyle = 'rgba(13,27,46,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(NOW_X, 0); ctx.lineTo(NOW_X, H); ctx.stroke();
  }

  // ── เริ่มร้อง: ไมค์ + เพลงบน AudioContext เดียวกัน ──
  // processed:true — ให้ echoCancellation ช่วยตัดเสียงเพลงจากลำโพงถ้าไม่ใส่หูฟัง
  const userBuckets = new Map(); // bucketIndex → [midi]
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
      // เก็บลง bucket 50ms สำหรับให้คะแนน
      if (frame.voiced) {
        const b = Math.floor(songT / HOP);
        if (!userBuckets.has(b)) userBuckets.set(b, []);
        userBuckets.get(b).push(frame.midi);
        // แสดงผล: เลื่อนอ็อกเทฟให้ใกล้เส้นเพลง (การให้คะแนนก็ไม่สนอ็อกเทฟเช่นกัน)
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
    stage.querySelector('#scStop').addEventListener('click', resolve, { once: true });
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

  // ── ให้คะแนน: เทียบ bucket ผู้ร้องกับ ref ±DTW_SPAN แบบ octave-invariant ──
  let counted = 0, inTune = 0, slightOff = 0, off = 0, centsSum = 0, scoreSum = 0;
  const mismatches = [];
  for (const [b, midis] of [...userBuckets.entries()].sort((a, z) => a[0] - z[0])) {
    const userMidi = midis.sort((x, y) => x - y)[midis.length >> 1]; // median ใน bucket
    let best = null;
    let bestRef = null;
    for (let j = Math.max(0, b - DTW_SPAN); j <= Math.min(refFrames.length - 1, b + DTW_SPAN); j++) {
      const rf = refFrames[j];
      if (rf.midi === null) continue;
      const d = Math.abs(foldCents((userMidi - rf.midi) * 100));
      if (best === null || d < best) { best = d; bestRef = rf; }
    }
    if (best === null) continue; // เพลงช่วงนั้นไม่มีเสียงร้อง (ดนตรีล้วน) — ไม่นับ
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

  if (counted < 60) { // ร้องน้อยกว่า ~3 วิ ของช่วงที่เทียบได้
    return {
      score: 0,
      accuracy_pct: 0,
      avg_cents_off: null,
      details: { source, sung_sec: Math.round(sungSec), counted, note: 'ร้องสั้นเกินไป' },
    };
  }

  const score = scoreSum / counted;
  // จัดกลุ่มจุดที่เพี้ยนหนักไว้ให้ครูดู (เก็บใน details)
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
      source,
      song: source === 'upload' ? cache.uploadName : 'builtin_warmup',
      sung_sec: Math.round(sungSec),
      in_tune: inTune, slight_off: slightOff, off,
      worst_spots: groups.slice(0, 10).map(x => ({
        at: Math.round(x.start), ref: x.ref,
        avg_cents: Math.round(x.cents.reduce((a, b) => a + b) / x.cents.length),
      })),
    },
  };
}
