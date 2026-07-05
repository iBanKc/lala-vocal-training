// fetch wrapper — แนบ JWT อัตโนมัติ, 401 → กลับหน้า login
const TOKEN_KEY = 'ls_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:required'));
  }

  let data = null;
  try { data = await res.json(); } catch { /* ไม่มี body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}
