// src/lib/api.js
export const API_BASE = import.meta.env.PROD ? '/api' : 'http://192.168.1.101:3001';

async function asJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export async function apiLogin({ username, password }) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  return asJson(res);
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/me`, { credentials: 'include' });
  return asJson(res);
}

export async function apiIsAdmin() {
  const res = await fetch(`${API_BASE}/auth/is-admin`, { credentials: 'include' });
  return asJson(res); // { ok:true, isAdmin: boolean }
}

export async function apiLogout() {
  const res = await fetch(`${API_BASE}/logout`, { method: 'POST', credentials: 'include' });
  return asJson(res);
}
