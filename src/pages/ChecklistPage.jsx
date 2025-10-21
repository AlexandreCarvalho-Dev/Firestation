// src/pages/ChecklistPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../lib/api';      // <— caminho correto a partir de /pages
import './vehicle.css';

export default function ChecklistPage({ idVeiculo, codigoVeiculo, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  // { [id_equip]: { presente, falta, inop, qty, nome, cofre } }
  const [counts, setCounts] = useState({});

  useEffect(() => {
    setLoading(true);
    setErro('');
    fetch(`${API_BASE}/veiculo/${idVeiculo}/inventario`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(data => {
        setRows(data);
        const init = {};
        for (const x of data) {
          const qtyNum = Number(x.qty) || 0;
          init[x.id_equip] = {
            presente: qtyNum,
            falta: 0,
            inop: 0,
            qty: qtyNum,
            nome: x.equipamento,
            cofre: x.cofre
          };
        }
        setCounts(init);
      })
      .catch(e => setErro(e.message))
      .finally(() => setLoading(false));
  }, [idVeiculo]);

  // Agrupar por nome de cofre
  const porCofre = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.cofre)) map.set(r.cofre, []);
      map.get(r.cofre).push(r);
    }
    return Array.from(map.entries()); // [ [cofre, items], ... ]
  }, [rows]);

  // Ajuste com regras: sem negativos, soma == qty
  const adjust = (id_equip, field, delta) => {
    setCounts(prev => {
      const cur = prev[id_equip];
      if (!cur) return prev;

      const next = { ...cur, [field]: cur[field] + delta };
      next.presente = Math.max(0, next.presente);
      next.falta    = Math.max(0, next.falta);
      next.inop     = Math.max(0, next.inop);

      let sum = next.presente + next.falta + next.inop;

      if (sum > cur.qty) {
        // remover excesso dos outros campos (mantém o campo clicado)
        let overflow = sum - cur.qty;
        const order = ['falta', 'inop', 'presente'].filter(k => k !== field);
        for (const k of order) {
          if (overflow === 0) break;
          const take = Math.min(overflow, next[k]);
          next[k] -= take;
          overflow -= take;
        }
      } else if (sum < cur.qty) {
        // completa no presente
        next.presente = Math.min(cur.qty, next.presente + (cur.qty - sum));
      }
      return { ...prev, [id_equip]: next };
    });
  };

  const CellCtrls = ({ id_equip, field }) => (
    <div className="ctr">
      <button className="btn minus" onClick={() => adjust(id_equip, field, -1)}>-</button>
      <span className="num">{counts[id_equip]?.[field] ?? 0}</span>
      <button className="btn plus" onClick={() => adjust(id_equip, field, +1)}>+</button>
    </div>
  );

  const exportarChecklist = () => {
    const payload = Object.entries(counts).map(([id, c]) => ({
      id_equip: Number(id),
      cofre: c.cofre,
      presente: c.presente,
      falta: c.falta,
      inop: c.inop,
      qty: c.qty
    }));
    const blob = new Blob([JSON.stringify({
      veiculo: { id: idVeiculo, codigo: codigoVeiculo },
      data: payload
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checklist_${codigoVeiculo || idVeiculo}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="veh-page">
      <div className="veh-header">
        <button className="icon back" onClick={onBack} aria-label="Voltar">←</button>
        <h1>{codigoVeiculo || `Veículo ${idVeiculo}`}</h1>
        <button className="icon home" onClick={onBack} aria-label="Home">⌂</button>
      </div>

      {loading && <p className="muted">A carregar…</p>}
      {erro && <p className="erro">{erro}</p>}

      {!loading && porCofre.map(([cofre, items]) => (
        <section key={cofre} className="cofre">
          <h2>{cofre}</h2>
          <table className="inv">
            {/* colunas estáticas */}
            <colgroup>
              <col className="col-material" />
              <col className="col-qty" />
              <col className="col-ctrl" />
              <col className="col-ctrl" />
              <col className="col-ctrl" />
            </colgroup>
            <thead>
              <tr>
                <th>Material</th>
                <th className="num">Quantidade</th>
                <th>Presente</th>
                <th>Falta</th>
                <th>INOP</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id_equip}>
                  <td>{it.equipamento}</td>
                  {/* só número, sem unidade */}
                  <td className="num">{Number(it.qty) || 0}</td>
                  <td><CellCtrls id_equip={it.id_equip} field="presente" /></td>
                  <td><CellCtrls id_equip={it.id_equip} field="falta" /></td>
                  <td><CellCtrls id_equip={it.id_equip} field="inop" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {!loading && porCofre.length === 0 && (
        <p className="muted">Sem inventário associado a este veículo.</p>
      )}

      <div className="footer-actions">
        <button className="btn-secondary" onClick={onBack}>Cancelar</button>
        <button className="btn-primary" onClick={exportarChecklist}>Exportar JSON</button>
      </div>
    </div>
  );
}
