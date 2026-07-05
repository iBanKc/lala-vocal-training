// เกมร้องตามทำนอง — ฟังทำนองสั้น ๆ แล้วร้องตามทีละโน้ต (ฝึกหูดนตรี / interval)
// ต่อโน้ต: ถูก semitone (±50¢) = 100 − clamp(|cents|−20, 0, 50), ผิดโน้ต = 0
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

export async function run({ level, stage, signal, voiceLow, voiceHigh }) {
  const cfg = config(level);
  const melody = makeMelody(cfg, voiceLow, voiceHigh);

  stage.innerHTML = `
    <div class="nm-top">
      <div class="me-dots" id="meDots">
        ${melody.map(() => '<span class="me-dot"></span>').join('')}
      </div>
      <div class="nm-note" id="meNote">🦜</div>
      <div class="nm-instruction" id="meInstruction">เตรียมตัว...</div>
    </div>
    <div class="nm-roll-wrap"><canvas id="meRoll" class="nm-roll"></canvas></div>
    <div class="me-actions">
      <button class="btn-secondary" id="meReplay">🔁 ฟังซ้ำ (−5 คะแนน)</button>
    </div>
    <div class="nm-status" id="meStatus"></div>`;

  const dots = [...stage.querySelectorAll('.me-dot')];
  const noteEl = stage.querySelector('#meNote');
  const instrEl = stage.querySelector('#meInstruction');
  const statusEl = stage.querySelector('#meStatus');
  const replayBtn = stage.querySelector('#meReplay');
  const roll = new PianoRoll(stage.querySelector('#meRoll'), { lowMidi: voiceLow, highMidi: voiceHigh });

  let listening = false;
  let seg = null;
  let replays = 0;

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
    },
    onFrame: frame => {
      roll.pushPitch(frame.voiced ? frame.midi : null);
      roll.draw();
      if (listening && seg) seg.push(frame);
    },
  });

  if (signal.aborted) return null;
  await mic.start();
  const onAbort = () => mic.stop();
  signal.addEventListener('abort', onAbort);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function playAll() {
    listening = false;
    instrEl.textContent = '👂 ฟังทำนองให้ดี...';
    for (let i = 0; i < melody.length; i++) {
      dots[i].classList.add('playing');
      await playMelody([melody[i]], { noteDur: 0.55, gap: 0.1 });
      dots[i].classList.remove('playing');
    }
    await wait(250);
  }

  let replayRequested = false;
  replayBtn.addEventListener('click', () => { replayRequested = true; });

  const results = [];
  try {
    while (mic.running && !mic.calibrated) {
      if (signal.aborted) return null;
      await wait(100);
    }

    await playAll();

    for (let n = 0; n < melody.length; n++) {
      if (signal.aborted) return null;
      const target = melody[n];

      if (replayRequested) {
        replayRequested = false;
        replays++;
        await playAll();
      }

      dots.forEach((d, i) => d.classList.toggle('active', i === n));
      instrEl.textContent = `🎤 ร้องโน้ตที่ ${n + 1}/${melody.length}`;
      noteEl.textContent = '♪';
      roll.setTarget(target, 50);

      seg = new SegmentTracker({ minDurMs: 300 });
      listening = true;

      // ตัดสินเมื่อได้ segment นิ่ง ≥400ms (stddev < 60¢) หรือหมดเวลา
      const t0 = performance.now();
      let judged = null;
      while (performance.now() - t0 < cfg.windowMs) {
        if (signal.aborted) return null;
        await wait(60);
        const live = seg.liveStats(target);
        if (live && live.durMs >= 400 && live.stddevCents < 60) { judged = live; break; }
      }
      listening = false;
      if (!judged) {
        const live = seg.liveStats(target);
        const ended = seg.end();
        judged = live && live.durMs >= 250 ? live : (ended ? ended.stats(target) : null);
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
    details: { melody, sung: results.map(r => ({ midi: r.sung_midi, cents: r.cents })), replays },
  };
}
