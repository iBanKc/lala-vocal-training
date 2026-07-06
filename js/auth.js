// login gate — ไม่มี token ที่ใช้ได้ → เห็นเฉพาะหน้า login
import { api, getToken, setToken, clearToken } from './api.js';
import { state, loadProfile } from './state.js';

const loginForm   = document.getElementById('loginForm');
const loginError  = document.getElementById('loginError');
const loginBtn    = document.getElementById('loginSubmit');
const guestForm   = document.getElementById('guestForm');
const guestError  = document.getElementById('guestError');
const guestBtn    = document.getElementById('guestSubmit');

// สลับระหว่างฟอร์มผู้เยี่ยมชม (ค่าเริ่มต้น) กับ login นักเรียน/ครู
document.getElementById('showLoginLink').addEventListener('click', e => {
  e.preventDefault();
  guestForm.classList.add('hidden');
  document.getElementById('showLoginLink').parentElement.classList.add('hidden');
  loginForm.classList.remove('hidden');
  document.getElementById('backToGuestHint').classList.remove('hidden');
});
document.getElementById('showGuestLink').addEventListener('click', e => {
  e.preventDefault();
  loginForm.classList.add('hidden');
  document.getElementById('backToGuestHint').classList.add('hidden');
  guestForm.classList.remove('hidden');
  document.getElementById('showLoginLink').parentElement.classList.remove('hidden');
});

function showLogin() {
  state.user = null;
  document.body.classList.add('auth-locked');
}

// "บัตรกลับเข้าเล่น" ของ guest — แสดง username/password ให้จด/ถ่ายหน้าจอ
// ใช้ทั้งตอนสมัครใหม่ (auth.js) และตอนกด "ดูรหัสกลับเข้าเล่น" บน hub (hub.js)
export function showCredentialsCard({ username, password }, { title = '🎟 บัตรกลับเข้าเล่นของคุณ' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-card">
      <h2>${title}</h2>
      <p class="cal-hint">ถ่ายหน้าจอหรือจดไว้ — ใช้กับปุ่ม "เข้าสู่ระบบ" ครั้งหน้า<br>กลับมาเล่นต่อได้ทุกเครื่อง คะแนนสะสมไม่หาย</p>
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

// ออกจากระบบ — guest เตือนให้จดรหัสก่อน (token หายแล้วไม่มีรหัส = บัญชีหาย)
export function logout() {
  if (state.user?.is_guest) {
    const ok = confirm(`คุณกำลังออกจากบัญชีผู้เยี่ยมชม "${state.user.display_name}"\n\nจดชื่อผู้ใช้ (${state.user.username}) และรหัสผ่านแล้วหรือยัง?\nถ้ายัง กด "ยกเลิก" แล้วไปที่ "ดูรหัสกลับเข้าเล่น" บนหน้าหลักก่อน`);
    if (!ok) return;
  }
  clearToken();
  showLogin();
}

function showApp() {
  document.body.classList.remove('auth-locked');
  window.dispatchEvent(new CustomEvent('auth:ready', { detail: state.user }));
}

window.addEventListener('auth:required', showLogin);

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = 'กำลังเข้าสู่ระบบ...';
  try {
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;
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

guestForm.addEventListener('submit', async e => {
  e.preventDefault();
  guestError.textContent = '';
  guestBtn.disabled = true;
  guestBtn.textContent = 'กำลังเตรียมเวที...';
  try {
    const nickname = document.getElementById('guestNickname').value;
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
