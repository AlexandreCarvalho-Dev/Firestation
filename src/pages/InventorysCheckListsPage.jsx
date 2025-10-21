// src/App.jsx
import { useEffect, useState } from 'react';
import './App.css';
import InventariosPage from './InventariosPage.jsx';
import ChecklistPage from './ChecklistPage.jsx';
import { API_BASE } from '../lib/api.js';

export default function InvetoryCheckListsPage() {
  const [screen, setScreen] = useState('home'); // 'home' | 'inventarios' | 'veiculo'
  const [veiculos, setVeiculos] = useState([]);
  const [selecionado, setSelecionado] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/veiculo`)
      .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then(data => setVeiculos(data))
      .catch(err => { console.error('Erro ao buscar veículos:', err); setErro('Não foi possível carregar a lista de veículos.'); });
  }, []);

  if (screen === 'inventarios') {
    return <InventariosPage onBack={() => setScreen('home')} />;
  }

  if (screen === 'login') {

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

  return (
    <div className='background'>
      <div className="header">
        <h1>Verificação veículos</h1>

        <select
          value={selecionado}
          onChange={(e) => {
            const id = e.target.value;
            setSelecionado(id);
            if (id) setScreen('veiculo');
          }}
          disabled={veiculos.length === 0}
        >
          <option value="">
            {veiculos.length === 0 ? 'A carregar...' : 'Escolha um veículo'}
          </option>
          {veiculos.map(v => (
            <option key={v.id_veiculo} value={v.id_veiculo}>
              {v.codigo}
            </option>
          ))}
        </select>

        {erro && <p className="erro" style={{ marginTop: 8 }}>{erro}</p>}
      </div>

      <div className="diarios">
        <h2>Veículos do Dia</h2>
        <div className="veiculos-diarios">
          <button>VSAT 01</button>
          <button>VECI 01</button>
          <button>VCOT 01</button>
        </div>
      </div>

      <div className="admin">
        <button>Reposição</button>
        <button>Listas Anteriores</button>
        <button onClick={() => setScreen('inventarios')}>Gerir Inventários</button>
        <button>Solicitações</button>
      </div>
    </div>
  );
}
}