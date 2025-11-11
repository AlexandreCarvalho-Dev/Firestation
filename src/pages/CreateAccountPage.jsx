// src/pages/CreateAccountPage.jsx
import { useState } from 'react';
const API_BASE = `http://${window.location.hostname}:3001`;
import './createaccount.css';

const OPCOES_FUNCOES = [
  'Motorista',
  'Motorista Pesados',
  'TAT',
  'TAS',
  'Responsável Secção de Material',
  'Responsável Secção de Saúde',
  'Responsável Secção de Fardamento',
  'Administrativo',
];

const OPCOES_GRADUACAO = [
  'Bombeiro 3ª',
  'Bombeiro 2ª',
  'Bombeiro 1ª',
  'Sub-Chefe',
  'Chefe',
  'Oficial Bombeiro',
  'Adjunto de Comando',
  '2ª Comandante',
  'Comandante',
];

const OPCOES_PIQUETE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export default function CreateAccountPage({ onBack, onCreated }) {
  const [nome, setNome] = useState('');
  const [apelido, setApelido] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [graduacao, setGraduacao] = useState(OPCOES_GRADUACAO[0]);
  const [piquete, setPiquete] = useState(OPCOES_PIQUETE[0]);
  const [funcoes, setFuncoes] = useState([]);
  const [selectedFuncao, setSelectedFuncao] = useState('');

  const [accountCreated, setAccountCreated] = useState(false);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  function addFuncao(e) {
    const valor = e.target.value;
    if (!valor) return;
    if (!funcoes.includes(valor)) setFuncoes(prev => [...prev, valor]);
    setSelectedFuncao(''); // volta ao placeholder
  }

  function removeFuncao(valor) {
    setFuncoes(prev => prev.filter(f => f !== valor));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    setAccountCreated(false);

    if (!nome.trim() || !apelido.trim() || !username.trim() || !password.trim()) {
      setErro('Preenche Nome, Sobrenome, Username e Password.');
      return;
    }
    if (password.length < 6) {
      setErro('Password deve ter pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        nome: nome.trim(),
        apelido: apelido.trim(), // backend espera "apelido"
        username: username.trim().toLowerCase(),
        password,
        graduacao,
        piquete,
        funcoes,
      };

      const r = await fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.ok) {
        if (data?.error === 'username_taken') {
          setErro('Esse username já está registado.');
        } else if (data?.error === 'missing_fields') {
          setErro('Campos em falta.');
        } else if (data?.error === 'weak_password') {
          setErro('Password demasiado curta.');
        } else {
          setErro(data?.error || 'Falha a criar conta.');
        }
        return;
      }

      setAccountCreated(true);
      setNome('');
      setApelido('');
      setUsername('');
      setPassword('');
      setGraduacao(OPCOES_GRADUACAO[0]);
      setPiquete(OPCOES_PIQUETE[0]);
      setFuncoes([]);

      onCreated?.(); // voltar ao login ou mostrar mensagem
    } catch {
      setErro('Erro de rede/servidor.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="create">
      <div className="create-header">
        <button type="button" className="back-btn" onClick={onBack}>← Voltar</button>
        <h2>Criar Conta</h2>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {erro && <p className="erro">{erro}</p>}
        {accountCreated && (
          <p className="ok">Conta criada com sucesso. Já podes iniciar sessão.</p>
        )}

        <div className="row">
          <input
            type="text"
            placeholder="Nome"
            value={nome}
            onChange={e => setNome(e.target.value)}
          />
          <input
            type="text"
            placeholder="Sobrenome"
            value={apelido}
            onChange={e => setApelido(e.target.value)}
          />
        </div>

        <div className="row">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        <div className="row">
          <select value={graduacao} onChange={e => setGraduacao(e.target.value)}>
            {OPCOES_GRADUACAO.map(g => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select value={piquete} onChange={e => setPiquete(e.target.value)}>
            {OPCOES_PIQUETE.map(p => (
              <option key={p} value={p}>
                Piquete {p}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <select value={selectedFuncao} onChange={addFuncao}>
            <option value="" disabled>
              — adicionar função —
            </option>
            {OPCOES_FUNCOES.map(f => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="tags">
          {funcoes.map(f => (
            <div className="tag" key={f}>
              <span className="tag-text">{f}</span>
              <button
                type="button"
                className="tag-close"
                onClick={() => removeFuncao(f)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="actions">
          <button className="submit" type="submit" disabled={loading}>
            {loading ? 'A criar…' : 'Criar conta'}
          </button>
          <button type="button" className="secondary" onClick={onBack}>
            Já tenho conta
          </button>
        </div>
      </form>
    </div>
  );
}
