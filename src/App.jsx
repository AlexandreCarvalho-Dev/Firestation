// src/App.jsx
import { useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import LoginPage from './pages/LoginPage.jsx';
import CreateAccountPage from './pages/CreateAccountPage.jsx';
import InventorysCheckListsPage from './pages/InventorysCheckListsPage.jsx';

export default function App() {
  const { user, checking, login, logout } = useAuth();
  const [guestScreen, setGuestScreen] = useState('login'); // 'login' | 'create'

  if (checking) return <p style={{ padding:16 }}>A verificar sessão…</p>;

  // Não autenticado → mostra Login ou Create
  if (!user) {
    if (guestScreen === 'create') {
      return (
        <CreateAccountPage
          onBack={() => setGuestScreen('login')}
          onCreated={() => setGuestScreen('login')}
        />
      );
    }
    return (
      <LoginPage
        onLogin={login}                   // chama o hook
        onCreate={() => setGuestScreen('create')}
      />
    );
  }

  // Autenticado → página protegida
  return (
    <InventorysCheckListsPage user={user} onLogout={logout} />
  );
}
