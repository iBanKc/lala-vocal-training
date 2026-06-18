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
  const cents = Math.round((midiFloat - midi) * 100);
  const octave = Math.floor(midi / 12) - 1;
  const noteIdx = ((midi % 12) + 12) % 12;
  return { note: NOTE_NAMES[noteIdx], octave, cents, midi };
}

// YIN pitch detection (simplified)
function detectPitch(buffer, sampleRate) {
  const bufSize = buffer.length;
  const halfBuf = Math.floor(bufSize / 2);
  const yinBuf = new Float32Array(halfBuf);

  // Difference function
  for (let tau = 0; tau < halfBuf; tau++) {
    yinBuf[tau] = 0;
    for (let i = 0; i < halfBuf; i++) {
      const delta = buffer[i] - buffer[i + tau];
      yinBuf[tau] += delta * delta;
    }
  }

  // Cumulative mean normalized difference
  yinBuf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfBuf; tau++) {
    runningSum += yinBuf[tau];
    yinBuf[tau] *= tau / runningSum;
  }

  // Absolute threshold
  const threshold = 0.15;
  let tau = 2;
  while (tau < halfBuf) {
    if (yinBuf[tau] < threshold) {
      while (tau + 1 < halfBuf && yinBuf[tau + 1] < yinBuf[tau]) tau++;
      // Parabolic interpolation
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

// App state
let audioCtx = null;
let analyser = null;
let micStream = null;
let animFrame = null;
let isListening = false;

let targetNote = 'C';
let targetOctave = 4;
let targetFreq = noteToFreq('C', 4);

let pitchHistory = [];
const MAX_HISTORY = 200;
let centHistory = [];
let totalSamples = 0;
let inTuneSamples = 0;

// DOM
const currentNoteEl = document.getElementById('currentNote');
const noteOctaveEl = document.getElementById('noteOctave');
const freqDisplayEl = document.getElementById('freqDisplay');
const meterBar = document.getElementById('meterBar');
const centDisplayEl = document.getElementById('centDisplay');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const playTargetBtn = document.getElementById('playTargetBtn');
const scoreValueEl = document.getElementById('scoreValue');
const scoreSubEl = document.getElementById('scoreSub');
const canvas = document.getElementById('pitchCanvas');
const ctx2d = canvas.getContext('2d');
const app = document.getElementById('app');

// Setup canvas
function resizeCanvas() {
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  ctx2d.scale(window.devicePixelRatio, window.devicePixelRatio);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Note buttons
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

// Start listening
startBtn.addEventListener('click', async () => {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const source = audioCtx.createMediaStreamSource(micStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    isListening = true;
    pitchHistory = [];
    centHistory = [];
    totalSamples = 0;
    inTuneSamples = 0;
    scoreValueEl.textContent = '—';
    scoreSubEl.textContent = '';

    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    app.classList.add('listening');
    freqDisplayEl.textContent = 'กำลังฟัง...';

    loop();
  } catch (err) {
    freqDisplayEl.textContent = 'ไม่สามารถเปิดไมค์ได้: ' + err.message;
  }
});

// Stop listening
stopBtn.addEventListener('click', () => {
  stopListening();
});

function stopListening() {
  isListening = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close();

  startBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
  app.classList.remove('listening');
  freqDisplayEl.textContent = 'กด "เริ่ม" เพื่อเปิดไมค์';

  showScore();
}

// Main analysis loop
const bufferData = new Float32Array(2048);

function loop() {
  if (!isListening) return;
  animFrame = requestAnimationFrame(loop);

  analyser.getFloatTimeDomainData(bufferData);

  // Check volume (RMS)
  let rms = 0;
  for (let i = 0; i < bufferData.length; i++) rms += bufferData[i] * bufferData[i];
  rms = Math.sqrt(rms / bufferData.length);

  if (rms < 0.01) {
    currentNoteEl.textContent = '—';
    noteOctaveEl.textContent = '';
    freqDisplayEl.textContent = 'ไม่ได้ยินเสียง...';
    updateMeter(0);
    drawCanvas(null);
    return;
  }

  const freq = detectPitch(bufferData, audioCtx.sampleRate);
  if (freq < 50 || freq > 2000) {
    drawCanvas(null);
    return;
  }

  const info = freqToNoteInfo(freq);
  if (!info) return;

  currentNoteEl.textContent = info.note;
  noteOctaveEl.textContent = `Octave ${info.octave}`;
  freqDisplayEl.textContent = `${freq.toFixed(1)} Hz`;

  // Cents relative to target
  const centsFromTarget = 1200 * Math.log2(freq / targetFreq);
  const clampedCents = Math.max(-50, Math.min(50, centsFromTarget));

  updateMeter(clampedCents);
  centDisplayEl.textContent = `${centsFromTarget > 0 ? '+' : ''}${Math.round(centsFromTarget)} cents`;

  const absC = Math.abs(centsFromTarget);
  if (absC < 10) centDisplayEl.style.color = '#22c55e';
  else if (absC < 25) centDisplayEl.style.color = '#eab308';
  else centDisplayEl.style.color = '#ef4444';

  pitchHistory.push(freq);
  centHistory.push(centsFromTarget);
  if (pitchHistory.length > MAX_HISTORY) pitchHistory.shift();
  if (centHistory.length > MAX_HISTORY) centHistory.shift();

  totalSamples++;
  if (absC <= 20) inTuneSamples++;

  drawCanvas(centsFromTarget);
}

function updateMeter(cents) {
  // Map -50..+50 cents to 5%..95% position
  const pct = 50 + (cents / 50) * 45;
  meterBar.style.left = pct + '%';

  const abs = Math.abs(cents);
  if (abs < 10) meterBar.style.background = '#22c55e';
  else if (abs < 25) meterBar.style.background = '#eab308';
  else meterBar.style.background = '#ef4444';
}

function drawCanvas(currentCents) {
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  ctx2d.clearRect(0, 0, w, h);

  // Background
  ctx2d.fillStyle = '#0f0f1a';
  ctx2d.fillRect(0, 0, w, h);

  // Center line (target)
  ctx2d.strokeStyle = 'rgba(168,85,247,0.4)';
  ctx2d.lineWidth = 1;
  ctx2d.setLineDash([4, 4]);
  ctx2d.beginPath();
  ctx2d.moveTo(0, h / 2);
  ctx2d.lineTo(w, h / 2);
  ctx2d.stroke();
  ctx2d.setLineDash([]);

  if (centHistory.length < 2) return;

  // Draw pitch line
  ctx2d.beginPath();
  ctx2d.lineWidth = 2;

  centHistory.forEach((c, i) => {
    const x = (i / (MAX_HISTORY - 1)) * w;
    const y = h / 2 + (c / 50) * (h / 2 - 8);
    const abs = Math.abs(c);
    ctx2d.strokeStyle = abs < 10 ? '#22c55e' : abs < 25 ? '#eab308' : '#ef4444';
    if (i === 0) ctx2d.moveTo(x, y);
    else {
      ctx2d.stroke();
      ctx2d.beginPath();
      ctx2d.moveTo(x, y);
    }
  });
  ctx2d.stroke();
}

function showScore() {
  if (totalSamples === 0) return;
  const pct = Math.round((inTuneSamples / totalSamples) * 100);
  scoreValueEl.textContent = pct + '%';

  let label = '';
  if (pct >= 90) label = '🌟 ยอดเยี่ยมมาก!';
  else if (pct >= 75) label = '👍 ดีมาก ฝึกต่อไปนะ';
  else if (pct >= 50) label = '💪 พอใช้ได้ ลองอีกครั้ง';
  else label = '🎵 ฝึกต่อไปเรื่อยๆ นะ';
  scoreSubEl.textContent = label;
}

// Play target note
playTargetBtn.addEventListener('click', () => {
  const ac = new AudioContext();
  const osc = ac.createOscillator();
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
