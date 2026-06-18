// ── Compare Mode ───────────────────────────────────────
const NOTE_NAMES_C = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function freqToNote(freq) {
  if (!freq || freq <= 0) return null;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return NOTE_NAMES_C[((midi % 12) + 12) % 12];
}

function freqToMidi(freq) {
  if (!freq || freq <= 0) return null;
  return 69 + 12 * Math.log2(freq / 440);
}

function detectPitchC(buffer, sampleRate) {
  const halfBuf = Math.floor(buffer.length / 2);
  const yinBuf  = new Float32Array(halfBuf);
  for (let tau = 0; tau < halfBuf; tau++) {
    for (let i = 0; i < halfBuf; i++) {
      const d = buffer[i] - buffer[i + tau];
      yinBuf[tau] += d * d;
    }
  }
  yinBuf[0] = 1;
  let rs = 0;
  for (let tau = 1; tau < halfBuf; tau++) {
    rs += yinBuf[tau];
    yinBuf[tau] *= tau / rs;
  }
  for (let tau = 2; tau < halfBuf; tau++) {
    if (yinBuf[tau] < 0.15) {
      while (tau + 1 < halfBuf && yinBuf[tau + 1] < yinBuf[tau]) tau++;
      const p = yinBuf[tau-1] ?? yinBuf[tau], c = yinBuf[tau], n = yinBuf[tau+1] ?? yinBuf[tau];
      const denom = 2*(2*c - p - n);
      return sampleRate / (denom !== 0 ? tau + (p - n)/denom : tau);
    }
  }
  return -1;
}

// Analyse AudioBuffer → [{time, freq, midi, note, rms}]
function analyseBuffer(audioBuffer, hopSec = 0.05) {
  const sr        = audioBuffer.sampleRate;
  const frameSize = 2048;
  const hopSize   = Math.round(hopSec * sr);
  const ch        = audioBuffer.getChannelData(0);
  const frames    = [];
  const buf       = new Float32Array(frameSize);

  for (let start = 0; start + frameSize < ch.length; start += hopSize) {
    buf.set(ch.subarray(start, start + frameSize));
    let rms = 0;
    for (let i = 0; i < frameSize; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / frameSize);

    const time = start / sr;
    if (rms < 0.005) { frames.push({ time, freq: 0, midi: null, note: null, rms }); continue; }

    const freq  = detectPitchC(buf, sr);
    const valid = freq >= 50 && freq <= 2000;
    frames.push({ time, freq: valid ? freq : 0, midi: valid ? freqToMidi(freq) : null, note: valid ? freqToNote(freq) : null, rms });
  }
  return frames;
}

// ── State ──────────────────────────────────────────────
let refFrames      = null;
let userFrames     = [];
let cmpAudioCtx    = null;
let cmpAnalyser    = null;
let cmpStream      = null;
let cmpAnimFrame   = null;
let isRecording    = false;
let mediaRecorder  = null;
let recordedChunks = [];
const HOP_SEC      = 0.05;

// ── DOM ────────────────────────────────────────────────
const refAudio       = document.getElementById('refAudio');
const refLoadStatus  = document.getElementById('refLoadStatus');
const cmpStartBtn    = document.getElementById('cmpStartBtn');
const cmpStopBtn     = document.getElementById('cmpStopBtn');
const cmpLivePitch   = document.getElementById('cmpLivePitch');
const cmpCurrentNote = document.getElementById('cmpCurrentNote');
const cmpNoteOctave  = document.getElementById('cmpNoteOctave');
const cmpFreqDisplay = document.getElementById('cmpFreqDisplay');
const cmpMeterBar    = document.getElementById('cmpMeterBar');
const cmpReport      = document.getElementById('cmpReport');
const rptScore       = document.getElementById('rptScore');
const rptInTune      = document.getElementById('rptInTune');
const rptSlightOff   = document.getElementById('rptSlightOff');
const rptOff         = document.getElementById('rptOff');
const mismatchList   = document.getElementById('mismatchList');
const cmpCanvas      = document.getElementById('cmpCanvas');
const cmpCtx         = cmpCanvas.getContext('2d');

// ── Auto-load reference.mp3 ────────────────────────────
async function loadReference() {
  try {
    refLoadStatus.textContent = '⏳ กำลังโหลดและวิเคราะห์เสียงตัวอย่าง...';
    refLoadStatus.className   = 'status-msg';

    const resp      = await fetch('reference.mp3');
    const arrayBuf  = await resp.arrayBuffer();

    // Decode at 22050 Hz via OfflineAudioContext for faster pitch analysis
    const tmpCtx    = new (window.AudioContext || window.webkitAudioContext)();
    const decoded   = await tmpCtx.decodeAudioData(arrayBuf);
    tmpCtx.close();

    const targetSr  = 22050;
    const offCtx    = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSr), targetSr);
    const src       = offCtx.createBufferSource();
    src.buffer      = decoded;
    src.connect(offCtx.destination);
    src.start(0);
    const resampled = await offCtx.startRendering();

    refFrames = analyseBuffer(resampled, HOP_SEC);

    refLoadStatus.textContent = '✅ พร้อมเปรียบเทียบ — เล่นเสียงตัวอย่างแล้วร้องตาม';
    refLoadStatus.className   = 'status-msg success';
    cmpStartBtn.disabled      = false;
    cmpStartBtn.textContent   = '🎤 เริ่มบันทึกเสียง';
  } catch (err) {
    refLoadStatus.textContent = '❌ โหลดไฟล์ตัวอย่างไม่สำเร็จ: ' + err.message;
    refLoadStatus.className   = 'status-msg error';
  }
}

// Load when Compare tab becomes visible
document.querySelector('[data-page="pageCompare"]').addEventListener('click', () => {
  if (!refFrames && refLoadStatus.className.indexOf('error') === -1) loadReference();
});

// ── Recording ──────────────────────────────────────────
cmpStartBtn.addEventListener('click', startCompareRecording);
cmpStopBtn.addEventListener('click',  stopCompareRecording);

async function startCompareRecording() {
  try {
    cmpAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (cmpAudioCtx.state === 'suspended') await cmpAudioCtx.resume();

    cmpStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    const source = cmpAudioCtx.createMediaStreamSource(cmpStream);
    cmpAnalyser  = cmpAudioCtx.createAnalyser();
    cmpAnalyser.fftSize = 2048;
    cmpAnalyser.smoothingTimeConstant = 0.4;
    source.connect(cmpAnalyser);

    // MediaRecorder for post-analysis
    recordedChunks = [];
    const mime = getSupportedMime();
    mediaRecorder = new MediaRecorder(cmpStream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start(100);

    isRecording = true;
    userFrames  = [];

    cmpStartBtn.classList.add('hidden');
    cmpStopBtn.classList.remove('hidden');
    cmpLivePitch.style.display = 'block';
    cmpReport.classList.add('hidden');

    liveLoop();
  } catch (err) {
    const permBanner = document.getElementById('permBanner');
    const permMsg    = document.getElementById('permMsg');
    let msg = '🚫 ไม่สามารถเปิดไมค์ได้';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
      msg = '🚫 ถูกปฏิเสธสิทธิ์ไมค์ — กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์';
    permMsg.textContent = msg;
    permBanner.classList.remove('hidden');
  }
}

function getSupportedMime() {
  const types = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

function stopCompareRecording() {
  isRecording = false;
  if (cmpAnimFrame) cancelAnimationFrame(cmpAnimFrame);
  if (cmpStream) cmpStream.getTracks().forEach(t => t.stop());

  cmpStopBtn.classList.add('hidden');
  cmpLivePitch.style.display = 'none';
  cmpStartBtn.textContent = '⏳ กำลังวิเคราะห์...';
  cmpStartBtn.disabled    = true;
  cmpStartBtn.classList.remove('hidden');

  mediaRecorder.onstop = async () => {
    try {
      const blob      = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      const arrayBuf  = await blob.arrayBuffer();
      const decoded   = await cmpAudioCtx.decodeAudioData(arrayBuf);
      userFrames      = analyseBuffer(decoded, HOP_SEC);
      buildReport();
    } catch (err) {
      mismatchList.innerHTML = `<p style="color:red">วิเคราะห์ไม่สำเร็จ: ${err.message}</p>`;
      cmpReport.classList.remove('hidden');
    } finally {
      cmpAudioCtx.close();
      cmpStartBtn.textContent = '🎤 เริ่มบันทึกอีกครั้ง';
      cmpStartBtn.disabled    = false;
    }
  };
  mediaRecorder.stop();
}

// ── Live pitch display ─────────────────────────────────
const liveBuf = new Float32Array(2048);
function liveLoop() {
  if (!isRecording) return;
  cmpAnimFrame = requestAnimationFrame(liveLoop);
  if (!cmpAnalyser) return;

  cmpAnalyser.getFloatTimeDomainData(liveBuf);
  let rms = 0;
  for (let i = 0; i < liveBuf.length; i++) rms += liveBuf[i] * liveBuf[i];
  rms = Math.sqrt(rms / liveBuf.length);

  if (rms < 0.008) {
    cmpCurrentNote.textContent = '—';
    cmpNoteOctave.textContent  = '';
    cmpFreqDisplay.textContent = 'ไม่ได้ยินเสียง...';
    cmpMeterBar.style.left = '50%';
    return;
  }
  const freq = detectPitchC(liveBuf, cmpAudioCtx.sampleRate);
  if (freq < 50 || freq > 2000) return;

  const midi   = freqToMidi(freq);
  const note   = freqToNote(freq);
  const octave = Math.floor(Math.round(midi) / 12) - 1;

  cmpCurrentNote.textContent = note || '—';
  cmpNoteOctave.textContent  = note ? `Octave ${octave}` : '';
  cmpFreqDisplay.textContent = `${freq.toFixed(1)} Hz`;

  const cents = (midi - Math.round(midi)) * 100;
  const pct   = 50 + (cents / 50) * 45;
  cmpMeterBar.style.left = Math.max(5, Math.min(95, pct)) + '%';
  const abs = Math.abs(cents);
  cmpMeterBar.style.background = abs < 10 ? '#16a34a' : abs < 25 ? '#ca8a04' : '#dc2626';
}

// ── Build comparison report ────────────────────────────
function buildReport() {
  cmpReport.classList.remove('hidden');
  cmpReport.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const minLen = Math.min(refFrames.length, userFrames.length);
  let inTune = 0, slightOff = 0, off = 0, total = 0;
  const mismatches = [];

  for (let i = 0; i < minLen; i++) {
    const ref  = refFrames[i];
    const user = userFrames[i];
    if (!ref.midi || !user.midi) continue;
    total++;

    const centDiff = Math.abs((user.midi - ref.midi) * 100);
    if (centDiff < 20)      inTune++;
    else if (centDiff < 50) slightOff++;
    else {
      off++;
      mismatches.push({
        time:     ref.time,
        refNote:  ref.note,
        refMidi:  ref.midi,
        userNote: user.note,
        userMidi: user.midi,
        centDiff: Math.round(centDiff),
      });
    }
  }

  const score = total > 0 ? Math.round((inTune / total) * 100) : 0;

  // Score display
  rptScore.textContent   = score + '%';
  rptScore.style.color   = score >= 75 ? '#1976D2' : score >= 50 ? '#ca8a04' : '#dc2626';
  rptInTune.textContent  = inTune    + ' ช่วง';
  rptSlightOff.textContent = slightOff + ' ช่วง';
  rptOff.textContent     = off       + ' ช่วง';

  // Graph
  drawCompareCanvas(refFrames, userFrames, minLen);

  // Mismatch list
  if (mismatches.length === 0) {
    mismatchList.innerHTML = '<p class="no-mismatch">🎉 ไม่พบจุดที่เสียงออกนอกโน้ตมากเกินไป!</p>';
    return;
  }

  const segments = groupMismatches(mismatches);
  mismatchList.innerHTML = segments.map(seg => {
    const severity  = seg.avgCents > 100 ? 'high' : seg.avgCents > 60 ? 'med' : 'low';
    const direction = seg.avgUserMidi > seg.avgRefMidi ? '▲ สูงเกิน' : '▼ ต่ำเกิน';
    return `
      <div class="mismatch-item ${severity}">
        <div class="mismatch-time">${formatTime(seg.startTime)} – ${formatTime(seg.endTime)}</div>
        <div class="mismatch-detail">
          <span class="mismatch-ref">เป้าหมาย: <strong>${seg.refNote}</strong></span>
          <span class="mismatch-user">ที่ร้อง: <strong>${seg.userNote}</strong></span>
          <span class="mismatch-cents ${severity}">${direction} ~${Math.round(seg.avgCents)} cents</span>
        </div>
      </div>`;
  }).join('');
}

function groupMismatches(mismatches) {
  const segments = [];
  let seg = null;
  for (const m of mismatches) {
    if (!seg || m.time - seg.endTime > 0.5) {
      if (seg) segments.push(finaliseSeg(seg));
      seg = { startTime: m.time, endTime: m.time, refNotes: [m.refNote], userNotes: [m.userNote], refMidis: [m.refMidi], userMidis: [m.userMidi], cents: [m.centDiff] };
    } else {
      seg.endTime = m.time;
      seg.refNotes.push(m.refNote); seg.userNotes.push(m.userNote);
      seg.refMidis.push(m.refMidi); seg.userMidis.push(m.userMidi);
      seg.cents.push(m.centDiff);
    }
  }
  if (seg) segments.push(finaliseSeg(seg));
  return segments;
}

function finaliseSeg(seg) {
  const mode = arr => [...arr].sort((a,b) => arr.filter(v=>v===b).length - arr.filter(v=>v===a).length)[0];
  return {
    ...seg,
    refNote:     mode(seg.refNotes),
    userNote:    mode(seg.userNotes),
    avgRefMidi:  seg.refMidis.reduce((a,b)=>a+b,0) / seg.refMidis.length,
    avgUserMidi: seg.userMidis.reduce((a,b)=>a+b,0) / seg.userMidis.length,
    avgCents:    seg.cents.reduce((a,b)=>a+b,0) / seg.cents.length,
  };
}

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ── Canvas ─────────────────────────────────────────────
function drawCompareCanvas(refF, userF, len) {
  const dpr = window.devicePixelRatio || 1;
  cmpCanvas.width  = cmpCanvas.offsetWidth  * dpr;
  cmpCanvas.height = cmpCanvas.offsetHeight * dpr;
  cmpCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = cmpCanvas.offsetWidth, h = cmpCanvas.offsetHeight;
  cmpCtx.fillStyle = '#f0f6ff';
  cmpCtx.fillRect(0, 0, w, h);

  const midiVals = [...refF.slice(0,len), ...userF.slice(0,len)].map(f=>f.midi).filter(Boolean);
  if (!midiVals.length) return;
  const minM = Math.min(...midiVals) - 2, maxM = Math.max(...midiVals) + 2;
  const toY  = midi => h - ((midi - minM) / (maxM - minM)) * (h - 8) - 4;

  const drawLine = (frames, color) => {
    cmpCtx.strokeStyle = color;
    cmpCtx.lineWidth   = 2;
    cmpCtx.beginPath();
    let first = true;
    frames.slice(0, len).forEach((f, i) => {
      if (!f.midi) { first = true; return; }
      const x = (i / (len - 1)) * w;
      const y = toY(f.midi);
      if (first) { cmpCtx.moveTo(x, y); first = false; } else cmpCtx.lineTo(x, y);
    });
    cmpCtx.stroke();
  };

  drawLine(refF,  'rgba(33,150,243,0.7)');
  drawLine(userF, 'rgba(239,68,68,0.85)');

  // Legend
  cmpCtx.font = `${12 * dpr / dpr}px Inter, sans-serif`;
  cmpCtx.fillStyle = 'rgba(33,150,243,1)';  cmpCtx.fillRect(8, 6, 14, 4);
  cmpCtx.fillStyle = '#333'; cmpCtx.fillText('ตัวอย่าง', 26, 14);
  cmpCtx.fillStyle = 'rgba(239,68,68,1)';   cmpCtx.fillRect(8, 18, 14, 4);
  cmpCtx.fillStyle = '#333'; cmpCtx.fillText('เสียงคุณ', 26, 26);
}
