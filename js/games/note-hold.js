// เกมเสียงนิ่ง — ลากเสียงให้นิ่ง (ฝึกลมหายใจ + ความนิ่งของเสียง)
// ความยาก = ความสูงของโน้ต × ความยาวที่ต้องค้าง (สูงสุด 12 วิ)
//   L1-5: โน้ตเดียว สุ่มตำแหน่งสูงขึ้นตาม level, ค้าง 4→12 วิ
//   L6-8: สเกล 5 โน้ต จากคลังแบบฝึกของโรงเรียน (L7 ไล่ลงแบบ Ng/Kah-kee-koh)
// คะแนนต่อโน้ต = 70×(เวลาที่ค้างได้/เป้า) + โบนัสความนิ่ง (30 − stddev cents)
import {
  MicSession, SegmentTracker, midiToFreq, midiToNoteName,
} from '../pitch-engine.js';
import { playNote, playMelody } from '../tone.js';
import { PianoRoll } from '../piano-roll.js';
import { BOOK } from '../curriculum.js';

export function config(level) {
  if (level <= 5) {
    const i = level - 1;
    return {
      scale: false,
      targetSec: [4, 6, 8, 10, 12][i],                                     // cap 12 วิ
      heightRange: [[0.05, 0.4], [0.15, 0.55], [0.3, 0.7], [0.45, 0.85], [0.6, 0.95]][i],
      tolerance: [25, 25, 22, 20, 18][i],
    };
  }
  const j = level - 6;
  return {
    scale: true,
    holdPerNote: [2.0, 2.2, 2.4][j],                                       // รวม 10/11/12 วิ
    tolerance: [22, 20, 18][j],
    tonicFrac: [0.35, 0.55, 0.75][j],
    descending: level === 7,                                               // ไล่ลงตามแบบฝึก
  };
}

// โน้ตเดียว: สุ่มความสูงในโซนของ level (สูงกว่า = ยากกว่า) — pure, ทดสอบได้
export function pickHoldNote(cfg, low, high, rand = Math.random) {
  const [a, b] = cfg.heightRange;
  const frac = a + rand() * (b - a);
  return Math.max(low + 1, Math.min(high - 1, Math.round(low + frac * (high - low))));
}

// สเกล 5 โน้ต major (1-2-3-4-5) จาก tonic ตามตำแหน่งของ level — pure, ทดสอบได้
export function scaleNotes(cfg, low, high) {
  const degrees = [0, 2, 4, 5, 7];
  let tonic = Math.round(low + cfg.tonicFrac * (high - low));
  tonic = Math.max(low + 1, Math.min(high - 1 - 7, tonic)); // ยอดสเกลไม่เกิน high-1
  const notes = degrees.map(d => tonic + d);
  return cfg.descending ? notes.reverse() : notes;
}

export async function run({ level, stage, signal, voiceLow, voiceHigh, exercise }) {
  if (exercise?.mechanic === 'rms_envelope') return runCrescendo({ stage, signal, voiceLow, voiceHigh, exercise });

  const cfg = config(level);
  const targets = cfg.scale ? scaleNotes(cfg, voiceLow, voiceHigh) : [pickHoldNote(cfg, voiceLow, voiceHigh)];
  const holdSec = cfg.scale ? cfg.holdPerNote : cfg.targetSec;

  stage.innerHTML = `
    <div class="nm-top">
      ${cfg.scale ? `<div class="me-dots" id="nhDots">${targets.map((_, i) => `<span class="me-dot">${i + 1}</span>`).join('')}</div>` : ''}
      <div class="nm-progress" id="nhProgress"></div>
      <div class="nm-note" id="nhNote">—</div>
      <div class="nm-instruction" id="nhInstruction">เตรียมตัว...</div>
    </div>
    <div class="nm-roll-wrap"><canvas id="nhRoll" class="nm-roll"></canvas></div>
    <div class="nh-seconds"><span id="nhHeld">0.0</span> / ${holdSec} วิ</div>
    <div class="nm-hold"><div class="nm-hold-bar" id="nhBar"></div></div>
    <div class="nh-wobble">
      <span>ความนิ่ง</span>
      <div class="nh-wobble-track"><div class="nh-wobble-bar" id="nhWobble"></div></div>
    </div>
    <div class="nm-status" id="nhStatus"></div>
    ${cfg.scale ? `<p class="login-hint">${BOOK.credit} · สเกล 5 โน้ต${cfg.descending ? 'ไล่ลง' : ''}</p>` : ''}`;

  const dots = [...stage.querySelectorAll('.me-dot')];
  const progEl = stage.querySelector('#nhProgress');
  const noteEl = stage.querySelector('#nhNote');
  const instrEl = stage.querySelector('#nhInstruction');
  const heldEl = stage.querySelector('#nhHeld');
  const barEl = stage.querySelector('#nhBar');
  const wobbleEl = stage.querySelector('#nhWobble');
  const statusEl = stage.querySelector('#nhStatus');
  const roll = new PianoRoll(stage.querySelector('#nhRoll'), { lowMidi: voiceLow, highMidi: voiceHigh, piano: true });

  let listening = false;
  let current = null;
  let heldMs = 0;
  let noteDone = false;
  let lastTime = null;
  let seg = null;
  const recentMidis = [];

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      roll.pushPitch(frame.voiced ? frame.midi : null);
      roll.draw();
      if (!listening || current === null) { lastTime = frame.time; return; }

      seg.push(frame);
      const dt = lastTime === null ? 0 : frame.time - lastTime;
      lastTime = frame.time;

      if (frame.voiced) {
        const centsOff = Math.abs(frame.midi - current) * 100;
        if (centsOff <= cfg.tolerance) heldMs += dt;
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
      }
      heldEl.textContent = (heldMs / 1000).toFixed(1);
      barEl.style.width = Math.min(100, (heldMs / (holdSec * 1000)) * 100) + '%';
      if (heldMs >= holdSec * 1000) noteDone = true;
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => mic.stop();
  signal.addEventListener('abort', onAbort);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const results = [];
  try {
    while (mic.running && !mic.calibrated) {
      if (signal.aborted) return null;
      await wait(100);
    }

    // โหมดสเกล: เล่นสเกลนำทั้งท่อนก่อน (call-and-response)
    if (cfg.scale) {
      instrEl.textContent = '👂 ฟังสเกลก่อน...';
      await playMelody(targets, { noteDur: 0.5, gap: 0.08 });
      await wait(300);
    }

    for (let n = 0; n < targets.length; n++) {
      if (signal.aborted) return null;
      const target = targets[n];
      current = null;

      if (cfg.scale) {
        dots.forEach((d, i) => d.classList.toggle('active', i === n));
        progEl.textContent = `โน้ตที่ ${n + 1}/${targets.length}`;
      }
      noteEl.textContent = midiToNoteName(target);
      roll.setTarget(target, cfg.tolerance);

      // เล่นโน้ตนำ (สั้นลงในโหมดสเกล)
      listening = false;
      instrEl.textContent = '👂 ฟังโน้ต...';
      await playNote(midiToFreq(target), cfg.scale ? 0.8 : 1.2);
      await wait(200);

      seg = new SegmentTracker({ minDurMs: 300 });
      heldMs = 0;
      noteDone = false;
      lastTime = null;
      heldEl.textContent = '0.0';
      barEl.style.width = '0%';
      current = target;
      instrEl.textContent = `🎤 ร้อง "อา" ค้างให้นิ่ง ${holdSec} วิ!`;
      listening = true;

      const t0 = performance.now();
      const maxMs = holdSec * 2500 + 4000;
      while (!noteDone && performance.now() - t0 < maxMs) {
        if (signal.aborted) return null;
        await wait(80);
      }
      listening = false;
      current = null;

      const live = seg.liveStats(target);
      const ended = seg.end();
      const st = live && live.durMs >= 300 ? live : (ended ? ended.stats(target) : null);
      const heldDone = heldMs / 1000;
      const stddev = st ? st.stddevCents : 100;
      const noteScore = Math.max(0, Math.min(100,
        70 * Math.min(heldDone / holdSec, 1) + Math.max(0, 30 - stddev)));

      results.push({
        midi: target,
        held_sec: Math.round(heldDone * 10) / 10,
        stddev_cents: Math.round(stddev * 10) / 10,
        mean_abs_cents: st ? Math.round(st.meanAbsCents * 10) / 10 : null,
        score: Math.round(noteScore),
      });

      if (cfg.scale) {
        dots[n].classList.remove('active');
        dots[n].classList.add(noteScore >= 70 ? 'good' : noteScore > 0 ? 'mid' : 'bad');
      }
      statusEl.innerHTML = noteDone
        ? '<span class="fb-good">✓ ครบเวลา!</span>'
        : `<span class="fb-mid">ได้ ${heldDone.toFixed(1)} วิ</span>`;
      roll.setTarget(null, 0);
      await wait(cfg.scale ? 800 : 1100);
      statusEl.textContent = '';
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  const score = results.reduce((a, r) => a + r.score, 0) / results.length;
  const withCents = results.filter(r => r.mean_abs_cents !== null);
  return {
    score,
    accuracy_pct: withCents.length
      ? withCents.reduce((a, r) => a + Math.max(0, 100 - r.mean_abs_cents), 0) / withCents.length
      : 0,
    avg_cents_off: withCents.length
      ? withCents.reduce((a, r) => a + r.mean_abs_cents, 0) / withCents.length
      : null,
    details: cfg.scale
      ? { scale: targets, per_note: results, book_scale: true, hold_per_note: cfg.holdPerNote }
      : {
          target_midi: targets[0],
          held_sec: results[0].held_sec,
          stddev_cents: results[0].stddev_cents,
          target_sec: cfg.targetSec,
        },
  };
}

// ── โหมด Crescendo-Decrescendo (แบบฝึกหัดที่ 38 จากคลังแบบฝึก) ──
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
  const samples = []; // {u(0..1), rms, midi|null}

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
