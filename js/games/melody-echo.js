// เกมร้องตามทำนอง — ฟังทำนองสั้น ๆ แล้วร้องตามทีละโน้ต (ฝึกหูดนตรี / interval)
// ต่อโน้ต: ถูก semitone (±50¢) = 100 − clamp(|cents|−20, 0, 50), ผิดโน้ต = 0
//
// UX (จาก feedback เจ้าของ: ผู้เล่นสับสนว่าต้องทำอะไร):
//   การ์ดวิธีเล่นก่อนเริ่ม → แถบบอกเฟส ฟัง(น้ำเงิน)/ร้อง(เขียว) → จุดโน้ตมีเลขกำกับ
//   → ชื่อโน้ตแสดงเสมอ + คีย์เปียโนขวา (PianoRoll piano:true) → กระตุ้นเมื่อผู้เล่นเงียบ
import {
  MicSession, SegmentTracker, midiToFreq, midiToNoteName,
} from '../pitch-engine.js';
import { playMelody } from '../tone.js';
import { PianoRoll } from '../piano-roll.js';

function config(level) {
  const i = level - 1;
  return {
    notes:   [3, 3, 4, 4, 5, 5, 5, 6, 6, 7, 7, 7][i],
    maxLeap: [2, 2, 2, 4, 4, 4, 7, 7, 7, 12, 12, 12][i],
    minor:   level >= 10,
    windowMs: 6000,
  };
}

// สร้างทำนองในช่วงเสียงนักเรียน: เดินใน scale ทีละไม่เกิน maxLeap
function makeMelody(cfg, voiceLow, voiceHigh) {
  const SCALE = cfg.minor ? new Set([0, 2, 3, 5, 7, 8, 10]) : new Set([0, 2, 4, 5, 7, 9, 11]);
  const center = Math.round((voiceLow + voiceHigh) / 2);
  const tonicPc = ((center % 12) + 12) % 12;
  const lo = voiceLow + 1, hi = voiceHigh - 1;
  const pool = [];
  for (let m = lo; m <= hi; m++) {
    if (SCALE.has((((m - tonicPc) % 12) + 12) % 12)) pool.push(m);
  }
  if (!pool.length) pool.push(center);

  const melody = [];
  let cur = pool.reduce((a, b) => Math.abs(b - center) < Math.abs(a - center) ? b : a);
  melody.push(cur);
  while (melody.length < cfg.notes) {
    const options = pool.filter(m => m !== cur && Math.abs(m - cur) <= cfg.maxLeap);
    cur = options.length ? options[Math.floor(Math.random() * options.length)] : cur;
    melody.push(cur);
  }
  return melody;
}

// ด่านพิเศษจากคลังแบบฝึก: pattern ตายตัว (สเกล 5 โน้ตไล่ลง) ขยับขึ้นครึ่งเสียงต่อรอบ + พยางค์กำกับ
const PATTERNS = { scale5_desc: [7, 5, 4, 2, 0] };

function exerciseMelody(exercise, voiceLow, voiceHigh) {
  const offsets = PATTERNS[exercise.pattern] || PATTERNS.scale5_desc;
  const center = Math.round((voiceLow + voiceHigh) / 2);
  const span = Math.max(...offsets);
  const tonic0 = Math.max(voiceLow + 1, Math.min(center - 4, voiceHigh - 1 - span - (exercise.keys - 1)));
  const notes = [];
  for (let k = 0; k < exercise.keys; k++) {
    const useAlt = exercise.syllablesAlt && k >= Math.ceil(exercise.keys / 2);
    const syl = useAlt ? exercise.syllablesAlt : exercise.syllables;
    offsets.forEach((off, i) => notes.push({ midi: tonic0 + k + off, syllable: syl ? syl[i % syl.length] : null }));
  }
  return notes;
}

export async function run({ level, stage, signal, voiceLow, voiceHigh, exercise }) {
  const cfg = exercise
    ? {
        windowMs: 5000,
        staccato: !!exercise.staccato,
        // staccato จริงร้องสั้น ~150-200ms — เกณฑ์ต้องต่ำพอให้เสียงตัดผ่านการตัดสิน
        judgeDurMs: exercise.staccato ? 160 : 400,
        noteDur: exercise.staccato ? 0.32 : 60 / (exercise.tempo || 90) * 0.9,
      }
    : { ...config(level), staccato: false, judgeDurMs: 400, noteDur: 0.55 };

  const melodyNotes = exercise
    ? exerciseMelody(exercise, voiceLow, voiceHigh)
    : makeMelody(config(level), voiceLow, voiceHigh).map(m => ({ midi: m, syllable: null }));
  const melody = melodyNotes.map(n => n.midi);
  const unitWord = exercise?.syllables ? 'พยางค์' : 'โน้ต';

  // ── การ์ดวิธีเล่น (ปุ่มเริ่ม = gesture สดสำหรับ iOS ด้วย) ──
  stage.innerHTML = `
    <div class="wr-card me-intro" id="meIntro">
      <h2>🦜 วิธีเล่น "ร้องตามทำนอง"</h2>
      <ol class="me-steps">
        <li><strong>👂 ฟังทำนองจนจบ</strong> — ยังไม่ต้องร้อง</li>
        <li><strong>🎤 ถึงตาคุณ</strong> — ร้องตาม "ทีละ${unitWord}" ตามจุดตัวเลขที่กะพริบ</li>
        <li>ร้องถูก จุดเปลี่ยนเป็น<span style="color:var(--green);font-weight:700">สีเขียว</span> แล้วเลื่อนไป${unitWord}ถัดไป</li>
      </ol>
      <button class="btn-start" id="meStart">▶ เริ่มเลย (${melody.length} ${unitWord})</button>
    </div>
    <div class="me-game hidden" id="meGame">
      <div class="phase-banner listen" id="mePhase">👂 ขั้นที่ 1/2 — ฟังทำนอง (ยังไม่ต้องร้อง)</div>
      <div class="nm-top">
        <div class="me-dots" id="meDots">
          ${melody.map((_, i) => `<span class="me-dot">${i + 1}</span>`).join('')}
        </div>
        <div class="nm-note" id="meNote">—</div>
        <div class="me-live" id="meLive"></div>
        <div class="nm-instruction" id="meInstruction">เตรียมตัว...</div>
      </div>
      <div class="nm-roll-wrap"><canvas id="meRoll" class="nm-roll"></canvas></div>
      <div class="me-actions">
        <button class="btn-secondary" id="meReplay" disabled>🔁 ขอฟังทำนองอีกครั้ง (−5 คะแนน)</button>
      </div>
      <div class="nm-status" id="meStatus"></div>
    </div>`;

  // รอผู้เล่นกด "เริ่มเลย"
  await new Promise((res, rej) => {
    stage.querySelector('#meStart').addEventListener('click', res, { once: true });
    signal.addEventListener('abort', () => rej(new Error('aborted')), { once: true });
  }).catch(() => null);
  if (signal.aborted) return null;
  stage.querySelector('#meIntro').classList.add('hidden');
  stage.querySelector('#meGame').classList.remove('hidden');

  const dots = [...stage.querySelectorAll('.me-dot')];
  const phaseEl = stage.querySelector('#mePhase');
  const noteEl = stage.querySelector('#meNote');
  const instrEl = stage.querySelector('#meInstruction');
  const statusEl = stage.querySelector('#meStatus');
  const replayBtn = stage.querySelector('#meReplay');
  const liveEl = stage.querySelector('#meLive');
  // ซูมช่วงโน้ตของทำนอง (เลนหนา เห็นความเพี้ยนชัด); staccato ใช้หน้าต่างเวลาสั้น
  // ให้เสียงร้องสั้น ๆ กินความกว้างจอมากขึ้น — เห็นทันทีที่เปล่งเสียง
  const roll = new PianoRoll(stage.querySelector('#meRoll'), {
    lowMidi: Math.min(...melody) - 3,
    highMidi: Math.max(...melody) + 3,
    piano: true,
    historyMs: cfg.staccato ? 2500 : 4000,
  });

  // แถบบอกเฟส: ฟัง (น้ำเงิน) / ร้อง (เขียว) — pulse ทุกครั้งที่สลับ
  function setPhase(p) {
    phaseEl.className = 'phase-banner ' + p;
    phaseEl.textContent = p === 'listen'
      ? '👂 ขั้นที่ 1/2 — ฟังทำนอง (ยังไม่ต้องร้อง)'
      : `🎤 ขั้นที่ 2/2 — ตาคุณแล้ว! ร้องตามทีละ${unitWord}`;
    phaseEl.classList.remove('pulse');
    void phaseEl.offsetWidth; // restart animation
    phaseEl.classList.add('pulse');
  }

  const noteLabel = n => {
    const name = midiToNoteName(melody[n]);
    return melodyNotes[n].syllable ? `${melodyNotes[n].syllable} · ${name}` : `🎯 ${name}`;
  };

  let listening = false;
  let seg = null;
  let replays = 0;
  let currentTarget = null;

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      roll.pushPitch(frame.voiced ? frame.midi : null);
      roll.draw();
      if (listening && seg) seg.push(frame);
      // ป้าย "ได้ยิน" สด — ผู้เล่นเห็นทันทีว่าแอปจับเสียงอะไรได้ (สำคัญกับเสียงตัดสั้น)
      if (listening && frame.voiced && currentTarget !== null) {
        const off = Math.abs(frame.midi - currentTarget) * 100;
        liveEl.textContent = `ได้ยิน: ${midiToNoteName(Math.round(frame.midi))}`;
        liveEl.style.color = off <= 50 ? '#16a34a' : '#dc2626';
      }
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => mic.stop();
  signal.addEventListener('abort', onAbort);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // เล่นทำนองทั้งท่อน (ช่วงฟัง — ปุ่มฟังซ้ำปิด, เป้าบนหน้าจอวิ่งตามโน้ตที่เล่น)
  async function playAll() {
    listening = false;
    replayBtn.disabled = true;
    setPhase('listen');
    for (let i = 0; i < melody.length; i++) {
      dots.forEach((d, j) => d.classList.toggle('playing', j === i));
      noteEl.textContent = noteLabel(i);
      roll.setTarget(melody[i], 50);
      instrEl.textContent = `กำลังเล่น${unitWord}ที่ ${i + 1}/${melody.length}...`;
      await playMelody([melody[i]], { noteDur: cfg.noteDur, gap: cfg.staccato ? 0.15 : 0.1 });
      dots[i].classList.remove('playing');
    }
    roll.setTarget(null, 0);
    await wait(250);
  }

  let replayRequested = false;
  replayBtn.addEventListener('click', () => {
    if (!replayBtn.disabled) replayRequested = true;
  });

  // ทวนโน้ตแรกหนึ่งครั้งก่อนถึงตาผู้เล่น — ให้ยึดเสียงตั้งต้นได้ (feedback เจ้าของ)
  async function anchorFirstNote() {
    instrEl.textContent = '🔔 ฟังโน้ตแรกอีกครั้ง...';
    noteEl.textContent = noteLabel(0);
    dots.forEach((d, j) => d.classList.toggle('playing', j === 0));
    roll.setTarget(melody[0], 50);
    await playMelody([melody[0]], { noteDur: cfg.noteDur, gap: 0.1 });
    dots[0].classList.remove('playing');
    roll.setTarget(null, 0);
    await wait(350);
  }

  const results = [];
  try {
    while (mic.running && !mic.calibrated) {
      if (signal.aborted) return null;
      await wait(100);
    }

    await playAll();

    // คั่นจังหวะ "ตาคุณแล้ว!" ให้เห็นชัดก่อนเริ่มร้อง + ทวนโน้ตแรกให้ยึดเสียง
    setPhase('sing');
    statusEl.innerHTML = '<span class="fb-good">ตาคุณแล้ว! 🎤</span>';
    await wait(900);
    statusEl.textContent = '';
    await anchorFirstNote();
    if (signal.aborted) return null;
    replayBtn.disabled = false;

    for (let n = 0; n < melody.length; n++) {
      if (signal.aborted) return null;
      const target = melody[n];

      if (replayRequested) {
        replayRequested = false;
        replays++;
        await playAll();
        setPhase('sing');
        await anchorFirstNote();
        if (signal.aborted) return null;
        replayBtn.disabled = false;
      }

      dots.forEach((d, i) => d.classList.toggle('active', i === n));
      const syl = melodyNotes[n].syllable;
      instrEl.textContent = syl
        ? `🎤 ร้อง "${syl}" (${unitWord}ที่ ${n + 1}/${melody.length})`
        : `🎤 ร้อง${unitWord}ที่ ${n + 1}/${melody.length} — นึกเสียงในใจแล้วร้องออกมา`;
      noteEl.textContent = noteLabel(n);
      roll.setTarget(target, 50);

      // เก็บ segment ที่ปิดแล้วไว้ด้วย — เสียงตัดสั้นที่จบก่อนถึงรอบ poll ต้องยังตัดสินได้
      let lastSeg = null;
      seg = new SegmentTracker({
        minDurMs: cfg.staccato ? 140 : 250,
        onSegment: s => { lastSeg = s; },
      });
      currentTarget = target;
      liveEl.textContent = '';
      listening = true;

      // ตัดสินเมื่อได้ segment นิ่งพอ หรือหมดเวลา — เงียบเกิน 2.5 วิ มีกระตุ้น
      const t0 = performance.now();
      let judged = null;
      let nudged = false;
      while (performance.now() - t0 < cfg.windowMs) {
        if (signal.aborted) return null;
        await wait(60);
        const live = seg.liveStats(target);
        if (live && live.durMs >= cfg.judgeDurMs && live.stddevCents < 60) { judged = live; break; }
        // เสียงตัดสั้นที่จบไปแล้ว (staccato) = คำตอบสมบูรณ์ ไม่ต้องรอหมดเวลา
        if (!judged && lastSeg && cfg.staccato) { judged = lastSeg.stats(target); break; }
        if (!live && !lastSeg && !nudged && performance.now() - t0 > 2500) {
          nudged = true;
          statusEl.innerHTML = '<span class="fb-mid">ร้องได้เลย ระบบกำลังฟังอยู่ 🎤</span>';
        }
      }
      listening = false;
      currentTarget = null;
      liveEl.textContent = '';
      if (nudged) statusEl.textContent = '';
      if (!judged) {
        const live = seg.liveStats(target);
        seg.end(); // ปิด segment ค้าง (ถ้ามี จะเข้า lastSeg ผ่าน onSegment)
        const minMs = cfg.staccato ? 140 : 250; // เสียงตัดสั้นต้องยังนับเป็นคำตอบได้
        judged = live && live.durMs >= minMs ? live : (lastSeg ? lastSeg.stats(target) : null);
      }

      let noteScore = 0;
      let feedback;
      if (!judged) {
        feedback = '<span class="fb-bad">✗ ไม่ได้ยินเสียง</span>';
      } else {
        const cents = judged.centsOff;
        if (Math.abs(cents) <= 50) {
          noteScore = 100 - Math.min(50, Math.max(0, Math.abs(cents) - 20));
          feedback = noteScore >= 85
            ? `<span class="fb-good">✓ ${midiToNoteName(target)} เป๊ะ!</span>`
            : `<span class="fb-mid">△ ใช่ ${midiToNoteName(target)} แต่${cents > 0 ? 'สูง' : 'ต่ำ'}ไปนิด</span>`;
        } else {
          const sungName = midiToNoteName(Math.round(judged.medianMidi));
          feedback = `<span class="fb-bad">✗ ร้องเป็น ${sungName} (เป้า ${midiToNoteName(target)})</span>`;
        }
      }

      results.push({
        target_midi: target,
        sung_midi: judged ? Math.round(judged.medianMidi * 100) / 100 : null,
        cents: judged ? Math.round(judged.centsOff) : null,
        score: Math.round(noteScore),
      });

      dots[n].classList.remove('active');
      dots[n].classList.add(noteScore >= 70 ? 'good' : noteScore > 0 ? 'mid' : 'bad');
      statusEl.innerHTML = feedback;
      roll.setTarget(null, 0);
      await wait(1000);
      statusEl.textContent = '';
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  const rawScore = results.reduce((a, r) => a + r.score, 0) / results.length;
  const score = Math.max(0, rawScore - replays * 5);
  const sung = results.filter(r => r.cents !== null && Math.abs(r.cents) <= 50);
  return {
    score,
    accuracy_pct: (results.filter(r => r.score > 0).length / results.length) * 100,
    avg_cents_off: sung.length ? sung.reduce((a, r) => a + Math.abs(r.cents), 0) / sung.length : null,
    details: {
      melody, sung: results.map(r => ({ midi: r.sung_midi, cents: r.cents })), replays,
      ...(exercise ? { exercise: exercise.id } : {}),
    },
  };
}
