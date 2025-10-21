// server.js (Node 18+ com "type":"module" no package.json)
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

// ========================= App & Config =========================
const app = express();

const {
  NODE_ENV = "development",
  CLIENT_ORIGINS = "http://localhost:5173",
  JWT_SECRET = "muda-isto",
  DB_HOST = "localhost",
  DB_USER = "root",
  DB_PASS = "12345678",
  DB_NAME = "bombeiros",
} = process.env;

const IS_PROD = NODE_ENV === "production";

// ========================= CORS (melhor abordagem) =========================
// - Lê origens permitidas do .env (vírgulas)
// - Suporta localhost, 127.0.0.1 e outros que adicionares
// - Ecoa a origem aprovada e permite credenciais (cookies)
// - Preflight (OPTIONS) passa com allow headers/methods

const allowlist = CLIENT_ORIGINS.split(",")
  .map(s => s.trim())
  .filter(Boolean);

// helper opcional para permitir IPs da LAN (192.168.x.x:5173) em dev
function isLanDevOrigin(origin) {
  if (IS_PROD || !origin) return false;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" &&
           /^192\.168\.\d{1,3}\.\d{1,3}$/.test(u.hostname) &&
           (u.port === "5173" || u.port === "");
  } catch { return false; }
}

const corsOptions = {
  origin: (origin, callback) => {
    // Sem origin (Postman/cURL) → permitir
    if (!origin) return callback(null, true);
    if (allowlist.includes(origin) || isLanDevOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origem não permitida: ${origin}`));
  },
  credentials: true,
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
  ],
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  maxAge: 600, // cache do preflight (10 min)
};

app.use(cors(corsOptions));
// (opcional, mas explícito) responder preflight a tudo
app.options("*", cors(corsOptions));

// Body & Cookies
app.use(express.json());
app.use(cookieParser());

// Log simples
app.use((req, _res, next) => { console.log(`${req.method} ${req.path}`); next(); });

// ========================= DB =========================
const db = await mysql.createConnection({
  host: DB_HOST, user: DB_USER, password: DB_PASS, database: DB_NAME,
  multipleStatements: false
});

// ========================= Helpers DB =========================
async function getSecaoIdByNome(nome) {
  const [r] = await db.query("SELECT id_secao FROM secao WHERE nome=?", [nome]);
  return r?.[0]?.id_secao ?? null;
}
async function getLocArmazemIdBySecao(id_secao) {
  const [r] = await db.query(
    "SELECT id_local FROM localizacao WHERE tipo='SECAO' AND id_secao=? LIMIT 1",
    [id_secao]
  );
  return r?.[0]?.id_local ?? null;
}

// ========================= Auth (JWT em cookie httpOnly) =========================
const JWT_EXPIRES = "7d";

function signToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    nome: user.nome,
    apelido: user.apelido,
    graduacao: user.graduacao
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: IS_PROD ? "lax" : "lax",
    secure: IS_PROD, // em produção usa HTTPS
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: IS_PROD });
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ ok: false, error: "no_token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }
}

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

// ========================= Health =========================
app.get("/health", async (_req, res) => {
  try {
    const [[r]] = await db.query("SELECT 1 AS ok");
    res.json({ ok: r.ok === 1 });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ========================= Veículos =========================
app.get("/veiculo", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id_veiculo, codigo FROM veiculo WHERE ativo = 1 ORDER BY codigo"
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

app.get("/veiculo/:id/cofres", async (req, res) => {
  const idVeic = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(idVeic)) return res.status(400).json({ error:"id inválido" });
  try {
    const [rows] = await db.query(
      `SELECT c.id_cofre, c.nome
         FROM localizacao l
         JOIN cofre c ON c.id_cofre = l.id_cofre
        WHERE l.tipo='COFRE' AND l.id_veiculo=? 
        ORDER BY c.nome`,
      [idVeic]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

app.get("/veiculo/:id/inventario", async (req, res) => {
  const idVeic = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(idVeic)) return res.status(400).json({ error:"id inválido" });
  try {
    const [rows] = await db.query(
      `SELECT 
          c.id_cofre, c.nome AS cofre,
          e.id_equip, e.nome AS equipamento, e.unidade,
          CAST(s.qty AS UNSIGNED) AS qty
        FROM inventario_saldo s
        JOIN localizacao l ON l.id_local = s.id_local AND l.tipo='COFRE'
        JOIN cofre c       ON c.id_cofre = l.id_cofre
        JOIN equipamento e ON e.id_equip = s.id_equip
       WHERE l.id_veiculo = ?
       ORDER BY c.nome, e.nome`,
      [idVeic]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// ========================= Secção (Material) =========================
app.get("/secao/:nome/catalogo", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.id_equip, e.nome, e.unidade
         FROM equipamento e
        WHERE e.id_secao = (SELECT id_secao FROM secao WHERE nome = ?)
        ORDER BY e.nome`,
      [req.params.nome]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

app.get("/secao/:nome/saldos-armazem", async (req, res) => {
  try {
    const id_secao = await getSecaoIdByNome(req.params.nome);
    if (!id_secao) return res.json([]);
    const id_local = await getLocArmazemIdBySecao(id_secao);
    if (!id_local) return res.json([]);

    const [rows] = await db.query(
      `SELECT 
         e.id_equip, e.nome, e.unidade,
         CAST(s.qty AS UNSIGNED) AS qty
       FROM inventario_saldo s
       JOIN equipamento e ON e.id_equip = s.id_equip
      WHERE s.id_local = ?
      ORDER BY e.nome`,
      [id_local]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error:e.message }); }
});

app.get("/secao/:nome/inventario", async (req, res) => {
  try {
    const id_secao = await getSecaoIdByNome(req.params.nome);
    if (!id_secao) return res.json({ totais:[], breakdown:[] });

    const [totais] = await db.query(
      `SELECT e.nome AS equipamento, CAST(SUM(s.qty) AS UNSIGNED) AS total
         FROM inventario_saldo s
         JOIN localizacao l ON l.id_local = s.id_local
         JOIN equipamento  e ON e.id_equip = s.id_equip
        WHERE l.id_secao = ?
        GROUP BY e.id_equip, e.nome
        ORDER BY e.nome`,
      [id_secao]
    );

    const [breakdown] = await db.query(
      `SELECT 
         e.nome AS equipamento,
         l.tipo,
         COALESCE(v.codigo, '') AS veiculo,
         COALESCE(c.nome,   '') AS cofre,
         CAST(s.qty AS UNSIGNED) AS qty
       FROM inventario_saldo s
       JOIN localizacao l ON l.id_local = s.id_local
       JOIN equipamento  e ON e.id_equip = s.id_equip
       LEFT JOIN veiculo v ON v.id_veiculo = l.id_veiculo
       LEFT JOIN cofre   c ON c.id_cofre   = l.id_cofre
       WHERE l.id_secao = ?
       ORDER BY e.nome, l.tipo, veiculo, cofre`,
      [id_secao]
    );

    res.json({ totais, breakdown });
  } catch (e) { res.status(500).json({ error:e.message }); }
});

// ===== Entradas/Saídas do ARMAZÉM da secção =====
app.post("/secao/:nome/entrada", async (req, res) => {
  const nomeSecao = req.params.nome;
  const id_equip = Number.parseInt(req.body?.id_equip, 10);
  const qty = Number.parseInt(req.body?.qty, 10);
  if (!Number.isInteger(id_equip) || !Number.isInteger(qty) || qty <= 0)
    return res.status(400).json({ error:"id_equip e qty (inteiros > 0) são obrigatórios" });

  await db.beginTransaction();
  try {
    const id_secao = await getSecaoIdByNome(nomeSecao);
    if (!id_secao) throw new Error("Secção não encontrada");
    const id_local = await getLocArmazemIdBySecao(id_secao);
    if (!id_local) throw new Error("Armazém da secção não encontrado");

    await db.query(
      `INSERT INTO inventario_saldo (id_local, id_equip, qty)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [id_local, id_equip, qty]
    );
    try {
      await db.query(
        `INSERT INTO inventario_mov (id_equip, from_loc, to_loc, qty, nota)
         VALUES (?, NULL, ?, ?, 'Entrada em armazém da secção')`,
        [id_equip, id_local, qty]
      );
    } catch {}

    await db.commit();
    res.json({ success:true });
  } catch (e) { await db.rollback(); res.status(500).json({ error:e.message }); }
});

app.post("/secao/:nome/saida", async (req, res) => {
  const nomeSecao = req.params.nome;
  const id_equip = Number.parseInt(req.body?.id_equip, 10);
  const qty = Number.parseInt(req.body?.qty, 10);
  const motivo = (req.body?.motivo || '').toString().slice(0, 255);
  if (!Number.isInteger(id_equip) || !Number.isInteger(qty) || qty <= 0)
    return res.status(400).json({ error:"id_equip e qty (inteiros > 0) são obrigatórios" });

  await db.beginTransaction();
  try {
    const id_secao = await getSecaoIdByNome(nomeSecao);
    if (!id_secao) throw new Error("Secção não encontrada");
    const id_local = await getLocArmazemIdBySecao(id_secao);
    if (!id_local) throw new Error("Armazém da secção não encontrado");

    const [[saldo]] = await db.query(
      "SELECT qty FROM inventario_saldo WHERE id_local=? AND id_equip=? FOR UPDATE",
      [id_local, id_equip]
    );
    const disp = saldo?.qty ?? 0;
    if (disp < qty) throw new Error(`Quantidade insuficiente. Disponível: ${disp}`);

    await db.query(
      "UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?",
      [qty, id_local, id_equip]
    );
    await db.query(
      "DELETE FROM inventario_saldo WHERE id_local=? AND id_equip=? AND qty=0",
      [id_local, id_equip]
    );
    try {
      await db.query(
        `INSERT INTO inventario_mov (id_equip, from_loc, to_loc, qty, nota)
         VALUES (?, ?, NULL, ?, ?)`,
        [id_equip, id_local, qty, motivo || 'Saída de armazém da secção']
      );
    } catch {}

    await db.commit();
    res.json({ success:true });
  } catch (e) { await db.rollback(); res.status(400).json({ error:e.message }); }
});

// ===== Criar equipamento rápido =====
app.post("/secao/:nome/equipamento", async (req, res) => {
  const nomeSecao = req.params.nome;
  const { nome } = req.body || {};
  const qty = Number.parseInt(req.body?.qty, 10);
  const nr_serie = (req.body?.nr_serie ?? '').toString().trim();
  if (!nome || !Number.isInteger(qty) || qty <= 0)
    return res.status(400).json({ error:"Campos obrigatórios: nome e qty (inteiro > 0)" });

  await db.beginTransaction();
  try {
    const id_secao = await getSecaoIdByNome(nomeSecao);
    if (!id_secao) throw new Error("Secção não encontrada");
    const id_local = await getLocArmazemIdBySecao(id_secao);
    if (!id_local) throw new Error("Armazém da secção não encontrado");

    const [insEq] = await db.query(
      `INSERT INTO equipamento (nome, unidade, nr_serie_req, especificacao, id_secao)
       VALUES (?, 'un', 0, NULL, ?)
       ON DUPLICATE KEY UPDATE id_equip=LAST_INSERT_ID(id_equip)`,
      [nome, id_secao]
    );
    const idEquip = insEq.insertId;

    await db.query(
      `INSERT INTO inventario_saldo (id_local, id_equip, qty)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [id_local, idEquip, qty]
    );

    const notaBase = 'Criação + Entrada inicial';
    const nota = nr_serie ? `${notaBase} — Nr. série: ${nr_serie}` : notaBase;
    try {
      await db.query(
        `INSERT INTO inventario_mov (id_equip, from_loc, to_loc, qty, nota)
         VALUES (?, NULL, ?, ?, ?)`,
        [idEquip, id_local, qty, nota]
      );
    } catch {}

    await db.commit();
    res.json({ success:true, id_equip:idEquip });
  } catch (e) { await db.rollback(); res.status(500).json({ error:e.message }); }
});

// ===== Movimentos Secção ⇄ Cofre do Veículo =====
app.post("/veiculo/:id/cofre/:cofreId/entrada", async (req, res) => {
  const idVeic   = Number.parseInt(req.params.id, 10);
  const idCofre  = Number.parseInt(req.params.cofreId, 10);
  const id_equip = Number.parseInt(req.body?.id_equip, 10);
  const qty      = Number.parseInt(req.body?.qty, 10);
  if (![idVeic,idCofre,id_equip,qty].every(Number.isInteger) || qty <= 0)
    return res.status(400).json({ error:"Parâmetros inválidos" });

  await db.beginTransaction();
  try {
    const [[locCofre]] = await db.query(
      "SELECT id_local, id_secao FROM localizacao WHERE tipo='COFRE' AND id_veiculo=? AND id_cofre=? LIMIT 1",
      [idVeic, idCofre]
    );
    if (!locCofre) throw new Error("Cofre/Veículo não encontrado");

    const [[eq]] = await db.query("SELECT id_secao FROM equipamento WHERE id_equip=?", [id_equip]);
    if (!eq) throw new Error("Equipamento não encontrado");

    const [[locSecao]] = await db.query(
      "SELECT id_local FROM localizacao WHERE tipo='SECAO' AND id_secao=? LIMIT 1",
      [eq.id_secao]
    );
    if (!locSecao) throw new Error("Armazém da secção do equipamento não encontrado");

    const [[saldo]] = await db.query(
      "SELECT qty FROM inventario_saldo WHERE id_local=? AND id_equip=? FOR UPDATE",
      [locSecao.id_local, id_equip]
    );
    const disp = saldo?.qty ?? 0;
    if (disp < qty) throw new Error(`Quantidade insuficiente no armazém. Disponível: ${disp}`);

    await db.query(
      "UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?",
      [qty, locSecao.id_local, id_equip]
    );
    await db.query(
      "DELETE FROM inventario_saldo WHERE id_local=? AND id_equip=? AND qty=0",
      [locSecao.id_local, id_equip]
    );
    await db.query(
      `INSERT INTO inventario_saldo (id_local, id_equip, qty)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [locCofre.id_local, id_equip, qty]
    );
    try {
      await db.query(
        `INSERT INTO inventario_mov (id_equip, from_loc, to_loc, qty, nota)
         VALUES (?, ?, ?, ?, 'Secao → Cofre do Veículo')`,
        [id_equip, locSecao.id_local, locCofre.id_local, qty]
      );
    } catch {}

    await db.commit();
    res.json({ success:true });
  } catch (e) { await db.rollback(); res.status(400).json({ error:e.message }); }
});

app.post("/veiculo/:id/cofre/:cofreId/saida", async (req, res) => {
  const idVeic   = Number.parseInt(req.params.id, 10);
  const idCofre  = Number.parseInt(req.params.cofreId, 10);
  const id_equip = Number.parseInt(req.body?.id_equip, 10);
  const qty      = Number.parseInt(req.body?.qty, 10);
  const motivo   = (req.body?.motivo || '').toString().slice(0, 255);
  if (![idVeic,idCofre,id_equip,qty].every(Number.isInteger) || qty <= 0)
    return res.status(400).json({ error:"Parâmetros inválidos" });

  await db.beginTransaction();
  try {
    const [[locCofre]] = await db.query(
      "SELECT id_local FROM localizacao WHERE tipo='COFRE' AND id_veiculo=? AND id_cofre=? LIMIT 1",
      [idVeic, idCofre]
    );
    if (!locCofre) throw new Error("Cofre/Veículo não encontrado");

    const [[eq]] = await db.query("SELECT id_secao FROM equipamento WHERE id_equip=?", [id_equip]);
    if (!eq) throw new Error("Equipamento não encontrado");

    const [[locSecao]] = await db.query(
      "SELECT id_local FROM localizacao WHERE tipo='SECAO' AND id_secao=? LIMIT 1",
      [eq.id_secao]
    );
    if (!locSecao) throw new Error("Armazém da secção do equipamento não encontrado");

    const [[saldo]] = await db.query(
      "SELECT qty FROM inventario_saldo WHERE id_local=? AND id_equip=? FOR UPDATE",
      [locCofre.id_local, id_equip]
    );
    const disp = saldo?.qty ?? 0;
    if (disp < qty) throw new Error(`Quantidade no cofre insuficiente. Disponível: ${disp}`);

    await db.query(
      "UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?",
      [qty, locCofre.id_local, id_equip]
    );
    await db.query(
      "DELETE FROM inventario_saldo WHERE id_local=? AND id_equip=? AND qty=0",
      [locCofre.id_local, id_equip]
    );
    await db.query(
      `INSERT INTO inventario_saldo (id_local, id_equip, qty)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [locSecao.id_local, id_equip, qty]
    );
    try {
      await db.query(
        `INSERT INTO inventario_mov (id_equip, from_loc, to_loc, qty, nota)
         VALUES (?, ?, ?, ?, ?)`,
        [id_equip, locCofre.id_local, locSecao.id_local, qty, motivo || 'Cofre do Veículo → Secao']
      );
    } catch {}
    await db.commit();
    res.json({ success:true });
  } catch (e) { await db.rollback(); res.status(400).json({ error:e.message }); }
});

// ========================= LOGIN / ME / LOGOUT =========================
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      return res.status(400).json({ ok:false, error: 'missing_fields' });
    }

    const [rows] = await db.query(
      'SELECT id, nome, apelido, graduacao, username, password_hash FROM bombeiro WHERE username = ?',
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ ok:false, error: 'invalid_credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok:false, error: 'invalid_credentials' });

    const token = signToken(user);
    setAuthCookie(res, token);

    const { id, nome, apelido, graduacao } = user;
    res.json({ ok:true, user: { id, nome, apelido, graduacao, username } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error: 'server_error' });
  }
});

app.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// ========================= CREATE ACCOUNT =========================
app.post('/create', async (req, res) => {
  const {
    nome = '',
    sobrenome = '',
    username = '',
    password = '',
    graduacao = null,
    piquete = null,
    funcoes = []
  } = req.body || {};

  if (!nome.trim() || !sobrenome.trim() || !username.trim() || !password.trim()) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok:false, error:'weak_password' });
  }

  const apelido = sobrenome.trim();
  const nome_completo = `${nome.trim()} ${apelido}`;
  const password_hash = await bcrypt.hash(password, 10);

  await db.beginTransaction();
  try {
    const [userResult] = await db.query(
      `INSERT INTO bombeiro
         (nome, apelido, nome_completo, graduacao, piquete, username, password_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nome.trim(), apelido, nome_completo, graduacao, piquete, username.trim(), password_hash]
    );
    const bombeiroId = userResult.insertId;

    if (Array.isArray(funcoes) && funcoes.length) {
      for (const f of funcoes) {
        await db.query(`INSERT IGNORE INTO funcao (nome) VALUES (?)`, [f]);
      }
      const [rows] = await db.query(
        `SELECT id, nome FROM funcao WHERE nome IN (${funcoes.map(() => '?').join(',')})`,
        funcoes
      );
      if (rows.length) {
        const values = rows.map(r => [bombeiroId, r.id]);
        await db.query(`INSERT INTO bombeiro_funcao (id_bombeiro, id_funcao) VALUES ?`, [values]);
      }
    }

    await db.commit();
    return res.json({ ok: true, id: bombeiroId });
  } catch (e) {
    await db.rollback().catch(() => {});
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: 'username_already_exists' });
    }
    console.error('CREATE ERROR:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ========================= Start =========================
const PORT = 3001;
app.listen(PORT, () => console.log(`Servidor a correr em http://localhost:${PORT}`));
