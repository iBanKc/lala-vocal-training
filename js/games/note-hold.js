// เกมเสียงนิ่ง — ลากเสียงโน้ตเดียวให้นิ่งและยาว (ฝึกลมหายใจ + ความนิ่งของเสียง)
// คะแนน = 70×(เวลาที่ค้างได้/เป้า) + โบนัสความนิ่ง (30 − stddev cents)
import {
  MicSession, SegmentTracker, midiToFreq, midiToNoteName,
} from '../pitch-engine.js';
import { playNote } from '../tone.js';

function config(level) {
  const i = level - 1;
  return {
    targetSec: [4, 5, 6, 8, 10, 12, 14, 15][i],
    tolerance: [25, 25, 22, 22, 20, 18, 16, 15][i],
    graceMs: 300, // หลุด tolerance ได้ไม่เกินนี้โดยไม่หยุดนับ
  };
}

export async function run({ level, stage, signal, voiceLow, voiceHigh, exercise }) {
  if (exercise?.mechanic === 'rms_envelope') return runCrescendo({ stage, signal, voiceLow, voiceHigh, exercise });
  const cfg = config(level);
  // โน้ตกลาง ๆ ของช่วงเสียง (สุ่มในหนึ่งในสามตรงกลาง) — โน้ตสบายที่สุดสำหรับลากยาว
  const third = Math.max(1, Math.round((voiceHigh - voiceLow) / 3));
  const lo = voiceLow + third, hi = voiceHigh - third;
  const target = lo >= hi ? Math.round((voiceLow + voiceHigh) / 2) : lo + Math.floor(Math.random() * (hi - lo + 1));

  stage.innerHTML = `
    <div class="nh-wrap">
      <div class="nm-note">${midiToNoteName(target)}</div>
      <div class="nm-instruction" id="nhInstruction">เตรียมตัว...</div>
      <div class="nh-ring-wrap">
        <svg viewBox="0 0 120 120" class="nh-ring">
          <circle cx="60" cy="60" r="52" fill="none" stroke="#e8f1ff" stroke-width="10"/>
          <circle id="nhRingBar" cx="60" cy="60" r="52" fill="none" stroke="#16a34a" stroke-width="10"
                  stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="326.7"
                  transform="rotate(-90 60 60)"/>
        </svg>
        <div class="nh-ring-text"><span id="nhHeld">0.0</span><small>/ ${cfg.targetSec} วิ</small></div>
      </div>
      <div class="nh-wobble">
        <span>ความนิ่ง</span>
        <div class="nh-wobble-track"><div class="nh-wobble-bar" id="nhWobble"></div></div>
      </div>
      <div class="nm-status" id="nhStatus"></div>
    </div>`;

  const instrEl = stage.querySelector('#nhInstruction');
  const ringBar = stage.querySelector('#nhRingBar');
  const heldEl = stage.querySelector('#nhHeld');
  const wobbleEl = stage.querySelector('#nhWobble');
  const statusEl = stage.querySelector('#nhStatus');
  const CIRC = 326.7;

  let listening = false;
  let heldMs = 0;
  let outMs = 0;         // เวลาต่อเนื่องที่หลุด tolerance
  let lastTime = null;
  let done = false;
  const seg = new SegmentTracker({ minDurMs: 300 });
  const recentMidis = []; // สำหรับ wobble meter (rolling stddev)

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      if (!listening || done) { lastTime = frame.time; return; }
      seg.push(frame);
      const dt = lastTime === null ? 0 : frame.time - lastTime;
      lastTime = frame.time;

      if (frame.voiced) {
        const centsOff = Math.abs(frame.midi - target) * 100;
        if (centsOff <= cfg.tolerance) {
          outMs = 0;
          heldMs += dt;
        } else {
          outMs += dt;
        }
        // wobble meter จาก rolling stddev 20 เฟรมล่าสุด
        recentMidis.push(frame.midi);
        if (recentMidis.length > 20) recentMidis.shift();
        if (recentMidis.length >= 5) {
          const mean = recentMidis.reduce((a, b) => a + b) / recentMidis.length;
          const sd = Math.sqrt(recentMidis.reduce((a, m) => a + ((m - mean) * 100) ** 2, 0) / recentMidis.length);
          const pct = Math.max(0, Math.min(100, 100 - (sd / 50) * 100));
          wobbleEl.style.width = pct + '%';
          wobbleEl.style.background = sd < 15 ? '#16a34a' : sd < 30 ? '#ca8a04' : '#dc2626';
        }
      } else {
        outMs += dt;
      }

      heldEl.textContent = (heldMs / 1000).toFixed(1);
      ringBar.style.strokeDashoffset = CIRC * (1 - Math.min(1, heldMs / (cfg.targetSec * 1000)));
      if (heldMs >= cfg.targetSec * 1000) done = true;
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
    listening = false;
    await playNote(midiToFreq(target), 1.2);
    await wait(200);

    instrEl.textContent = `🎤 ร้อง "อา" ค้างไว้ให้นิ่งที่สุด!`;
    lastTime = null;
    listening = true;

    // จำกัดเวลารอบ: 3 เท่าของเป้า + 5 วิ
    const t0 = performance.now();
    const maxMs = cfg.targetSec * 3000 + 5000;
    while (!done && performance.now() - t0 < maxMs) {
      if (signal.aborted) return null;
      await wait(80);
    }
    listening = false;
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  const live = seg.liveStats(target);
  const ended = seg.end();
  const st = live && live.durMs >= 300 ? live : (ended ? ended.stats(target) : null);

  const heldSec = heldMs / 1000;
  const stddev = st ? st.stddevCents : 100;
  const score = Math.max(0, Math.min(100,
    70 * Math.min(heldSec / cfg.targetSec, 1) + Math.max(0, 30 - stddev)));

  statusEl.innerHTML = done ? '<span class="fb-good">✓ ครบเวลา!</span>' : '<span class="fb-mid">หมดเวลา</span>';

  return {
    score,
    accuracy_pct: st ? Math.max(0, 100 - st.meanAbsCents) : 0,
    avg_cents_off: st ? Math.abs(st.centsOff) : null,
    details: {
      target_midi: target,
      held_sec: Math.round(heldSec * 10) / 10,
      stddev_cents: Math.round(stddev * 10) / 10,
      target_sec: cfg.targetSec,
    },
  };
}

// ── โหมด Crescendo-Decrescendo (แบบฝึกหัดที่ 38 จากหนังสือ) ──
// ร้องโน้ตเดียว 8 วิ: เบา → ดัง → เบา — คะแนน 60% ความนิ่งของ pitch + 40% รูปทรงความดัง
async function runCrescendo({ stage, signal, voiceLow, voiceHigh, exercise }) {
  const target = Math.round((voiceLow + voiceHigh) / 2);
  const DUR = 8; // วินาที

  stage.innerHTML = `
    <div class="nh-wrap">
      <div class="nm-note">${midiToNoteName(target)}</div>
      <div class="nm-instruction" id="crInstruction">เตรียมตัว...</div>
      <div class="cr-guide">
        <svg viewBox="0 0 200 60" class="cr-guide-svg">
          <path d="M 10 50 Q 100 -10 190 50" fill="none" stroke="#93c5fd" stroke-width="3" stroke-dasharray="5 4"/>
          <text x="10" y="58" font-size="9" fill="#4a6585">เบา</text>
          <text x="95" y="12" font-size="9" fill="#4a6585">ดัง</text>
          <text x="175" y="58" font-size="9" fill="#4a6585">เบา</text>
        </svg>
        <div class="cr-cursor" id="crCursor"></div>
      </div>
      <div class="nh-wobble">
        <span>ความดังตอนนี้</span>
        <div class="nh-wobble-track"><div class="nh-wobble-bar" id="crLoud"></div></div>
      </div>
      <div class="nm-status" id="crStatus"></div>
    </div>`;

  const instrEl = stage.querySelector('#crInstruction');
  const loudEl = stage.querySelector('#crLoud');
  const cursorEl = stage.querySelector('#crCursor');
  const statusEl = stage.querySelector('#crStatus');

  let listening = false;
  let t0 = null;
  const samples = []; // {t(0..1), rms, midi|null}

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      if (!listening || t0 === null) return;
      const u = (frame.time - t0) / (DUR * 1000);
      if (u > 1) return;
      samples.push({ u, rms: frame.rms, midi: frame.voiced ? frame.midi : null });
      const loudPct = Math.min(100, (frame.rms / 0.15) * 100);
      loudEl.style.width = loudPct + '%';
      loudEl.style.background = '#1976D2';
      cursorEl.style.left = (u * 100) + '%';
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

    instrEl.textContent = `🎤 ร้อง "อา" ${DUR} วิ: เริ่มเบา → ดังสุดตรงกลาง → กลับมาเบา`;
    t0 = performance.now();
    listening = true;
    while (performance.now() - t0 < DUR * 1000) {
      if (signal.aborted) return null;
      await wait(80);
    }
    listening = false;
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  // ── คะแนน pitch (60): สัดส่วนเฟรม voiced ที่อยู่ใน ±30¢ ──
  const voiced = samples.filter(s => s.midi !== null);
  const inTol = voiced.filter(s => Math.abs(s.midi - target) * 100 <= 30).length;
  const pitchScore = voiced.length >= 20 ? 60 * (inTol / voiced.length) : 0;

  // ── คะแนน envelope (40): peak อยู่ช่วงกลาง + หัวท้ายเบากว่า peak ชัดเจน ──
  // smooth RMS ด้วย moving average 7 จุด
  const rms = samples.map(s => s.rms);
  const sm = rms.map((_, i) => {
    const a = rms.slice(Math.max(0, i - 3), i + 4);
    return a.reduce((x, y) => x + y, 0) / a.length;
  });
  let envScore = 0;
  if (sm.length >= 30) {
    const peak = Math.max(...sm);
    const peakU = samples[sm.indexOf(peak)].u;
    const n = sm.length;
    const startQ = sm.slice(0, Math.max(3, n * 0.12 | 0)).reduce((a, b) => a + b) / Math.max(3, n * 0.12 | 0) / peak;
    const endQ = sm.slice(-Math.max(3, n * 0.12 | 0)).reduce((a, b) => a + b) / Math.max(3, n * 0.12 | 0) / peak;
    const quiet = x => x <= 0.5 ? 1 : x >= 0.9 ? 0 : (0.9 - x) / 0.4;
    const posOK = peakU >= 0.25 && peakU <= 0.75 ? 1 : Math.max(0, 1 - Math.abs(peakU - 0.5) * 2.5);
    envScore = 40 * (0.3 * posOK + 0.35 * quiet(startQ) + 0.35 * quiet(endQ));
  }

  const score = Math.max(0, Math.min(100, pitchScore + envScore));
  statusEl.innerHTML = score >= 75
    ? '<span class="fb-good">✓ รูปทรงเสียงสวยมาก!</span>'
    : '<span class="fb-mid">ลองให้หัว-ท้ายเบากว่านี้ และดังสุดตรงกลาง</span>';
  await new Promise(r => setTimeout(r, 1200));

  return {
    score,
    accuracy_pct: voiced.length ? (inTol / voiced.length) * 100 : 0,
    avg_cents_off: null,
    details: {
      exercise: exercise.id,
      target_midi: target,
      pitch_score: Math.round(pitchScore),
      env_score: Math.round(envScore),
    },
  };
}
