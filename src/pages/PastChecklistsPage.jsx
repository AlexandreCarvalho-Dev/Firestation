// src/pages/PastChecklistsPage.jsx
import { useEffect, useState } from "react";
import { API_BASE } from "../lib/api";
import "./pastchecklistpage.css";

export default function PastChecklistsPage({ onBack }) {
  const [veiculos, setVeiculos] = useState([]);
  const [idVeiculo, setIdVeiculo] = useState("");
  const [from, setFrom] = useState(""); // YYYY-MM-DD
  const [to, setTo] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/veiculo`)
      .then((r) => r.json())
      .then(setVeiculos)
      .catch(() => {});
  }, []);

  async function load() {
    try {
      setLoading(true);
      setErro("");
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (idVeiculo) params.set("id_veiculo", idVeiculo);

      const r = await fetch(`${API_BASE}/checklists?${params.toString()}`, {
        credentials: "include",
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || `HTTP ${r.status}`);
      }
      setRows(await r.json());
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }

  function abrirPDF(id) {
    window.open(`${API_BASE}/checklists/${id}/pdf`, "_blank");
  }

  async function verDetalhe(id) {
    try {
      const r = await fetch(`${API_BASE}/checklists/${id}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      alert(
        `Checklist #${d.id}\nVeículo: ${d.veiculo}\nData: ${new Date(
          d.created_at
        ).toLocaleString("pt-PT")}\nItens: ${d.itens.length}`
      );
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <div className="past-page">
      <div className="toolbar">
        <button onClick={onBack}>Voltar</button>
        <h2>Listas Anteriores</h2>

        <div className="filters">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            title="De"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            title="Até"
          />
          <select
            value={idVeiculo}
            onChange={(e) => setIdVeiculo(e.target.value)}
            title="Veículo"
          >
            <option value="">Todos os veículos</option>
            {veiculos.map((v) => (
              <option key={v.id_veiculo} value={v.id_veiculo}>
                {v.codigo}
              </option>
            ))}
          </select>
          <button onClick={load} disabled={loading}>
            {loading ? "A carregar..." : "Pesquisar"}
          </button>
        </div>
      </div>

      {erro && <p className="erro">{erro}</p>}

      <div className="panel">
        <table className="tabela">
          <thead>
            <tr>
              <th>ID</th>
              <th>Data</th>
              <th>Veículo</th>
              <th>Responsável</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>
                  {new Date(r.created_at).toLocaleString("pt-PT", {
                    hour12: false,
                  })}
                </td>
                <td>{r.veiculo}</td>
                <td>{r.autor}</td>
                <td>
                  <button onClick={() => verDetalhe(r.id)}>Detalhe</button>
                  <button onClick={() => abrirPDF(r.id)}>Abrir PDF</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: "center" }}>
                  Sem resultados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
