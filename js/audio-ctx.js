// ทะเบียน AudioContext ร่วม — บทเรียน iOS: context ที่ใช้งานได้ต้องเกิดจาก user gesture
// MicSession สร้าง context ใน gesture (ตอนกดเริ่มเกม/เริ่มวัด) และลงทะเบียนไว้ที่นี่
// ให้ tone.js เล่นเสียงนำผ่าน context เดียวกัน → เสียงออกแน่นอนบน iOS ขณะไมค์เปิดอยู่
// (แยกเป็นไฟล์เล็ก ๆ กัน circular import ระหว่าง pitch-engine.js กับ tone.js)

let shared = null;

export function setSharedContext(ctx) {
  shared = ctx;
}

export function clearSharedContext(ctx) {
  if (shared === ctx) shared = null;
}

export function getSharedContext() {
  return shared && shared.state !== 'closed' ? shared : null;
}
