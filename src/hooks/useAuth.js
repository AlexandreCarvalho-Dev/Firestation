// src/hooks/useAuth.js
import { useEffect, useState, useCallback } from "react";
import { API_BASE as API } from "../lib/api";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  // Verifica sessão ao montar
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/me`, { credentials: "include" });
        if (!alive) return;
        if (r.ok) {
          const data = await r.json().catch(() => ({}));
          setUser(data?.user || null);
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback(async ({ username, password }) => {
    const r = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // necessário para cookie de sessão
      body: JSON.stringify({ username, password })
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data?.ok) {
      const msg =
        data?.error === "invalid_credentials" ? "Credenciais inválidas." :
        data?.error === "missing_fields"      ? "Faltam campos." :
        "Falha no login.";
      throw new Error(msg);
    }
    setUser(data.user ?? null);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/logout`, { method: "POST", credentials: "include" });
    } catch {}
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const r = await fetch(`${API}/me`, { credentials: "include" });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      setUser(data?.user || null);
    } else {
      setUser(null);
    }
  }, []);

  return { user, checking, login, logout, refresh };
}
