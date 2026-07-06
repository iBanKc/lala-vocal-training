// login gate — ไม่มี token ที่ใช้ได้ → เห็นเฉพาะหน้า login
// หน้าแรกมี 3 ทางเข้า: (1) ตั้งชื่อเล่นเล่นเลย (guest ใหม่) (2) 🎟 รหัสกลับเข้าเล่น (guest เดิม)
// (3) login นักเรียน/ครูของโรงเรียน — และ์การ์ด "▶ กลับเข้าเล่น" สำหรับ guest ที่เคยเล่นในเครื่องนี้
import { api, getToken, setToken, clearToken } from './api.js';
import { state, loadProfile } from './state.js';

const REMEMBER_KEY = 'ls_remembered_guest'; // จำเฉพาะ guest — บัญชีโรงเรียนไม่จำ (เครื่องอาจใช้ร่วมกัน)

const el = id => document.getElementById(id);
const guestForm = el('guestForm'), guestError = el('guestError'), guestBtn = el('guestSubmit');
const returnForm = el('returnForm'), returnError = el('returnError'), returnBtn = el('returnSubmit');
const loginForm = el('loginForm'), loginError = el('loginError'), loginBtn = el('loginSubmit');

// ── จำบัญชี guest ในเครื่องนี้ ──────────────────────────
function getRemembered() {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY)); } catch { return null; }
}

function saveRemembered() {
  if (state.user?.is_guest && getToken()) {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({
      username: state.user.username,
      display_name: state.user.display_name,
      token: getToken(),
    }));
  }
}

// ── สลับฟอร์มบนหน้า login ───────────────────────────────
const SECTIONS = {
  guest:  ['resumeCard', 'guestForm', 'guestLinks'],
  return: ['returnForm', 'backFromReturnHint'],
  school: ['loginForm', 'backToGuestHint'],
};
const ALL_IDS = [...new Set(Object.values(SECTIONS).flat())];

function showSection(name) {
  for (const id of ALL_IDS) el(id).classList.toggle('hidden', !SECTIONS[name].includes(id));
  if (name === 'guest') renderResumeCard(); // ซ่อนการ์ดถ้าไม่มีบัญชีที่จำไว้
}

function renderResumeCard() {
  const saved = getRemembered();
  const card = el('resumeCard');
  if (!saved) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  el('resumeBtn').textContent = `▶ กลับเข้าเล่นเป็น "${saved.display_name}"`;
}

function showLogin() {
  state.user = null;
  document.body.classList.add('auth-locked');
  showSection('guest');
}

function showApp() {
  document.body.classList.remove('auth-locked');
  saveRemembered(); // guest → อัปเดตบัญชีที่จำไว้ทุกครั้งที่เข้าสำเร็จ
  window.dispatchEvent(new CustomEvent('auth:ready', { detail: state.user }));
}

window.addEventListener('auth:required', showLogin);

// ── "บัตรกลับเข้าเล่น" ของ guest ────────────────────────
export function showCredentialsCard({ username, password }, { title = '🎟 บัตรกลับเข้าเล่นของคุณ' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-card">
      <h2>${title}</h2>
      <p class="cal-hint">ถ่ายหน้าจอหรือจดไว้ — ใช้กับปุ่ม "🎟 มีรหัสกลับเข้าเล่น" หน้าแรก<br>กลับมาเล่นต่อได้ทุกเครื่อง คะแนนสะสมไม่หาย<br><small>(ในเครื่องนี้ แอปจำบัญชีให้อัตโนมัติ ไม่ต้องกรอก)</small></p>
      <div class="cred-box">
        <div class="cred-row"><span>ชื่อผู้ใช้</span><strong>${username}</strong></div>
        <div class="cred-row"><span>รหัสผ่าน</span><strong>${password}</strong></div>
      </div>
      <div class="overlay-actions">
        <button class="btn-secondary" id="credCopy">📋 คัดลอก</button>
        <button class="btn-start" id="credOk">จดแล้ว เริ่มร้องเลย!</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#credCopy').addEventListener('click', async e => {
    try {
      await navigator.clipboard.writeText(`Let's Sing — ชื่อผู้ใช้: ${username} รหัสผ่าน: ${password}`);
      e.target.textContent = '✅ คัดลอกแล้ว';
    } catch { e.target.textContent = '⚠️ คัดลอกไม่ได้ — จดเองนะ'; }
  });
  return new Promise(res => {
    overlay.querySelector('#credOk').addEventListener('click', () => { overlay.remove(); res(); });
  });
}

// ออกจากระบบ — guest: จำบัญชีไว้ให้กลับเข้าเล่นกดเดียว (ไม่ต้อง confirm แล้ว)
export function logout() {
  if (state.user?.is_guest) saveRemembered();
  clearToken();
  showLogin();
}

// ── สลับลิงก์ ───────────────────────────────────────────
el('showReturnLink').addEventListener('click', e => { e.preventDefault(); showSection('return'); });
el('showLoginLink').addEventListener('click', e => { e.preventDefault(); showSection('school'); });
el('backFromReturnLink').addEventListener('click', e => { e.preventDefault(); showSection('guest'); });
el('showGuestLink').addEventListener('click', e => { e.preventDefault(); showSection('guest'); });

// ── ▶ กลับเข้าเล่น (บัญชีที่จำไว้ในเครื่อง) ──────────────
el('resumeBtn').addEventListener('click', async () => {
  const saved = getRemembered();
  if (!saved) return;
  el('resumeBtn').disabled = true;
  el('resumeBtn').textContent = 'กำลังเข้า...';
  setToken(saved.token);
  try {
    await loadProfile();
    showApp();
  } catch {
    // token หมดอายุ (180 วัน) → ให้กรอกรหัสแทน โดยเติมชื่อผู้ใช้ให้แล้ว
    clearToken();
    showSection('return');
    el('returnUsername').value = saved.username;
    returnError.textContent = 'เซสชันหมดอายุ — กรอกรหัสผ่านอีกครั้งนะ';
  } finally {
    el('resumeBtn').disabled = false;
    renderResumeCard();
  }
});

el('resumeDismiss').addEventListener('click', e => {
  e.preventDefault();
  localStorage.removeItem(REMEMBER_KEY);
  renderResumeCard();
});

// ── สมัคร guest ใหม่ ────────────────────────────────────
guestForm.addEventListener('submit', async e => {
  e.preventDefault();
  guestError.textContent = '';
  guestBtn.disabled = true;
  guestBtn.textContent = 'กำลังเตรียมเวที...';
  try {
    const nickname = el('guestNickname').value;
    const { token, credentials } = await api('/api/guest', { method: 'POST', body: { nickname } });
    setToken(token);
    await loadProfile();
    showApp();
    guestForm.reset();
    if (credentials) await showCredentialsCard(credentials);
  } catch (err) {
    guestError.textContent = err.message || 'เริ่มไม่สำเร็จ ลองอีกครั้ง';
  } finally {
    guestBtn.disabled = false;
    guestBtn.textContent = '🎵 เริ่มเลย!';
  }
});

// ── 🎟 กลับเข้าเล่นด้วยรหัส (guest เดิม) ─────────────────
returnForm.addEventListener('submit', async e => {
  e.preventDefault();
  returnError.textContent = '';
  returnBtn.disabled = true;
  returnBtn.textContent = 'กำลังเข้า...';
  try {
    const username = el('returnUsername').value;
    const password = el('returnPassword').value;
    const { token } = await api('/api/login', { method: 'POST', body: { username, password } });
    setToken(token);
    await loadProfile();
    showApp();
    returnForm.reset();
  } catch (err) {
    returnError.textContent = err.message || 'เข้าไม่สำเร็จ — ตรวจชื่อผู้ใช้/รหัสอีกครั้ง';
  } finally {
    returnBtn.disabled = false;
    returnBtn.textContent = '🎟 กลับเข้าเล่น';
  }
});

// ── login นักเรียน/ครูของโรงเรียน ───────────────────────
loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'กำลังเข้าสู่ระบบ...';
  try {
    const username = el('loginUsername').value;
    const password = el('loginPassword').value;
    const { token } = await api('/api/login', { method: 'POST', body: { username, password } });
    setToken(token);
    await loadProfile();
    showApp();
    loginForm.reset();
  } catch (err) {
    loginError.textContent = err.message || 'เข้าสู่ระบบไม่สำเร็จ';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'เข้าสู่ระบบ';
  }
});

// ตอนโหลดหน้า: มี token → ตรวจกับ /api/me
(async () => {
  if (!getToken()) { showLogin(); return; }
  try {
    await loadProfile();
    showApp();
  } catch {
    showLogin(); // token หมดอายุ/ใช้ไม่ได้
  }
})();
