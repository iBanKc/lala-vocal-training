// ── Compare Mode — ใช้ Pitch Engine v2 ร่วมกับทั้งแอป ───
import {
  NOTE_NAMES, freqToMidi, freqToNoteInfo, analyseBuffer, decodeAndAnalyse,
  detectFreq, PitchTracker,
} from './js/pitch-engine.js';

function freqToNote(freq) {
  const info = freqToNoteInfo(freq);
  return info ? info.note : null;
}

// ── State ──────────────────────────────────────────────
let refFrames        = null;   // resolved when analysis done
let refAnalysisReady = false;
let refAnalysisPromise = null; // so we can await it at compare time

let userFrames     = [];
let cmpAudioCtx    = null;
let cmpAnalyser    = null;
let cmpStream      = null;
let cmpAnimFrame   = null;
let isRecording    = false;
let mediaRecorder  = null;
let recordedChunks = [];
let activeSource   = 'builtin'; // 'builtin' | 'upload'

// ── DOM ────────────────────────────────────────────────
const tabBuiltin     = document.getElementById('tabBuiltin');
const tabUpload      = document.getElementById('tabUpload');
const panelBuiltin   = document.getElementById('panelBuiltin');
const panelUpload    = document.getElementById('panelUpload');
const refLoadStatus  = document.getElementById('refLoadStatus');
const refFileInput   = document.getElementById('refFileInput');
const uploadLabel    = document.getElementById('uploadLabel');
const uploadLabelText= document.getElementById('uploadLabelText');
const uploadAudioWrap= document.getElementById('uploadAudioWrap');
const uploadedAudio  = document.getElementById('uploadedAudio');
const uploadStatus   = document.getElementById('uploadStatus');
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

// ── Source tabs ────────────────────────────────────────
tabBuiltin.addEventListener('click', () => {
  activeSource = 'builtin';
  tabBuiltin.classList.add('active'); tabUpload.classList.remove('active');
  panelBuiltin.classList.remove('hidden'); panelUpload.classList.add('hidden');
});
tabUpload.addEventListener('click', () => {
  activeSource = 'upload';
  tabUpload.classList.add('active'); tabBuiltin.classList.remove('active');
  panelUpload.classList.remove('hidden'); panelBuiltin.classList.add('hidden');
});

// ── Load built-in reference in background ──────────────
// Audio element plays immediately (preload="auto"), analysis runs separately
function startBuiltinAnalysis() {
  if (refAnalysisPromise) return; // already started
  refAnalysisPromise = (async () => {
    try {
      const resp     = await fetch('reference.mp3');
      const arrayBuf = await resp.arrayBuffer();
      refFrames      = await decodeAndAnalyse(arrayBuf);
      refAnalysisReady = true;
      refLoadStatus.textContent = '✅ วิเคราะห์ pitch เสร็จแล้ว';
      refLoadStatus.className   = 'status-msg success';
    } catch (err) {
      refLoadStatus.textContent = '⚠️ วิเคราะห์ไม่สำเร็จ — ผลเปรียบเทียบอาจไม่สมบูรณ์';
      refLoadStatus.className   = 'status-msg error';
    }
  })();
}

// Kick off analysis as soon as Compare tab is first clicked
document.querySelector('[data-page="pageCompare"]').addEventListener('click', () => {
  startBuiltinAnalysis();
}, { once: true });

// ── File upload ────────────────────────────────────────
let uploadFrames          = null;
let uploadAnalysisPromise = null;

uploadLabel.addEventListener('click', () => refFileInput.click());
refFileInput.addEventListener('change', async () => {
  const file = refFileInput.files[0];
  if (!file) return;

  // Show audio player immediately for instant playback
  uploadLabelText.textContent = `🎵 ${file.name}`;
  const url = URL.createObjectURL(file);
  uploadedAudio.src = url;
  uploadAudioWrap.classList.remove('hidden');
  uploadStatus.textContent = '⏳ กำลังวิเคราะห์ pitch ในพื้นหลัง...';
  uploadStatus.className   = 'status-msg';

  // Analyse in background
  uploadFrames = null;
  uploadAnalysisPromise = (async () => {
    try {
      const arrayBuf = await file.arrayBuffer();
      uploadFrames   = await decodeAndAnalyse(arrayBuf);
      uploadStatus.textContent = '✅ วิเคราะห์ pitch เสร็จแล้ว';
      uploadStatus.className   = 'status-msg success';
    } catch (err) {
      uploadStatus.textContent = '⚠️ วิเคราะห์ไม่สำเร็จ';
      uploadStatus.className   = 'status-msg error';
    }
  })();
});

// ── Recording ──────────────────────────────────────────
cmpStartBtn.addEventListener('click', startCompareRecording);
cmpStopBtn.addEventListener('click',  stopCompareRecording);

async function startCompareRecording() {
  // Ensure background analysis has started
  if (activeSource === 'builtin') startBuiltinAnalysis();

  try {
    cmpAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (cmpAudioCtx.state === 'suspended') await cmpAudioCtx.resume();

    cmpStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    const source = cmpAudioCtx.createMediaStreamSource(cmpStream);
    cmpAnalyser  = cmpAudioCtx.createAnalyser();
    cmpAnalyser.fftSize = 4096;
    source.connect(cmpAnalyser);
    liveTracker.reset();

    recordedChunks = [];
    const mime = getSupportedMime();
    mediaRecorder  = new MediaRecorder(cmpStream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start(100);

    isRecording = true; userFrames = [];
    cmpStartBtn.classList.add('hidden');
    cmpStopBtn.classList.remove('hidden');
    cmpLivePitch.style.display = 'block';
    cmpReport.classList.add('hidden');
    liveLoop();
  } catch (err) {
    const permBanner = document.getElementById('permBanner');
    const permMsg    = document.getElementById('permMsg');
    permMsg.textContent = err.name === 'NotAllowedError'
      ? '🚫 ถูกปฏิเสธสิทธิ์ไมค์ — กรุณาอนุญาตในการตั้งค่าเบราว์เซอร์'
      : '🚫 ไม่สามารถเปิดไมค์ได้: ' + err.message;
    permBanner.classList.remove('hidden');
  }
}

function getSupportedMime() {
  return ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4']
    .find(t => MediaRecorder.isTypeSupported(t)) || '';
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
      // Decode user recording
      const blob     = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      const arrayBuf = await blob.arrayBuffer();
      const decoded  = await cmpAudioCtx.decodeAudioData(arrayBuf);
      userFrames     = analyseBuffer(decoded, 0.05);

      // Wait for reference analysis if still running
      const analysisPromise = activeSource === 'builtin' ? refAnalysisPromise : uploadAnalysisPromise;
      if (analysisPromise) await analysisPromise;

      const currentRef = activeSource === 'builtin' ? refFrames : uploadFrames;
      buildReport(currentRef);
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

// ── Live pitch display (engine v2: detectFreq + tracker) ──
const liveBuf = new Float32Array(4096);
const liveTracker = new PitchTracker();
function liveLoop() {
  if (!isRecording) return;
  cmpAnimFrame = requestAnimationFrame(liveLoop);
  if (!cmpAnalyser) return;
  cmpAnalyser.getFloatTimeDomainData(liveBuf);
  let rms = 0;
  for (let i = 0; i < liveBuf.length; i++) rms += liveBuf[i]*liveBuf[i];
  rms = Math.sqrt(rms / liveBuf.length);
  if (rms < 0.008) {
    cmpCurrentNote.textContent = '—'; cmpNoteOctave.textContent = '';
    cmpFreqDisplay.textContent = 'ไม่ได้ยินเสียง...'; cmpMeterBar.style.left = '50%'; return;
  }
  const { freq: rawFreq, clarity } = detectFreq(liveBuf, cmpAudioCtx.sampleRate);
  const p = liveTracker.push(rawFreq, clarity, performance.now());
  if (!p) return;
  const info = freqToNoteInfo(p.freq);
  cmpCurrentNote.textContent = info.note;
  cmpNoteOctave.textContent  = `Octave ${info.octave}`;
  cmpFreqDisplay.textContent = `${p.freq.toFixed(1)} Hz`;
  const cents = info.cents;
  const pct   = 50 + (cents / 50) * 45;
  cmpMeterBar.style.left = Math.max(5, Math.min(95, pct)) + '%';
  cmpMeterBar.style.background = Math.abs(cents) < 10 ? '#16a34a' : Math.abs(cents) < 25 ? '#ca8a04' : '#dc2626';
}

// ── Build report ───────────────────────────────────────
function buildReport(currentRefFrames) {
  cmpReport.classList.remove('hidden');
  setTimeout(() => cmpReport.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

  if (!currentRefFrames || currentRefFrames.length === 0) {
    // No reference — show user pitch quality only
    buildUserOnlyReport();
    return;
  }

  const minLen = Math.min(currentRefFrames.length, userFrames.length);
  let inTune = 0, slightOff = 0, off = 0, total = 0;
  const mismatches = [];

  for (let i = 0; i < minLen; i++) {
    const ref = currentRefFrames[i], user = userFrames[i];
    if (!ref.midi || !user.midi) continue;
    total++;
    const centDiff = Math.abs((user.midi - ref.midi) * 100);
    if (centDiff < 20) inTune++;
    else if (centDiff < 50) slightOff++;
    else { off++; mismatches.push({ time: ref.time, refNote: ref.note, refMidi: ref.midi, userNote: user.note, userMidi: user.midi, centDiff: Math.round(centDiff) }); }
  }

  const score = total > 0 ? Math.round((inTune / total) * 100) : 0;
  renderReport(score, inTune, slightOff, off, mismatches);
  drawCompareCanvas(currentRefFrames, userFrames, minLen);
}

function buildUserOnlyReport() {
  let inTune = 0, slightOff = 0, off = 0, total = 0;
  const mismatches = [];
  userFrames.forEach(f => {
    if (!f.midi) return; total++;
    const cents = Math.abs((f.midi - Math.round(f.midi)) * 100);
    if (cents < 20) inTune++;
    else if (cents < 40) slightOff++;
    else { off++; const ref = NOTE_NAMES[((Math.round(f.midi)%12)+12)%12]; mismatches.push({ time: f.time, refNote: ref, refMidi: Math.round(f.midi), userNote: f.note, userMidi: f.midi, centDiff: Math.round(cents) }); }
  });
  const score = total > 0 ? Math.round((inTune / total) * 100) : 0;
  renderReport(score, inTune, slightOff, off, mismatches);
  drawUserOnlyCanvas(userFrames);
}

function renderReport(score, inTune, slightOff, off, mismatches) {
  rptScore.textContent     = score + '%';
  rptScore.style.color     = score >= 75 ? '#1976D2' : score >= 50 ? '#ca8a04' : '#dc2626';
  rptInTune.textContent    = inTune    + ' ช่วง';
  rptSlightOff.textContent = slightOff + ' ช่วง';
  rptOff.textContent       = off       + ' ช่วง';

  if (mismatches.length === 0) {
    mismatchList.innerHTML = '<p class="no-mismatch">🎉 ไม่พบจุดที่เสียงออกนอกโน้ตมากเกินไป!</p>';
    return;
  }
  const segments = groupMismatches(mismatches);
  mismatchList.innerHTML = segments.map(seg => {
    const sev = seg.avgCents > 100 ? 'high' : seg.avgCents > 60 ? 'med' : 'low';
    const dir = seg.avgUserMidi > seg.avgRefMidi ? '▲ สูงเกิน' : '▼ ต่ำเกิน';
    return `<div class="mismatch-item ${sev}">
      <div class="mismatch-time">${formatTime(seg.startTime)} – ${formatTime(seg.endTime)}</div>
      <div class="mismatch-detail">
        <span class="mismatch-ref">เป้าหมาย: <strong>${seg.refNote}</strong></span>
        <span class="mismatch-user">ที่ร้อง: <strong>${seg.userNote}</strong></span>
        <span class="mismatch-cents ${sev}">${dir} ~${Math.round(seg.avgCents)} cents</span>
      </div></div>`;
  }).join('');
}

function groupMismatches(list) {
  const out = []; let seg = null;
  for (const m of list) {
    if (!seg || m.time - seg.endTime > 0.5) {
      if (seg) out.push(finSeg(seg));
      seg = { startTime:m.time, endTime:m.time, refNotes:[m.refNote], userNotes:[m.userNote], refMidis:[m.refMidi], userMidis:[m.userMidi], cents:[m.centDiff] };
    } else {
      seg.endTime=m.time; seg.refNotes.push(m.refNote); seg.userNotes.push(m.userNote);
      seg.refMidis.push(m.refMidi); seg.userMidis.push(m.userMidi); seg.cents.push(m.centDiff);
    }
  }
  if (seg) out.push(finSeg(seg));
  return out;
}
function finSeg(s) {
  const mode = a => [...a].sort((x,y)=>a.filter(v=>v===y).length-a.filter(v=>v===x).length)[0];
  return { ...s, refNote:mode(s.refNotes), userNote:mode(s.userNotes), avgRefMidi:s.refMidis.reduce((a,b)=>a+b)/s.refMidis.length, avgUserMidi:s.userMidis.reduce((a,b)=>a+b)/s.userMidis.length, avgCents:s.cents.reduce((a,b)=>a+b)/s.cents.length };
}
function formatTime(sec) {
  return `${Math.floor(sec/60)}:${Math.floor(sec%60).toString().padStart(2,'0')}`;
}

// ── Canvas ─────────────────────────────────────────────
function setupCmp() {
  const dpr = window.devicePixelRatio||1;
  cmpCanvas.width=cmpCanvas.offsetWidth*dpr; cmpCanvas.height=cmpCanvas.offsetHeight*dpr;
  cmpCtx.setTransform(dpr,0,0,dpr,0,0);
  return [cmpCanvas.offsetWidth, cmpCanvas.offsetHeight];
}
function drawCompareCanvas(refF, userF, len) {
  const [w,h] = setupCmp();
  cmpCtx.fillStyle='#f0f6ff'; cmpCtx.fillRect(0,0,w,h);
  const vals=[...refF.slice(0,len),...userF.slice(0,len)].map(f=>f.midi).filter(Boolean);
  if(!vals.length) return;
  const minM=Math.min(...vals)-2, maxM=Math.max(...vals)+2;
  const toY=m=>h-((m-minM)/(maxM-minM))*(h-8)-4;
  const line=(frames,color)=>{
    cmpCtx.strokeStyle=color; cmpCtx.lineWidth=2; cmpCtx.beginPath(); let first=true;
    frames.slice(0,len).forEach((f,i)=>{ if(!f.midi){first=true;return;} const x=(i/(len-1))*w,y=toY(f.midi); first?(cmpCtx.moveTo(x,y),first=false):cmpCtx.lineTo(x,y); }); cmpCtx.stroke();
  };
  line(refF,'rgba(33,150,243,0.7)'); line(userF,'rgba(239,68,68,0.85)');
  cmpCtx.font='12px Inter,sans-serif';
  cmpCtx.fillStyle='rgba(33,150,243,1)'; cmpCtx.fillRect(8,6,14,4); cmpCtx.fillStyle='#333'; cmpCtx.fillText('ตัวอย่าง',26,14);
  cmpCtx.fillStyle='rgba(239,68,68,1)';  cmpCtx.fillRect(8,18,14,4); cmpCtx.fillStyle='#333'; cmpCtx.fillText('เสียงคุณ',26,26);
}
function drawUserOnlyCanvas(userF) {
  const [w,h] = setupCmp();
  cmpCtx.fillStyle='#f0f6ff'; cmpCtx.fillRect(0,0,w,h);
  const vals=userF.map(f=>f.midi).filter(Boolean); if(!vals.length) return;
  const minM=Math.min(...vals)-2, maxM=Math.max(...vals)+2;
  cmpCtx.strokeStyle='#2196F3'; cmpCtx.lineWidth=2; cmpCtx.beginPath(); let first=true;
  userF.forEach((f,i)=>{ if(!f.midi){first=true;return;} const x=(i/(userF.length-1))*w,y=h-((f.midi-minM)/(maxM-minM))*(h-8)-4; first?(cmpCtx.moveTo(x,y),first=false):cmpCtx.lineTo(x,y); }); cmpCtx.stroke();
}
