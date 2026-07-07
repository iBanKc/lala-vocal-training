// Fit-guard: safety net ของ dynamic UI — ถ้าเนื้อหาสูงเกินพื้นที่ของ element
// (system font ใหญ่พิเศษ, จอ aspect แปลก, เนื้อหาอนาคต) ย่อทั้งก้อนด้วย
// CSS zoom ให้พอดีเสมอ ไม่มีการตัด/ทับ — กรณีปกติ zoom = 1 ไม่มีผลใด ๆ
//
// ใช้: const guard = watchFit(el, onChange); guard.refit() บังคับเช็ค; guard.stop() เลิกเฝ้า
export function watchFit(el, onChange = null) {
  let scheduled = false;

  const apply = () => {
    scheduled = false;
    const prev = el.style.zoom || '';
    el.style.zoom = '';
    let next = '';
    if (el.scrollHeight > el.clientHeight + 2) {
      // ×0.99 เผื่อ rounding ของ zoom quantization ให้ไม่เหลือเศษล้น 1-2px
      next = Math.max(0.7, (el.clientHeight / el.scrollHeight) * 0.99).toFixed(3);
    }
    el.style.zoom = next;
    if (next !== prev && onChange) onChange(next ? Number(next) : 1);
  };

  // ใช้ setTimeout ไม่ใช่ rAF — ทำงานแม้แท็บถูกซ่อน (เช่นสลับแอปกลับมา layout ถูกทันที)
  const refit = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(apply, 0);
  };

  // ครอบคลุม: สลับหน้า (ขนาด el เปลี่ยน), หมุนจอ/resize, เนื้อหาใน el เปลี่ยน
  const ro = new ResizeObserver(refit);
  ro.observe(el);
  const mo = new MutationObserver(refit);
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  window.addEventListener('resize', refit);
  refit();

  return {
    refit,
    stop() {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', refit);
      el.style.zoom = '';
    },
  };
}
