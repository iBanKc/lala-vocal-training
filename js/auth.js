// login gate — ไม่มี token ที่ใช้ได้ → เห็นเฉพาะหน้า login
import { api, getToken, setToken, clearToken } from './api.js';
import { state, loadProfile } from './state.js';

const loginForm   = document.getElementById('loginForm');
const loginError  = document.getElementById('loginError');
const loginBtn    = document.getElementById('loginSubmit');
const guestForm   = document.getElementById('guestForm');
const guestError  = document.getElementById('guestError');
const guestBtn    = document.getElementById('guestSubmit');
const userNameEl  = document.getElementById('headerUserName');
const logoutBtn   = document.getElementById('logoutBtn');

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

function showApp() {
  document.body.classList.remove('auth-locked');
  if (userNameEl) userNameEl.textContent = state.user.display_name;
  const tLink = document.getElementById('teacherLink');
  if (tLink) tLink.classList.toggle('hidden', state.user.role !== 'teacher');
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
    const { token } = await api('/api/guest', { method: 'POST', body: { nickname } });
    setToken(token);
    await loadProfile();
    showApp();
    guestForm.reset();
  } catch (err) {
    guestError.textContent = err.message || 'เริ่มไม่สำเร็จ ลองอีกครั้ง';
  } finally {
    guestBtn.disabled = false;
    guestBtn.textContent = '🎵 เริ่มเลย!';
  }
});

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    clearToken();
    showLogin();
  });
}

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
