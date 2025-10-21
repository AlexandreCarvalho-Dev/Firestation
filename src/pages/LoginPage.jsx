// src/pages/LoginPage.jsx
import { useState } from 'react';
import { API_BASE as API } from '../lib/api';
import logo from '../assets/Logo_Bombeiros.png';
import './login.css';

export default function LoginPage({ onLogin, onCreate }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    if (!username || !password) {
      setError('Preenche username e password.');
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',                // <— importante p/ cookie
        body: JSON.stringify({ username, password })
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        const msg = data?.error === 'invalid_credentials'
          ? 'Credenciais inválidas.'
          : data?.error === 'missing_fields'
          ? 'Faltam campos.'
          : 'Falha no login.';
        setError(msg);
        return;
      }

      onLogin?.(data.user);
    } catch (err) {
      setError('Erro de rede/servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="header">
        <img src={logo} alt="Bombeiros Voluntários de Algés" />
        <h2>Bombeiros <br/>Voluntários de Algés</h2>
      </div>

      <form className="card" onSubmit={handleLogin}>
        <h1>Login</h1>

        {error && <p className="erro">{error}</p>}

        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button type="submit" disabled={loading}>
          {loading ? 'A entrar…' : 'Submeter'}
        </button>

        <div className="links">
          <button
            type="button"
            className="link-btn"
            onClick={() => onCreate?.()}
          >
            Criar conta
          </button>
        </div>
      </form>
    </div>
  );
}
