// ฝึกอิสระ (Pitch Trainer) — วัดแบบเดียวกับเกมเสียงนิ่ง:
// PianoRoll โซนเป้าหมาย ±TOL, นับเวลาที่อยู่ในโซน, แถบความนิ่งจาก rolling stddev,
// คะแนน = 70×สัดส่วนเวลาในโซน + โบนัสความนิ่ง (30 − stddev)
import {
  noteToFreq, freqToNoteInfo, centsBetween,
  MicSession, SegmentTracker,
} from './js/pitch-engine.js';
import { playNote } from './js/tone.js';
import { PianoRoll } from './js/piano-roll.js';

const TOL = 25; // cents — โซนเป้าหมาย (เท่าเกมเสียงนิ่งด่าน 1)

// ── State ──────────────────────────────────────────────
let mic = null;
let isListening = false;

let targetNote = 'C';
let targetOctave = 4;
let targetFreq = noteToFreq('C', 4);
let targetMidi = 60;

// ตัวสะสมการวัด (ตรรกะเดียวกับเกมเสียงนิ่ง)
let heldMs = 0;         // เวลาที่เสียงอยู่ในโซน ±TOL
let voicedMs = 0;       // เวลาที่ได้ยินเสียงร้องทั้งหมด
let lastTime = null;
let recentMidis = [];
let segments = [];
let segTracker = null;

// ── DOM ────────────────────────────────────────────────
const currentNoteEl = document.getElementById('currentNote');
const noteOctaveEl  = document.getElementById('noteOctave');
const freqDisplayEl = document.getElementById('freqDisplay');
const centDisplayEl = document.getElementById('centDisplay');
const fpHeldEl      = document.getElementById('fpHeld');
const wobbleEl      = document.getElementById('fpWobble');
const startBtn      = document.getElementById('startBtn');
const stopBtn       = document.getElementById('stopBtn');
const playTargetBtn = document.getElementById('playTargetBtn');
const scoreValueEl  = document.getElementById('scoreValue');
const scoreSubEl    = document.getElementById('scoreSub');
const appEl         = document.getElementById('app');
const permBanner    = document.getElementById('permBanner');
const permMsg       = document.getElementById('permMsg');

// ── Piano roll (จอวัดเดียวกับเกมเสียงนิ่ง) ─────────────
const roll = new PianoRoll(document.getElementById('fpRoll'), {
  lowMidi: targetMidi - 7, highMidi: targetMidi + 7, piano: true,
});
roll.setTarget(targetMidi, TOL);

window.addEventListener('resize', () => { roll.resize(); roll.draw(); });

// ── Bottom navigation ──────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
    if (target !== 'pagePitch' && isListening) stopListening();
    // canvas ถูกสร้างตอนหน้ายังซ่อน (กว้าง 0) — วัดขนาดใหม่เมื่อหน้าเปิด
    if (target === 'pagePitch') { roll.resize(); roll.draw(); }
  });
});

// ── Note buttons ───────────────────────────────────────
document.querySelectorAll('.note-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.note-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    targetNote = btn.dataset.note;
    setTarget();
  });
});

document.getElementById('octaveSelect').addEventListener('change', e => {
  targetOctave = parseInt(e.target.value);
  setTarget();
});

function setTarget() {
  targetFreq = noteToFreq(targetNote, targetOctave);
  targetMidi = Math.round(69 + 12 * Math.log2(targetFreq / 440));
  roll.setRange(targetMidi - 7, targetMidi + 7);
  roll.setTarget(targetMidi, TOL);
  resetMeasure(); // เป้าใหม่ = เริ่มวัดใหม่ ให้ตัวเลขสะท้อนโน้ตปัจจุบัน
  roll.draw();
}

function resetMeasure() {
  heldMs = 0;
  voicedMs = 0;
  lastTime = null;
  recentMidis = [];
  segments = [];
  if (isListening) segTracker = new SegmentTracker({ onSegment: seg => segments.push(seg) });
  fpHeldEl.textContent = '0.0';
  wobbleEl.style.width = '0%';
  centDisplayEl.textContent = '0 cents';
  centDisplayEl.style.color = '';
}

// ── Microphone permission check ────────────────────────
async function checkMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showPermError('เบราว์เซอร์นี้ไม่รองรับการใช้ไมค์ — กรุณาใช้ Chrome หรือ Safari');
    startBtn.disabled = true;
    return;
  }
  if (navigator.permissions) {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });
      if (result.state === 'denied') {
        showPermError('การเข้าถึงไมค์ถูกปฏิเสธ — กรุณาเปิดสิทธิ์ในการตั้งค่าเบราว์เซอร์');
        startBtn.disabled = true;
      }
      result.addEventListener('change', () => {
        if (result.state === 'denied') {
          showPermError('การเข้าถึงไมค์ถูกปฏิเสธ — กรุณาเปิดสิทธิ์ในการตั้งค่าเบราว์เซอร์');
          startBtn.disabled = true;
        } else {
          hidePermError();
          startBtn.disabled = false;
        }
      });
    } catch (_) { /* เบราว์เซอร์ไม่รองรับ permissions query */ }
  }
}

function showPermError(msg) {
  permMsg.textContent = msg;
  permBanner.classList.remove('hidden');
}
function hidePermError() {
  permBanner.classList.add('hidden');
}

checkMicPermission();

// ── Start listening ────────────────────────────────────
startBtn.addEventListener('click', async () => {
  hidePermError();
  freqDisplayEl.textContent = 'กำลังขอสิทธิ์ไมค์...';
  startBtn.disabled = true;

  isListening = true; // ให้ resetMeasure สร้าง segTracker
  resetMeasure();
  scoreValueEl.textContent = '—';
  scoreSubEl.textContent = '';

  mic = new MicSession({
    onFrame: handleFrame,
    onStatus: s => {
      if (s === 'calibrating') freqDisplayEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'ready') freqDisplayEl.textContent = 'กำลังฟัง... ร้องได้เลย!';
      if (s === 'suspended') freqDisplayEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
  });

  try {
    await mic.start();
    startBtn.classList.add('hidden');
    startBtn.disabled = false;
    stopBtn.classList.remove('hidden');
    appEl.classList.add('listening');
    roll.resize();
    roll.clearTrace();
    roll.draw();
  } catch (err) {
    isListening = false;
    startBtn.disabled = false;
    startBtn.classList.remove('hidden');
    let msg = 'ไม่สามารถเปิดไมค์ได้';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      msg = '🚫 ถูกปฏิเสธสิทธิ์ไมค์ — กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์ แล้วรีเฟรชหน้า';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      msg = '🎤 ไม่พบไมค์ในอุปกรณ์นี้';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      msg = '⚠️ ไมค์ถูกใช้งานโดยแอปอื่นอยู่';
    } else if (err.name === 'SecurityError') {
      msg = '🔒 ต้องใช้งานผ่าน HTTPS เท่านั้น';
    }
    showPermError(msg);
    freqDisplayEl.textContent = 'กด "เริ่ม" เพื่อเปิดไมค์';
  }
});

// ── Frame handler (ตรรกะวัดเดียวกับเกมเสียงนิ่ง) ───────
function handleFrame(frame) {
  segTracker.push(frame);
  roll.pushPitch(frame.voiced ? frame.midi : null);
  roll.draw();

  const dt = lastTime === null ? 0 : frame.time - lastTime;
  lastTime = frame.time;

  if (!frame.voiced) {
    currentNoteEl.textContent = '—';
    noteOctaveEl.textContent = '';
    freqDisplayEl.textContent = 'ไม่ได้ยินเสียง...';
    return;
  }

  const info = freqToNoteInfo(frame.freq);
  currentNoteEl.textContent = info.note;
  noteOctaveEl.textContent  = `Octave ${info.octave}`;
  freqDisplayEl.textContent = `${frame.freq.toFixed(1)} Hz`;

  voicedMs += dt;
  const centsFromTarget = centsBetween(frame.freq, targetFreq);
  const absC = Math.abs(centsFromTarget);
  if (absC <= TOL) heldMs += dt;

  centDisplayEl.textContent = `${centsFromTarget > 0 ? '+' : ''}${Math.round(centsFromTarget)} cents`;
  centDisplayEl.style.color = absC <= TOL ? '#16a34a' : absC < 50 ? '#ca8a04' : '#dc2626';
  fpHeldEl.textContent = (heldMs / 1000).toFixed(1);

  // แถบความนิ่ง: rolling stddev 20 เฟรมล่าสุด
  recentMidis.push(frame.midi);
  if (recentMidis.length > 20) recentMidis.shift();
  if (recentMidis.length >= 5) {
    const mean = recentMidis.reduce((a, b) => a + b) / recentMidis.length;
    const sd = Math.sqrt(recentMidis.reduce((a, m) => a + ((m - mean) * 100) ** 2, 0) / recentMidis.length);
    const pct = Math.max(0, Math.min(100, 100 - (sd / 50) * 100));
    wobbleEl.style.width = pct + '%';
    wobbleEl.style.background = sd < 15 ? '#16a34a' : sd < 30 ? '#ca8a04' : '#dc2626';
  }
}

// ── Stop listening ─────────────────────────────────────
stopBtn.addEventListener('click', stopListening);

function stopListening() {
  isListening = false;
  if (mic) { mic.stop(); mic = null; }
  if (segTracker) segTracker.end(); // ปิด segment สุดท้ายที่ค้างอยู่

  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  appEl.classList.remove('listening');
  freqDisplayEl.textContent = 'กด "เริ่ม" เพื่อเปิดไมค์';

  showScore();
}

// ── คะแนน (สูตรเกมเสียงนิ่ง ปรับเป็นแบบไม่มีเวลาเป้าหมาย) ──
// 70 × สัดส่วนเวลาที่อยู่ในโซน ±TOL + โบนัสความนิ่ง max(0, 30 − stddev)
function showScore() {
  document.getElementById('scoreSection').classList.remove('hidden');

  const scored = segments
    .map(seg => seg.stats(targetMidi))
    .filter(Boolean);

  if (voicedMs < 1000 || !scored.length) {
    scoreValueEl.textContent = '—';
    scoreSubEl.textContent = 'ยังไม่ได้ยินเสียงร้องที่ชัดพอ ลองอีกครั้งนะ';
    return;
  }

  const totalDur = scored.reduce((a, s) => a + s.durMs, 0);
  const stddev = scored.reduce((a, s) => a + s.stddevCents * s.durMs, 0) / totalDur;
  const avgCents = scored.reduce((a, s) => a + s.meanAbsCents * s.durMs, 0) / totalDur;
  const inZone = Math.min(1, heldMs / voicedMs);
  const score = Math.round(Math.max(0, Math.min(100, 70 * inZone + Math.max(0, 30 - stddev))));

  scoreValueEl.textContent = score + '%';
  let label = '';
  if (score >= 90)      label = '🌟 ยอดเยี่ยมมาก!';
  else if (score >= 75) label = '👍 ดีมาก ฝึกต่อไปนะ';
  else if (score >= 50) label = '💪 พอใช้ได้ ลองอีกครั้ง';
  else                  label = '🎵 ฝึกต่อไปเรื่อยๆ นะ';
  scoreSubEl.textContent = `${label} อยู่ในโซน ${Math.round(inZone * 100)}% · เพี้ยนเฉลี่ย ${avgCents.toFixed(0)} cents`;
}

// ── Play target note ───────────────────────────────────
playTargetBtn.addEventListener('click', () => {
  playNote(noteToFreq(targetNote, targetOctave), 1.2);
});
