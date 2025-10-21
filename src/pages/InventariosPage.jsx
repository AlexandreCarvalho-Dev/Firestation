import { useEffect, useMemo, useState } from 'react';
const API_BASE = `http://${window.location.hostname}:3001`;
import './inventarios.css';
import VehicleInventarioPage from './VehicleInventarioPage.jsx';

export default function InventariosPage({ onBack }) {
  const API = API_BASE;
  const secaoNome = 'Material';

  const [inv, setInv] = useState(null);              // 'secao' | 'veiculo'
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  // Tabelas (dados brutos do servidor)
  const [totais, setTotais] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [catalogo, setCatalogo] = useState([]);

  // Veículos (para filtro)
  const [veiculos, setVeiculos] = useState([]);

  // Filtros
  // ALL | SECAO | VEIC   (VEIC = itens que estão em cofres/veículos)
  const [filtro, setFiltro] = useState('ALL');
  // Guarda o código do veículo (porque breakdown traz "veiculo" como código, não id)
  const [veicSel, setVeicSel] = useState('ALL'); // 'ALL' ou código do veículo

  // Criar novo equipamento
  const [novoNome, setNovoNome] = useState('');
  const [novoQty, setNovoQty] = useState('');
  const [nrSerie, setNrSerie] = useState('');        // opcional

  // Adicionar existente
  const [equipSel, setEquipSel] = useState('');
  const [qtyAdd, setQtyAdd] = useState('');

  // Remover existente
  const [equipRem, setEquipRem] = useState('');
  const [qtyRem, setQtyRem] = useState('');
  const [motivoRem, setMotivoRem] = useState('');

  const loadCatalogo = async () => {
    try {
      const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/catalogo`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCatalogo(await r.json());
    } catch (e) {
      setErro(`Falha ao carregar catálogo: ${e.message}`);
    }
  };

  const loadInventario = async () => {
    setLoading(true);
    setErro('');
    try {
      const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/inventario`);
      const raw = await r.text();
      if (!r.ok) {
        let body;
        try { body = JSON.parse(raw); } catch {}
        throw new Error(body?.details || body?.error || `HTTP ${r.status}`);
      }
      const data = raw ? JSON.parse(raw) : {};
      setTotais(data.totais || []);
      setBreakdown(data.breakdown || []);
    } catch (e) {
      setErro(`Falha ao carregar inventário da secção: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadVeiculos = async () => {
    try {
      const r = await fetch(`${API}/veiculo`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setVeiculos(await r.json());
    } catch (e) {
      // Filtro de veículos é opcional; não bloqueia a página
      console.warn('Falha a carregar veículos:', e.message);
    }
  };

  useEffect(() => {
    if (inv !== 'secao') return;
    loadCatalogo();
    loadInventario();
    loadVeiculos(); // para o dropdown de filtro
  }, [inv]);

  /* ===== Helpers de filtragem e totais ===== */

  // Filtra as linhas do breakdown conforme filtro/veículo
  const filteredBreakdown = useMemo(() => {
    if (filtro === 'SECAO') {
      return breakdown.filter(r => r.tipo === 'SECAO');
    }
    if (filtro === 'VEIC') {
      const base = breakdown.filter(r => r.tipo === 'COFRE'); // itens que estão em cofres/veículos
      if (veicSel === 'ALL') return base;
      // breakdown.veiculo é o código do veículo (ex.: "VUCI 01")
      return base.filter(r => (r.veiculo || '') === veicSel);
    }
    return breakdown; // ALL
  }, [breakdown, filtro, veicSel]);

  // Recalcula os totais a partir do breakdown filtrado
  const filteredTotals = useMemo(() => {
    const map = new Map(); // equipamento -> soma qty
    for (const row of filteredBreakdown) {
      const key = row.equipamento;
      const qty = parseInt(row.qty, 10) || 0;
      map.set(key, (map.get(key) || 0) + qty);
    }
    // Se estiveres em "ALL", podes manter os totais do servidor para eficiência,
    // mas manter consistente assim evita divergências.
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([equipamento, total]) => ({ equipamento, total }));
  }, [filteredBreakdown]);

  /* ========== Ações ========== */

  const criarEquipamento = async (e) => {
    e.preventDefault();
    const q = Number.parseInt(novoQty, 10);
    if (!novoNome || !Number.isInteger(q) || q <= 0) {
      setErro('Preenche nome e quantidade (inteira > 0).');
      return;
    }
    setErro('');
    const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/equipamento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: novoNome,
        qty: q,
        nr_serie: nrSerie?.trim() || null   // opcional
      })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(`Falha ao criar equipamento: ${body?.error || `HTTP ${r.status}`}`);
      return;
    }
    setNovoNome('');
    setNovoQty('1');
    setNrSerie('');
    await Promise.all([loadCatalogo(), loadInventario()]);
  };

  const adicionarExistente = async (e) => {
    e.preventDefault();
    const q = Number.parseInt(qtyAdd, 10);
    if (!equipSel || !Number.isInteger(q) || q <= 0) {
      setErro('Selecione equipamento e quantidade válida (>0).');
      return;
    }
    setErro('');
    const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/entrada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_equip: Number.parseInt(equipSel, 10), qty: q })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(`Falha ao adicionar: ${body?.error || `HTTP ${r.status}`}`);
      return;
    }
    setQtyAdd('1');
    await loadInventario();
  };

  const removerDoArmazem = async (e) => {
    e.preventDefault();
    const q = Number.parseInt(qtyRem, 10);
    if (!equipRem || !Number.isInteger(q) || q <= 0) {
      setErro('Selecione equipamento e quantidade válida (>0).');
      return;
    }
    setErro('');
    const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/saida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id_equip: Number.parseInt(equipRem, 10),
        qty: q,
        motivo: motivoRem
      })
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(`Falha ao remover: ${body?.error || `HTTP ${r.status}`}`);
      return;
    }
    setQtyRem('1');
    setMotivoRem('');
    await loadInventario();
  };

  return (
    <div className="page">
      <div className="toolbar">
        <button onClick={() => setInv('secao')}>Inventário da secção</button>
        <button onClick={() => setInv('veiculo')}>Inventário de um veículo</button>
        <button onClick={onBack}>Voltar</button>
      </div>

      {inv === 'secao' && (
        <div className="section-content">
          <h1 className="title">Secção</h1>

          {/* Criar novo equipamento */}
          <h4>Criar novo equipamento e adicionar</h4>
          <form className="entrada-form" onSubmit={criarEquipamento}>
            <input
              type="text"
              placeholder="Nome do equipamento"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              required
            />
            <input
              id="quantidade"
              type="number"
              min="1"
              step="1"
              placeholder="Qtd. inicial"
              value={novoQty}
              onChange={(e) => setNovoQty(e.target.value)}
              required
            />
            <input
              id='quantidade'
              type="text"
              placeholder="Nr. série (opcional)"
              value={nrSerie}
              onChange={(e) => setNrSerie(e.target.value)}
            />
            <button type="submit">Adicionar</button>
          </form>

          {/* Entrada de existente */}
          <h4>Adicionar quantidade de equipamento</h4>
          <form className="entrada-form" onSubmit={adicionarExistente}>
            <select
              value={equipSel}
              onChange={(e) => setEquipSel(e.target.value)}
              required
            >
              <option value="">Escolha equipamento…</option>
              {catalogo.map(e => (
                <option key={e.id_equip} value={e.id_equip}>
                  {e.nome} ({e.unidade})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              step="1"
              value={qtyAdd}
              onChange={(e) => setQtyAdd(e.target.value)}
              required
              placeholder="Quantidade"
            />
            <button type="submit">Adicionar</button>
          </form>

          {/* Saída */}
          <h4>Remover equipamento</h4>
          <form className="entrada-form" onSubmit={removerDoArmazem}>
            <select
              value={equipRem}
              onChange={(e) => setEquipRem(e.target.value)}
              required
            >
              <option value="">Remover: escolha…</option>
              {catalogo.map(e => (
                <option key={e.id_equip} value={e.id_equip}>
                  {e.nome} ({e.unidade})
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              step="1"
              value={qtyRem}
              onChange={(e) => setQtyRem(e.target.value)}
              required
              placeholder="Qtd. a remover"
            />
            <button type="submit">Remover</button>
          </form>

          {loading && <p className="muted">A carregar…</p>}
          {erro && <p className="erro">{erro}</p>}

          {!loading && !erro && (
            <div className="tables-wrap">
              {/* FILTROS */}
              <div className="toolbar" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <label>
                  <input
                    type="radio"
                    name="filtro"
                    value="ALL"
                    checked={filtro === 'ALL'}
                    onChange={() => setFiltro('ALL')}
                  />{' '}
                  Tudo
                </label>
                <label>
                  <input
                    type="radio"
                    name="filtro"
                    value="SECAO"
                    checked={filtro === 'SECAO'}
                    onChange={() => setFiltro('SECAO')}
                  />{' '}
                  Só Secção
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="filtro"
                    value="VEIC"
                    checked={filtro === 'VEIC'}
                    onChange={() => setFiltro('VEIC')}
                  />{' '}
                  Veículos:
                  <select
                    disabled={filtro !== 'VEIC'}
                    value={veicSel}
                    onChange={(e) => setVeicSel(e.target.value)}
                  >
                    <option value="ALL">Todos os veículos</option>
                    {veiculos.map(v => (
                      <option key={v.id_veiculo} value={v.codigo}>{v.codigo}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="table-card">
                <h3>Distribuição (Armazém / Veículos / Cofres)</h3>
                <div className="table-scroll">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>Equipamento</th><th>Tipo</th><th>Veículo</th>
                        <th>Cofre</th><th className="num">Qtd.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBreakdown.map((row, i) => (
                        <tr key={i}>
                          <td>{row.equipamento}</td>
                          <td>{row.tipo}</td>
                          <td>{row.veiculo || '-'}</td>
                          <td>{row.cofre || '-'}</td>
                          <td className="num">{parseInt(row.qty, 10)}</td>
                        </tr>
                      ))}
                      {filteredBreakdown.length === 0 && (
                        <tr><td colSpan="5" className="muted">Sem dados</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {inv === 'veiculo' && (
        <div className="section-content">
          <VehicleInventarioPage onBack={() => setInv(null)} />
        </div>
      )}
    </div>
  );
}
