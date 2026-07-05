// วอร์มตามหนังสือ "เสียงใหม่ฯ" — ท่ากายภาพแบบไกด์ + จับเวลา
// step ปกติ: การ์ดวิธีทำ + นาฬิกานับถอยหลัง; step 'hiss' (S-s-s Breath): ใช้ไมค์จับเวลาลมจริง
import { MicSession } from '../pitch-engine.js';
import { BOOK } from '../curriculum.js';

export async function run({ stage, signal, routine }) {
  if (!routine) throw new Error('ไม่พบ routine');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const results = []; // ต่อ step: 1 = ทำครบ, 0..1 สำหรับ hiss

  for (let i = 0; i < routine.steps.length; i++) {
    if (signal.aborted) return null;
    const step = routine.steps[i];

    stage.innerHTML = `
      <div class="wr-card">
        <div class="wr-progress">ท่าที่ ${i + 1}/${routine.steps.length} · ${routine.name}</div>
        <h2 class="wr-name">${step.name}</h2>
        <p class="wr-instruction">${step.instruction}</p>
        <p class="wr-feel">💡 ความรู้สึกที่ถูกต้อง: ${step.feel}</p>
        <div class="wr-timer" id="wrTimer">${step.measured ? '🎤' : step.seconds + ' วิ'}</div>
        <div class="nm-hold"><div class="nm-hold-bar" id="wrBar"></div></div>
        <div class="nm-status" id="wrStatus"></div>
        <div class="wr-actions">
          <button class="btn-start" id="wrStart">${step.measured ? '🎤 เริ่ม (เปิดไมค์)' : '⏱ เริ่มจับเวลา'}</button>
          <button class="btn-secondary" id="wrSkip">ข้ามท่านี้</button>
        </div>
        <p class="login-hint">${BOOK.credit}</p>
      </div>`;

    const timerEl = stage.querySelector('#wrTimer');
    const barEl = stage.querySelector('#wrBar');
    const statusEl = stage.querySelector('#wrStatus');
    const startBtn = stage.querySelector('#wrStart');
    const skipBtn = stage.querySelector('#wrSkip');

    const outcome = await new Promise(resolve => {
      const onAbort = () => resolve(null);
      signal.addEventListener('abort', onAbort, { once: true });
      skipBtn.addEventListener('click', () => { signal.removeEventListener('abort', onAbort); resolve(0); });

      startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        skipBtn.textContent = 'ข้าม';

        if (step.measured === 'hiss') {
          // S-s-s Breath: วัดเสียง "สสส" (unvoiced) ต่อเนื่องด้วย RMS
          let best = 0;
          let cur = 0;
          let lastLoud = null;
          let lastTime = null;
          const mic = new MicSession({
            onStatus: s => {
              if (s === 'calibrating') statusEl.textContent = 'เงียบสักครู่... กำลังวัดเสียงรอบข้าง';
              if (s === 'ready') statusEl.textContent = 'สูดลมลึก แล้ว "สสส" ยาว ๆ!';
            },
            onFrame: frame => {
              const now = frame.time;
              const dt = lastTime === null ? 0 : now - lastTime;
              lastTime = now;
              const hissing = frame.rms >= mic.rmsThreshold * 1.5; // เสียงลมดังพอ (ไม่ต้อง voiced)
              if (hissing) {
                lastLoud = now;
                cur += dt;
                best = Math.max(best, cur);
              } else if (lastLoud && now - lastLoud > 400) {
                cur = 0; // ขาดตอนเกิน 400ms = จบหนึ่งลม
              }
              timerEl.textContent = (cur / 1000).toFixed(1) + ' วิ';
              barEl.style.width = Math.min(100, (best / (step.targetSec * 1000)) * 100) + '%';
            },
          });
          try {
            await mic.start();
          } catch {
            statusEl.textContent = '⚠️ เปิดไมค์ไม่ได้ — ข้ามการวัด กดข้ามเพื่อไปต่อ';
            startBtn.disabled = false;
            return;
          }
          const stopAll = () => { mic.stop(); signal.removeEventListener('abort', onAbort); };
          // จบเมื่อ: เคยเป่าแล้ว + เงียบ 2 วิ หรือครบ 45 วิ
          const t0 = performance.now();
          const poll = setInterval(() => {
            if (signal.aborted) { clearInterval(poll); stopAll(); resolve(null); return; }
            const now = performance.now();
            if ((best > 1000 && lastLoud && now - lastLoud > 2000) || now - t0 > 45000) {
              clearInterval(poll);
              stopAll();
              const ratio = Math.min(1, best / (step.targetSec * 1000));
              statusEl.innerHTML = ratio >= 1
                ? `<span class="fb-good">✓ ${(best / 1000).toFixed(1)} วิ — ปอดแข็งแรงมาก!</span>`
                : `<span class="fb-mid">ได้ ${(best / 1000).toFixed(1)} วิ (เป้า ${step.targetSec} วิ)</span>`;
              setTimeout(() => resolve({ ratio, hissSec: best / 1000 }), 1300);
            }
          }, 150);
        } else {
          // จับเวลาปกติ
          const total = step.seconds * 1000;
          const t0 = performance.now();
          const tick = setInterval(() => {
            if (signal.aborted) { clearInterval(tick); resolve(null); return; }
            const el = performance.now() - t0;
            timerEl.textContent = Math.max(0, Math.ceil((total - el) / 1000)) + ' วิ';
            barEl.style.width = Math.min(100, (el / total) * 100) + '%';
            if (el >= total) {
              clearInterval(tick);
              signal.removeEventListener('abort', onAbort);
              statusEl.innerHTML = '<span class="fb-good">✓ เสร็จท่านี้!</span>';
              setTimeout(() => resolve(1), 900);
            }
          }, 200);
        }
      });
    });

    if (outcome === null) return null; // aborted
    results.push(typeof outcome === 'object' ? outcome.ratio : outcome);
    if (typeof outcome === 'object') results.hissSec = outcome.hissSec;
  }

  const score = Math.round((results.reduce((a, b) => a + b, 0) / routine.steps.length) * 100);
  return {
    score,
    accuracy_pct: null,
    avg_cents_off: null,
    details: {
      routine: routine.name,
      steps_total: routine.steps.length,
      steps_done: results.filter(r => r > 0).length,
      ...(results.hissSec ? { hiss_sec: Math.round(results.hissSec * 10) / 10 } : {}),
    },
  };
}
