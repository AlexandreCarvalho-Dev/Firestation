// src/pages/ReposicaoPage.jsx
import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../lib/api";
import "./reposicao.css";

export default function ReposicaoPage({ onBack /* idVeiculo (ignorado de propósito) */ }) {
  const [rows, setRows] = useState([]);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState(""); // só pesquisa local opcional

  async function load() {
    try {
      setLoading(true);
      setErro("");
      // Carrega sempre tudo (sem filtros): todos os itens em Falta/INOP do último checklist por veículo
      const r = await fetch(`${API_BASE}/reposicao`, { credentials: "include" });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const b = await r.json(); if (b?.error) msg += ` - ${b.error}`; } catch {}
        throw new Error(msg);
      }
      const data = await r.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setErro(e.message || "Falha a carregar reposição");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.veiculo || "").toLowerCase().includes(q) ||
      (r.cofre || "").toLowerCase().includes(q) ||
      (r.equipamento || "").toLowerCase().includes(q)
    );
  }, [rows, busca]);

  return (
    <div className="reposicao-wrap">
      <div className="repos-header">
        <h2>Reposição de Materiais (Faltas / INOP)</h2>
        <div className="actions">
          <button className="btn" onClick={onBack}>Voltar</button>
          <button className="btn primary" onClick={load} disabled={loading}>
            {loading ? "A atualizar..." : "Atualizar"}
          </button>
        </div>
      </div>

      {/* Pesquisa local opcional (não é filtro de backend) */}
      <div className="topbar">
        <input
          className="search"
          placeholder="Procurar por veículo, cofre ou equipamento…"
          value={busca}
          onChange={e=>setBusca(e.target.value)}
        />
      </div>

      {erro && <div className="erro">{erro}</div>}

      <div className="table-wrap no-hscroll">
        <table className="repo-table compact">
          <thead>
            <tr>
              <th className="col-veic">Veículo</th>
              <th className="col-cofre">Cofre</th>
              <th className="col-equip">Equipamento</th>
              <th className="col-num">Falta</th>
              <th className="col-num">INOP</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan="5" className="empty">Sem itens em falta/INOP.</td>
              </tr>
            )}
            {filtradas.map((r, i) => (
              <tr key={`${r.id_checklist}:${r.id_equip}:${r.id_cofre}:${i}`}>
                <td className="wrap">{r.veiculo}</td>
                <td className="wrap">{r.cofre}</td>
                <td className="wrap">{r.equipamento}</td>
                <td className={`col-num ${Number(r.falta) > 0 ? "neg" : ""}`}>{r.falta}</td>
                <td className={`col-num ${Number(r.inop) > 0 ? "warn" : ""}`}>{r.inop}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">
        Mostrando automaticamente todos os itens com Falta ou INOP do último checklist por veículo.
      </p>
    </div>
  );
}
