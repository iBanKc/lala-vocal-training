// นับถอยหลังเริ่มเกม — ตัวเลขใหญ่กลาง container แล้วหายไปเมื่อจบ
// utility กลาง: เกมไหนมีนับถอยหลังให้ใช้ตัวนี้ (หน้าตาเดียวกันทั้งแอป)
// container ต้องเป็น position:relative (หรือ absolute-positioned parent)
export async function runCountdown(containerEl, {
  signal = null,
  steps = ['3', '2', '1', 'เริ่ม!'],
  stepMs = 700,
  onTick = null,
} = {}) {
  const el = document.createElement('div');
  el.className = 'game-countdown';
  containerEl.appendChild(el);
  try {
    for (const s of steps) {
      if (signal?.aborted) break;
      el.textContent = s;
      el.classList.remove('tick');
      void el.offsetWidth; // restart อนิเมชัน
      el.classList.add('tick');
      if (onTick) onTick(s);
      await new Promise(r => setTimeout(r, stepMs));
    }
  } finally {
    el.remove();
  }
}
