// วัดช่วงเสียง (voice range calibration) — ครั้งแรกก่อนเล่นเกม / วัดใหม่ได้จาก hub
//
// ใช้ trailing window (ไม่ใช่ทั้ง segment): คนหาโน้ตสูง/ต่ำสุดจะ "ไล่เสียง" ก่อนค้าง —
// ถ้าคิด stddev รวมช่วงไล่เสียงจะไม่ผ่านเกณฑ์ความนิ่งตลอดกาล จึงดูเฉพาะ 1.5 วิล่าสุดพอ
import { MicSession, freqToNoteInfo, midiToNoteName } from './pitch-engine.js';
import { api } from './api.js';
import { state, loadProfile } from './state.js';

const STEPS = [
  { key: 'low',  title: 'โน้ตต่ำสุด',  hint: 'ไล่เสียง "อา" ลงต่ำช้า ๆ จนถึงโน้ตต่ำสุดที่ร้องได้สบาย แล้วค้างเสียงไว้' },
  { key: 'high', title: 'โน้ตสูงสุด', hint: 'ไล่เสียง "วู้" ขึ้นช้า ๆ จนถึงโน้ตสูงสุดที่ร้องได้สบาย แล้วค้างเสียงไว้' },
];

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ตรรกะจับโน้ตแบบ trailing window — pure, ทดสอบใน Node ได้ (test/engine.test.mjs)
export class TrailingCapture {
  constructor({ windowMs = 1500, minDurMs = 1200, gapMs = 400, maxStddevCents = 80, manualMinMs = 600 } = {}) {
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
      // เงียบนานเกิน gap → progress ตก แต่ไม่ล้างข้อมูล (เฟรมเก่าหมดอายุเองตาม window)
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

  // สำหรับปุ่ม "ใช้โน้ตนี้": median ของ 600ms ล่าสุด
  manualCapture(now) {
    const recent = this._frames.filter(f => f.time >= now - this.manualMinMs);
    return recent.length >= 5 ? Math.round(median(recent.map(f => f.midi))) : null;
  }
}

export function isCalibrated() {
  return state.user && state.user.voice_low_midi !== null && state.user.voice_high_midi !== null;
}

// เปิด flow วัดช่วงเสียง; คืน true เมื่อสำเร็จ, false เมื่อผู้ใช้ยกเลิก
export function runCalibration() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h2 id="calTitle">🎙️ วัดช่วงเสียงของคุณ</h2>
        <p id="calHint" class="cal-hint">ระบบจะใช้ช่วงเสียงนี้เลือกโน้ตที่เหมาะกับคุณในทุกเกม</p>
        <div class="cal-note" id="calNote">—</div>
        <div class="cal-progress"><div class="cal-progress-bar" id="calBar"></div></div>
        <div class="cal-status" id="calStatus"></div>
        <div class="overlay-actions">
          <button class="btn-start" id="calAction">เริ่มวัด</button>
          <button class="btn-secondary hidden" id="calManual">✓ ใช้โน้ตนี้</button>
          <button class="btn-secondary" id="calCancel">ยกเลิก</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector('#calTitle');
    const hintEl = overlay.querySelector('#calHint');
    const noteEl = overlay.querySelector('#calNote');
    const barEl = overlay.querySelector('#calBar');
    const statusEl = overlay.querySelector('#calStatus');
    const actionBtn = overlay.querySelector('#calAction');
    const manualBtn = overlay.querySelector('#calManual');
    const cancelBtn = overlay.querySelector('#calCancel');

    let mic = null;
    const results = {};

    function cleanup(ok) {
      if (mic) { mic.stop(); mic = null; }
      overlay.remove();
      resolve(ok);
    }
    cancelBtn.addEventListener('click', () => cleanup(false));

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
        const finish = midi => {
          if (done || midi === null) return;
          done = true;
          manualBtn.classList.add('hidden');
          if (mic) { mic.stop(); mic = null; }
          res(midi);
        };

        manualBtn.onclick = () => finish(cap.manualCapture(performance.now()));

        mic = new MicSession({
          clarityMin: 0.8, // เสียงสูง/falsetto มักมีลมเยอะ — ผ่อน gate ให้ผ่าน
          onStatus: s => {
            if (s === 'calibrating') statusEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
            if (s === 'ready') statusEl.textContent = 'ร้องได้เลย!';
          },
          onFrame: frame => {
            if (done) return;
            if (frame.voiced) {
              const info = freqToNoteInfo(frame.freq);
              noteEl.textContent = `${info.note}${info.octave}`;
            }
            const st = cap.push(frame.time, frame.voiced ? frame.midi : null);
            barEl.style.width = Math.round(st.progress * 100) + '%';
            if (st.manualReady && st.candidate !== null) {
              manualBtn.textContent = `✓ ใช้โน้ตนี้ (${midiToNoteName(Math.round(st.candidate))})`;
              manualBtn.classList.remove('hidden');
            }
            if (st.captured !== null) finish(st.captured);
          },
        });
        mic.start().catch(rej);
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
          statusEl.textContent = '⚠️ ช่วงเสียงแคบเกินไป — ลองใหม่อีกครั้ง (สูง/ต่ำให้ต่างกันชัด ๆ)';
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
        statusEl.textContent = '⚠️ ' + (err.message || 'วัดไม่สำเร็จ ลองใหม่');
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
