// login gate — ไม่มี token ที่ใช้ได้ → เห็นเฉพาะหน้า login
import { api, getToken, setToken, clearToken } from './api.js';
import { state, loadProfile } from './state.js';

const loginForm   = document.getElementById('loginForm');
const loginError  = document.getElementById('loginError');
const loginBtn    = document.getElementById('loginSubmit');
const userNameEl  = document.getElementById('headerUserName');
const logoutBtn   = document.getElementById('logoutBtn');

function showLogin() {
  state.user = null;
  document.body.classList.add('auth-locked');
}

function showApp() {
  document.body.classList.remove('auth-locked');
  if (userNameEl) userNameEl.textContent = state.user.display_name;
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
