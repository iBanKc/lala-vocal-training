// เกมจับคู่โน้ต — ฟังโน้ตแล้วร้องตาม (call-and-response)
// จับ stable segment แล้วให้คะแนนจาก median (curve 100@≤10¢ → 0@60¢)
import {
  MicSession, SegmentTracker, midiToFreq, midiToNoteName, scoreFromCents,
} from '../pitch-engine.js';
import { playNote } from '../tone.js';
import { PianoRoll } from '../piano-roll.js';

// ปรับความยากตามด่าน
function config(level) {
  const i = level - 1;
  return {
    notes:     [3, 4, 5, 6, 6, 7, 8, 8, 8, 8][i],
    tolerance: [40, 35, 30, 25, 22, 20, 15, 15, 12, 10][i],
    windowMs:  (level >= 7 ? 8 : 10) * 1000,
    holdMs:    1500,
    chromatic: level >= 6,
    maxLeap:   level < 4 ? 4 : level < 7 ? 7 : 12,
  };
}

// เลือกลำดับโน้ตในช่วงเสียงนักเรียน: เดินสุ่มทีละ step ไม่เกิน maxLeap
function pickTargets(cfg, voiceLow, voiceHigh) {
  const MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
  const center = Math.round((voiceLow + voiceHigh) / 2);
  const tonicPc = ((center % 12) + 12) % 12;
  // เผื่อขอบบน/ล่างไว้ 1 semitone กันโน้ตสุดช่วงที่ร้องยาก
  const lo = voiceLow + 1, hi = voiceHigh - 1;
  const pool = [];
  for (let m = lo; m <= hi; m++) {
    const pc = (((m - tonicPc) % 12) + 12) % 12;
    if (cfg.chromatic || MAJOR.has(pc)) pool.push(m);
  }
  if (!pool.length) pool.push(center);

  const targets = [];
  let cur = pool.reduce((a, b) => Math.abs(b - center) < Math.abs(a - center) ? b : a);
  targets.push(cur);
  while (targets.length < cfg.notes) {
    const options = pool.filter(m => m !== cur && Math.abs(m - cur) <= cfg.maxLeap);
    cur = options.length ? options[Math.floor(Math.random() * options.length)] : cur;
    targets.push(cur);
  }
  return targets;
}

export async function run({ level, stage, signal, voiceLow, voiceHigh, exercise }) {
  if (exercise?.mechanic === 'repeat_count') return runRepeatCount({ stage, signal, voiceLow, voiceHigh, exercise });
  const cfg = config(level);
  const targets = pickTargets(cfg, voiceLow, voiceHigh);

  stage.innerHTML = `
    <div class="nm-top">
      <div class="nm-progress" id="nmProgress"></div>
      <div class="nm-note" id="nmNote">—</div>
      <div class="nm-instruction" id="nmInstruction">เตรียมตัว...</div>
    </div>
    <div class="nm-roll-wrap"><canvas id="nmRoll" class="nm-roll"></canvas></div>
    <div class="nm-hold"><div class="nm-hold-bar" id="nmHoldBar"></div></div>
    <div class="nm-status" id="nmStatus"></div>`;

  const noteEl = stage.querySelector('#nmNote');
  const instrEl = stage.querySelector('#nmInstruction');
  const progEl = stage.querySelector('#nmProgress');
  const holdBar = stage.querySelector('#nmHoldBar');
  const statusEl = stage.querySelector('#nmStatus');
  const roll = new PianoRoll(stage.querySelector('#nmRoll'), { lowMidi: voiceLow, highMidi: voiceHigh, piano: true });

  let listening = false;
  let segTracker = null;
  let lastFrameTime = null;
  let holdMs = 0;
  let currentTarget = null;
  let inTolFrames = 0, voicedFrames = 0;

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      roll.pushPitch(frame.voiced ? frame.midi : null);
      roll.draw();
      if (!listening || currentTarget === null) { lastFrameTime = frame.time; return; }

      segTracker.push(frame);
      const dt = lastFrameTime === null ? 0 : frame.time - lastFrameTime;
      lastFrameTime = frame.time;

      if (frame.voiced) {
        voicedFrames++;
        const centsOff = Math.abs(frame.midi - currentTarget) * 100;
        if (centsOff <= 20) inTolFrames++;
        if (centsOff <= cfg.tolerance) {
          holdMs += dt;
          holdBar.style.width = Math.min(100, (holdMs / cfg.holdMs) * 100) + '%';
        }
      }
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => mic.stop();
  signal.addEventListener('abort', onAbort);

  const wait = ms => new Promise(r => setTimeout(r, ms));
  const results = [];

  try {
    // รอ calibrate noise floor ให้เสร็จ
    while (mic.running && !mic.calibrated) {
      if (signal.aborted) return null;
      await wait(100);
    }

    for (let n = 0; n < targets.length; n++) {
      if (signal.aborted) return null;
      const target = targets[n];
      progEl.textContent = `โน้ต ${n + 1}/${targets.length}`;
      noteEl.textContent = midiToNoteName(target);
      roll.setTarget(target, cfg.tolerance);

      // 1) เล่นโน้ตให้ฟัง (หยุดวิเคราะห์ไมค์ระหว่างเล่น — กันจับเสียงลำโพง)
      listening = false;
      instrEl.textContent = '👂 ฟังโน้ต...';
      await playNote(midiToFreq(target), 1.2);
      await wait(200); // กัน reverb ค้าง

      // 2) ฟังนักเรียนร้อง
      segTracker = new SegmentTracker();
      holdMs = 0;
      lastFrameTime = null;
      currentTarget = target;
      holdBar.style.width = '0%';
      instrEl.textContent = '🎤 ร้องเลย! ค้างเสียงไว้ให้นิ่ง';
      listening = true;

      const t0 = performance.now();
      let noteScore = null;
      let sungStats = null;
      while (performance.now() - t0 < cfg.windowMs) {
        if (signal.aborted) return null;
        await wait(60);
        if (holdMs >= cfg.holdMs) {
          const live = segTracker.liveStats(target);
          if (live) { sungStats = live; noteScore = live.score; }
          break;
        }
      }
      listening = false;
      currentTarget = null;

      // หมดเวลา: ใช้ segment ที่ดีที่สุดเท่าที่ร้องมา (ถ้ามี)
      if (noteScore === null) {
        const live = segTracker.liveStats(target);
        const ended = segTracker.end();
        const st = live && live.durMs >= 300 ? live : (ended ? ended.stats(target) : null);
        if (st) { sungStats = st; noteScore = st.score * Math.min(1, st.durMs / cfg.holdMs); }
        else noteScore = 0;
      }

      results.push({
        target_midi: target,
        sung_midi: sungStats ? Math.round(sungStats.medianMidi * 100) / 100 : null,
        cents: sungStats ? Math.round(sungStats.centsOff) : null,
        held_ms: Math.round(holdMs),
        score: Math.round(noteScore),
      });

      // 3) feedback
      if (noteScore >= 75) statusEl.innerHTML = `<span class="fb-good">✓ เยี่ยม! ${midiToNoteName(target)}</span>`;
      else if (noteScore >= 40) statusEl.innerHTML = `<span class="fb-mid">△ เกือบแล้ว ${sungStats && sungStats.centsOff > 0 ? 'สูงไปนิด' : 'ต่ำไปนิด'}</span>`;
      else statusEl.innerHTML = `<span class="fb-bad">✗ ${sungStats ? (sungStats.centsOff > 0 ? 'สูงเกินไป' : 'ต่ำเกินไป') : 'ไม่ได้ยินเสียงชัด ๆ'}</span>`;
      roll.setTarget(null, 0);
      await wait(1100);
      statusEl.textContent = '';
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  const score = results.reduce((a, r) => a + r.score, 0) / results.length;
  const sung = results.filter(r => r.cents !== null);
  return {
    score,
    accuracy_pct: voicedFrames ? (inTolFrames / voicedFrames) * 100 : 0,
    avg_cents_off: sung.length ? sung.reduce((a, r) => a + Math.abs(r.cents), 0) / sung.length : null,
    details: { notes: results, tolerance: cfg.tolerance },
  };
}

// ── โหมด Hee-ah (จากหนังสือ): ร้องซ้ำโน้ตเดิมให้ได้มากที่สุดในหนึ่งลมหายใจ ──
// นับ 1 ครั้ง = segment เสียงนิ่ง ≥250ms ที่ตรงโน้ต (±40¢) — จบเมื่อเงียบ >1.5s หรือครบ 25s
async function runRepeatCount({ stage, signal, voiceLow, voiceHigh, exercise }) {
  const target = Math.round((voiceLow + voiceHigh) / 2) - 1; // ช่วงเสียงกลางค่อนต่ำ ตามหนังสือ
  const targetReps = exercise.targetReps || 15;

  stage.innerHTML = `
    <div class="nm-top">
      <div class="nm-note">${midiToNoteName(target)}</div>
      <div class="nm-instruction" id="rcInstruction">เตรียมตัว...</div>
    </div>
    <div class="rc-combo-wrap">
      <div class="rc-combo" id="rcCombo">0</div>
      <div class="rc-combo-label">ครั้ง / เป้า ${targetReps}</div>
    </div>
    <div class="nm-hold"><div class="nm-hold-bar" id="rcBar"></div></div>
    <div class="nm-status" id="rcStatus"></div>`;

  const instrEl = stage.querySelector('#rcInstruction');
  const comboEl = stage.querySelector('#rcCombo');
  const barEl = stage.querySelector('#rcBar');
  const statusEl = stage.querySelector('#rcStatus');

  let reps = 0;
  let misses = 0;
  let listening = false;
  let lastVoiced = null;

  const seg = new SegmentTracker({
    minDurMs: 250,
    gapMs: 120, // "ฮี-อา" แยกพยางค์เร็ว — ช่องว่างสั้น
    onSegment: s => {
      if (!listening) return;
      const st = s.stats(target);
      if (Math.abs(st.centsOff) <= 40) {
        reps++;
        comboEl.textContent = reps;
        comboEl.classList.remove('pop');
        void comboEl.offsetWidth; // restart animation
        comboEl.classList.add('pop');
        barEl.style.width = Math.min(100, (reps / targetReps) * 100) + '%';
      } else {
        misses++;
        statusEl.innerHTML = `<span class="fb-mid">△ ${st.centsOff > 0 ? 'สูงไปนิด' : 'ต่ำไปนิด'}</span>`;
        setTimeout(() => { statusEl.textContent = ''; }, 700);
      }
    },
  });

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      if (!listening) return;
      seg.push(frame);
      if (frame.voiced) lastVoiced = frame.time;
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => mic.stop();
  signal.addEventListener('abort', onAbort);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  try {
    while (mic.running && !mic.calibrated) {
      if (signal.aborted) return null;
      await wait(100);
    }

    instrEl.textContent = '👂 ฟังโน้ต...';
    await playNote(midiToFreq(target), 1.2);
    await wait(200);

    instrEl.textContent = '🎤 สูดลมลึก แล้วร้อง "ฮี-อา ฮี-อา" ซ้ำ ๆ ให้มากที่สุด!';
    listening = true;
    const t0 = performance.now();

    // จบเมื่อ: เคยร้องแล้ว + เงียบเกิน 1.5 วิ (หมดลมหายใจ) หรือครบ 25 วิ
    while (performance.now() - t0 < 25000) {
      if (signal.aborted) return null;
      await wait(100);
      if (reps + misses > 0 && lastVoiced && performance.now() - lastVoiced > 1500) break;
    }
    listening = false;
    seg.end();
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  const score = Math.min(1, reps / targetReps) * 100;
  statusEl.innerHTML = reps >= targetReps
    ? '<span class="fb-good">✓ สุดยอด! ครบเป้าในลมหายใจเดียว</span>'
    : `<span class="fb-mid">ได้ ${reps} ครั้ง — ฝึกลมหายใจแล้วลองใหม่นะ</span>`;
  await new Promise(r => setTimeout(r, 1200));

  return {
    score,
    accuracy_pct: reps + misses ? (reps / (reps + misses)) * 100 : 0,
    avg_cents_off: null,
    details: { exercise: exercise.id, target_midi: target, reps, misses, target_reps: targetReps },
  };
}
