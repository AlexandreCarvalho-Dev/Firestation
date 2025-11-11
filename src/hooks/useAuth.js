// src/hooks/useAuth.js
import { useEffect, useState, useCallback } from 'react';
import { apiLogin, apiMe, apiIsAdmin, apiLogout } from '../lib/api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  // Arranca sessão a partir do cookie
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { user } = await apiMe();                 // precisa do cookie
        let isAdmin = false;
        try { isAdmin = !!(await apiIsAdmin()).isAdmin; } catch {}
        if (alive) setUser({ ...user, isAdmin });
      } catch {
        if (alive) setUser(null);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback(async ({ username, password }) => {
    const { user } = await apiLogin({ username, password }); // guarda cookie
    let isAdmin = false;
    try { isAdmin = !!(await apiIsAdmin()).isAdmin; } catch {}
    const u = { ...user, isAdmin };
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await apiLogout(); } catch {}
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    const { user } = await apiMe();
    let isAdmin = false;
    try { isAdmin = !!(await apiIsAdmin()).isAdmin; } catch {}
    setUser({ ...user, isAdmin });
  }, []);

  return { user, checking, login, logout, refresh };
}
