// src/App.jsx
import { useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import LoginPage from './pages/LoginPage.jsx';
import CreateAccountPage from './pages/CreateAccountPage.jsx';

export default function App() {
  const { user, checking, login } = useAuth();
  const [guestScreen, setGuestScreen] = useState('login'); // 'login' | 'create'

  if (checking) return <p style={{ padding:16 }}>A verificar sessão…</p>;

  // Não autenticado → mostra Login ou Create
  if (!user) {
    if (guestScreen === 'create') {
      return (
        <CreateAccountPage
          onBack={() => setGuestScreen('login')}
          onCreated={() => setGuestScreen('login')} // opcional, volta ao login após criar
        />
      );
    }
    return (
      <LoginPage
        onLogin={login}
        onCreate={() => setGuestScreen('create')}   // <- AQUI FAZ A MUDANÇA
      />
    );
  }

  // Autenticado → resto da app
  return (
    <div style={{ padding:16 }}>
      <h1>Área autenticada</h1>
      {/* o teu conteúdo protegido */}
    </div>
  );
}
