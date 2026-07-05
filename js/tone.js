// เล่นโน้ต/ทำนองอ้างอิง — call-and-response: เล่นก่อน แล้วค่อยเปิดวิเคราะห์ไมค์
import { midiToFreq } from './pitch-engine.js';

let ac = null;
function ensureCtx() {
  if (!ac || ac.state === 'closed') ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

// เล่นหนึ่งโน้ต (รับความถี่ Hz) คืน Promise ที่ resolve เมื่อเสียงจบ
export function playNote(freq, durSec = 1.0, { type = 'sine', gain = 0.4 } = {}) {
  const ctx = ensureCtx();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g);
  g.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.05);
  g.gain.setValueAtTime(gain, t + durSec - 0.1);
  g.gain.linearRampToValueAtTime(0, t + durSec);
  osc.start(t);
  osc.stop(t + durSec + 0.05);
  return new Promise(res => { osc.onended = res; });
}

// เล่นทำนอง (MIDI array) ตามลำดับ
export async function playMelody(midis, { noteDur = 0.6, gap = 0.12 } = {}) {
  for (const m of midis) {
    await playNote(midiToFreq(m), noteDur);
    if (gap > 0) await new Promise(r => setTimeout(r, gap * 1000));
  }
}
