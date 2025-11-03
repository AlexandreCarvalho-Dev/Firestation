// src/pages/ReposicaoPage.jsx
import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "../lib/api";
import "./reposicao.css";

function Modal({
  open, onClose, row,
  qty, setQty,
  reporFrom, setReporFrom,
  onInop, onRepor, onProcesso
}) {
  if (!open || !row) return null;

  const inop = Number(row.inop) || 0;
  const falta = Number(row.falta) || 0;
  const manut = Number(row.manutencao) || 0;

  // Máximos por origem
  const maxByFrom = {
    inop,
    falta,
    manutencao: manut
  };

  // Normaliza qty ao alterar manualmente (UI; backend também capa)
  const currentMax = maxByFrom[reporFrom] || Math.max(inop, falta, manut, 1);
  const normalizedQty = Math.max(1, Math.min(Number(qty) || 1, currentMax || 1));

  const hasInop = inop > 0;
  const hasFalta = falta > 0;
  const hasMan = manut > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3>Decisão</h3>
        <p className="muted">
          {row.veiculo} • {row.cofre} • {row.equipamento}
        </p>

        <div className="kv">
          <div><strong>Falta:</strong> {falta}</div>
          <div><strong>Manut.:</strong> {manut}</div>
          <div><strong>INOP:</strong> {inop}</div>
        </div>

        <div className="mt">
          <label className="lbl">Quantidade</label>
          <input
            type="number"
            min={1}
            step={1}
            value={normalizedQty}
            onChange={(e)=> setQty(parseInt(e.target.value || "0", 10))}
            className="qty-input"
          />
          <p className="hint small">Máx. para origem selecionada: {currentMax || 0}</p>
        </div>

        {/* Origem para REPOR: só mostra se houver mais do que uma opção disponível */}
        {(hasInop + hasFalta + hasMan > 1) && (
          <div className="mt">
            <div className="lbl">Repor a partir de</div>
            <div className="radio-group">
              <label className={`radio ${!hasInop ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="reporFrom"
                  value="inop"
                  checked={reporFrom === 'inop'}
                  onChange={()=> hasInop && setReporFrom('inop')}
                  disabled={!hasInop}
                />
                INOP ({inop})
              </label>
              <label className={`radio ${!hasFalta ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="reporFrom"
                  value="falta"
                  checked={reporFrom === 'falta'}
                  onChange={()=> hasFalta && setReporFrom('falta')}
                  disabled={!hasFalta}
                />
                Falta ({falta})
              </label>
              <label className={`radio ${!hasMan ? 'disabled' : ''}`}>
                <input
                  type="radio"
                  name="reporFrom"
                  value="manutencao"
                  checked={reporFrom === 'manutencao'}
                  onChange={()=> hasMan && setReporFrom('manutencao')}
                  disabled={!hasMan}
                />
                Manut. ({manut})
              </label>
            </div>
          </div>
        )}

        <div className="btn-row mt">
          <button
            className="btn danger"
            onClick={()=> onInop(Math.min(qty||1, manut))}
            disabled={manut === 0}
            title="Mover Manutenção → INOP"
          >
            INOP
          </button>

          <button
            className="btn success"
            onClick={()=> onRepor(Math.min(qty||1, currentMax))}
            disabled={currentMax === 0}
            title="Repor a partir da origem selecionada"
          >
            Reposto
          </button>

          <button className="btn" onClick={onProcesso}>Em processo</button>
        </div>

        <button className="icon close-x" onClick={onClose} aria-label="Fechar">×</button>
      </div>
    </div>
  );
}

function EstadoStack({ r }) {
  const blocks = [];
  if (Number(r.inop) > 0) blocks.push(<span key="inop" className="badge badge-inop">INOP</span>);
  if (Number(r.falta) > 0) blocks.push(<span key="falta" className="badge badge-falta">Falta {r.falta}</span>);
  if (Number(r.manutencao) > 0 && Number(r.inop) === 0) {
    blocks.push(<span key="man" className="badge badge-manut">Manut. {r.manutencao}</span>);
  }
  return blocks.length ? <div className="state-stack">{blocks}</div> : <span>—</span>;
}

export default function ReposicaoPage({ onBack }) {
  const [rows, setRows] = useState([]);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState("");

  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [reporFrom, setReporFrom] = useState('inop'); // 'inop' | 'falta' | 'manutencao'

  async function load() {
    try {
      setLoading(true);
      setErro("");
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

  function openRow(row) {
    setSel(row);
    // default reporFrom: prefer INOP, depois Falta, depois Manut.
    const inop = Number(row.inop) || 0;
    const falta = Number(row.falta) || 0;
    const manut = Number(row.manutencao) || 0;
    const defFrom = inop > 0 ? 'inop' : (falta > 0 ? 'falta' : 'manutencao');
    setReporFrom(defFrom);
    const max = Math.max(inop, falta, manut, 1);
    setQty(max);
    setOpen(true);
  }
  function closeModal() { setOpen(false); setSel(null); }

  async function decidir(tipo, sendQty) {
    if (!sel) return;
    try {
      const body = {
        id_veiculo: sel.id_veiculo,
        id_cofre: sel.id_cofre,
        id_equip: sel.id_equip,
        decidir: tipo, // 'inop' | 'repor'
        qty: Math.max(1, parseInt(sendQty,10) || 1),
      };
      // Para "Reposto" enviamos a origem escolhida, para "INOP" não é preciso
      if (tipo === 'repor') body.from = reporFrom;

      const resp = await fetch(`${API_BASE}/reposicao/decidir`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const e = await resp.json().catch(()=> ({}));
        throw new Error(e?.error || `HTTP ${resp.status}`);
      }
      closeModal();
      await load();
    } catch (e) {
      setErro(e.message || 'Falha ao decidir');
    }
  }

  return (
    <div className="reposicao-wrap">
      <div className="repos-header">
        <h2>Reposição de Materiais</h2>
        <div className="actions">
          <button className="btn" onClick={onBack}>Voltar</button>
          <button className="btn primary" onClick={load} disabled={loading}>
            {loading ? "A atualizar..." : "Atualizar"}
          </button>
        </div>
      </div>

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
              <th className="col-estado">Estado</th>
            </tr>
          </thead>
            <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan="4" className="empty">Sem itens para repor/decidir.</td>
              </tr>
            )}
            {filtradas.map((r, i) => (
              <tr
                key={`${r.id_veiculo}:${r.id_cofre}:${r.id_equip}:${i}`}
                className="row-click"
                onClick={() => openRow(r)}
                title="Clicar para decidir (INOP / Reposto / Em processo)"
              >
                <td className="wrap">{r.veiculo}</td>
                <td className="wrap">{r.cofre}</td>
                <td className="wrap">{r.equipamento}</td>
                <td className="wrap"><EstadoStack r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      <Modal
        open={open}
        row={sel}
        qty={qty}
        setQty={setQty}
        reporFrom={reporFrom}
        setReporFrom={setReporFrom}
        onClose={closeModal}
        onInop={(q)=> decidir('inop', q)}     // move Manut. → INOP
        onRepor={(q)=> decidir('repor', q)}   // repõe da origem selecionada
        onProcesso={closeModal}
      />
    </div>
  );
}
