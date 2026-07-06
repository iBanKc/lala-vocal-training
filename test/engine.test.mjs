// ทดสอบความแม่นยำ Pitch Engine v2 (ส่วนที่รันใน Node ได้ — ไม่ใช้ Web Audio)
// รัน: node test/engine.test.mjs
// เกณฑ์: ตัววัดต้องรายงานภายใน ±3 cents ของค่าจริง รวมเคสจงใจเพี้ยน

import {
  detectFreq, PitchTracker, SegmentTracker, segmentStats, computeRmsThreshold,
  freqToMidi, midiToFreq, noteToFreq, freqToNoteInfo, foldCents, scoreFromCents,
} from '../js/pitch-engine.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

const SR = 48000;
const N = 4096;

// สร้างสัญญาณทดสอบ: sine, harmonic-rich (คล้าย sawtooth), เสียงสระสังเคราะห์
function synth(freq, kind, n = N, sr = SR) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = 2 * Math.PI * freq * i / sr;
    if (kind === 'sine') buf[i] = Math.sin(ph);
    else if (kind === 'harmonics') buf[i] = Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.33 * Math.sin(3 * ph) + 0.25 * Math.sin(4 * ph);
    else if (kind === 'vowel') // สระ "อา" หยาบ ๆ: H1 อ่อนกว่า H2/H3 (formant ~700-1200Hz)
      buf[i] = 0.4 * Math.sin(ph) + 1.0 * Math.sin(2 * ph) + 0.9 * Math.sin(3 * ph) + 0.3 * Math.sin(4 * ph) + 0.15 * Math.sin(5 * ph);
  }
  return buf;
}

console.log('\n── 1. ความแม่นยำตัวตรวจจับ (เกณฑ์ ±3¢) ──');
const baseFreqs = [110, 220, 440]; // A2, A3, A4
const detunes = [0, 15, -30, 70];  // cents จงใจเพี้ยน
for (const base of baseFreqs) {
  for (const det of detunes) {
    for (const kind of ['sine', 'harmonics', 'vowel']) {
      const f = base * Math.pow(2, det / 1200);
      const { freq, clarity } = detectFreq(synth(f, kind), SR);
      const errCents = 1200 * Math.log2(freq / f);
      check(`${kind} ${base}Hz ${det >= 0 ? '+' : ''}${det}¢ → err ${errCents.toFixed(2)}¢ (clarity ${clarity.toFixed(2)})`,
        Math.abs(errCents) <= 3 && clarity >= 0.85);
    }
  }
}

console.log('\n── 2. เสียงต่ำผู้ชาย (E2-G2) ต้องไม่ octave error ──');
for (const f of [82.41, 87.31, 98.0]) { // E2, F2, G2
  const { freq, clarity } = detectFreq(synth(f, 'vowel'), SR);
  const errCents = Math.abs(1200 * Math.log2(freq / f));
  check(`${f}Hz → detect ${freq.toFixed(2)}Hz err ${errCents.toFixed(1)}¢`, errCents <= 5 && clarity >= 0.85);
}

console.log('\n── 3. PitchTracker: gate + octave-jump correction ──');
{
  const tr = new PitchTracker();
  // clarity ต่ำต้องถูกทิ้ง
  check('clarity 0.5 ถูก gate ทิ้ง', tr.push(440, 0.5, 0) === null);
  check('นอกช่วงความถี่ถูกทิ้ง', tr.push(30, 0.99, 10) === null && tr.push(3000, 0.99, 20) === null);
  // ป้อน A4 ต่อเนื่อง แล้วแทรก octave error หนึ่งเฟรม (880Hz)
  const t2 = new PitchTracker();
  for (let i = 0; i < 8; i++) t2.push(440, 0.99, i * 20);
  const corrected = t2.push(880, 0.99, 160); // octave jump ขึ้น
  check(`octave jump 880→fold กลับ ~A4 (ได้ ${corrected.midi.toFixed(2)})`, Math.abs(corrected.midi - 69) < 0.5);
  // median filter กันค่ากระโดดเฟรมเดียว
  const t3 = new PitchTracker();
  for (let i = 0; i < 5; i++) t3.push(440, 0.99, i * 20);
  const spiked = t3.push(466.16, 0.99, 100); // spike +100¢ หนึ่งเฟรม
  check(`spike เฟรมเดียวถูก median กลบ (ได้ ${spiked.midi.toFixed(2)})`, Math.abs(spiked.midi - 69) < 0.3);
}

console.log('\n── 4. Segment scoring: ตัด onset + median ทน vibrato ──');
{
  // จำลองการร้อง A4: onset ไถลจากต่ำ 100ms แรก + vibrato ±30¢ — ต้องได้คะแนนสูง
  const frames = [];
  for (let t = 0; t <= 1000; t += 20) {
    let midi;
    if (t < 100) midi = 68 + t / 100;                      // ไถลเข้าโน้ต (onset)
    else midi = 69 + 0.3 * Math.sin(2 * Math.PI * 5.5 * t / 1000); // vibrato ±30¢ @5.5Hz
    frames.push({ time: t, midi });
  }
  const st = segmentStats(frames, 69);
  check(`ร้องตรง+vibrato: centsOff ${st.centsOff.toFixed(1)}¢ score ${st.score.toFixed(0)}`,
    Math.abs(st.centsOff) <= 5 && st.score >= 95);

  // ร้องเพี้ยน +70¢ ค้าง — ต้องได้ 0
  const off = [];
  for (let t = 0; t <= 1000; t += 20) off.push({ time: t, midi: 69.7 });
  const stOff = segmentStats(off, 69);
  check(`ร้องเพี้ยน +70¢: score ${stOff.score.toFixed(0)}`, stOff.score === 0);

  // ร้องเพี้ยน +30¢ — ต้องได้คะแนนกลาง ๆ (curve ไม่ใช่ binary)
  const mid = [];
  for (let t = 0; t <= 1000; t += 20) mid.push({ time: t, midi: 69.3 });
  const stMid = segmentStats(mid, 69);
  check(`ร้องเพี้ยน +30¢: score ${stMid.score.toFixed(0)} (คาด 60)`, Math.abs(stMid.score - 60) <= 2);
}

console.log('\n── 5. SegmentTracker: จับ segment จากสตรีมเฟรม ──');
{
  const segs = [];
  const st = new SegmentTracker({ onSegment: s => segs.push(s) });
  // เงียบ 200ms → ร้อง 600ms → เงียบ 300ms → ร้องสั้น 100ms (ต้องถูกทิ้ง เพราะ < 300ms)
  for (let t = 0; t < 200; t += 20) st.push({ time: t, voiced: false });
  for (let t = 200; t < 800; t += 20) st.push({ time: t, voiced: true, midi: 69 });
  for (let t = 800; t < 1100; t += 20) st.push({ time: t, voiced: false });
  for (let t = 1100; t < 1200; t += 20) st.push({ time: t, voiced: true, midi: 71 });
  for (let t = 1200; t < 1500; t += 20) st.push({ time: t, voiced: false });
  st.end();
  check(`ได้ 1 segment (segment สั้น 100ms ถูกทิ้ง) — ได้ ${segs.length}`, segs.length === 1);
  if (segs.length) {
    const s = segs[0].stats(69);
    check(`segment แรก median A4 score 100 (ได้ ${s.score.toFixed(0)})`, s.score === 100);
  }
}

console.log('\n── 6. TrailingCapture: วัดช่วงเสียง (เคสไล่เสียงขึ้นก่อนค้าง) ──');
{
  const { TrailingCapture } = await import('../js/calibrate.js');

  // เคสที่พังบนมือถือ: ไล่เสียงขึ้น 2 วิ (C4→C5) แล้วค้าง C5 — ระบบเก่าคิด stddev รวม glide → ไม่มีวันจับ
  const cap = new TrailingCapture();
  let captured = null;
  for (let t = 0; t <= 2000; t += 20) cap.push(t, 60 + (t / 2000) * 12);          // glide ขึ้น
  for (let t = 2020; t <= 3600 && !captured; t += 20) {
    const st = cap.push(t, 72 + 0.15 * Math.sin(t / 60));                          // ค้าง C5 + สั่นเล็กน้อย
    if (st.captured !== null) captured = st.captured;
  }
  check(`glide-แล้วค้าง: จับได้ C5 (ได้ ${captured})`, captured === 72);

  // หายใจสะดุดสั้น (<400ms) ต้องไม่รีเซ็ต
  const cap2 = new TrailingCapture();
  let captured2 = null;
  for (let t = 0; t <= 700; t += 20) cap2.push(t, 65);
  for (let t = 720; t <= 1000; t += 20) cap2.push(t, null);                        // เงียบ 280ms
  for (let t = 1020; t <= 2400 && !captured2; t += 20) {
    const st = cap2.push(t, 65);
    if (st.captured !== null) captured2 = st.captured;
  }
  check(`สะดุด 280ms ไม่รีเซ็ต: จับ F4 ได้ (ได้ ${captured2})`, captured2 === 65);

  // เสียงแกว่งแรง (ยังไล่อยู่) ต้องยังไม่จับ
  const cap3 = new TrailingCapture();
  let wrongCapture = false;
  for (let t = 0; t <= 3000; t += 20) {
    const st = cap3.push(t, 60 + (t / 3000) * 14);                                 // glide ช้าตลอด ไม่ค้างเลย
    if (st.captured !== null) wrongCapture = true;
  }
  check('glide ตลอดไม่ค้าง: ไม่จับมั่ว', !wrongCapture);

  // ปุ่ม manual: ใช้ median 600ms ล่าสุด
  const cap4 = new TrailingCapture();
  for (let t = 0; t <= 800; t += 20) cap4.push(t, 67);
  check(`manualCapture คืน G4 (ได้ ${cap4.manualCapture(800)})`, cap4.manualCapture(800) === 67);
}

console.log('\n── 7. computeRmsThreshold: noise floor บนมือถือจริง ──');
{
  const mk = pairs => pairs.flatMap(([t0, t1, rms]) => {
    const out = [];
    for (let t = t0; t < t1; t += 16) out.push({ t, rms });
    return out;
  });

  // iOS pop ช่วง 200ms แรก (ดัง 0.05) แล้วห้องเงียบจริง 0.001 → pop ต้องไม่ทำให้ threshold เฟ้อ
  const pop = computeRmsThreshold(mk([[0, 200, 0.05], [200, 700, 0.001]]));
  check(`pop ตอนเปิดไมค์ไม่เฟ้อ: threshold ${pop.threshold} (คาด 0.004 floor)`, pop.threshold === 0.004);

  // ห้องเงียบสนิท → floor 0.004 (ต่ำพอให้ head voice เบา ๆ ผ่าน)
  const quiet = computeRmsThreshold(mk([[0, 700, 0.0005]]));
  check(`ห้องเงียบ → floor 0.004 (ได้ ${quiet.threshold})`, quiet.threshold === 0.004);

  // ห้องดังมาก (0.03) → cap ที่ 0.03 ไม่ใช่ 0.075 (cap ยกขึ้นเพราะเปิด AGC แล้ว noise floor สูงขึ้น)
  const noisy = computeRmsThreshold(mk([[0, 700, 0.03]]));
  check(`ห้องดัง → cap 0.03 (ได้ ${noisy.threshold})`, noisy.threshold === 0.03);

  // ห้องปกติ (0.003) → 0.003×2.5 = 0.0075
  const normal = computeRmsThreshold(mk([[0, 700, 0.003]]));
  check(`ห้องปกติ 0.003 → ${normal.threshold} (คาด 0.0075)`, Math.abs(normal.threshold - 0.0075) < 1e-9);
}

console.log('\n── 8. stepFreqBounds: ขอบเขตความถี่ต่อขั้นวัด (กัน hum 100Hz หลงเข้าขั้นเสียงสูง) ──');
{
  const { stepFreqBounds } = await import('../js/calibrate.js');
  const low = stepFreqBounds('low');
  check(`ขั้น low: 55-500Hz (ได้ ${low.fmin}-${low.fmax})`, low.fmin === 55 && low.fmax === 500);

  const highUnknown = stepFreqBounds('high', null);
  check(`ขั้น high ไม่รู้ low: floor 130Hz (ได้ ${highUnknown.fmin})`, highUnknown.fmin === 130 && highUnknown.fmax === 1400);

  // low = G2 (midi 43) → floor = max(130, freq(47)≈123.5) = 130 — hum 100Hz ถูกกันแน่นอน
  const highG2 = stepFreqBounds('high', 43);
  check(`ขั้น high (low=G2): floor 130 (ได้ ${highG2.fmin.toFixed(1)})`, highG2.fmin === 130);

  // low = G3 (midi 55) → floor = freq(59) ≈ 246.9 — เสียงต่ำของตัวเองก็หลงเข้าไม่ได้
  const highG3 = stepFreqBounds('high', 55);
  check(`ขั้น high (low=G3): floor ≈246.9 (ได้ ${highG3.fmin.toFixed(1)})`, Math.abs(highG3.fmin - 246.94) < 0.1);
}

console.log('\n── 9. เกมเสียงนิ่ง: ความยาก = สูง×ยาว, cap 12 วิ, สเกลจากหนังสือ ──');
{
  const { config, pickHoldNote, scaleNotes } = await import('../js/games/note-hold.js');
  const LOW = 48, HIGH = 72; // C3–C5

  // cap 12 วิ ทุก level
  let maxTotal = 0;
  for (let lv = 1; lv <= 8; lv++) {
    const c = config(lv);
    const total = c.scale ? c.holdPerNote * 5 : c.targetSec;
    maxTotal = Math.max(maxTotal, total);
  }
  check(`เวลาร้องรวมทุก level ≤ 12 วิ (สูงสุด ${maxTotal})`, maxTotal <= 12);

  // โน้ตเดียว: อยู่ในช่วงเสียงเสมอ + level สูง = โน้ตสูงขึ้น (เทียบค่าเฉลี่ยจากการสุ่มคุมได้)
  const avgFor = lv => {
    const c = config(lv);
    let sum = 0;
    for (let i = 0; i <= 20; i++) sum += pickHoldNote(c, LOW, HIGH, () => i / 20);
    return sum / 21;
  };
  let inRange = true;
  for (let lv = 1; lv <= 5; lv++) {
    const c = config(lv);
    for (let i = 0; i <= 10; i++) {
      const m = pickHoldNote(c, LOW, HIGH, () => i / 10);
      if (m < LOW + 1 || m > HIGH - 1) inRange = false;
    }
  }
  check('pickHoldNote อยู่ใน [low+1, high-1] ทุก level', inRange);
  const a1 = avgFor(1), a3 = avgFor(3), a5 = avgFor(5);
  check(`level สูง = โน้ตสูงขึ้น (avg L1 ${a1.toFixed(1)} < L3 ${a3.toFixed(1)} < L5 ${a5.toFixed(1)})`, a1 < a3 && a3 < a5);

  // สเกล 5 โน้ต: อยู่ในช่วง, L6/L8 ขึ้น, L7 ลง, ช่วงกว้าง 7 semitones (1→5 major)
  for (const lv of [6, 7, 8]) {
    const notes = scaleNotes(config(lv), LOW, HIGH);
    const dir = notes[4] > notes[0] ? 'ขึ้น' : 'ลง';
    const ok = notes.length === 5 &&
      notes.every(m => m >= LOW + 1 && m <= HIGH - 1) &&
      Math.abs(notes[4] - notes[0]) === 7 &&
      (lv === 7 ? notes[4] < notes[0] : notes[4] > notes[0]);
    check(`L${lv} สเกล ${notes.join('-')} (${dir})`, ok);
  }
  // tonic L8 สูงกว่า L6
  check('tonic L8 สูงกว่า L6', scaleNotes(config(8), LOW, HIGH)[0] > scaleNotes(config(6), LOW, HIGH)[0]);
}

console.log('\n── 10. utilities ──');
check('noteToFreq A4 = 440', Math.abs(noteToFreq('A', 4) - 440) < 0.01);
check('freqToNoteInfo 452Hz = A4 +46.6¢', (() => { const i = freqToNoteInfo(452); return i.note === 'A' && i.octave === 4 && Math.abs(i.cents - 46.6) < 1; })());
check('foldCents: ร้องต่ำ 1 อ็อกเทฟ = 0¢', foldCents(-1200) === 0);
check('foldCents: -1230¢ → -30¢', Math.abs(foldCents(-1230) - (-30)) < 0.01);
check('scoreFromCents ขอบเขต', scoreFromCents(0) === 100 && scoreFromCents(10) === 100 && scoreFromCents(60) === 0 && Math.abs(scoreFromCents(35) - 50) < 0.01);

console.log(`\n═══ ผล: ${pass} ผ่าน, ${fail} ไม่ผ่าน ═══`);
process.exit(fail ? 1 : 0);
