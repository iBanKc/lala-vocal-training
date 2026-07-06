// เสียงนำของทุกเกม — default เป็น "เสียงคน" (voice-synth) แทนบี๊บ
//
// บทเรียน iOS: ห้ามสร้าง/resume AudioContext นอก user gesture
// → ใช้ context ร่วมกับ MicSession ก่อนเสมอ (มันเกิดจาก gesture และกำลังวิ่งอยู่)
//   สร้างเองเฉพาะกรณีไม่มีไมค์เปิด (เช่น หน้า audition) พร้อม pointerdown recovery
import { midiToFreq } from './pitch-engine.js';
import { getSharedContext } from './audio-ctx.js';
import { playVoiceNote } from './voice-synth.js';

let ownCtx = null;
let masterGainValue = 1.0;
const chains = new WeakMap(); // ctx → { comp, master }

function ensureCtx() {
  const shared = getSharedContext();
  if (shared) {
    if (shared.state === 'suspended') shared.resume().catch(() => {});
    return shared;
  }
  if (!ownCtx || ownCtx.state === 'closed') {
    ownCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (ownCtx.state === 'suspended') {
    ownCtx.resume().catch(() => {});
    document.addEventListener('pointerdown', () => {
      if (ownCtx && ownCtx.state === 'suspended') ownCtx.resume().catch(() => {});
    }, { once: true });
  }
  return ownCtx;
}

// compressor + master gain ต่อ context — ยกความดังโดยไม่แตก (Android duck เสียงตอนอัด)
function outputNode(ctx) {
  let c = chains.get(ctx);
  if (!c) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    const master = ctx.createGain();
    master.gain.value = masterGainValue;
    comp.connect(master);
    master.connect(ctx.destination);
    c = { comp, master };
    chains.set(ctx, c);
  }
  return c.comp;
}

// สำหรับหน้า audition จูนความดัง
export function setMasterGain(v) {
  masterGainValue = v;
  const shared = getSharedContext();
  for (const ctx of [shared, ownCtx]) {
    if (!ctx) continue;
    const c = chains.get(ctx);
    if (c) c.master.gain.value = v;
  }
}

// iOS Safari: Web Audio เงียบทั้งหมดถ้าเปิดสวิตช์โหมดเงียบ — โค้ดแก้ไม่ได้ ต้องบอกผู้ใช้
function maybeShowIosSilentHint() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos || localStorage.getItem('ls_ios_snd_hint')) return;
  localStorage.setItem('ls_ios_snd_hint', '1');
  const toast = document.createElement('div');
  toast.className = 'snd-toast';
  toast.textContent = '🔔 ถ้าไม่ได้ยินเสียง: ปิดโหมดเงียบ (สวิตช์ข้างเครื่อง) และเพิ่มระดับเสียง';
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 50);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 6000);
}

// เล่นหนึ่งโน้ต (รับความถี่ Hz) คืน Promise ที่ resolve เมื่อเสียงจบ
export function playNote(freq, durSec = 1.0, { instrument = 'voice', vowel = 'ah', gain = 0.9 } = {}) {
  const ctx = ensureCtx();
  maybeShowIosSilentHint();
  const dest = outputNode(ctx);

  if (instrument === 'voice') {
    return playVoiceNote(ctx, { freq, durSec, vowel, gain, destination: dest });
  }

  // เสียง sine เดิม (เผื่อเทียบ/สำรอง)
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.connect(g);
  g.connect(dest);
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * 0.55, t + 0.05);
  g.gain.setValueAtTime(gain * 0.55, t + durSec - 0.1);
  g.gain.linearRampToValueAtTime(0, t + durSec);
  osc.start(t);
  osc.stop(t + durSec + 0.05);
  return new Promise(res => { osc.onended = res; });
}

// เล่นทำนอง (MIDI array) ตามลำดับ
export async function playMelody(midis, { noteDur = 0.6, gap = 0.12, instrument = 'voice', vowel = 'ah' } = {}) {
  for (const m of midis) {
    await playNote(midiToFreq(m), noteDur, { instrument, vowel });
    if (gap > 0) await new Promise(r => setTimeout(r, gap * 1000));
  }
}
