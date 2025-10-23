// src/pages/ChecklistPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../lib/api';
import './vehicle.css';

export default function ChecklistPage({ idVeiculo, codigoVeiculo, onBack }) {
  const [rows, setRows] = useState([]);          // linhas vindas da API (por cofre)
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  // Estado por (cofre:id_equip) → chave `${id_cofre}:${id_equip}`
  // Guardamos: baseQty (da API), falta, inop
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
          init[keyFor(row)] = { baseQty: base, falta: 0, inop: 0 };
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
      const cur = prev[k] || { baseQty: Number(r.qty ?? 0), falta: 0, inop: 0 };
      const next = fn({ ...cur });
      // clamp para garantir 0 <= falta+inop <= baseQty
      const totalOut = Math.min(next.baseQty, Math.max(0, next.falta + next.inop));
      const excesso = totalOut - (next.falta + next.inop);
      if (excesso !== 0) {
        // se por alguma razão passou do limite, ajusta INOP por último
        if (excesso < 0) {
          // reduzir
          const reduzir = -excesso;
          const tiraInop = Math.min(reduzir, next.inop);
          next.inop -= tiraInop;
          const faltaRest = reduzir - tiraInop;
          if (faltaRest > 0) next.falta = Math.max(0, next.falta - faltaRest);
        }
      }
      return { ...prev, [k]: next };
    });
  }

  const getPresente = (k) => {
    const c = counts[k];
    if (!c) return 0;
    const p = c.baseQty - c.falta - c.inop;
    return Math.max(0, Math.min(c.baseQty, p));
  };

  // Payload novo: { id_cofre, id_equip, presente, falta, inop }
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
        inop: c.inop,
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
      {/* Header fixo */}
      <div className="veh-header">
        <button className="icon" onClick={onBack} aria-label="Voltar">←</button>
        <h1>{codigoVeiculo || `Veículo #${idVeiculo}`}</h1>
        <button
          className="btn-primary save-btn"
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
              <col className="col-inop" />
            </colgroup>
            <thead>
              <tr>
                <th>Material</th>
                <th>Presente</th>
                <th>Falta</th>
                <th>INOP</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map(r => {
                const k = keyFor(r);
                const c = counts[k] || { baseQty: Number(r.qty ?? 0), falta: 0, inop: 0 };
                const presente = getPresente(k);

                const inc = (tipo) => patchLinha(r, cur => {
                  if (cur.falta + cur.inop >= cur.baseQty) return cur; // já não há para tirar do presente
                  return { ...cur, [tipo]: cur[tipo] + 1 };
                });
                const dec = (tipo) => patchLinha(r, cur => ({ ...cur, [tipo]: Math.max(0, cur[tipo] - 1) }));

                return (
                  <tr key={k}>
                    <td>
                      {r.equipamento} <span className="muted">({r.unidade})</span>
                    </td>

                    {/* Presente (read-only) */}
                    <td className="num">
                      <input className="qty-input readonly" readOnly value={presente} />
                      <span className="muted small">/ {c.baseQty}</span>
                    </td>

                    {/* Falta */}
                    <td className="num">
                      <div className="stepper">
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => dec('falta')}
                          aria-label="Diminuir falta"
                        >−</button>
                        <span className="step-val">{c.falta}</span>
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => inc('falta')}
                          aria-label="Aumentar falta"
                          disabled={c.falta + c.inop >= c.baseQty}
                        >+</button>
                      </div>
                    </td>

                    {/* INOP */}
                    <td className="num">
                      <div className="stepper">
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => dec('inop')}
                          aria-label="Diminuir INOP"
                        >−</button>
                        <span className="step-val">{c.inop}</span>
                        <button
                          type="button"
                          className="step-btn"
                          onClick={() => inc('inop')}
                          aria-label="Aumentar INOP"
                          disabled={c.falta + c.inop >= c.baseQty}
                        >+</button>
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
