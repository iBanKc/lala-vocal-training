// เกมเสียงพาบิน — ลูกโป่งลอยตามระดับเสียง บินลอดห่วงที่วางตาม pattern วอร์มเสียงจริง
// (hold / step / arpeggio / siren) — ฝึก pitch control และการ glide ระหว่างโน้ต
// คะแนน = 80×(ห่วงที่ลอดได้/ทั้งหมด) + 20×ความลื่นไหลช่วง glide
import { MicSession, midiToFreq, midiToNoteName, NOTE_NAMES } from '../pitch-engine.js';
import { playGlide, playNote } from '../tone.js';

function tolerance(level) {
  return [100, 90, 80, 70, 60, 55, 50, 45, 40, 35][level - 1];
}

// สร้างเส้นทางบิน: ลำดับ segment { t0, t1, fn(u)→midi, glide }
function buildCourse(level, voiceLow, voiceHigh) {
  const lo = voiceLow + 1, hi = voiceHigh - 1;
  const center = (lo + hi) / 2;
  const span = hi - lo;
  const segs = [];
  let t = 0;
  const add = (dur, fn, glide = false) => { segs.push({ t0: t, t1: t + dur, fn, glide }); t += dur; };
  const hold = (midi, dur = 2.4) => add(dur, () => midi);
  const glideTo = (m0, m1, dur = 2.2) => add(dur, u => m0 + (m1 - m0) * u, true);
  const siren = (m0, m1, dur = 4.5) => add(dur, u => m0 + (m1 - m0) * Math.sin(Math.PI * u), true);
  const clamp = m => Math.max(lo, Math.min(hi, m));

  const c = Math.round(center);
  if (level <= 2) {
    // โน้ตค้าง + ก้าวขึ้นลงทีละ step
    hold(c); hold(clamp(c + 2)); hold(c); hold(clamp(c - 2)); hold(c); hold(clamp(c + 4), 2.8);
  } else if (level <= 4) {
    // steps + arpeggio (do-mi-sol-mi-do)
    hold(c, 2); hold(clamp(c + 2), 2); hold(clamp(c + 4), 2);
    hold(c, 2); hold(clamp(c + 4), 1.8); hold(clamp(c + 7), 1.8); hold(clamp(c + 4), 1.8); hold(c, 2);
  } else if (level <= 6) {
    // arpeggio + siren ขึ้นคู่ 5 แล้วลง
    hold(c, 1.8); hold(clamp(c + 4), 1.6); hold(clamp(c + 7), 1.6); hold(c, 1.8);
    siren(clamp(c - 2), clamp(c + 5), 4);
    hold(clamp(c + 2), 2); siren(c, clamp(c + 7), 4.5);
  } else if (level <= 8) {
    // siren ออกเทฟ + steps เร็วขึ้น
    siren(clamp(center - span / 3), clamp(center + span / 3), 5);
    hold(c, 1.5); hold(clamp(c + 3), 1.5); hold(clamp(c - 3), 1.5);
    siren(clamp(c - 5), clamp(c + 7), 5);
    hold(clamp(c + 5), 1.8); glideTo(clamp(c + 5), clamp(c - 4), 2.5); hold(clamp(c - 4), 1.5);
  } else {
    // full siren เกือบทั้งช่วงเสียง + arpeggio run
    siren(lo, hi, 5.5);
    hold(c, 1.4); hold(clamp(c + 4), 1.3); hold(clamp(c + 7), 1.3); hold(clamp(c + 11), 1.5);
    siren(clamp(c + 9), clamp(c - 5), 5);
    glideTo(c, hi, 2.2); glideTo(hi, lo, 3); hold(c, 1.6);
  }
  return segs;
}

// เส้นทางบินจากคลังแบบฝึก (Ng / Ning): สเกลไล่ลง 5-4-3-2-1 legato
// ขยับขึ้นครึ่งเสียงต่อ key; Ng ต่อท้ายด้วยไล่ลงหนึ่งอ็อกเทฟ
function buildExerciseCourse(exercise, voiceLow, voiceHigh) {
  const beat = 60 / (exercise.tempo || 60);
  const center = Math.round((voiceLow + voiceHigh) / 2);
  const desc = [7, 5, 4, 2, 0];
  const segs = [];
  let t = 0;
  const add = (dur, fn, glide = false) => { segs.push({ t0: t, t1: t + dur, fn, glide }); t += dur; };
  const clamp = m => Math.max(voiceLow + 1, Math.min(voiceHigh - 1, m));

  for (let k = 0; k < exercise.keys; k++) {
    const tonic = clamp(center - 4 + k);
    // สเกลไล่ลง legato: เชื่อมโน้ตด้วย glide สั้น ๆ ให้ลูกโป่งไหลตามธรรมชาติ
    for (let i = 0; i < desc.length; i++) {
      const midi = clamp(tonic + desc[i]);
      add(beat * 0.75, () => midi);
      if (i < desc.length - 1) {
        const next = clamp(tonic + desc[i + 1]);
        add(beat * 0.25, u => midi + (next - midi) * u, true);
      }
    }
    if (exercise.course === 'ng') {
      // ขยายเป็นหนึ่งอ็อกเทฟไล่ลง (glide ยาว)
      add(beat, () => clamp(tonic + 12));
      add(beat * 3, u => clamp(tonic + 12) + (clamp(tonic) - clamp(tonic + 12)) * u, true);
      add(beat, () => clamp(tonic));
    }
    // พักหายใจ + เตรียม key ถัดไป: ไต่ขึ้นหายอดสเกลใหม่
    if (k < exercise.keys - 1) {
      const nextTop = clamp(center - 4 + k + 1 + 7);
      add(1.2, u => clamp(tonic) + (nextTop - clamp(tonic)) * u, true);
    }
  }
  return segs;
}

export async function run({ level, stage, signal, voiceLow, voiceHigh, exercise }) {
  const tol = exercise ? 60 : tolerance(level); // ด่านแบบฝึกใช้ห่วงขนาดกลางคงที่
  const course = exercise
    ? buildExerciseCourse(exercise, voiceLow, voiceHigh)
    : buildCourse(level, voiceLow, voiceHigh);
  const courseDur = course[course.length - 1].t1;

  // ห่วง: สุ่มตัวอย่างตามเส้นทางทุก 0.8 วิ
  const rings = [];
  for (let rt = 0.8; rt < courseDur - 0.2; rt += 0.8) {
    const seg = course.find(s => rt >= s.t0 && rt < s.t1);
    if (seg) rings.push({ time: rt, midi: seg.fn((rt - seg.t0) / (seg.t1 - seg.t0)), glide: seg.glide, state: 'wait' });
  }

  stage.innerHTML = `
    <div class="nm-top">
      <div class="nm-instruction" id="pgInstruction">เตรียมตัว... ใช้เสียง "อู" หรือ "อา" บังคับลูกโป่ง</div>
      <div class="pg-target-note" id="pgNote">—</div>
      <div class="pg-hud"><span id="pgHits">🎯 0/${rings.length}</span><span id="pgTime"></span></div>
    </div>
    <div class="pg-canvas-wrap">
      <canvas id="pgCanvas" class="pg-canvas"></canvas>
      <button class="pg-guide-btn" id="pgGuide">🔊 ไกด์</button>
    </div>`;

  const instrEl = stage.querySelector('#pgInstruction');
  const noteEl = stage.querySelector('#pgNote');
  const hitsEl = stage.querySelector('#pgHits');
  const timeEl = stage.querySelector('#pgTime');
  const canvas = stage.querySelector('#pgCanvas');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = canvas.offsetWidth, H = canvas.offsetHeight;

  const viewLow = voiceLow - 2, viewHigh = voiceHigh + 2;
  const yOf = midi => H - ((midi - viewLow) / (viewHigh - viewLow)) * H;
  const PIANO_W = 46;              // คีย์เปียโนแนวตั้งฝั่งขวา
  const FIELD_W = W - PIANO_W;     // สนามบิน (เส้นทาง/ห่วง) ไม่ทับเปียโน
  const PX_PER_SEC = FIELD_W / 5;
  const BALLOON_X = FIELD_W * 0.25;

  // โน้ตเป้าหมายบนเส้นทาง ณ เวลาใดก็ได้ (ก่อนเริ่ม = โน้ตแรก, จบแล้ว = โน้ตสุดท้าย)
  const courseMidiAt = ts => {
    if (ts <= 0) return course[0].fn(0);
    const seg = course.find(s => ts >= s.t0 && ts < s.t1);
    if (seg) return seg.fn((ts - seg.t0) / (seg.t1 - seg.t0));
    return course[course.length - 1].fn(1);
  };

  let running = false;
  let t0 = 0;                       // performance.now() ตอนเริ่มบิน
  let balloonMidi = (voiceLow + voiceHigh) / 2;
  let lastFrameMs = null;
  let hits = 0;
  const deltas = [];                // |Δcents| ต่อเฟรมช่วง glide (วัดความลื่นไหล)
  let prevMidi = null;
  let guideUsed = 0;

  // ปุ่ม 🔊 ไกด์: ร้องนำเส้นทาง 1.6 วิข้างหน้าให้ฟังระหว่างบิน (กดได้ตลอด ไม่หักคะแนน)
  const guideBtn = stage.querySelector('#pgGuide');
  guideBtn.addEventListener('click', async () => {
    const nowSec = running ? (performance.now() - t0) / 1000 : 0;
    const DUR = 1.6, N = 32;
    const freqs = [];
    for (let i = 0; i < N; i++) {
      const ts = Math.min(courseDur - 0.01, nowSec + (i / (N - 1)) * DUR);
      const seg = course.find(s => ts >= s.t0 && ts < s.t1) || course[course.length - 1];
      const u = Math.min(1, Math.max(0, (ts - seg.t0) / (seg.t1 - seg.t0)));
      freqs.push(midiToFreq(seg.fn(u)));
    }
    guideUsed++;
    guideBtn.disabled = true;
    try { await playGlide(freqs, DUR, { vowel: 'oo' }); } finally { guideBtn.disabled = false; }
  });

  let lastNoteName = '';

  function draw(nowSec) {
    const targetMidi = courseMidiAt(nowSec);
    const targetRound = Math.round(targetMidi);

    // ป้ายชื่อโน้ตเป้าหมาย (อัปเดตเฉพาะตอนเปลี่ยน กัน DOM ทำงานทุกเฟรม)
    const name = midiToNoteName(targetRound);
    if (name !== lastNoteName) { lastNoteName = name; noteEl.textContent = `🎯 ${name}`; }

    ctx.clearRect(0, 0, W, H);
    // ท้องฟ้า
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#dbeeff'); grad.addColorStop(1, '#f0f6ff');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // เส้นเลนโน้ต C แต่ละอ็อกเทฟ
    for (let m = Math.ceil(viewLow); m <= viewHigh; m++) {
      if (m % 12 !== 0) continue;
      const y = yOf(m);
      ctx.strokeStyle = 'rgba(33,150,243,0.15)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(FIELD_W, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(74,101,133,0.5)';
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(NOTE_NAMES[0] + (Math.floor(m / 12) - 1), 4, y - 3);
    }

    // เส้นนำสายตาวิ่งเข้าคีย์คำตอบ: เส้นประเขียวที่ระดับโน้ตเป้าหมายปัจจุบัน
    const ty = yOf(targetMidi);
    ctx.strokeStyle = 'rgba(22,163,74,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.beginPath(); ctx.moveTo(BALLOON_X, ty); ctx.lineTo(FIELD_W, ty); ctx.stroke();
    ctx.setLineDash([]);

    // เส้นทางบิน (เส้นนำสายตา) — หยุดที่ขอบเปียโน
    ctx.strokeStyle = 'rgba(25,118,210,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    for (let ts = nowSec - 1; ts <= nowSec + 5; ts += 0.08) {
      const seg = course.find(s => ts >= s.t0 && ts < s.t1);
      if (!seg) { first = true; continue; }
      const x = BALLOON_X + (ts - nowSec) * PX_PER_SEC;
      if (x > FIELD_W) break;
      const y = yOf(seg.fn((ts - seg.t0) / (seg.t1 - seg.t0)));
      if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ห่วง — โผล่จากหลังเปียโน
    const tolSemi = tol / 100;
    for (const ring of rings) {
      const x = BALLOON_X + (ring.time - nowSec) * PX_PER_SEC;
      if (x < -30 || x > FIELD_W - 12) continue;
      const y = yOf(ring.midi);
      const rh = Math.max(14, (yOf(ring.midi - tolSemi) - yOf(ring.midi + tolSemi)) / 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = ring.state === 'hit' ? '#16a34a' : ring.state === 'miss' ? 'rgba(220,38,38,0.45)' : '#f59e0b';
      ctx.beginPath();
      ctx.ellipse(x, y, 10, rh, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ลูกโป่ง
    const by = yOf(balloonMidi);
    ctx.font = '30px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎈', BALLOON_X, by + 10);
    ctx.textAlign = 'left';

    // ── คีย์เปียโนแนวตั้งฝั่งขวา — คีย์คำตอบไฮไลต์เขียว ──
    const laneH = H / (viewHigh - viewLow);
    const BLACK = new Set([1, 3, 6, 8, 10]);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(FIELD_W, 0, PIANO_W, H);
    const balloonRound = Math.round(balloonMidi);
    for (let m = Math.ceil(viewLow); m <= Math.floor(viewHigh); m++) {
      const pc = ((m % 12) + 12) % 12;
      const yTop = yOf(m + 0.5);
      const isBlack = BLACK.has(pc);
      const isTarget = m === targetRound;
      const keyW = isBlack ? PIANO_W * 0.62 : PIANO_W;
      ctx.fillStyle = isTarget ? '#16a34a' : isBlack ? '#334155' : '#ffffff';
      ctx.fillRect(FIELD_W, yTop, keyW, laneH);
      ctx.strokeStyle = 'rgba(13,27,46,0.18)';
      ctx.strokeRect(FIELD_W + 0.5, yTop + 0.5, keyW - 1, laneH - 1);
      if (isTarget && laneH >= 9) {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.min(12, laneH - 1)}px Inter, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(midiToNoteName(m), W - 4, yTop + laneH / 2 + 4);
        ctx.textAlign = 'left';
      } else if (m === balloonRound && running) {
        // จุดฟ้า = คีย์ที่เสียงผู้เล่นอยู่ตอนนี้
        ctx.fillStyle = '#1976D2';
        ctx.beginPath();
        ctx.arc(FIELD_W + PIANO_W - 8, yTop + laneH / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(13,27,46,0.35)';
    ctx.strokeRect(FIELD_W + 0.5, 0.5, PIANO_W - 1, H - 1);
  }

  const mic = new MicSession({
    onStatus: s => {
      if (s === 'calibrating') instrEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
      if (s === 'suspended') instrEl.textContent = '👆 แตะหน้าจอหนึ่งครั้งเพื่อเปิดไมค์ต่อ';
    },
    onFrame: frame => {
      const dt = lastFrameMs === null ? 16 : frame.time - lastFrameMs;
      lastFrameMs = frame.time;
      if (!running) return;
      const nowSec = (performance.now() - t0) / 1000;

      if (frame.voiced) {
        balloonMidi = frame.midi;
        // ความลื่นไหลช่วง glide
        const seg = course.find(s => nowSec >= s.t0 && nowSec < s.t1);
        if (seg && seg.glide && prevMidi !== null) {
          deltas.push(Math.abs(frame.midi - prevMidi) * 100 / Math.max(1, dt / 16.7));
        }
        prevMidi = frame.midi;
      } else {
        // เงียบ → ลูกโป่งค่อย ๆ ร่วง 2 semitones/วิ
        balloonMidi = Math.max(viewLow, balloonMidi - 2 * (dt / 1000));
        prevMidi = null;
      }

      // ตัดสินห่วงที่มาถึงลูกโป่ง
      for (const ring of rings) {
        if (ring.state === 'wait' && ring.time <= nowSec) {
          if (Math.abs(balloonMidi - ring.midi) * 100 <= tol && frame.voiced) {
            ring.state = 'hit'; hits++;
          } else {
            ring.state = 'miss';
          }
          hitsEl.textContent = `🎯 ${hits}/${rings.length}`;
        }
      }

      timeEl.textContent = `⏱ ${Math.max(0, Math.ceil(courseDur - nowSec))} วิ`;
      draw(nowSec);
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

    // เล่นโน้ตแรกให้ฟังก่อนเริ่ม (call-and-response)
    const firstMidi = courseMidiAt(0);
    instrEl.textContent = `👂 ฟังโน้ตแรก... ${midiToNoteName(Math.round(firstMidi))}`;
    draw(0);
    await playNote(midiToFreq(firstMidi), 1.3, { vowel: 'oo' });
    await wait(250);
    if (signal.aborted) return null;

    // นับถอยหลัง
    for (const c of ['3', '2', '1', '🎈 บิน!']) {
      if (signal.aborted) return null;
      instrEl.textContent = c;
      draw(0);
      await wait(700);
    }
    instrEl.textContent = 'ร้องตามเส้น บินลอดห่วง!';
    t0 = performance.now();
    running = true;

    while ((performance.now() - t0) / 1000 < courseDur + 0.5) {
      if (signal.aborted) return null;
      await wait(100);
    }
    running = false;
  } finally {
    signal.removeEventListener('abort', onAbort);
    mic.stop();
  }

  const meanDelta = deltas.length ? deltas.reduce((a, b) => a + b) / deltas.length : 30;
  const smoothness = Math.max(0, Math.min(1, 1 - meanDelta / 30));
  const score = 80 * (hits / rings.length) + 20 * smoothness;

  return {
    score,
    accuracy_pct: (hits / rings.length) * 100,
    avg_cents_off: null, // เกมนี้วัดการเคลื่อนที่ ไม่ใช่ความตรงโน้ตค้าง
    details: {
      rings_total: rings.length,
      rings_hit: hits,
      smoothness: Math.round(smoothness * 100) / 100,
      tolerance: tol,
      guide_used: guideUsed,
      ...(exercise ? { exercise: exercise.id } : {}),
    },
  };
}
