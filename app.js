// ฝึกอิสระ (Pitch Trainer) — ใช้ Pitch Engine v2
import {
  noteToFreq, freqToNoteInfo, centsBetween, scoreFromCents,
  MicSession, SegmentTracker,
} from './js/pitch-engine.js';
import { playNote } from './js/tone.js';

// ── State ──────────────────────────────────────────────
let mic = null;
let isListening = false;

let targetNote = 'C';
let targetOctave = 4;
let targetFreq = noteToFreq('C', 4);
let targetMidi = 60;

let centHistory = [];
const MAX_HISTORY = 200;

// เก็บ segment ที่ร้องจบแล้ว เพื่อคิดคะแนนแบบ segment (ไม่ใช่ต่อเฟรม)
let segments = [];
let segTracker = null;

// ── Bottom navigation ──────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.page;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(target).classList.add('active');
    if (target !== 'pagePitch' && isListening) stopListening();
  });
});

// ── DOM ────────────────────────────────────────────────
const currentNoteEl = document.getElementById('currentNote');
const noteOctaveEl  = document.getElementById('noteOctave');
const freqDisplayEl = document.getElementById('freqDisplay');
const meterBar      = document.getElementById('meterBar');
const centDisplayEl = document.getElementById('centDisplay');
const startBtn      = document.getElementById('startBtn');
const stopBtn       = document.getElementById('stopBtn');
const playTargetBtn = document.getElementById('playTargetBtn');
const scoreValueEl  = document.getElementById('scoreValue');
const scoreSubEl    = document.getElementById('scoreSub');
const canvas        = document.getElementById('pitchCanvas');
const ctx2d         = canvas.getContext('2d');
const appEl         = document.getElementById('app');
const permBanner    = document.getElementById('permBanner');
const permMsg       = document.getElementById('permMsg');

// ── Canvas resize ──────────────────────────────────────
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

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

  centHistory = [];
  segments = [];
  segTracker = new SegmentTracker({ onSegment: seg => segments.push(seg) });
  scoreValueEl.textContent = '—';
  scoreSubEl.textContent = '';

  mic = new MicSession({
    onFrame: handleFrame,
    onStatus: s => {
      if (s === 'calibrating') freqDisplayEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'ready') freqDisplayEl.textContent = 'กำลังฟัง... ร้องได้เลย!';
    },
  });

  try {
    await mic.start();
    isListening = true;
    startBtn.classList.add('hidden');
    startBtn.disabled = false;
    stopBtn.classList.remove('hidden');
    appEl.classList.add('listening');
  } catch (err) {
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

// ── Frame handler (จาก MicSession) ─────────────────────
function handleFrame(frame) {
  segTracker.push(frame);

  if (!frame.voiced) {
    currentNoteEl.textContent = '—';
    noteOctaveEl.textContent = '';
    freqDisplayEl.textContent = 'ไม่ได้ยินเสียง...';
    updateMeter(0);
    drawCanvas();
    return;
  }

  const info = freqToNoteInfo(frame.freq);
  currentNoteEl.textContent = info.note;
  noteOctaveEl.textContent  = `Octave ${info.octave}`;
  freqDisplayEl.textContent = `${frame.freq.toFixed(1)} Hz`;

  const centsFromTarget = centsBetween(frame.freq, targetFreq);
  const absC = Math.abs(centsFromTarget);

  updateMeter(Math.max(-50, Math.min(50, centsFromTarget)));
  centDisplayEl.textContent = `${centsFromTarget > 0 ? '+' : ''}${Math.round(centsFromTarget)} cents`;
  centDisplayEl.style.color = absC < 10 ? '#16a34a' : absC < 25 ? '#ca8a04' : '#dc2626';

  centHistory.push(centsFromTarget);
  if (centHistory.length > MAX_HISTORY) centHistory.shift();

  drawCanvas();
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

// ── Meter & canvas ─────────────────────────────────────
function updateMeter(cents) {
  const pct = 50 + (cents / 50) * 45;
  meterBar.style.left = pct + '%';
  const abs = Math.abs(cents);
  meterBar.style.background = abs < 10 ? '#16a34a' : abs < 25 ? '#ca8a04' : '#dc2626';
}

function drawCanvas() {
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.fillStyle = '#f0f6ff';
  ctx2d.fillRect(0, 0, w, h);

  ctx2d.strokeStyle = 'rgba(33,150,243,0.3)';
  ctx2d.lineWidth = 1;
  ctx2d.setLineDash([4, 4]);
  ctx2d.beginPath();
  ctx2d.moveTo(0, h / 2);
  ctx2d.lineTo(w, h / 2);
  ctx2d.stroke();
  ctx2d.setLineDash([]);

  if (centHistory.length < 2) return;

  ctx2d.lineWidth = 2.5;
  centHistory.forEach((c, i) => {
    const x = (i / (MAX_HISTORY - 1)) * w;
    const y = h / 2 + (Math.max(-50, Math.min(50, c)) / 50) * (h / 2 - 8);
    const abs = Math.abs(c);
    ctx2d.strokeStyle = abs < 10 ? '#16a34a' : abs < 25 ? '#ca8a04' : '#dc2626';
    if (i === 0) { ctx2d.beginPath(); ctx2d.moveTo(x, y); }
    else { ctx2d.lineTo(x, y); ctx2d.stroke(); ctx2d.beginPath(); ctx2d.moveTo(x, y); }
  });
  ctx2d.stroke();
}

// ── คะแนน: เฉลี่ยต่อ segment ถ่วงด้วยระยะเวลา ──────────
// ตัด onset/ช่วงหายใจทิ้ง ใช้ median ของแต่ละช่วงร้อง → ทน vibrato, สะท้อนความเพี้ยนจริง
function showScore() {
  const scored = segments
    .map(seg => seg.stats(targetMidi))
    .filter(Boolean);

  document.getElementById('scoreSection').classList.remove('hidden');

  if (!scored.length) {
    scoreValueEl.textContent = '—';
    scoreSubEl.textContent = 'ยังไม่ได้ยินเสียงร้องที่ชัดพอ ลองอีกครั้งนะ';
    return;
  }

  const totalDur = scored.reduce((a, s) => a + s.durMs, 0);
  const score = Math.round(scored.reduce((a, s) => a + s.score * s.durMs, 0) / totalDur);
  const avgCents = scored.reduce((a, s) => a + Math.abs(s.centsOff) * s.durMs, 0) / totalDur;

  scoreValueEl.textContent = score + '%';
  let label = '';
  if (score >= 90)      label = '🌟 ยอดเยี่ยมมาก!';
  else if (score >= 75) label = '👍 ดีมาก ฝึกต่อไปนะ';
  else if (score >= 50) label = '💪 พอใช้ได้ ลองอีกครั้ง';
  else                  label = '🎵 ฝึกต่อไปเรื่อยๆ นะ';
  scoreSubEl.textContent = `${label} (เพี้ยนเฉลี่ย ${avgCents.toFixed(0)} cents)`;
}

// ── Play target note ───────────────────────────────────
playTargetBtn.addEventListener('click', () => {
  playNote(noteToFreq(targetNote, targetOctave), 1.2);
});
