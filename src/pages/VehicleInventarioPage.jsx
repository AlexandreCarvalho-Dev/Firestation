// src/pages/VehicleInventarioPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { API_BASE as API } from '../lib/api'; 

export default function VehicleInventarioPage({ onBack, secaoNome = 'Material' }) {
  const [veiculos, setVeiculos] = useState([]);
  const [veicSel, setVeicSel] = useState('');      

  const [cofres, setCofres] = useState([]);
  const [cofreSel, setCofreSel] = useState('');  

  const [invVeiculo, setInvVeiculo] = useState([]); 
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  // armazém da secção
  const [catalogo, setCatalogo] = useState([]);
  const [saldosSecao, setSaldosSecao] = useState([]);

  // adicionar
  const [equipAdd, setEquipAdd] = useState('');
  const [qtyAdd, setQtyAdd] = useState('');

  // remover
  const [equipRm, setEquipRm] = useState('');
  const [qtyRm, setQtyRm] = useState('');

  const safeJson = async (res) => {
    if (!res.ok) throw new Error(`${res.url} -> HTTP ${res.status}`);
    const data = await res.json();
    return data;
  };

  const loadBase = async () => {
    try {
      const [v, c, s] = await Promise.all([
        fetch(`${API}/veiculo`).then(safeJson),
        fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/catalogo`).then(safeJson),
        fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/saldos-armazem`).then(safeJson),
      ]);
      setVeiculos(Array.isArray(v) ? v : []);
      setCatalogo(Array.isArray(c) ? c : []);
      setSaldosSecao(Array.isArray(s) ? s : []);
      setErro('');
    } catch (e) {
      console.error('Erro base:', e);
      setErro(`Erro a carregar dados iniciais: ${e.message}`);
      setVeiculos([]); setCatalogo([]); setSaldosSecao([]);
    }
  };

  const loadCofresEInventario = async (idVeic) => {
    try {
      const cof = await fetch(`${API}/veiculo/${idVeic}/cofres`).then(safeJson);
      const cofArr = Array.isArray(cof) ? cof : [];
      setCofres(cofArr);
      setCofreSel(cofArr[0]?.id_cofre != null ? String(cofArr[0].id_cofre) : '');
    } catch (e) {
      console.error('Erro cofres:', e);
      setCofres([]); setCofreSel('');
      setErro(`Erro a carregar cofres: ${e.message}`);
    }
    await refreshInventarioVeiculo(idVeic);
  };

  const refreshInventarioVeiculo = async (idVeic) => {
    setLoading(true);
    try {
      const data = await fetch(`${API}/veiculo/${idVeic}/inventario`).then(safeJson);
      setInvVeiculo(Array.isArray(data) ? data : []);
      setErro('');
    } catch (e) {
      console.error('Erro inventário veículo:', e);
      setInvVeiculo([]);
      setErro(`Falha ao carregar inventário do veículo: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadBase(); }, [secaoNome]);

  useEffect(() => {
    if (!veicSel) {
      setCofres([]); setCofreSel('');
      setInvVeiculo([]);
      setEquipAdd(''); setEquipRm('');
      return;
    }
    loadCofresEInventario(veicSel);
  }, [veicSel]);

  useEffect(() => {
    setEquipAdd('');
    setQtyAdd('1');
    setEquipRm('');
    setQtyRm('1');
  }, [cofreSel]);

  const invCofreSelecionado = useMemo(() => {
    return Array.isArray(invVeiculo)
      ? invVeiculo.filter(l => l?.id_cofre?.toString() === cofreSel)
      : [];
  }, [invVeiculo, cofreSel]);

  const saldoDisponivelSecao = (id_equip) =>
    (Array.isArray(saldosSecao) ? saldosSecao : []).find(s => s.id_equip === id_equip)?.qty ?? 0;

  const saldoNoCofre = (id_equip) =>
    (Array.isArray(invCofreSelecionado) ? invCofreSelecionado : []).find(l => l.id_equip === id_equip)?.qty ?? 0;

  const adicionarAoCofre = async (e) => {
    e.preventDefault();
    if (!veicSel || !cofreSel) return setErro('Escolha veículo e cofre.');
    const id_equip = Number.parseInt(equipAdd, 10);
    const qty = Number.parseInt(qtyAdd, 10);
    if (!Number.isInteger(id_equip) || !Number.isInteger(qty) || qty <= 0)
      return setErro('Selecione equipamento e quantidade válida (>0).');

    const disponivel = saldoDisponivelSecao(id_equip);
    if (qty > disponivel) return setErro(`Qtd maior que disponível na secção (${disponivel}).`);

    setErro('');
    try {
      const res = await fetch(`${API}/veiculo/${veicSel}/cofre/${cofreSel}/entrada`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_equip, qty })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setQtyAdd('1');
      const s = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/saldos-armazem`).then(safeJson);
      setSaldosSecao(Array.isArray(s) ? s : []);
      await refreshInventarioVeiculo(veicSel);
    } catch (e2) {
      setErro(`Falha ao adicionar: ${e2.message}`);
    }
  };

  const removerDoCofre = async (e) => {
    e.preventDefault();
    if (!veicSel || !cofreSel) return setErro('Escolha veículo e cofre.');
    const id_equip = Number.parseInt(equipRm, 10);
    const qty = Number.parseInt(qtyRm, 10);
    if (!Number.isInteger(id_equip) || !Number.isInteger(qty) || qty <= 0)
      return setErro('Selecione equipamento e quantidade válida (>0).');

    const disponivel = saldoNoCofre(id_equip);
    if (qty > disponivel) return setErro(`Qtd maior que disponível no cofre (${disponivel}).`);

    setErro('');
    try {
      const res = await fetch(`${API}/veiculo/${veicSel}/cofre/${cofreSel}/saida`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_equip, qty})
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const s = await fetch(`${API}/secao/${encodeURIComponent(secaoNome)}/saldos-armazem`).then(safeJson);
      setSaldosSecao(Array.isArray(s) ? s : []);
      await refreshInventarioVeiculo(veicSel);
    } catch (e2) {
      setErro(`Falha ao remover: ${e2.message}`);
    }
  };

  return (
    <div className="page">
      <h1>Inventário de Veículo</h1>

      <div className="entrada-form" style={{ flexWrap: 'wrap' }}>
        <select value={veicSel} onChange={(e) => setVeicSel(e.target.value)} required>
          <option value="">Escolhe um veículo…</option>
          {Array.isArray(veiculos) && veiculos.map(v => (
            <option key={v.id_veiculo} value={String(v.id_veiculo)}>{v.codigo}</option>
          ))}
        </select>
      </div>

      {erro && <p className="erro">{erro}</p>}
      {loading && <p>A carregar…</p>}

      {!!veicSel && !!cofreSel && (
        <>
          <h3>Adicionar do armazém da secção “{secaoNome}” → Cofre</h3>
          <form className="entrada-form" onSubmit={adicionarAoCofre}>
            <select value={equipAdd} onChange={(e) => setEquipAdd(e.target.value)} required>
              <option value="">Equipamento (disponível na secção)</option>
              {Array.isArray(saldosSecao) && saldosSecao.map(s => (
                <option key={s.id_equip} value={String(s.id_equip)}>
                  {s.nome} ({s.unidade}) — disp.: {s.qty}
                </option>
              ))}
            </select>
            <input type="number" min="1" step="1" value={qtyAdd}
                   onChange={(e) => setQtyAdd(e.target.value)} required />
            <select value={cofreSel} onChange={(e) => setCofreSel(e.target.value)} disabled={!veicSel}>
              <option value="">Escolhe um cofre…</option>
              {Array.isArray(cofres) && cofres.map(c => (
                <option key={c.id_cofre} value={String(c.id_cofre)}>{c.nome}</option>
              ))}
            </select>
            <button type="submit">Adicionar ao cofre</button>
          </form>

          <h3>Remover do Cofre → Armazém da secção</h3>
          <form className="entrada-form" onSubmit={removerDoCofre}>
            <select value={equipRm} onChange={(e) => setEquipRm(e.target.value)} required>
              <option value="">Equipamento no cofre</option>
              {Array.isArray(invCofreSelecionado) && invCofreSelecionado.map(l => (
                <option key={l.id_equip} value={String(l.id_equip)}>
                  {l.equipamento} ({l.unidade}) — no cofre: {l.qty}
                </option>
              ))}
            </select>
            <input placeholder='Quantidade' type="number" min="1" step="1" value={qtyRm}
                   onChange={(e) => setQtyRm(e.target.value)} required />
            <button type="submit">Remover do cofre</button>
          </form>

          <h3>Inventário atual do veículo</h3>
          <table className="tabela">
            <thead>
              <tr>
                <th>Cofre</th>
                <th>Equipamento</th>
                <th className="num">Qtd</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(invVeiculo) && invVeiculo.map((r, i) => (
                <tr key={`${r.id_cofre}-${r.id_equip}-${i}`}>
                  <td>{r.cofre}</td>
                  <td>{r.equipamento}</td>
                  <td className="num">{Number.isFinite(+r.qty) ? parseInt(r.qty, 10) : 0}</td>
                </tr>
              ))}
              {(!Array.isArray(invVeiculo) || invVeiculo.length === 0) && (
                <tr><td colSpan="4" className="muted">Sem dados</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
