// src/pages/ChecklistPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../lib/api';
import './vehicle.css';

export default function ChecklistPage({ idVeiculo, codigoVeiculo, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  // Estado por (cofre:id_equip)
  // Guardamos: baseQty (da API), falta (int), manutencao (int)
  const [counts, setCounts] = useState({});
  const keyFor = (r) => `${r.id_cofre}:${r.id_equip}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErro('');
        const r = await fetch(`${API_BASE}/veiculo/${idVeiculo}/inventario`);
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b?.error || `HTTP ${r.status}`);
        }
        const data = await r.json();
        if (!alive) return;

        setRows(data);
        const init = {};
        for (const row of data) {
          const base = Number(row.qty ?? 0);
          init[keyFor(row)] = { baseQty: base, falta: 0, manutencao: 0 };
        }
        setCounts(init);
      } catch (e) {
        if (alive) setErro(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [idVeiculo]);

  const porCofre = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r.cofre)) m.set(r.cofre, []);
      m.get(r.cofre).push(r);
    }
    return [...m.entries()];
  }, [rows]);

  function patchLinha(r, fn) {
    const k = keyFor(r);
    setCounts(prev => {
      const cur = prev[k] || { baseQty: Number(r.qty ?? 0), falta: 0, manutencao: 0 };
      const next = fn({ ...cur });

      // clamps: 0 ≤ falta ≤ base; 0 ≤ manutencao; e (falta + manutencao) ≤ base
      next.falta = Math.max(0, Math.min(next.falta, next.baseQty));
      next.manutencao = Math.max(0, next.manutencao | 0);

      const totalOut = next.falta + next.manutencao;
      if (totalOut > next.baseQty) {
        // reduzir preferência em manutencao
        const excesso = totalOut - next.baseQty;
        const tiraMan = Math.min(excesso, next.manutencao);
        next.manutencao -= tiraMan;
        const resto = excesso - tiraMan;
        if (resto > 0) next.falta = Math.max(0, next.falta - resto);
      }
      return { ...prev, [k]: next };
    });
  }

  const getPresente = (k) => {
    const c = counts[k];
    if (!c) return 0;
    // Agora: Presente = base - Falta - Manutenção
    const p = c.baseQty - c.falta - c.manutencao;
    return Math.max(0, Math.min(c.baseQty, p));
  };

  // Payload: { id_cofre, id_equip, presente, falta, manutencao }
  function toItemsPayload() {
    const itens = [];
    for (const r of rows) {
      const k = keyFor(r);
      const c = counts[k];
      if (!c) continue;
      itens.push({
        id_cofre: r.id_cofre,
        id_equip: r.id_equip,
        presente: getPresente(k),
        falta: c.falta,
        manutencao: c.manutencao,
      });
    }
    return itens;
  }

  async function handleGuardarPDF() {
    try {
      setLoading(true);
      setErro('');
      const body = { id_veiculo: idVeiculo, itens: toItemsPayload() };
      const r = await fetch(`${API_BASE}/checklists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || `HTTP ${r.status}`);
      }
      const data = await r.json();
      window.open(`${API_BASE}/checklists/${data.id}/pdf`, '_blank');
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (loading && rows.length === 0) {
    return (
      <div className="veh-page">
        <div className="veh-header">
          <button className="icon" onClick={onBack} aria-label="Voltar">←</button>
          <h1>{codigoVeiculo || `Veículo #${idVeiculo}`}</h1>
          <button className="btn-primary save-btn" disabled>Guardar e PDF</button>
        </div>
        <p className="muted">A carregar…</p>
      </div>
    );
  }

  return (
    <div className="veh-page">
      <div className="veh-header">
        <button className="icon" onClick={onBack} aria-label="Voltar">←</button>
        <h1>{codigoVeiculo || `Veículo #${idVeiculo}`}</h1>
        <button
          className="btn-primary save-btn"
          id='save'
          onClick={handleGuardarPDF}
          disabled={rows.length === 0 || loading}
          title="Guardar e gerar PDF"
        >
          Guardar e PDF
        </button>
      </div>

      {erro && <p className="erro">{erro}</p>}

      {porCofre.map(([cofre, linhas]) => (
        <div className="cofre" key={cofre}>
          <h3>{cofre}</h3>

          <table className="inv">
            <colgroup>
              <col className="col-material" />
              <col className="col-presente" />
              <col className="col-falta" />
              <col className="col-manut" />
            </colgroup>
            <thead>
              <tr>
                <th>Material</th>
                <th>Presente</th>
                <th>Falta</th>
                <th>Manutenção</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(r => {
                const k = keyFor(r);
                const c = counts[k] || { baseQty: Number(r.qty ?? 0), falta: 0, manutencao: 0 };
                const presente = getPresente(k);

                const incFalta = () => patchLinha(r, cur => ({ ...cur, falta: Math.min(cur.falta + 1, cur.baseQty) }));
                const decFalta = () => patchLinha(r, cur => ({ ...cur, falta: Math.max(0, cur.falta - 1) }));
                const incMan   = () => patchLinha(r, cur => ({ ...cur, manutencao: cur.manutencao + 1 }));
                const decMan   = () => patchLinha(r, cur => ({ ...cur, manutencao: Math.max(0, cur.manutencao - 1) }));

                const disableIncFalta = c.falta + c.manutencao >= c.baseQty;
                const disableIncMan   = c.falta + c.manutencao >= c.baseQty;

                return (
                  <tr key={k}>
                    <td>
                      {r.equipamento} <span className="muted">({r.unidade})</span>
                    </td>

                    {/* Presente (read-only) */}
                    <td className="num">
                      <input className="qty-input readonly" readOnly value={presente} />
                    </td>

                    {/* Falta */}
                    <td className="num">
                      <div className="stepper">
                        <button type="button" className="step-btn" onClick={decFalta} aria-label="Diminuir falta">−</button>
                        <span className="step-val">{c.falta}</span>
                        <button type="button" className="step-btn" onClick={incFalta} aria-label="Aumentar falta" disabled={disableIncFalta}>+</button>
                      </div>
                    </td>

                    {/* Manutenção */}
                    <td className="num">
                      <div className="stepper">
                        <button type="button" className="step-btn" onClick={decMan} aria-label="Diminuir manutenção">−</button>
                        <span className="step-val">{c.manutencao}</span>
                        <button type="button" className="step-btn" onClick={incMan} aria-label="Aumentar manutenção" disabled={disableIncMan}>+</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
