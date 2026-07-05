// วัดช่วงเสียง (voice range calibration) — ครั้งแรกก่อนเล่นเกม / วัดใหม่ได้จาก hub
//
// บทเรียน iPhone (จากภาพ ?debug=1 ของเจ้าของ):
// 1. iOS อนุญาตเปิด/ปลุก AudioContext เฉพาะใน user gesture — เดิมเราปิด-เปิดไมค์ใหม่
//    ระหว่างขั้นโดยอัตโนมัติ ทำให้ขั้น "โน้ตสูงสุด" ไม่เคยเริ่มฟังเลย
//    → เปิดไมค์ครั้งเดียวตอนกด "เริ่มวัด" ใช้ยาวทั้ง flow และคั่นขั้นด้วยปุ่ม (gesture ใหม่)
// 2. เสียงสูง/head voice เบากว่าเสียงอกมาก → ตัดสินด้วย clarity จากเส้นทาง raw ไม่ใช่ความดัง
// 3. มีทางหนีเสมอ: ปุ่ม "ใช้โน้ตนี้" + preset ชาย/หญิง/เด็ก — ไม่มีใครติดค้างที่หน้านี้
import { MicSession, freqToMidi, midiToFreq, freqToNoteInfo, midiToNoteName } from './pitch-engine.js';
import { api } from './api.js';
import { state, loadProfile } from './state.js';

const STEPS = {
  low:  { title: 'โน้ตต่ำสุด',  hint: 'ไล่เสียง "อา" ลงต่ำช้า ๆ จนถึงโน้ตต่ำสุดที่ร้องได้สบาย แล้วค้างเสียงไว้' },
  high: { title: 'โน้ตสูงสุด', hint: 'ไล่เสียง "วู้" ขึ้นช้า ๆ จนถึงโน้ตสูงสุดที่ร้องได้สบาย แล้วค้างเสียงไว้ (เสียงหลบได้)' },
};

// ช่วงเสียงสำเร็จรูป — ทางลัดถ้าไม่อยากวัด/วัดไม่ผ่าน
const PRESETS = [
  { label: '👨 ชาย',  low: 45, high: 67 }, // A2–G4
  { label: '👩 หญิง', low: 55, high: 76 }, // G3–E5
  { label: '🧒 เด็ก',  low: 60, high: 81 }, // C4–A5
];

const RAW_CLARITY_MIN = 0.6;   // เกณฑ์รับ pitch จากเส้นทาง raw (ผ่อนสำหรับเสียง breathy)
const QUIET_RMS = 0.004;       // ต่ำกว่านี้ถือว่า "เสียงเบาไป" (สำหรับ hint)

// ขอบเขตความถี่ต่อขั้น — กัน mains hum (~100Hz) และค่าหลงเข้าหน้าต่างตอนวัดเสียงสูง
export function stepFreqBounds(stepKey, lowMidi = null) {
  if (stepKey === 'low') return { fmin: 55, fmax: 500 };
  const fmin = lowMidi !== null ? Math.max(130, midiToFreq(lowMidi + 4)) : 130;
  return { fmin, fmax: 1400 };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ตรรกะจับโน้ตแบบ trailing window — pure, ทดสอบใน Node ได้ (test/engine.test.mjs)
export class TrailingCapture {
  constructor({ windowMs = 1500, minDurMs = 1200, gapMs = 400, maxStddevCents = 80, manualMinMs = 400 } = {}) {
    this.windowMs = windowMs;
    this.minDurMs = minDurMs;
    this.gapMs = gapMs;
    this.maxStddevCents = maxStddevCents;
    this.manualMinMs = manualMinMs;
    this._frames = [];       // voiced {time, midi}
    this._runStart = null;   // เริ่มช่วงเสียงต่อเนื่องปัจจุบัน (gap > gapMs = เริ่มใหม่)
    this._lastVoiced = -Infinity;
  }

  push(time, midi) {
    if (midi === null) {
      if (time - this._lastVoiced > this.gapMs) this._runStart = null;
      return this._status(time);
    }
    if (this._runStart === null || time - this._lastVoiced > this.gapMs) this._runStart = time;
    this._lastVoiced = time;
    this._frames.push({ time, midi });
    while (this._frames.length && this._frames[0].time < time - this.windowMs - 500) this._frames.shift();
    return this._status(time);
  }

  _status(now) {
    if (this._runStart === null) return { progress: 0, candidate: null, captured: null, manualReady: false };
    const winStart = Math.max(this._runStart, now - this.windowMs);
    const win = this._frames.filter(f => f.time >= winStart);
    const dur = win.length ? now - winStart : 0;
    if (win.length < 5) return { progress: 0, candidate: null, captured: null, manualReady: false };

    const midis = win.map(f => f.midi);
    const med = median(midis);
    const sd = Math.sqrt(midis.reduce((a, m) => a + ((m - med) * 100) ** 2, 0) / midis.length);

    const stable = sd < this.maxStddevCents;
    return {
      progress: Math.min(1, dur / this.minDurMs) * (stable ? 1 : 0.35),
      candidate: med,
      captured: dur >= this.minDurMs && stable ? Math.round(med) : null,
      manualReady: dur >= this.manualMinMs,
    };
  }

  manualCapture(now) {
    const recent = this._frames.filter(f => f.time >= now - Math.max(600, this.manualMinMs));
    return recent.length >= 5 ? Math.round(median(recent.map(f => f.midi))) : null;
  }
}

export function isCalibrated() {
  return state.user && state.user.voice_low_midi !== null && state.user.voice_high_midi !== null;
}

// เปิด flow วัดช่วงเสียง; คืน true เมื่อสำเร็จ, false เมื่อผู้ใช้ยกเลิก
export function runCalibration() {
  return new Promise(resolve => {
    const debug = new URLSearchParams(location.search).has('debug');

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h2 id="calTitle">🎙️ วัดช่วงเสียงของคุณ</h2>
        <p id="calHint" class="cal-hint">ระบบจะใช้ช่วงเสียงนี้เลือกโน้ตที่เหมาะกับคุณในทุกเกม</p>
        <div class="cal-note" id="calNote">—</div>
        <div class="cal-vu"><div class="cal-vu-bar" id="calVu"></div></div>
        <div class="cal-progress"><div class="cal-progress-bar" id="calBar"></div></div>
        <div class="cal-status" id="calStatus"></div>
        <div class="cal-debug ${debug ? '' : 'hidden'}" id="calDebug"></div>
        <div class="overlay-actions">
          <button class="btn-start" id="calAction">เริ่มวัด</button>
          <button class="btn-start hidden" id="calNext">ต่อไป: วัดโน้ตสูงสุด ▶</button>
          <button class="btn-secondary hidden" id="calManual">✓ ใช้โน้ตนี้</button>
          <button class="btn-secondary" id="calCancel">ยกเลิก</button>
        </div>
        <div class="cal-presets">
          <span>หรือเลือกช่วงเสียงแบบเร็ว:</span>
          <div class="cal-preset-row">
            ${PRESETS.map((p, i) => `<button class="btn-secondary cal-preset" data-i="${i}">${p.label}</button>`).join('')}
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const el = id => overlay.querySelector('#' + id);
    const titleEl = el('calTitle'), hintEl = el('calHint'), noteEl = el('calNote');
    const vuEl = el('calVu'), barEl = el('calBar'), statusEl = el('calStatus');
    const debugEl = el('calDebug'), actionBtn = el('calAction'), nextBtn = el('calNext');
    const manualBtn = el('calManual'), cancelBtn = el('calCancel');

    let mic = null;
    let step = null;        // { key, cap, bounds, lastLoudMs, lastClearMs }
    let hintTimer = null;
    const results = {};

    function cleanup(ok) {
      clearInterval(hintTimer);
      if (mic) { mic.stop(); mic = null; }
      overlay.remove();
      resolve(ok);
    }
    cancelBtn.addEventListener('click', () => cleanup(false));

    // ── preset: บันทึกทันที จบ flow ──
    overlay.querySelectorAll('.cal-preset').forEach(btn =>
      btn.addEventListener('click', async () => {
        const p = PRESETS[Number(btn.dataset.i)];
        btn.disabled = true;
        try {
          await api('/api/me', { method: 'PATCH', body: { voice_low_midi: p.low, voice_high_midi: p.high } });
          await loadProfile();
          statusEl.textContent = `✅ ตั้งช่วงเสียง ${p.label}: ${midiToNoteName(p.low)} – ${midiToNoteName(p.high)} (วัดจริงทีหลังได้จากหน้าหลัก)`;
          setTimeout(() => cleanup(true), 1200);
        } catch (err) {
          statusEl.textContent = '⚠️ ' + (err.message || 'บันทึกไม่สำเร็จ');
          btn.disabled = false;
        }
      }));

    // ── เริ่มขั้นวัด (ไมค์ตัวเดิม แค่รีเซ็ตตัวจับ + จอ) ──
    function beginStep(key) {
      const def = STEPS[key];
      step = {
        key,
        cap: new TrailingCapture(),
        bounds: stepFreqBounds(key, results.low ?? null),
        lastLoudMs: 0,
        lastClearMs: 0,
      };
      titleEl.textContent = `🎙️ ${def.title}`;
      hintEl.textContent = def.hint;
      noteEl.textContent = '—';
      barEl.style.width = '0%';
      vuEl.style.width = '0%';
      debugEl.textContent = '';
      statusEl.textContent = 'ร้องได้เลย!';
      manualBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
    }

    function finishStep(midi) {
      if (midi === null || !step) return;
      const key = step.key;
      step = null;
      manualBtn.classList.add('hidden');
      results[key] = midi;
      statusEl.textContent = `✅ ${STEPS[key].title}: ${midiToNoteName(midi)}`;
      barEl.style.width = '100%';

      if (key === 'low') {
        // คั่นด้วยปุ่ม = user gesture ใหม่ (iOS) + ให้ผู้ใช้ตั้งหลัก
        titleEl.textContent = '🎙️ เยี่ยม! ต่อไปวัดโน้ตสูงสุด';
        hintEl.textContent = 'พักหายใจสักครู่ พร้อมแล้วกดปุ่มด้านล่าง';
        nextBtn.classList.remove('hidden');
        return;
      }

      // ขั้น high จบ → ตรวจ + บันทึก
      (async () => {
        if (results.high - results.low < 5) {
          statusEl.textContent = '⚠️ ช่วงเสียงแคบเกินไป — ลองใหม่ (สูง/ต่ำให้ต่างกันชัด ๆ) หรือใช้ปุ่มเลือกแบบเร็ว';
          actionBtn.textContent = 'วัดใหม่';
          actionBtn.disabled = false;
          actionBtn.classList.remove('hidden');
          return;
        }
        try {
          await api('/api/me', { method: 'PATCH', body: { voice_low_midi: results.low, voice_high_midi: results.high } });
          await loadProfile();
          statusEl.textContent = `🎉 ช่วงเสียงของคุณ: ${midiToNoteName(results.low)} – ${midiToNoteName(results.high)}`;
          setTimeout(() => cleanup(true), 1400);
        } catch (err) {
          statusEl.textContent = '⚠️ ' + (err.message || 'บันทึกไม่สำเร็จ ลองใหม่');
          actionBtn.textContent = 'วัดใหม่';
          actionBtn.disabled = false;
          actionBtn.classList.remove('hidden');
        }
      })();
    }

    manualBtn.addEventListener('click', () => {
      if (step) finishStep(step.cap.manualCapture(performance.now()));
    });

    nextBtn.addEventListener('click', () => {
      if (mic) mic.resume(); // gesture นี้ปลุก context ได้ ถ้า iOS แช่ไว้
      beginStep('high');
    });

    function onFrame(frame) {
      // VU meter ขยับเสมอ (sqrt scale ให้เสียงเบาก็เห็น)
      const vuPct = Math.min(100, Math.sqrt(frame.rms / 0.05) * 100);
      vuEl.style.width = vuPct + '%';
      vuEl.style.background = frame.rms >= QUIET_RMS ? '#16a34a' : '#94a3b8';
      if (frame.calibrating || !step) return;

      if (frame.rms >= QUIET_RMS) step.lastLoudMs = frame.time;

      const raw = frame.raw;
      const ok = raw && raw.clarity >= RAW_CLARITY_MIN &&
        raw.freq >= step.bounds.fmin && raw.freq <= step.bounds.fmax;
      if (ok) {
        step.lastClearMs = frame.time;
        const info = freqToNoteInfo(raw.freq);
        noteEl.textContent = `${info.note}${info.octave}`;
      }
      if (debug) {
        debugEl.textContent =
          `[${step.key}] rms ${frame.rms.toFixed(4)} | thr ${mic ? mic.rmsThreshold.toFixed(4) : '-'} | ` +
          `clarity ${raw ? raw.clarity.toFixed(2) : '-'} | freq ${raw ? raw.freq.toFixed(0) : '-'} | ctx ${mic?.audioCtx?.state}`;
      }

      const st = step.cap.push(frame.time, ok ? freqToMidi(raw.freq) : null);
      barEl.style.width = Math.round(st.progress * 100) + '%';
      if (st.manualReady && st.candidate !== null) {
        manualBtn.textContent = `✓ ใช้โน้ตนี้ (${midiToNoteName(Math.round(st.candidate))})`;
        manualBtn.classList.remove('hidden');
      }
      if (st.captured !== null) finishStep(st.captured);
    }

    // hint ตามเกตที่ไม่ผ่าน — ผู้ใช้รู้เสมอว่าต้องปรับอะไร
    function startHints() {
      hintTimer = setInterval(() => {
        if (!step || !mic || !mic.calibrated) return;
        const now = performance.now();
        if (now - step.lastLoudMs > 900) {
          statusEl.textContent = '🔈 เสียงเบาไป — ขยับมือถือเข้าใกล้ปาก หรือร้องดังขึ้นอีกนิด';
        } else if (now - step.lastClearMs > 900) {
          statusEl.textContent = 'ได้ยินแล้ว แต่ยังไม่ชัด — ลองร้องสระ "อา" หรือ "อู" ตรง ๆ';
        } else {
          statusEl.textContent = '✓ ได้ยินชัดแล้ว! ค้างเสียงไว้นิ่ง ๆ...';
        }
      }, 700);
    }

    // ── เริ่มวัด: เปิดไมค์ครั้งเดียว (ใน gesture นี้) ใช้ทั้ง flow ──
    actionBtn.addEventListener('click', async () => {
      actionBtn.disabled = true;
      actionBtn.textContent = 'กำลังวัด...';
      actionBtn.classList.add('hidden');
      delete results.low;
      delete results.high;

      if (!mic) {
        mic = new MicSession({
          emitRaw: true,
          onStatus: s => {
            if (s === 'calibrating') statusEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
            if (s === 'ready') statusEl.textContent = 'ร้องได้เลย!';
            if (s === 'suspended') statusEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
          },
          onFrame,
        });
        try {
          await mic.start();
        } catch (err) {
          mic = null;
          statusEl.textContent = '⚠️ เปิดไมค์ไม่ได้: ' + (err.message || '') + ' — ใช้ปุ่มเลือกแบบเร็วด้านล่างได้';
          actionBtn.textContent = 'ลองอีกครั้ง';
          actionBtn.disabled = false;
          actionBtn.classList.remove('hidden');
          return;
        }
        startHints();
      } else {
        mic.resume();
      }
      beginStep('low');
    });
  });
}

export async function ensureCalibrated() {
  if (isCalibrated()) return true;
  return runCalibration();
}
