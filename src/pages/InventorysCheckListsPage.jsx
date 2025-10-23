// src/pages/InventorysCheckListsPage.jsx
import { useEffect, useState } from 'react';
import InventariosPage from '../pages/InventariosPage.jsx';
import ChecklistPage from '../pages/ChecklistPage.jsx';
import PastChecklistsPage from '../pages/PastChecklistsPage.jsx';
import { API_BASE } from '../lib/api.js';
import './App.css';

export default function InventorysCheckListsPage({ user, onLogout }) {
  // 'home' | 'inventarios' | 'veiculo' | 'historico'
  const [screen, setScreen] = useState('home');
  const [veiculos, setVeiculos] = useState([]);
  const [selecionado, setSelecionado] = useState('');
  const [erro, setErro] = useState('');
  const [loadingVeic, setLoadingVeic] = useState(false);

  // Carregar lista de veículos ativos
  useEffect(() => {
    const ac = new AbortController();
    setErro('');
    setLoadingVeic(true);
    fetch(`${API_BASE}/veiculo`, { signal: ac.signal, credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => setVeiculos(data || []))
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Erro ao buscar veículos:', err);
          setErro('Não foi possível carregar a lista de veículos.');
        }
      })
      .finally(() => setLoadingVeic(false));
    return () => ac.abort();
  }, []);

  // Rota: Inventários (secção/armazém)
  if (screen === 'inventarios') {
    return <InventariosPage onBack={() => setScreen('home')} />;
  }

  // Rota: Histórico de checklists
  if (screen === 'historico') {
    return <PastChecklistsPage onBack={() => setScreen('home')} />;
  }

  // Rota: Checklist de um veículo
  if (screen === 'veiculo') {
    const v = veiculos.find(x => String(x.id_veiculo) === String(selecionado));
    return (
      <ChecklistPage
        idVeiculo={Number(selecionado)}
        codigoVeiculo={v?.codigo ?? ''}
        onBack={() => { setScreen('home'); setSelecionado(''); }}
      />
    );
  }

  // Home
  return (
    <div className="background">
      <div className="session">
        <span>Bem-Vindo de volta, {user?.username || 'Utilizador'}</span>
        <button onClick={onLogout}>Sair</button>
      </div>

      <div className="header">
        <h1>Verificação de veículos</h1>
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
              : (veiculos.length === 0 ? 'Sem veículos ativos' : 'Escolha um veículo')}
          </option>
          {veiculos.map(v => (
            <option key={v.id_veiculo} value={v.id_veiculo}>
              {v.codigo}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        {erro && <p className="erro">{erro}</p>}
      </div>

      <div className="diarios">
        <h2>Veículos do Dia</h2>
        <div className="veiculos-diarios">
          {/* Aqui podes ligar estes botões a IDs reais se quiseres salto rápido */}
          <button type="button">VSAT 01</button>
          <button type="button">VECI 01</button>
          <button type="button">VCOT 01</button>
        </div>
      </div>

      <div className="panel">
        <h2>Administração</h2>
        <div className="admin">
          <button type="button">Reposição</button>
          <button type="button" onClick={() => setScreen('historico')}>Listas Anteriores</button>
          <button type="button" onClick={() => setScreen('inventarios')}>Gerir Inventários</button>
          <button type="button">Solicitações</button>
        </div>
      </div>
    </div>
  );
}
