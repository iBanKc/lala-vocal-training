// วัดช่วงเสียง (voice range calibration) — ครั้งแรกก่อนเล่นเกม / วัดใหม่ได้จาก hub
import { MicSession, SegmentTracker, freqToNoteInfo, midiToNoteName } from './pitch-engine.js';
import { api } from './api.js';
import { state, loadProfile } from './state.js';

const STEPS = [
  { key: 'low',  title: 'โน้ตต่ำสุด',  hint: 'ร้อง "อา" เสียงต่ำที่สุดที่ร้องได้สบาย ๆ ค้างไว้ 2 วินาที' },
  { key: 'high', title: 'โน้ตสูงสุด', hint: 'ร้อง "อา" เสียงสูงที่สุดที่ร้องได้สบาย ๆ ค้างไว้ 2 วินาที' },
];

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
    const cancelBtn = overlay.querySelector('#calCancel');

    let mic = null;
    const results = {};

    function cleanup(ok) {
      if (mic) { mic.stop(); mic = null; }
      overlay.remove();
      resolve(ok);
    }
    cancelBtn.addEventListener('click', () => cleanup(false));

    // วัดหนึ่งขั้น: จับ segment นิ่ง ≥1.5s (stddev < 60¢) → median MIDI
    function measureStep(step) {
      return new Promise((res, rej) => {
        titleEl.textContent = `🎙️ ${step.title}`;
        hintEl.textContent = step.hint;
        noteEl.textContent = '—';
        barEl.style.width = '0%';
        statusEl.textContent = '';

        const seg = new SegmentTracker({ minDurMs: 1500 });
        mic = new MicSession({
          onStatus: s => {
            if (s === 'calibrating') statusEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
            if (s === 'ready') statusEl.textContent = 'ร้องได้เลย!';
          },
          onFrame: frame => {
            seg.push(frame);
            if (frame.voiced) {
              const info = freqToNoteInfo(frame.freq);
              noteEl.textContent = `${info.note}${info.octave}`;
            }
            const live = seg.liveStats();
            if (live && live.durMs >= 300) {
              barEl.style.width = Math.min(100, (live.durMs / 1500) * 100) + '%';
              if (live.durMs >= 1500 && live.stddevCents < 60) {
                const midi = Math.round(live.medianMidi);
                mic.stop(); mic = null;
                res(midi);
              }
            }
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
