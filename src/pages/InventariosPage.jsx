// src/pages/InventariosPage.jsx
import { useEffect, useMemo, useState } from 'react';
import './inventarios.css';
import VehicleInventarioPage from './VehicleInventarioPage.jsx';
import { API_BASE } from '../lib/api';

export default function InventariosPage({ onBack }) {
  const API = API_BASE;
  const secaoNome = 'Material';

  const [inv, setInv] = useState(null);

  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const [totais, setTotais] = useState([]);
  const [breakdown, setBreakdown] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [veiculos, setVeiculos] = useState([]);

  const [filtro, setFiltro] = useState('ALL');
  const [veicSel, setVeicSel] = useState('ALL');

  const [novoNome, setNovoNome] = useState('');
  const [novoQty, setNovoQty] = useState('1');
  const [nrSerie, setNrSerie] = useState('');

  const [equipSel, setEquipSel] = useState('');
  const [qtyMov, setQtyMov] = useState('1');
  const [motivoRem, setMotivoRem] = useState('');

  const [removingKey, setRemovingKey] = useState(null);

  async function loadCatalogo() {
    try {
      const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/catalogo`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setCatalogo(await r.json());
    } catch (e) {
      setErro(`Falha ao carregar catálogo: ${e.message}`);
    }
  }

  function getEquipIdByNome(nome) {
    const e = catalogo.find(x => x.nome === nome);
    return e?.id_equip ?? null;
  }

  async function removerTudoDaSecao(row) {
    if (row?.tipo !== 'SECAO') return;
    const id_equip = getEquipIdByNome(row.equipamento);
    const qty = parseInt(row.qty, 10) || 0;
    if (!id_equip || qty <= 0) return;

    const key = `${row.equipamento}::${row.tipo}`;
    if (!confirm(`Eliminar ${qty} do armazém da secção para "${row.equipamento}"?`)) return;

    try {
      setRemovingKey(key);
      setErro('');
      const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/saida`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id_equip, qty }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      await loadInventario();
    } catch (e) {
      setErro(`Falha ao eliminar: ${e.message}`);
    } finally {
      setRemovingKey(null);
    }
  }

  async function eliminarEquipamentoSecao(row) {
    const id_equip = getEquipIdByNome(row.equipamento);
    if (!id_equip) return;
    if (!confirm(`Eliminar o equipamento "${row.equipamento}" do catálogo da secção?`)) return;

    try {
      setRemovingKey(`${row.equipamento}::${row.tipo}::del`);
      setErro('');
      const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/equipamento/${id_equip}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      await Promise.all([loadCatalogo(), loadInventario()]);
    } catch (e) {
      setErro(`Falha ao eliminar equipamento: ${e.message}`);
    } finally {
      setRemovingKey(null);
    }
  }

  async function loadInventario() {
    setLoading(true);
    setErro('');
    try {
      const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/inventario`, { credentials: 'include' });
      const raw = await r.text();
      if (!r.ok) {
        let body;
        try { body = JSON.parse(raw); } catch {}
        throw new Error(body?.details || body?.error || `HTTP ${r.status}`);
      }
      const data = raw ? JSON.parse(raw) : {};
      setTotais(data.totais || []);
      // Normaliza (se backend ainda não devolver manutencao/inop)
      const normalized = (data.breakdown || []).map(x => ({
        ...x,
        manutencao: Number.isFinite(+x.manutencao) ? +x.manutencao : 0,
        inop: Number.isFinite(+x.inop) ? +x.inop : 0,
        qty: Number.isFinite(+x.qty) ? +x.qty : 0,
      }));
      setBreakdown(normalized);
    } catch (e) {
      setErro(`Falha ao carregar inventário da secção: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadVeiculos() {
    try {
      const r = await fetch(`${API}/veiculo`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setVeiculos(await r.json());
    } catch (e) {
      console.warn('Falha a carregar veículos:', e.message);
    }
  }

  useEffect(() => {
    if (inv !== 'secao') return;
    loadCatalogo();
    loadInventario();
    loadVeiculos();
  }, [inv]);

  const filteredBreakdown = useMemo(() => {
    if (filtro === 'SECAO') return breakdown.filter(r => r.tipo === 'SECAO');
    if (filtro === 'VEIC') {
      const base = breakdown.filter(r => r.tipo === 'COFRE');
      if (veicSel === 'ALL') return base;
      return base.filter(r => (r.veiculo || '') === veicSel);
    }
    return breakdown;
  }, [breakdown, filtro, veicSel]);

  const filteredTotals = useMemo(() => {
    const map = new Map();
    for (const row of filteredBreakdown) {
      const key = row.equipamento;
      const qty = parseInt(row.qty, 10) || 0;
      map.set(key, (map.get(key) || 0) + qty);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([equipamento, total]) => ({ equipamento, total }));
  }, [filteredBreakdown]);

  // --- NOVO: Resumo "Armazém da Secção" (Stock / Manut. / INOP) ---
  const resumoSecao = useMemo(() => {
    const map = new Map();
    for (const row of breakdown) {
      if (row.tipo !== 'SECAO') continue;
      const key = row.equipamento;
      const cur = map.get(key) || { equipamento: key, stock: 0, manutencao: 0, inop: 0 };
      cur.stock += Number(row.qty || 0);
      cur.manutencao += Number(row.manutencao || 0);
      cur.inop += Number(row.inop || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.equipamento.localeCompare(b.equipamento));
  }, [breakdown]);

  async function criarEquipamento(e) {
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
      credentials: 'include',
      body: JSON.stringify({ nome: novoNome, qty: q, nr_serie: nrSerie?.trim() || null }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(`Falha ao criar equipamento: ${body?.error || `HTTP ${r.status}`}`);
      return;
    }
    setNovoNome(''); setNovoQty('1'); setNrSerie('');
    await Promise.all([loadCatalogo(), loadInventario()]);
  }

  async function onAdicionarClick() {
    const q = Number.parseInt(qtyMov, 10);
    if (!equipSel || !Number.isInteger(q) || q <= 0) {
      setErro('Selecione equipamento e quantidade válida (>0).');
      return;
    }
    setErro('');
    const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/entrada`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id_equip: Number.parseInt(equipSel, 10), qty: q }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(`Falha ao adicionar: ${body?.error || `HTTP ${r.status}`}`);
      return;
    }
    setQtyMov('1');
    await loadInventario();
  }

  async function onRemoverClick() {
    const q = Number.parseInt(qtyMov, 10);
    if (!equipSel || !Number.isInteger(q) || q <= 0) {
      setErro('Selecione equipamento e quantidade válida (>0).');
      return;
    }
    setErro('');
    const r = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/saida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id_equip: Number.parseInt(equipSel, 10),
        qty: q,
        motivo: motivoRem,
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErro(`Falha ao remover: ${body?.error || `HTTP ${r.status}`}`);
      return;
    }
    setQtyMov('1'); setMotivoRem('');
    await loadInventario();
  }

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
              id="nrserie"
              type="text"
              placeholder="Nr. série (opcional)"
              value={nrSerie}
              onChange={(e) => setNrSerie(e.target.value)}
            />
            <button type="submit">Adicionar</button>
          </form>

          <h4>Movimentar quantidade (Adicionar / Remover)</h4>
          <div className="entrada-form" onSubmit={(e)=>e.preventDefault()}>
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
              value={qtyMov}
              onChange={(e) => setQtyMov(e.target.value)}
              required
              placeholder="Quantidade"
            />

            <input
              type="text"
              value={motivoRem}
              onChange={(e) => setMotivoRem(e.target.value)}
              placeholder="Motivo (opcional, só para remover)"
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={onAdicionarClick}>Adicionar</button>
              <button type="button" onClick={onRemoverClick}>Remover</button>
            </div>
          </div>

          {loading && <p className="muted">A carregar…</p>}
          {erro && <p className="erro">{erro}</p>}

          {!loading && !erro && (
            <div className="tables-wrap">

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
                        <th>Equipamento</th>
                        <th>Tipo</th>
                        <th>Veículo</th>
                        <th>Cofre</th>
                        <th className="num">Qtd.</th>
                        <th className="num">Manut.</th>
                        <th className="num">INOP</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBreakdown.map((row) => {
                        const key = `${row.equipamento}::${row.tipo}::${row.veiculo || ''}::${row.cofre || ''}`;
                        const showFlags = row.tipo === 'SECAO';
                        const manut = showFlags ? (row.manutencao || 0) : 0;
                        const inop = showFlags ? (row.inop || 0) : 0;
                        return (
                          <tr key={key}>
                            <td>{row.equipamento}</td>
                            <td>{row.tipo}</td>
                            <td>{row.veiculo || '-'}</td>
                            <td>{row.cofre || '-'}</td>
                            <td className="num">{parseInt(row.qty, 10)}</td>
                            <td className="num">{showFlags ? manut : '-'}</td>
                            <td className="num">{showFlags ? inop : '-'}</td>
                            <td>
                              {row.tipo === 'SECAO' ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const q = parseInt(row.qty, 10) || 0;
                                    return q > 0 ? removerTudoDaSecao(row) : eliminarEquipamentoSecao(row);
                                  }}
                                  disabled={removingKey && removingKey.startsWith(`${row.equipamento}::${row.tipo}`)}
                                >
                                  Eliminar
                                </button>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      {filteredBreakdown.length === 0 && (
                        <tr><td colSpan="8" className="muted">Sem dados</td></tr>
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
