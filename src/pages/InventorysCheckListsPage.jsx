// src/pages/InventorysCheckListsPage.jsx
import { useEffect, useState } from 'react';
import InventariosPage from '../pages/InventariosPage.jsx';
import ChecklistPage from '../pages/ChecklistPage.jsx';
import PastChecklistsPage from '../pages/PastChecklistsPage.jsx';
import ReposicaoPage from '../pages/ReposicaoPage.jsx';
import { API_BASE } from '../lib/api.js';
import './App.css';

export default function InventorysCheckListsPage({ user, onLogout }) {
  const [screen, setScreen] = useState('home');
  const [veiculos, setVeiculos] = useState([]);
  const [selecionado, setSelecionado] = useState('');
  const [erro, setErro] = useState('');
  const [loadingVeic, setLoadingVeic] = useState(false);
  const [canAdmin, setCanAdmin] = useState(!!user?.isAdmin);

  // Seed a partir do user prop (caso /login já tenha devolvido isAdmin)
  useEffect(() => {
    setCanAdmin(!!user?.isAdmin);
  }, [user?.isAdmin]);

  // Verifica no servidor (cookie) — primeiro /me (traz isAdmin), fallback /auth/is-admin
  useEffect(() => {
    let alive = true;

    async function checkAdmin() {
      try {
        // 1) /me
        const r1 = await fetch(`${API_BASE}/me`, { credentials: 'include' });
        if (r1.ok) {
          const j1 = await r1.json();
          console.log('[/me] =>', j1);
          if (alive && j1?.ok && typeof j1?.user?.isAdmin === 'boolean') {
            setCanAdmin(j1.user.isAdmin);
            return;
          }
        } else {
          console.warn('[/me] HTTP', r1.status);
        }
      } catch (e) {
        console.warn('Falha em /me:', e);
      }

      try {
        // 2) fallback /auth/is-admin
        const r2 = await fetch(`${API_BASE}/auth/is-admin`, { credentials: 'include' });
        if (r2.ok) {
          const j2 = await r2.json();
          console.log('[/auth/is-admin] =>', j2);
          if (alive && typeof j2?.isAdmin === 'boolean') {
            setCanAdmin(j2.isAdmin);
            return;
          }
        } else {
          console.warn('[/auth/is-admin] HTTP', r2.status);
        }
      } catch (e) {
        console.warn('Falha em /auth/is-admin:', e);
      }

      if (alive) setCanAdmin(false);
    }

    checkAdmin();
    return () => { alive = false; };
  }, [user?.id]);

  // Carregar lista de veículos ativos
  useEffect(() => {
    const ac = new AbortController();
    setErro('');
    setLoadingVeic(true);
    fetch(`${API_BASE}/veiculo`, { signal: ac.signal, credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setVeiculos(data || []))
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Erro ao buscar veículos:', err);
          setErro('Não foi possível carregar a lista de veículos.');
        }
      })
      .finally(() => setLoadingVeic(false));
    return () => ac.abort();
  }, []);

  if (screen === 'inventarios') {
    return <InventariosPage onBack={() => setScreen('home')} />;
  }

  if (screen === 'historico') {
    return <PastChecklistsPage onBack={() => setScreen('home')} />;
  }

  if (screen === 'reposicao') {
    const idVeic = selecionado ? Number(selecionado) : '';
    return <ReposicaoPage onBack={() => setScreen('home')} idVeiculo={idVeic} />;
  }

  if (screen === 'veiculo') {
    const v = veiculos.find((x) => String(x.id_veiculo) === String(selecionado));
    return (
      <ChecklistPage
        idVeiculo={Number(selecionado)}
        codigoVeiculo={v?.codigo ?? ''}
        onBack={() => {
          setScreen('home');
          setSelecionado('');
        }}
      />
    );
  }

  return (
    <div className="background">
      <div className="session">
        <span>Bem-Vindo de volta, {user?.username || 'Utilizador'}</span>
        <button onClick={onLogout}>Sair</button>
      </div>

      <div className="header-mainpage">
        <div>
          <h1>Verificação de veículos</h1>
        </div>
        <select
          value={selecionado}
          onChange={(e) => {
            const id = e.target.value;
            setSelecionado(id);
            if (id) setScreen('veiculo');
          }}
          disabled={loadingVeic || veiculos.length === 0}
        >
          <option value="">
            {loadingVeic
              ? 'A carregar...'
              : veiculos.length === 0
              ? 'Sem veículos ativos'
              : 'Escolha um veículo'}
          </option>
          {veiculos.map((v) => (
            <option key={v.id_veiculo} value={v.id_veiculo}>
              {v.codigo}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">{erro && <p className="erro">{erro}</p>}</div>

      {canAdmin && (
        <div className="panel">
          <div className="admin">
            <button type="button" onClick={() => setScreen('reposicao')}>
              Reposição
            </button>
            <button type="button" onClick={() => setScreen('historico')}>
              Listas Anteriores
            </button>
            <button type="button" onClick={() => setScreen('inventarios')}>
              Gerir Inventários
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
