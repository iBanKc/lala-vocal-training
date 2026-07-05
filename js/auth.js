// login gate — ไม่มี token ที่ใช้ได้ → เห็นเฉพาะหน้า login
import { api, getToken, setToken, clearToken } from './api.js';

export let currentUser = null;

const loginView   = document.getElementById('viewLogin');
const loginForm   = document.getElementById('loginForm');
const loginError  = document.getElementById('loginError');
const loginBtn    = document.getElementById('loginSubmit');
const userNameEl  = document.getElementById('headerUserName');
const logoutBtn   = document.getElementById('logoutBtn');

function showLogin() {
  currentUser = null;
  document.body.classList.add('auth-locked');
}

function showApp(user) {
  currentUser = user;
  document.body.classList.remove('auth-locked');
  if (userNameEl) userNameEl.textContent = user.display_name;
  window.dispatchEvent(new CustomEvent('auth:ready', { detail: user }));
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
    const { token, user } = await api('/api/login', { method: 'POST', body: { username, password } });
    setToken(token);
    showApp(user);
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
    const { user } = await api('/api/me');
    showApp(user);
  } catch {
    showLogin(); // token หมดอายุ/ใช้ไม่ได้ (api.js เคลียร์ให้แล้วผ่าน auth:required)
  }
})();
