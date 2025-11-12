// src/lib/api.js

// 1) Permite override manual em dev: .env -> VITE_API_BASE
const ENV_BASE = import.meta.env.VITE_API_BASE;

// 2) Host atual do browser (localhost, 127.0.0.1, app.bombeirosdealges.pt, etc.)
const HOST = typeof window !== "undefined" ? window.location.hostname : "localhost";
const PROTOCOL = typeof window !== "undefined" ? window.location.protocol : "http:";

// 3) Regra: em produção usa sempre caminho relativo '/api' (Nginx proxy).
//           em desenvolvimento usa ENV_BASE se existir; caso contrário, http://HOST:3001
export const API_BASE = import.meta.env.PROD
  ? "/api"
  : (ENV_BASE || `http://${HOST}:3001`);

// --- helpers ---
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

// --- endpoints ---
export async function apiLogin({ username, password }) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });
  return asJson(res);
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/me`, { credentials: "include" });
  return asJson(res);
}

export async function apiIsAdmin() {
  const res = await fetch(`${API_BASE}/auth/is-admin`, { credentials: "include" });
  return asJson(res);
}

export async function apiLogout() {
  const res = await fetch(`${API_BASE}/logout`, { method: "POST", credentials: "include" });
  return asJson(res);
}
