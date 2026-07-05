// Pitch Engine v2 — แหล่งเดียวของการวัดเสียงทั้งแอป
// ตัวตรวจจับ: pitchy (McLeod Pitch Method) ให้ค่า clarity 0-1
// pipeline: clarity gate → RMS gate (calibrate ต่อ session) → median filter → octave-jump correction
// การให้คะแนน: ต่อ stable segment (ตัด onset ทิ้ง, ใช้ median) ไม่ใช่ต่อเฟรม

import { PitchDetector } from './vendor/pitchy.mjs';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ── การแปลงโน้ต/ความถี่ ────────────────────────────────
export function noteToFreq(note, octave) {
  const idx = NOTE_NAMES.indexOf(note);
  return midiToFreq((octave + 1) * 12 + idx);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq) {
  if (!freq || freq <= 0) return null;
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToNoteName(midi) {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

export function freqToNoteInfo(freq) {
  const midiFloat = freqToMidi(freq);
  if (midiFloat === null) return null;
  const midi = Math.round(midiFloat);
  return {
    note: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: (midiFloat - midi) * 100, // เพี้ยนจากโน้ตที่ใกล้ที่สุด
  };
}

export function centsBetween(freq, refFreq) {
  return 1200 * Math.log2(freq / refFreq);
}

// fold เข้า [-600, 600] — เทียบแบบไม่สนอ็อกเทฟ (นักเรียนร้องอ็อกเทฟตัวเองได้)
export function foldCents(cents) {
  return ((cents % 1200) + 1800) % 1200 - 600;
}

// คะแนนจากความเพี้ยน: 100 เมื่อ ≤10¢ ลดเชิงเส้นถึง 0 ที่ 60¢
export function scoreFromCents(absCents) {
  if (absCents <= 10) return 100;
  if (absCents >= 60) return 0;
  return 100 * (60 - absCents) / 50;
}

// ── PitchTracker: pipeline ต่อเฟรม ─────────────────────
// gate ด้วย clarity + ช่วงความถี่, median filter, octave-jump correction
export class PitchTracker {
  constructor({ clarityMin = 0.85, fmin = 60, fmax = 1500, medianWindow = 5, resetGapMs = 150 } = {}) {
    this.clarityMin = clarityMin;
    this.fmin = fmin;
    this.fmax = fmax;
    this.medianWindow = medianWindow;
    this.resetGapMs = resetGapMs;
    this.reset();
  }

  reset() {
    this._buf = [];      // หน้าต่าง median filter
    this._recent = [];   // ประวัติ output สำหรับ octave correction
    this._lastMs = -Infinity;
  }

  // คืน { freq, midi } หลังผ่าน pipeline หรือ null ถ้าถูก gate ทิ้ง
  push(freq, clarity, timeMs) {
    if (!freq || freq < this.fmin || freq > this.fmax || clarity < this.clarityMin) return null;

    // เว้นช่วงเงียบนาน → เริ่มหน้าต่างใหม่ กันโน้ตเก่าลากค่าโน้ตใหม่
    if (timeMs - this._lastMs > this.resetGapMs) { this._buf = []; this._recent = []; }
    this._lastMs = timeMs;

    let midi = freqToMidi(freq);

    // octave-jump correction: กระโดด ~±12 semitones จาก median ล่าสุด → fold กลับ
    if (this._recent.length >= 3) {
      const ref = median(this._recent);
      const d = midi - ref;
      if (Math.abs(Math.abs(d) - 12) < 0.6) midi -= Math.sign(d) * 12;
      else if (Math.abs(Math.abs(d) - 24) < 0.6) midi -= Math.sign(d) * 24;
    }

    this._buf.push(midi);
    if (this._buf.length > this.medianWindow) this._buf.shift();
    const smoothed = median(this._buf);

    this._recent.push(smoothed);
    if (this._recent.length > 15) this._recent.shift();

    return { freq: midiToFreq(smoothed), midi: smoothed };
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Segment: กลุ่มเฟรม voiced ต่อเนื่อง ─────────────────
// สถิติคิดหลังตัด onset ทิ้ง — vibrato ปกติไม่โดนลงโทษเพราะใช้ median
export function segmentStats(samples, targetMidi = null, onsetMs = 120) {
  if (!samples.length) return null;
  const t0 = samples[0].time;
  const body = samples.filter(s => s.time - t0 >= onsetMs);
  const use = body.length >= 3 ? body : samples;
  const midis = use.map(s => s.midi);
  const med = median(midis);
  const durMs = samples[samples.length - 1].time - t0;
  const stddevCents = Math.sqrt(midis.reduce((a, m) => a + ((m - med) * 100) ** 2, 0) / midis.length);
  const out = { medianMidi: med, durMs, stddevCents, nFrames: use.length };
  if (targetMidi !== null) {
    out.centsOff = (med - targetMidi) * 100;
    out.meanAbsCents = midis.reduce((a, m) => a + Math.abs((m - targetMidi) * 100), 0) / midis.length;
    out.score = scoreFromCents(Math.abs(out.centsOff));
  }
  return out;
}

export class SegmentTracker {
  constructor({ minDurMs = 300, onsetMs = 120, gapMs = 150, onSegment = null } = {}) {
    this.minDurMs = minDurMs;
    this.onsetMs = onsetMs;
    this.gapMs = gapMs;
    this.onSegment = onSegment;
    this.reset();
  }

  reset() {
    this._samples = [];
    this._lastVoicedMs = -Infinity;
  }

  push(frame) {
    if (frame.voiced) {
      this._samples.push({ time: frame.time, midi: frame.midi });
      this._lastVoicedMs = frame.time;
    } else if (this._samples.length && frame.time - this._lastVoicedMs > this.gapMs) {
      this.end();
    }
  }

  // สถิติสดของ segment ที่กำลังร้องอยู่ (สำหรับ UI real-time)
  liveStats(targetMidi = null) {
    if (!this._samples.length) return null;
    return segmentStats(this._samples, targetMidi, this.onsetMs);
  }

  end() {
    const samples = this._samples;
    this._samples = [];
    if (!samples.length) return null;
    const durMs = samples[samples.length - 1].time - samples[0].time;
    if (durMs < this.minDurMs) return null;
    const seg = { samples, stats: (target = null) => segmentStats(samples, target, this.onsetMs) };
    if (this.onSegment) this.onSegment(seg);
    return seg;
  }
}

// ── ตัวตรวจจับ (cache ต่อขนาด buffer) ──────────────────
const _detectors = new Map();
export function detectFreq(float32, sampleRate) {
  let d = _detectors.get(float32.length);
  if (!d) { d = PitchDetector.forFloat32Array(float32.length); _detectors.set(float32.length, d); }
  const [freq, clarity] = d.findPitch(float32, sampleRate);
  return { freq, clarity };
}

// ── noise floor → RMS threshold ──────────────────────────
// ทิ้งช่วงแรก (iOS มี pop/settle หลังเปิดไมค์) ใช้ 25th percentile กันค่าเฟ้อ
// clamp: floor 0.004 (AGC ปิดแล้วเสียงเบา — ต่ำพอสำหรับ head voice) / cap 0.02 (ห้องดังก็ยังร้องได้)
export function computeRmsThreshold(samples, { skipMs = 250, mult = 2.5, floor = 0.004, cap = 0.03 } = {}) {
  const usable = samples.filter(s => s.t >= skipMs).map(s => s.rms).sort((a, b) => a - b);
  const pool = usable.length >= 4 ? usable : samples.map(s => s.rms).sort((a, b) => a - b);
  if (!pool.length) return { noiseFloor: 0, threshold: floor };
  const noiseFloor = pool[Math.floor(pool.length * 0.25)];
  return { noiseFloor, threshold: Math.min(cap, Math.max(floor, noiseFloor * mult)) };
}

// ── MicSession: ไมค์ + calibrate noise floor + wake lock ──
// ค่า default ปิด echoCancellation/noiseSuppression/autoGainControl —
// DSP พวกนี้ออกแบบมาสำหรับเสียงพูด บิดเบือนเสียงร้องก่อนถึงตัววัด
// emitRaw: รัน detector ที่ floor จิ๋ว (0.002) และแนบ frame.raw = {freq, clarity}
// สำหรับโหมดที่ต้องผ่อนปรน (วัดช่วงเสียง) — เส้นทาง voiced ของเกมไม่เปลี่ยน
export class MicSession {
  constructor({ processed = false, fftSize = 4096, calibrateMs = 700, clarityMin = null, emitRaw = false, onFrame = null, onStatus = null } = {}) {
    this.emitRaw = emitRaw;
    this.processed = processed;
    this.fftSize = fftSize;
    this.calibrateMs = calibrateMs;
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.running = false;
    this.calibrated = false;
    this.noiseFloor = 0;
    this.rmsThreshold = 0.006;
    this._tracker = new PitchTracker(clarityMin !== null ? { clarityMin } : {});
    this._wakeLock = null;
    this._onVis = () => {
      if (this.running && document.visibilityState === 'visible') {
        this._requestWakeLock();
        this.resume(); // iOS ชอบ suspend context ตอนสลับแอป/พับจอ
      }
    };
  }

  async start() {
    // สร้าง AudioContext ใน user gesture — จำเป็นบน iOS Safari
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') {
      // ห้าม await resume() เฉย ๆ — บน iOS ถ้าไม่มี gesture promise จะค้างตลอดกาล
      await Promise.race([
        this.audioCtx.resume().catch(() => {}),
        new Promise(r => setTimeout(r, 400)),
      ]);
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: this.processed,
        noiseSuppression: this.processed,
        // AGC เปิดเสมอ: คุมเกนระดับ OS (จำเป็นบน iPhone ที่ input เบามาก)
        // และไม่กระทบความแม่นยำ pitch — MPM ไม่ขึ้นกับ amplitude
        autoGainControl: true,
      },
      video: false,
    });

    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    source.connect(this.analyser);

    this._buf = new Float32Array(this.fftSize);
    this._tracker.reset();
    this._calibrating = true;
    this._calibrateRms = [];
    this._calibrateStart = performance.now();
    this.running = true;
    this._requestWakeLock();
    document.addEventListener('visibilitychange', this._onVis);
    if (this.onStatus) this.onStatus('calibrating');
    this._loop();

    // iOS: ถ้า context ยังไม่วิ่ง (resume ไม่มี gesture รองรับ) → รอผู้ใช้แตะจอหนึ่งครั้ง
    if (this.audioCtx.state !== 'running') {
      if (this.onStatus) this.onStatus('suspended');
      const onTap = () => this.resume();
      document.addEventListener('pointerdown', onTap, { once: true });
      this.audioCtx.onstatechange = () => {
        if (this.audioCtx.state === 'running' && this.onStatus) {
          this.onStatus(this.calibrated ? 'ready' : 'calibrating');
        }
      };
    }
  }

  // เรียกได้จาก user gesture ใด ๆ เพื่อปลุก context ที่ iOS แช่ไว้
  resume() {
    if (this.audioCtx && this.audioCtx.state !== 'running') {
      this.audioCtx.resume().catch(() => { /* รอ gesture ถัดไป */ });
    }
  }

  _loop() {
    if (!this.running) return;
    this._raf = requestAnimationFrame(() => this._loop());

    // context ยังไม่วิ่ง (iOS suspended) → analyser คืนแต่ศูนย์
    // ห้ามเอาไปนับ noise floor — เลื่อนจุดเริ่ม calibrate ออกไปจนกว่าเสียงจะไหลจริง
    if (this.audioCtx.state !== 'running') {
      if (this._calibrating) {
        this._calibrateStart = performance.now();
        this._calibrateRms = [];
      }
      return;
    }

    this.analyser.getFloatTimeDomainData(this._buf);

    let rms = 0;
    for (let i = 0; i < this._buf.length; i++) rms += this._buf[i] * this._buf[i];
    rms = Math.sqrt(rms / this._buf.length);
    const now = performance.now();

    if (this._calibrating) {
      this._calibrateRms.push({ t: now - this._calibrateStart, rms });
      if (now - this._calibrateStart >= this.calibrateMs) {
        const { noiseFloor, threshold } = computeRmsThreshold(this._calibrateRms);
        this.noiseFloor = noiseFloor;
        this.rmsThreshold = threshold;
        this._calibrating = false;
        this.calibrated = true;
        if (this.onStatus) this.onStatus('ready');
      } else if (this.emitRaw && this.onFrame) {
        // ให้ VU meter ขยับได้ตั้งแต่วินาทีแรก
        this.onFrame({ time: now, rms, voiced: false, freq: null, midi: null, clarity: 0, calibrating: true });
      }
      return;
    }

    const frame = { time: now, rms, voiced: false, freq: null, midi: null, clarity: 0 };
    // เส้นทาง raw (วัดช่วงเสียง): รัน detector ที่ floor จิ๋ว ไม่อิง noise threshold
    if (rms >= this.rmsThreshold || (this.emitRaw && rms >= 0.002)) {
      const { freq, clarity } = detectFreq(this._buf, this.audioCtx.sampleRate);
      frame.clarity = clarity;
      if (this.emitRaw) frame.raw = { freq, clarity };
      if (rms >= this.rmsThreshold) {
        const p = this._tracker.push(freq, clarity, now);
        if (p) { frame.voiced = true; frame.freq = p.freq; frame.midi = p.midi; }
      }
    }
    if (this.onFrame) this.onFrame(frame);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close();
    document.removeEventListener('visibilitychange', this._onVis);
    this._releaseWakeLock();
  }

  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* ไม่วิกฤต */ }
  }

  _releaseWakeLock() {
    if (this._wakeLock) { this._wakeLock.release(); this._wakeLock = null; }
  }
}

// ── วิเคราะห์ไฟล์เสียง (offline) ────────────────────────
// คืน frames [{time(s), freq, midi, note, rms}] — pipeline เดียวกับ live
export function analyseBuffer(audioBuffer, hopSec = 0.05) {
  const sr = audioBuffer.sampleRate;
  // หน้าต่าง ~93ms เท่ากับ live: 2048 ที่ 22050Hz, 4096 ที่ 44100/48000Hz
  const frameSize = sr <= 24000 ? 2048 : 4096;
  const hopSize = Math.round(hopSec * sr);
  const ch = audioBuffer.getChannelData(0);
  const frames = [];
  const buf = new Float32Array(frameSize);
  const tracker = new PitchTracker();

  for (let start = 0; start + frameSize < ch.length; start += hopSize) {
    buf.set(ch.subarray(start, start + frameSize));
    let rms = 0;
    for (let i = 0; i < frameSize; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / frameSize);
    const time = start / sr;
    if (rms < 0.005) { frames.push({ time, freq: 0, midi: null, note: null, rms }); continue; }
    const { freq, clarity } = detectFreq(buf, sr);
    const p = tracker.push(freq, clarity, time * 1000);
    if (p) frames.push({ time, freq: p.freq, midi: p.midi, note: freqToNoteInfo(p.freq).note, rms });
    else frames.push({ time, freq: 0, midi: null, note: null, rms });
  }
  return frames;
}

export async function decodeAndAnalyse(arrayBuf) {
  // decode แล้ว resample เป็น 22050Hz ให้วิเคราะห์เร็วขึ้น (หน้าต่างเวลาเท่าเดิม)
  const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await tmpCtx.decodeAudioData(arrayBuf.slice(0));
  tmpCtx.close();
  const targetSr = 22050;
  const offCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetSr), targetSr);
  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);
  const resampled = await offCtx.startRendering();
  return analyseBuffer(resampled, 0.05);
}
