// src/hooks/useAuth.js
import { useEffect, useState, useCallback } from 'react';
import { API_BASE as API } from '../lib/api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/me`, { credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        if (alive && r.ok && data?.ok) setUser(data.user);
      } catch {}
      if (alive) setChecking(false);
    })();
    return () => { alive = false; };
  }, []);

  const login = useCallback((userObj) => setUser(userObj), []);
  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' });
    } catch {}
    setUser(null);
  }, []);

  return { user, checking, login, logout };
}
