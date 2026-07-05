// วัดช่วงเสียง (voice range calibration) — ครั้งแรกก่อนเล่นเกม / วัดใหม่ได้จาก hub
//
// บทเรียนจากการทดสอบ iPhone จริง: เสียงสูง/head voice มี RMS เบากว่าเสียงอกมาก
// (โดยเฉพาะเมื่อปิด AGC) จนไม่ผ่าน noise gate ของเกมเลย — หน้านี้จึงใช้เส้นทาง raw
// ของ MicSession (detector รันที่ floor จิ๋ว, ตัดสินด้วย clarity แทน RMS) และมี
// ทางหนีเสมอ: ปุ่ม "ใช้โน้ตนี้" + preset ชาย/หญิง/เด็ก — ไม่มีใครติดค้างที่หน้านี้
import { MicSession, freqToMidi, freqToNoteInfo, midiToNoteName } from './pitch-engine.js';
import { api } from './api.js';
import { state, loadProfile } from './state.js';

const STEPS = [
  { key: 'low',  title: 'โน้ตต่ำสุด',  hint: 'ไล่เสียง "อา" ลงต่ำช้า ๆ จนถึงโน้ตต่ำสุดที่ร้องได้สบาย แล้วค้างเสียงไว้' },
  { key: 'high', title: 'โน้ตสูงสุด', hint: 'ไล่เสียง "วู้" ขึ้นช้า ๆ จนถึงโน้ตสูงสุดที่ร้องได้สบาย แล้วค้างเสียงไว้ (เสียงหลบได้)' },
];

// ช่วงเสียงสำเร็จรูป — ทางลัดถ้าไม่อยากวัด/วัดไม่ผ่าน
const PRESETS = [
  { label: '👨 ชาย',  low: 45, high: 67 }, // A2–G4
  { label: '👩 หญิง', low: 55, high: 76 }, // G3–E5
  { label: '🧒 เด็ก',  low: 60, high: 81 }, // C4–A5
];

const RAW_CLARITY_MIN = 0.6;   // เกณฑ์รับ pitch จากเส้นทาง raw (ผ่อนสำหรับเสียง breathy)
const QUIET_RMS = 0.004;       // ต่ำกว่านี้ถือว่า "เสียงเบาไป" (สำหรับ hint)

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

  // คืน { progress 0..1, candidate (median ของ window) | null, captured midi | null, manualReady }
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

  // สำหรับปุ่ม "ใช้โน้ตนี้": median ของช่วงท้ายล่าสุด
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
    const debugEl = el('calDebug'), actionBtn = el('calAction');
    const manualBtn = el('calManual'), cancelBtn = el('calCancel');

    let mic = null;
    const results = {};

    function cleanup(ok) {
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

    function measureStep(step) {
      return new Promise((res, rej) => {
        titleEl.textContent = `🎙️ ${step.title}`;
        hintEl.textContent = step.hint;
        noteEl.textContent = '—';
        barEl.style.width = '0%';
        statusEl.textContent = '';
        manualBtn.classList.add('hidden');

        const cap = new TrailingCapture();
        let done = false;
        let lastLoudMs = 0;   // rms ≥ QUIET_RMS ล่าสุด
        let lastClearMs = 0;  // raw pitch clarity ผ่านล่าสุด
        let heardAnything = false;

        const finish = midi => {
          if (done || midi === null) return;
          done = true;
          clearInterval(hintTimer);
          manualBtn.classList.add('hidden');
          if (mic) { mic.stop(); mic = null; }
          res(midi);
        };

        manualBtn.onclick = () => finish(cap.manualCapture(performance.now()));

        // hint ตามเกตที่ไม่ผ่าน — ผู้ใช้รู้เสมอว่าต้องปรับอะไร
        const hintTimer = setInterval(() => {
          if (done || !mic || !mic.calibrated) return;
          const now = performance.now();
          if (now - lastLoudMs > 900) {
            statusEl.textContent = '🔈 เสียงเบาไป — ขยับมือถือเข้าใกล้ปาก หรือร้องดังขึ้นอีกนิด';
          } else if (now - lastClearMs > 900) {
            statusEl.textContent = 'ได้ยินแล้ว แต่ยังไม่ชัด — ลองร้องสระ "อา" หรือ "อู" ตรง ๆ';
          } else {
            statusEl.textContent = '✓ ได้ยินชัดแล้ว! ค้างเสียงไว้นิ่ง ๆ...';
          }
        }, 700);

        mic = new MicSession({
          emitRaw: true,
          onStatus: s => {
            if (s === 'calibrating') statusEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
            if (s === 'ready') statusEl.textContent = 'ร้องได้เลย!';
          },
          onFrame: frame => {
            if (done) return;
            // VU meter (sqrt scale ให้เสียงเบาก็เห็นแถบขยับ)
            const vuPct = Math.min(100, Math.sqrt(frame.rms / 0.05) * 100);
            vuEl.style.width = vuPct + '%';
            vuEl.style.background = frame.rms >= QUIET_RMS ? '#16a34a' : '#94a3b8';
            if (frame.calibrating) return;

            if (frame.rms >= QUIET_RMS) lastLoudMs = frame.time;

            // เส้นทาง raw: ตัดสินด้วย clarity ไม่ใช่ความดัง — head voice เบา ๆ ก็ผ่าน
            const raw = frame.raw;
            const ok = raw && raw.clarity >= RAW_CLARITY_MIN && raw.freq >= 55 && raw.freq <= 1400;
            if (ok) {
              lastClearMs = frame.time;
              heardAnything = true;
              const info = freqToNoteInfo(raw.freq);
              noteEl.textContent = `${info.note}${info.octave}`;
            }
            if (debug) {
              debugEl.textContent =
                `rms ${frame.rms.toFixed(4)} | thr ${mic ? mic.rmsThreshold.toFixed(4) : '-'} | ` +
                `clarity ${raw ? raw.clarity.toFixed(2) : '-'} | freq ${raw ? raw.freq.toFixed(0) : '-'}`;
            }

            const st = cap.push(frame.time, ok ? freqToMidi(raw.freq) : null);
            barEl.style.width = Math.round(st.progress * 100) + '%';
            if (st.manualReady && st.candidate !== null) {
              manualBtn.textContent = `✓ ใช้โน้ตนี้ (${midiToNoteName(Math.round(st.candidate))})`;
              manualBtn.classList.remove('hidden');
            }
            if (st.captured !== null) finish(st.captured);
          },
        });
        mic.start().catch(err => { clearInterval(hintTimer); rej(err); });
      });
    }

    actionBtn.addEventListener('click', async () => {
      actionBtn.disabled = true;
      actionBtn.textContent = 'กำลังวัด...';
      try {
        for (const step of STEPS) {
          const midi = await measureStep(step);
          results[step.key] = midi;
          statusEl.textContent = `✅ ${step.title}: ${midiToNoteName(midi)}`;
          await new Promise(r => setTimeout(r, 900));
        }
        if (results.high - results.low < 5) {
          statusEl.textContent = '⚠️ ช่วงเสียงแคบเกินไป — ลองใหม่ (สูง/ต่ำให้ต่างกันชัด ๆ) หรือใช้ปุ่มเลือกแบบเร็วด้านล่าง';
          actionBtn.disabled = false;
          actionBtn.textContent = 'วัดใหม่';
          return;
        }
        await api('/api/me', { method: 'PATCH', body: { voice_low_midi: results.low, voice_high_midi: results.high } });
        await loadProfile();
        statusEl.textContent = `🎉 ช่วงเสียงของคุณ: ${midiToNoteName(results.low)} – ${midiToNoteName(results.high)}`;
        actionBtn.textContent = 'เสร็จสิ้น';
        setTimeout(() => cleanup(true), 1400);
      } catch (err) {
        statusEl.textContent = '⚠️ ' + (err.message || 'วัดไม่สำเร็จ ลองใหม่ หรือใช้ปุ่มเลือกแบบเร็ว');
        actionBtn.disabled = false;
        actionBtn.textContent = 'วัดใหม่';
      }
    });
  });
}

export async function ensureCalibrated() {
  if (isCalibrated()) return true;
  return runCalibration();
}
