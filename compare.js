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

// Re-use YIN from app.js scope — same function, local alias
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

// Analyse an AudioBuffer → array of {time, freq, midi, note, rms}
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
    if (rms < 0.005) {
      frames.push({ time, freq: 0, midi: null, note: null, rms });
      continue;
    }

    const freq = detectPitchC(buf, sr);
    const valid = freq >= 50 && freq <= 2000;
    const midi  = valid ? freqToMidi(freq) : null;
    const note  = valid ? freqToNote(freq) : null;
    frames.push({ time, freq: valid ? freq : 0, midi, note, rms });
  }
  return frames;
}

// ── State ──────────────────────────────────────────────
let refFrames   = null;   // pitch timeline of reference audio
let userFrames  = [];     // pitch timeline of user recording
let cmpAudioCtx = null;
let cmpAnalyser = null;
let cmpStream   = null;
let cmpAnimFrame= null;
let isRecording = false;
let recordStart = 0;
let mediaRecorder = null;
let recordedChunks = [];
const HOP_SEC   = 0.05;  // 50 ms per frame

// ── DOM ────────────────────────────────────────────────
const tabYoutube   = document.getElementById('tabYoutube');
const tabUpload    = document.getElementById('tabUpload');
const panelYoutube = document.getElementById('panelYoutube');
const panelUpload  = document.getElementById('panelUpload');
const refFileInput = document.getElementById('refFileInput');
const refAnalyzing = document.getElementById('refAnalyzing');
const refReady     = document.getElementById('refReady');
const uploadLabel  = document.getElementById('uploadLabel');
const uploadLabelText = document.getElementById('uploadLabelText');

const cmpStartBtn  = document.getElementById('cmpStartBtn');
const cmpStopBtn   = document.getElementById('cmpStopBtn');
const cmpLivePitch = document.getElementById('cmpLivePitch');
const cmpCurrentNote = document.getElementById('cmpCurrentNote');
const cmpNoteOctave  = document.getElementById('cmpNoteOctave');
const cmpFreqDisplay = document.getElementById('cmpFreqDisplay');
const cmpMeterBar    = document.getElementById('cmpMeterBar');

const cmpReport    = document.getElementById('cmpReport');
const rptScore     = document.getElementById('rptScore');
const rptInTune    = document.getElementById('rptInTune');
const rptSlightOff = document.getElementById('rptSlightOff');
const rptOff       = document.getElementById('rptOff');
const mismatchList = document.getElementById('mismatchList');
const cmpCanvas    = document.getElementById('cmpCanvas');
const cmpCtx       = cmpCanvas.getContext('2d');

// ── Source tabs ────────────────────────────────────────
tabYoutube.addEventListener('click', () => {
  tabYoutube.classList.add('active'); tabUpload.classList.remove('active');
  panelYoutube.classList.remove('hidden'); panelUpload.classList.add('hidden');
});
tabUpload.addEventListener('click', () => {
  tabUpload.classList.add('active'); tabYoutube.classList.remove('active');
  panelUpload.classList.remove('hidden'); panelYoutube.classList.add('hidden');
});

// ── File upload & analysis ─────────────────────────────
uploadLabel.addEventListener('click', () => refFileInput.click());
refFileInput.addEventListener('change', async () => {
  const file = refFileInput.files[0];
  if (!file) return;
  uploadLabelText.textContent = `📄 ${file.name}`;
  refAnalyzing.classList.remove('hidden');
  refReady.classList.add('hidden');

  try {
    const arrayBuf = await file.arrayBuffer();
    const offCtx   = new OfflineAudioContext(1, 1, 44100); // temp to decode
    const decoded  = await offCtx.decodeAudioData(arrayBuf);

    // Resample to 22050 via OfflineAudioContext for faster analysis
    const targetSr  = 22050;
    const duration  = decoded.duration;
    const offCtx2   = new OfflineAudioContext(1, Math.ceil(duration * targetSr), targetSr);
    const src       = offCtx2.createBufferSource();
    src.buffer      = decoded;
    src.connect(offCtx2.destination);
    src.start(0);
    const resampled = await offCtx2.startRendering();

    refFrames = analyseBuffer(resampled, HOP_SEC);
    refAnalyzing.classList.add('hidden');
    refReady.classList.remove('hidden');
    cmpStartBtn.disabled = false;
  } catch (err) {
    refAnalyzing.classList.add('hidden');
    uploadLabelText.textContent = '❌ ไม่สามารถอ่านไฟล์ได้ ลองไฟล์อื่น';
  }
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

    // Live analyser for real-time display
    const source = cmpAudioCtx.createMediaStreamSource(cmpStream);
    cmpAnalyser  = cmpAudioCtx.createAnalyser();
    cmpAnalyser.fftSize = 2048;
    cmpAnalyser.smoothingTimeConstant = 0.4;
    source.connect(cmpAnalyser);

    // MediaRecorder to capture full audio for post analysis
    recordedChunks = [];
    const mimeType = getSupportedMime();
    mediaRecorder  = new MediaRecorder(cmpStream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start(100);

    isRecording = true;
    userFrames  = [];
    recordStart = cmpAudioCtx.currentTime;

    cmpStartBtn.classList.add('hidden');
    cmpStopBtn.classList.remove('hidden');
    cmpLivePitch.style.display = 'block';
    cmpReport.classList.add('hidden');

    liveLoop();
  } catch (err) {
    const permBanner = document.getElementById('permBanner');
    const permMsg    = document.getElementById('permMsg');
    permMsg.textContent = '🚫 ไม่สามารถเปิดไมค์ได้ — ' + err.message;
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

  mediaRecorder.onstop = async () => {
    cmpStartBtn.textContent = '⏳ กำลังวิเคราะห์...';
    cmpStartBtn.disabled    = true;
    cmpStartBtn.classList.remove('hidden');

    try {
      const blob     = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      const arrayBuf = await blob.arrayBuffer();
      const decoded  = await cmpAudioCtx.decodeAudioData(arrayBuf);
      userFrames     = analyseBuffer(decoded, HOP_SEC);
      buildReport();
    } catch (err) {
      cmpStartBtn.textContent = '🎤 เริ่มบันทึกเสียง';
      cmpStartBtn.disabled = false;
      mismatchList.innerHTML = '<p style="color:red">วิเคราะห์ไม่สำเร็จ: ' + err.message + '</p>';
      cmpReport.classList.remove('hidden');
    }

    cmpAudioCtx.close();
    cmpStartBtn.textContent = '🎤 เริ่มบันทึกอีกครั้ง';
    cmpStartBtn.disabled = false;
  };
  mediaRecorder.stop();
}

// ── Live pitch display while recording ────────────────
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

  // Meter vs nearest semitone
  const cents = (midi - Math.round(midi)) * 100;
  const pct   = 50 + (cents / 50) * 45;
  cmpMeterBar.style.left = Math.max(5, Math.min(95, pct)) + '%';
  const abs = Math.abs(cents);
  cmpMeterBar.style.background = abs < 10 ? '#16a34a' : abs < 25 ? '#ca8a04' : '#dc2626';
}

// ── Build comparison report ────────────────────────────
function buildReport() {
  cmpReport.classList.remove('hidden');

  // If no reference frames, just show user stats
  if (!refFrames || refFrames.length === 0) {
    buildYoutubeReport();
    return;
  }
  buildFileReport();
}

// When reference = uploaded file: full frame-by-frame comparison
function buildFileReport() {
  const minLen = Math.min(refFrames.length, userFrames.length);

  let inTune = 0, slightOff = 0, off = 0, total = 0;
  const mismatches = [];

  for (let i = 0; i < minLen; i++) {
    const ref  = refFrames[i];
    const user = userFrames[i];
    if (!ref.midi || !user.midi) continue;
    total++;

    const centDiff = Math.abs((user.midi - ref.midi) * 100);
    if (centDiff < 20)       inTune++;
    else if (centDiff < 50)  slightOff++;
    else                     off++;

    if (centDiff >= 50) {
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
  renderReport(score, inTune, slightOff, off, total, mismatches, true);
  drawCompareCanvas(refFrames, userFrames, minLen);
}

// When reference = YouTube (no audio data): just analyse user's pitch quality
function buildYoutubeReport() {
  let inTune = 0, slightOff = 0, off = 0, total = 0;
  const mismatches = [];

  userFrames.forEach(f => {
    if (!f.midi) return;
    total++;
    const cents = Math.abs((f.midi - Math.round(f.midi)) * 100);
    if (cents < 20)      inTune++;
    else if (cents < 40) slightOff++;
    else {
      off++;
      const nearestNote = NOTE_NAMES_C[((Math.round(f.midi) % 12) + 12) % 12];
      mismatches.push({
        time:     f.time,
        refNote:  nearestNote,
        refMidi:  Math.round(f.midi),
        userNote: f.note,
        userMidi: f.midi,
        centDiff: Math.round(cents),
      });
    }
  });

  const score = total > 0 ? Math.round((inTune / total) * 100) : 0;
  renderReport(score, inTune, slightOff, off, total, mismatches, false);
  drawUserOnlyCanvas(userFrames);
}

function renderReport(score, inTune, slightOff, off, total, mismatches, hasRef) {
  rptScore.textContent = score + '%';
  rptScore.style.color = score >= 75 ? '#1976D2' : score >= 50 ? '#ca8a04' : '#dc2626';
  rptInTune.textContent    = inTune    + ' frames';
  rptSlightOff.textContent = slightOff + ' frames';
  rptOff.textContent       = off       + ' frames';

  // Mismatch list
  if (mismatches.length === 0) {
    mismatchList.innerHTML = '<p class="no-mismatch">🎉 ไม่พบจุดที่เสียงออกนอกโน้ตมากเกินไป!</p>';
    return;
  }

  // Group consecutive mismatches into segments
  const segments = groupMismatches(mismatches);
  let html = '';
  segments.forEach((seg, idx) => {
    const timeStr   = formatTime(seg.startTime);
    const endStr    = formatTime(seg.endTime);
    const severity  = seg.avgCents > 100 ? 'high' : seg.avgCents > 60 ? 'med' : 'low';
    const direction = seg.avgUserMidi > seg.avgRefMidi ? '▲ สูงเกิน' : '▼ ต่ำเกิน';
    html += `
      <div class="mismatch-item ${severity}">
        <div class="mismatch-time">${timeStr} – ${endStr}</div>
        <div class="mismatch-detail">
          <span class="mismatch-ref">โน้ตเป้าหมาย: <strong>${seg.refNote}</strong></span>
          <span class="mismatch-user">ที่ร้อง: <strong>${seg.userNote}</strong></span>
          <span class="mismatch-cents ${severity}">${direction} ~${Math.round(seg.avgCents)} cents</span>
        </div>
      </div>`;
  });

  if (!hasRef) {
    html = `<p class="note-text" style="margin-bottom:8px">⚠️ โหมด YouTube: วัดความตรงโน้ตเทียบกับโน้ตที่ใกล้ที่สุด (ไม่มีไฟล์อ้างอิง)</p>` + html;
  }

  mismatchList.innerHTML = html;
}

function groupMismatches(mismatches) {
  if (!mismatches.length) return [];
  const segments = [];
  let seg = { ...mismatches[0], endTime: mismatches[0].time, refNotes: [mismatches[0].refNote], userNotes: [mismatches[0].userNote], avgRefMidi: mismatches[0].refMidi, avgUserMidi: mismatches[0].userMidi, cents: [mismatches[0].centDiff], startTime: mismatches[0].time };

  for (let i = 1; i < mismatches.length; i++) {
    const m = mismatches[i];
    if (m.time - seg.endTime < 0.5) {
      // Extend segment
      seg.endTime = m.time;
      seg.refNotes.push(m.refNote);
      seg.userNotes.push(m.userNote);
      seg.cents.push(m.centDiff);
    } else {
      pushSeg(segments, seg);
      seg = { startTime: m.time, endTime: m.time, refNotes: [m.refNote], userNotes: [m.userNote], avgRefMidi: m.refMidi, avgUserMidi: m.userMidi, cents: [m.centDiff] };
    }
  }
  pushSeg(segments, seg);
  return segments;
}

function pushSeg(segments, seg) {
  const mode = arr => arr.sort((a,b)=>arr.filter(v=>v===a).length-arr.filter(v=>v===b).length).pop();
  seg.refNote  = mode([...seg.refNotes]);
  seg.userNote = mode([...seg.userNotes]);
  seg.avgCents = seg.cents.reduce((a,b)=>a+b,0) / seg.cents.length;
  segments.push(seg);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ── Canvas drawings ────────────────────────────────────
function setupCanvas(cvs) {
  const dpr = window.devicePixelRatio || 1;
  cvs.width  = cvs.offsetWidth * dpr;
  cvs.height = cvs.offsetHeight * dpr;
  const c = cvs.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}

function drawCompareCanvas(refF, userF, len) {
  const c = setupCanvas(cmpCanvas);
  const w = cmpCanvas.offsetWidth, h = cmpCanvas.offsetHeight;
  c.fillStyle = '#f0f6ff'; c.fillRect(0,0,w,h);

  // Draw ref in blue, user in orange
  const midiList = [...refF.slice(0,len), ...userF.slice(0,len)].map(f=>f.midi).filter(Boolean);
  if (!midiList.length) return;
  const minM = Math.min(...midiList) - 2, maxM = Math.max(...midiList) + 2;
  const toY  = midi => h - ((midi - minM) / (maxM - minM)) * h;

  const drawLine = (frames, color) => {
    c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); let first = true;
    frames.slice(0, len).forEach((f, i) => {
      if (!f.midi) { first = true; return; }
      const x = (i / (len-1)) * w, y = toY(f.midi);
      if (first) { c.moveTo(x,y); first = false; } else c.lineTo(x,y);
    });
    c.stroke();
  };

  drawLine(refF,  'rgba(33,150,243,0.7)');   // blue = reference
  drawLine(userF, 'rgba(239,68,68,0.85)');   // red = user

  // Legend
  c.font = '11px Inter, sans-serif';
  c.fillStyle = 'rgba(33,150,243,0.9)'; c.fillRect(8, 8, 12, 4); c.fillStyle='#333'; c.fillText('ตัวอย่าง', 24, 16);
  c.fillStyle = 'rgba(239,68,68,0.9)';  c.fillRect(8,18, 12, 4); c.fillStyle='#333'; c.fillText('เสียงคุณ', 24, 26);
}

function drawUserOnlyCanvas(userF) {
  const c = setupCanvas(cmpCanvas);
  const w = cmpCanvas.offsetWidth, h = cmpCanvas.offsetHeight;
  c.fillStyle = '#f0f6ff'; c.fillRect(0,0,w,h);

  const midis = userF.map(f=>f.midi).filter(Boolean);
  if (!midis.length) return;
  const minM = Math.min(...midis) - 2, maxM = Math.max(...midis) + 2;

  c.strokeStyle = '#2196F3'; c.lineWidth = 2; c.beginPath(); let first = true;
  userF.forEach((f, i) => {
    if (!f.midi) { first = true; return; }
    const x = (i / (userF.length-1)) * w;
    const y = h - ((f.midi - minM)/(maxM - minM)) * h;
    if (first) { c.moveTo(x,y); first=false; } else c.lineTo(x,y);
  });
  c.stroke();
}
