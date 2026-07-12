// ตัวเล่นเสียงบรรยาย (ไฟล์ ElevenLabs สร้างล่วงหน้า) — ใช้ร่วมกันทั้งวอร์มพื้นฐานและแบบฝึกจากคลัง
// cache ไฟล์+บัฟเฟอร์, AudioContext เดียวทั้งแอป, เสียงพัง degrade เงียบ (ห้ามล้มเกม)
const fileCache = new Map(); // url → Promise<ArrayBuffer|null>
const bufCache = new Map();  // url → AudioBuffer
let ctx = null;
let source = null;

export function prefetchVoice(url) {
  if (!fileCache.has(url)) {
    fileCache.set(url, fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null));
  }
  return fileCache.get(url);
}

export function stopVoice() {
  if (source) { try { source.stop(); } catch (_) { /* จบไปแล้ว */ } source = null; }
}

// สร้าง/resume AudioContext ได้เฉพาะใน user gesture (กฎ iOS) — จึงต้องถูกเรียกครั้งแรก
// จากปุ่ม/การ์ดที่ผู้เล่นกดเสมอ; คืนความยาวเสียงเป็นวินาที (โหลดไม่ได้คืน 0)
export async function playVoice(url) {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    let buf = bufCache.get(url);
    if (!buf) {
      const data = await prefetchVoice(url);
      if (!data) return 0;
      buf = await ctx.decodeAudioData(data.slice(0));
      bufCache.set(url, buf);
    }
    stopVoice();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    source = src;
    return buf.duration;
  } catch (_) {
    return 0;
  }
}
