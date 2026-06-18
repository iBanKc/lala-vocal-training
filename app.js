// Note names and frequencies
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToFreq(note, octave) {
  const idx = NOTE_NAMES.indexOf(note);
  const midiNum = (octave + 1) * 12 + idx;
  return 440 * Math.pow(2, (midiNum - 69) / 12);
}

function freqToNoteInfo(freq) {
  if (freq <= 0) return null;
  const midiFloat = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiFloat);
  const octave = Math.floor(midi / 12) - 1;
  const noteIdx = ((midi % 12) + 12) % 12;
  return { note: NOTE_NAMES[noteIdx], octave, midi };
}

// YIN pitch detection
function detectPitch(buffer, sampleRate) {
  const bufSize = buffer.length;
  const halfBuf = Math.floor(bufSize / 2);
  const yinBuf = new Float32Array(halfBuf);

  for (let tau = 0; tau < halfBuf; tau++) {
    yinBuf[tau] = 0;
    for (let i = 0; i < halfBuf; i++) {
      const delta = buffer[i] - buffer[i + tau];
      yinBuf[tau] += delta * delta;
    }
  }

  yinBuf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfBuf; tau++) {
    runningSum += yinBuf[tau];
    yinBuf[tau] *= tau / runningSum;
  }

  const threshold = 0.15;
  let tau = 2;
  while (tau < halfBuf) {
    if (yinBuf[tau] < threshold) {
      while (tau + 1 < halfBuf && yinBuf[tau + 1] < yinBuf[tau]) tau++;
      const prev = yinBuf[tau - 1] ?? yinBuf[tau];
      const curr = yinBuf[tau];
      const next = yinBuf[tau + 1] ?? yinBuf[tau];
      const denom = 2 * (2 * curr - prev - next);
      const tauFine = denom !== 0 ? tau + (prev - next) / denom : tau;
      return sampleRate / tauFine;
    }
    tau++;
  }
  return -1;
}

// ── State ──────────────────────────────────────────────
let audioCtx = null;
let analyser = null;
let micStream = null;
let animFrame = null;
let isListening = false;

let targetNote = 'C';
let targetOctave = 4;
let targetFreq = noteToFreq('C', 4);

let centHistory = [];
let totalSamples = 0;
let inTuneSamples = 0;
const MAX_HISTORY = 200;

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
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
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
    targetFreq = noteToFreq(targetNote, targetOctave);
  });
});

document.getElementById('octaveSelect').addEventListener('change', e => {
  targetOctave = parseInt(e.target.value);
  targetFreq = noteToFreq(targetNote, targetOctave);
});

// ── Microphone permission check ────────────────────────
async function checkMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showPermError('เบราว์เซอร์นี้ไม่รองรับการใช้ไมค์ — กรุณาใช้ Chrome หรือ Safari');
    startBtn.disabled = true;
    return;
  }
  // Check permission state if available (not all browsers support this)
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
    } catch (_) { /* browser doesn't support permissions query */ }
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

  try {
    // Create AudioContext inside user gesture — required on iOS Safari
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Resume suspended context (common on iOS after page load)
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Mobile-optimised audio constraints
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        // Prefer front-facing mic on phones (usually the earpiece side mic)
        facingMode: undefined,
      },
      video: false,
    };

    micStream = await navigator.mediaDevices.getUserMedia(constraints);

    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    isListening = true;
    centHistory = [];
    totalSamples = 0;
    inTuneSamples = 0;
    scoreValueEl.textContent = '—';
    scoreSubEl.textContent = '';

    startBtn.classList.add('hidden');
    startBtn.disabled = false;
    stopBtn.classList.remove('hidden');
    appEl.classList.add('listening');
    freqDisplayEl.textContent = 'กำลังฟัง...';

    // Prevent screen sleep on mobile while listening
    requestWakeLock();

    loop();
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
    } else if (err.name === 'OverconstrainedError') {
      msg = '⚠️ ไมค์ไม่รองรับการตั้งค่าที่ต้องการ';
    } else if (err.name === 'SecurityError') {
      msg = '🔒 ต้องใช้งานผ่าน HTTPS เท่านั้น';
    }
    showPermError(msg);
    freqDisplayEl.textContent = 'กด "เริ่ม" เพื่อเปิดไมค์';
  }
});

// ── Stop listening ─────────────────────────────────────
stopBtn.addEventListener('click', stopListening);

function stopListening() {
  isListening = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close();
  releaseWakeLock();

  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  appEl.classList.remove('listening');
  freqDisplayEl.textContent = 'กด "เริ่ม" เพื่อเปิดไมค์';

  showScore();
}

// ── Wake Lock (prevent screen sleep on mobile) ─────────
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* not critical */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}
// Re-acquire wake lock if user switches tabs and comes back
document.addEventListener('visibilitychange', () => {
  if (isListening && document.visibilityState === 'visible') requestWakeLock();
});

// ── Main analysis loop ─────────────────────────────────
const bufferData = new Float32Array(2048);

function loop() {
  if (!isListening) return;
  animFrame = requestAnimationFrame(loop);

  analyser.getFloatTimeDomainData(bufferData);

  // RMS volume check
  let rms = 0;
  for (let i = 0; i < bufferData.length; i++) rms += bufferData[i] * bufferData[i];
  rms = Math.sqrt(rms / bufferData.length);

  if (rms < 0.008) {
    currentNoteEl.textContent = '—';
    noteOctaveEl.textContent = '';
    freqDisplayEl.textContent = 'ไม่ได้ยินเสียง...';
    updateMeter(0);
    drawCanvas(null);
    return;
  }

  const freq = detectPitch(bufferData, audioCtx.sampleRate);
  if (freq < 50 || freq > 2000) { drawCanvas(null); return; }

  const info = freqToNoteInfo(freq);
  if (!info) return;

  currentNoteEl.textContent = info.note;
  noteOctaveEl.textContent  = `Octave ${info.octave}`;
  freqDisplayEl.textContent = `${freq.toFixed(1)} Hz`;

  const centsFromTarget = 1200 * Math.log2(freq / targetFreq);
  const absC = Math.abs(centsFromTarget);

  updateMeter(Math.max(-50, Math.min(50, centsFromTarget)));
  centDisplayEl.textContent = `${centsFromTarget > 0 ? '+' : ''}${Math.round(centsFromTarget)} cents`;
  centDisplayEl.style.color = absC < 10 ? '#16a34a' : absC < 25 ? '#ca8a04' : '#dc2626';

  centHistory.push(centsFromTarget);
  if (centHistory.length > MAX_HISTORY) centHistory.shift();

  totalSamples++;
  if (absC <= 20) inTuneSamples++;

  drawCanvas(centsFromTarget);
}

function updateMeter(cents) {
  const pct = 50 + (cents / 50) * 45;
  meterBar.style.left = pct + '%';
  const abs = Math.abs(cents);
  meterBar.style.background = abs < 10 ? '#16a34a' : abs < 25 ? '#ca8a04' : '#dc2626';
}

function drawCanvas(currentCents) {
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  ctx2d.clearRect(0, 0, w, h);

  ctx2d.fillStyle = '#f0f6ff';
  ctx2d.fillRect(0, 0, w, h);

  // Centre line
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
    const y = h / 2 + (c / 50) * (h / 2 - 8);
    const abs = Math.abs(c);
    ctx2d.strokeStyle = abs < 10 ? '#16a34a' : abs < 25 ? '#ca8a04' : '#dc2626';
    if (i === 0) { ctx2d.beginPath(); ctx2d.moveTo(x, y); }
    else { ctx2d.lineTo(x, y); ctx2d.stroke(); ctx2d.beginPath(); ctx2d.moveTo(x, y); }
  });
  ctx2d.stroke();
}

function showScore() {
  if (totalSamples === 0) return;
  const pct = Math.round((inTuneSamples / totalSamples) * 100);
  scoreValueEl.textContent = pct + '%';
  let label = '';
  if (pct >= 90)      label = '🌟 ยอดเยี่ยมมาก!';
  else if (pct >= 75) label = '👍 ดีมาก ฝึกต่อไปนะ';
  else if (pct >= 50) label = '💪 พอใช้ได้ ลองอีกครั้ง';
  else                label = '🎵 ฝึกต่อไปเรื่อยๆ นะ';
  scoreSubEl.textContent = label;
}

// ── Play target note ───────────────────────────────────
playTargetBtn.addEventListener('click', () => {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.type = 'sine';
  osc.frequency.value = noteToFreq(targetNote, targetOctave);
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.linearRampToValueAtTime(0.4, ac.currentTime + 0.05);
  gain.gain.linearRampToValueAtTime(0, ac.currentTime + 1.2);
  osc.start(ac.currentTime);
  osc.stop(ac.currentTime + 1.3);
});
