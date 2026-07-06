// เสียงนำแบบ "เสียงคน" — formant synthesis (source-filter model) ฟรี 100% ไม่มี asset
// เสียงเหมือนคนฮัมสระ "อา/อู" ที่ pitch เป๊ะทุกโน้ต (ตัวกำเนิดคือ oscillator — ความถี่ตรงตามสั่ง)
//
// ═══ เส้นทางอัปเกรดเป็นเสียงจริง (ElevenLabs / อัดครูของโรงเรียน) ═══
// ทำเป็น sample bank: /assets/voice/{vowel}_{midi}.mp3 อัดทุก 3-4 semitones
// แล้วเขียน playVoiceNote เวอร์ชันใหม่ลายเซ็นเดิม: เลือกไฟล์ midi ใกล้สุด →
// decodeAudioData (cache) → AudioBufferSourceNode.playbackRate = 2^(Δsemitones/12)
// (shift ≤ ±2 semitones เสียงไม่เพี้ยนธรรมชาติ) — เกมทุกเกมเรียกผ่าน tone.js อยู่แล้ว ไม่ต้องแก้
//
// หมายเหตุ: ElevenLabs TTS แบบพูดให้ pitch ดนตรีเป๊ะไม่ได้ — ต้อง generate เสียงร้องสระค้าง
// เป็นไฟล์ต่อโน้ตแล้วใช้แบบ sample bank ข้างบน

// ตาราง formant (F1/F2/F3) ต่อสระ — ค่ากลางเสียงผู้ใหญ่
const VOWELS = {
  ah: [ // "อา" — เปิด อบอุ่น
    { f: 700,  q: 9,  g: 1.0 },
    { f: 1220, q: 10, g: 0.45 },
    { f: 2600, q: 12, g: 0.22 },
  ],
  oo: [ // "อู" — กลม นุ่ม
    { f: 330,  q: 9,  g: 1.0 },
    { f: 870,  q: 10, g: 0.3 },
    { f: 2240, q: 12, g: 0.12 },
  ],
};

// เล่นหนึ่งโน้ตเสียงคน — คืน Promise ที่ resolve เมื่อเสียงจบ
// ใช้ได้ทั้ง AudioContext ปกติและ OfflineAudioContext (สำหรับ test ความแม่น)
export function playVoiceNote(ctx, {
  freq, durSec = 1.0, vowel = 'ah', gain = 1.0,
  vibratoCents = 12, destination = null,
} = {}) {
  const dest = destination || ctx.destination;
  const t = ctx.currentTime;
  const midi = 69 + 12 * Math.log2(freq / 440);
  // โน้ตสูง formant ขยับขึ้นเล็กน้อยตามธรรมชาติของเสียงคน
  const formantScale = 1 + Math.max(0, midi - 60) * 0.006;
  const bands = VOWELS[vowel] || VOWELS.ah;

  // ── source: saw คู่ detune เล็กน้อย (อุ่นแบบ chorus) ──
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = osc2.type = 'sawtooth';
  osc1.frequency.value = freq;
  osc2.frequency.value = freq;
  osc1.detune.value = -5;
  osc2.detune.value = +5;

  const source = ctx.createGain();
  source.gain.value = 0.5;
  osc1.connect(source);
  osc2.connect(source);

  // ── vibrato: เริ่มหลังตั้งเสียง 150ms ค่อย ๆ ลึกขึ้น ──
  let lfo = null;
  if (vibratoCents > 0) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    const depth = ctx.createGain();
    const depthHz = freq * (Math.pow(2, vibratoCents / 1200) - 1);
    depth.gain.setValueAtTime(0, t);
    depth.gain.setValueAtTime(0, t + 0.15);
    depth.gain.linearRampToValueAtTime(depthHz, t + 0.45);
    lfo.connect(depth);
    depth.connect(osc1.frequency);
    depth.connect(osc2.frequency);
    lfo.start(t);
    lfo.stop(t + durSec + 0.05);
  }

  // ── ตัวกรอง formant ขนาน + เส้นเนื้อเสียง (เสริม fundamental โน้ตต่ำ) ──
  const mix = ctx.createGain();
  for (const b of bands) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = b.f * formantScale;
    bp.Q.value = b.q;
    const g = ctx.createGain();
    g.gain.value = b.g;
    source.connect(bp);
    bp.connect(g);
    g.connect(mix);
  }
  const body = ctx.createBiquadFilter(); // ให้ f0 มีตัวตนแม้ formant อยู่สูง
  body.type = 'lowpass';
  body.frequency.value = 800;
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.25;
  source.connect(body);
  body.connect(bodyGain);
  bodyGain.connect(mix);

  // ── ขัดเงา + envelope ──
  const polish = ctx.createBiquadFilter();
  polish.type = 'lowpass';
  polish.frequency.value = 4200;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.06);
  env.gain.setValueAtTime(gain, t + Math.max(0.07, durSec - 0.12));
  env.gain.linearRampToValueAtTime(0, t + durSec);

  mix.connect(polish);
  polish.connect(env);
  env.connect(dest);

  osc1.start(t);
  osc2.start(t);
  osc1.stop(t + durSec + 0.05);
  osc2.stop(t + durSec + 0.05);

  return new Promise(res => { osc1.onended = res; });
}
