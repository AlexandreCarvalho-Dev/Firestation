// server.js (Node 18+ com "type":"module" no package.json)
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import PDFDocument from "pdfkit"; // <-- PDF
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

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
  PORT = 3001
} = process.env;

const IS_PROD = NODE_ENV === "production";

// ====== Storage local para PDFs ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, "storage", "checklists");
await fsp.mkdir(STORAGE_DIR, { recursive: true });

// ========================= CORS =========================
const allowlist = CLIENT_ORIGINS.split(",").map(s => s.trim()).filter(Boolean);
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
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowlist.includes(origin) || isLanDevOrigin(origin)) return cb(null, true);
    return cb(new Error(`CORS: origem não permitida: ${origin}`));
  },
  credentials: true,
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With"],
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  maxAge: 600,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
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
async function getCofreLocalId(idVeic, idCofre) {
  const [[r]] = await db.query(
    "SELECT id_local FROM localizacao WHERE tipo='COFRE' AND id_veiculo=? AND id_cofre=? LIMIT 1",
    [idVeic, idCofre]
  );
  return r?.id_local ?? null;
}

// ========================= Auth (JWT em cookie httpOnly) =========================
const JWT_EXPIRES = "7d";
function signToken(user) {
  const payload = { id: user.id, username: user.username, nome: user.nome, apelido: user.apelido, graduacao: user.graduacao };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function setAuthCookie(res, token) {
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: 7*24*60*60*1000 });
}
function clearAuthCookie(res) {
  res.clearCookie("token", { httpOnly: true, sameSite: "lax", secure: IS_PROD });
}
function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ ok:false, error:"no_token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ ok:false, error:"invalid_token" }); }
}
const loginLimiter = rateLimit({ windowMs: 10*60*1000, max: 20, standardHeaders: true, legacyHeaders: false });

// ========================= Health =========================
app.get("/health", async (_req, res) => {
  try { const [[r]] = await db.query("SELECT 1 AS ok"); res.json({ ok: r.ok === 1 }); }
  catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});

// ========================= Veículos =========================
app.get("/veiculo", async (_req, res) => {
  try {
    const [rows] = await db.query("SELECT id_veiculo, codigo FROM veiculo WHERE ativo = 1 ORDER BY codigo");
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

// ===== Entradas/Saídas do ARMAZÉM da secção (exemplos) =====
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

    await db.commit();
    res.json({ success:true });
  } catch (e) { await db.rollback(); res.status(500).json({ error:e.message }); }
});

// ========================= Checklists (NOVO) =========================

// util: gerar e guardar PDF em disco + atualizar caminho na BD
async function gerarPdfChecklist(chkId, cab, linhas) {
  const filename = `checklist_${chkId}.pdf`;
  const filepath = path.join(STORAGE_DIR, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const out = fs.createWriteStream(filepath);
    out.on('finish', resolve);
    out.on('error', reject);
    doc.pipe(out);

    doc.fontSize(16).text('Checklist de Verificação de Veículo', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`ID: ${cab.id}`);
    doc.text(`Veículo: ${cab.veiculo}`);
    doc.text(`Data: ${new Date(cab.created_at).toLocaleString('pt-PT')}`);
    doc.text(`Responsável: ${cab.autor} ${cab.autor_apelido || ''}`.trim());
    if (cab.observacoes) doc.text(`Observações: ${cab.observacoes}`);
    doc.moveDown(0.6);

    doc.fontSize(11).text('Cofre            Equipamento                                 Pres.  Falta  INOP');
    doc.moveTo(36, doc.y + 2).lineTo(559, doc.y + 2).stroke();

    const fmt = (s, n) => (s.length > n ? s.slice(0, n-1) + '…' : s).padEnd(n, ' ');
    for (const r of linhas) {
      const linha =
        `${fmt(r.cofre,14)}  ${fmt(r.equipamento,40)}  ` +
        `${String(r.presente).padStart(4,' ')}  ` +
        `${String(r.falta).padStart(5,' ')}  ` +
        `${String(r.inop).padStart(4,' ')}`;
      doc.fontSize(10).text(linha);
      if (doc.y > 760) doc.addPage();
    }

    doc.end();
  });

  await db.query(
    `UPDATE checklist SET pdf_path=?, status='closed', closed_at=IFNULL(closed_at, CURRENT_TIMESTAMP) WHERE id=?`,
    [filename, chkId]
  );
  return filepath;
}

// POST /checklists  (usa o payload do UI: { id_veiculo, itens: [{ id_cofre, id_equip, presente, falta, inop }] })
app.post('/checklists', requireAuth, async (req, res) => {
  const id_veiculo = Number.parseInt(req.body?.id_veiculo, 10);
  const observacoes = (req.body?.observacoes || '').toString().slice(0,500);
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!Number.isInteger(id_veiculo) || itens.length === 0) {
    return res.status(400).json({ ok:false, error:'invalid_payload' });
  }

  await db.beginTransaction();
  try {
    const [ins] = await db.query(
      `INSERT INTO checklist (id_veiculo, id_bombeiro, observacoes, status) VALUES (?,?,?,'closed')`,
      [id_veiculo, req.user.id, observacoes]
    );
    const chkId = ins.insertId;

    // agrega possíveis duplicados por (id_local, id_equip)
    const agg = new Map();
    for (const it of itens) {
      const id_cofre = Number.parseInt(it.id_cofre, 10);
      const id_equip = Number.parseInt(it.id_equip, 10);
      if (![id_cofre, id_equip].every(Number.isInteger)) throw new Error('id_cofre/id_equip inválidos');

      const id_local = await getCofreLocalId(id_veiculo, id_cofre);
      if (!id_local) throw new Error('cofre/localização não encontrado');

      const p = Math.max(0, Number(it.presente ?? 0));
      const f = Math.max(0, Number(it.falta ?? 0));
      const i = Math.max(0, Number(it.inop ?? 0));

      const k = `${id_local}:${id_equip}`;
      const cur = agg.get(k) || { p:0, f:0, i:0, id_local, id_equip };
      cur.p += p; cur.f += f; cur.i += i;
      agg.set(k, cur);
    }

    const rows = [...agg.values()].map(x => [chkId, x.id_local, x.id_equip, x.p, x.f, x.i]);
    if (rows.length === 0) throw new Error('sem linhas');

    await db.query(
      `INSERT INTO checklist_item (id_checklist, id_local, id_equip, presente, falta, inop) VALUES ?`,
      [rows]
    );

    await db.query(`UPDATE checklist SET closed_at = CURRENT_TIMESTAMP WHERE id=?`, [chkId]);
    await db.commit();

    // Buscar dados para PDF e gerar/guardar ficheiro
    const [[cab]] = await db.query(
      `SELECT c.id, c.created_at, c.closed_at, c.observacoes,
              v.codigo AS veiculo, b.nome AS autor, b.apelido AS autor_apelido
         FROM checklist c
         JOIN veiculo v ON v.id_veiculo = c.id_veiculo
         JOIN bombeiro b ON b.id = c.id_bombeiro
        WHERE c.id=?`,
      [chkId]
    );
    const [rowsForPdf] = await db.query(
      `SELECT e.nome AS equipamento, e.unidade, c.nome AS cofre,
              chki.presente, chki.falta, chki.inop
         FROM checklist_item chki
         JOIN localizacao l ON l.id_local = chki.id_local
         JOIN cofre c       ON c.id_cofre = l.id_cofre
         JOIN equipamento e ON e.id_equip = chki.id_equip
        WHERE chki.id_checklist = ?
        ORDER BY c.nome, e.nome`,
      [chkId]
    );
    await gerarPdfChecklist(chkId, cab, rowsForPdf);

    console.log('CHECKLIST criada', { chkId, linhas: rows.length });
    res.json({ ok:true, id: chkId, pdf: `/checklists/${chkId}/pdf` });
  } catch (e) {
    await db.rollback().catch(()=>{});
    console.error('ERRO /checklists:', e);
    res.status(400).json({ ok:false, error: e.message });
  }
});

// GET /checklists (listagem)
app.get('/checklists', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const idV = req.query.id_veiculo ? Number.parseInt(req.query.id_veiculo,10) : null;
  const where = [];
  const params = [];
  if (from) { where.push('c.created_at >= ?'); params.push(from + ' 00:00:00'); }
  if (to)   { where.push('c.created_at <= ?'); params.push(to   + ' 23:59:59'); }
  if (idV)  { where.push('c.id_veiculo = ?');  params.push(idV); }
  const sql = `SELECT c.id, c.created_at, c.closed_at, c.status, v.codigo AS veiculo, b.nome AS autor
               FROM checklist c
               JOIN veiculo v ON v.id_veiculo = c.id_veiculo
               JOIN bombeiro b ON b.id = c.id_bombeiro
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY c.created_at DESC
               LIMIT 200`;
  const [rows] = await db.query(sql, params);
  res.json(rows);
});

// GET /checklists/:id (detalhe)
app.get('/checklists/:id', requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id,10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok:false, error:'invalid_id' });

  const [[cab]] = await db.query(
    `SELECT c.id, c.created_at, c.closed_at, c.observacoes, c.status, c.pdf_path,
            v.codigo AS veiculo, b.nome AS autor, b.apelido AS autor_apelido
       FROM checklist c
       JOIN veiculo v ON v.id_veiculo = c.id_veiculo
       JOIN bombeiro b ON b.id = c.id_bombeiro
      WHERE c.id=?`,
    [id]
  );
  if (!cab) return res.status(404).json({ ok:false, error:'not_found' });

  const [itens] = await db.query(
    `SELECT e.nome AS equipamento, e.unidade, c.nome AS cofre,
            chki.presente, chki.falta, chki.inop
       FROM checklist_item chki
       JOIN localizacao l ON l.id_local = chki.id_local
       JOIN cofre c       ON c.id_cofre = l.id_cofre
       JOIN equipamento e ON e.id_equip = chki.id_equip
      WHERE chki.id_checklist = ?
      ORDER BY c.nome, e.nome`,
    [id]
  );

  res.json({ ...cab, itens });
});

// GET /checklists/:id/pdf (serve do disco; se faltar, regenera)
app.get('/checklists/:id/pdf', requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id,10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok:false, error:'invalid_id' });
  console.log('PDF pedido para checklist', id, 'por', req.user?.username);

  const [[cab]] = await db.query(
    `SELECT c.id, c.created_at, c.closed_at, c.observacoes, c.pdf_path,
            v.codigo AS veiculo, b.nome AS autor, b.apelido AS autor_apelido
       FROM checklist c
       JOIN veiculo v ON v.id_veiculo = c.id_veiculo
       JOIN bombeiro b ON b.id = c.id_bombeiro
      WHERE c.id=?`,
    [id]
  );
  if (!cab) {
    console.warn('PDF 404: checklist não encontrada', id);
    return res.status(404).json({ ok:false, error:'not_found' });
  }

  const filename = cab.pdf_path || `checklist_${id}.pdf`;
  const filepath = path.join(STORAGE_DIR, filename);

  try {
    await fsp.access(filepath, fs.constants.R_OK);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${path.basename(filename)}`);
    return fs.createReadStream(filepath).pipe(res);
  } catch {}

  const [rows] = await db.query(
    `SELECT e.nome AS equipamento, e.unidade, c.nome AS cofre,
            chki.presente, chki.falta, chki.inop
       FROM checklist_item chki
       JOIN localizacao l ON l.id_local = chki.id_local
       JOIN cofre c       ON c.id_cofre = l.id_cofre
       JOIN equipamento e ON e.id_equip = chki.id_equip
      WHERE chki.id_checklist = ?
      ORDER BY c.nome, e.nome`,
    [id]
  );

  const regeneratedPath = await gerarPdfChecklist(id, cab, rows);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=${path.basename(regeneratedPath)}`);
  return fs.createReadStream(regeneratedPath).pipe(res);
});

// ========================= LOGIN / ME / LOGOUT =========================
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) return res.status(400).json({ ok:false, error: 'missing_fields' });
    const [rows] = await db.query('SELECT id, nome, apelido, graduacao, username, password_hash FROM bombeiro WHERE username = ?', [username]);
    if (rows.length === 0) return res.status(401).json({ ok:false, error: 'invalid_credentials' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok:false, error: 'invalid_credentials' });
    const token = signToken(user); setAuthCookie(res, token);
    const { id, nome, apelido, graduacao } = user;
    res.json({ ok:true, user: { id, nome, apelido, graduacao, username } });
  } catch (e) { console.error(e); res.status(500).json({ ok:false, error: 'server_error' }); }
});
app.get('/me', requireAuth, (req, res) => { res.json({ ok: true, user: req.user }); });
app.post('/logout', (_req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

// ========================= CREATE ACCOUNT =========================
app.post('/create', async (req, res) => {
  const { nome = '', sobrenome = '', username = '', password = '', graduacao = null, piquete = null, funcoes = [] } = req.body || {};
  if (!nome.trim() || !sobrenome.trim() || !username.trim() || !password.trim()) return res.status(400).json({ ok: false, error: 'missing_fields' });
  if (password.length < 6) return res.status(400).json({ ok:false, error:'weak_password' });
  const apelido = sobrenome.trim();
  const nome_completo = `${nome.trim()} ${apelido}`;
  const password_hash = await bcrypt.hash(password, 10);
  await db.beginTransaction();
  try {
    const [userResult] = await db.query(
      `INSERT INTO bombeiro (nome, apelido, nome_completo, graduacao, piquete, username, password_hash) VALUES (?,?,?,?,?,?,?)`,
      [nome.trim(), apelido, nome_completo, graduacao, piquete, username.trim(), password_hash]
    );
    const bombeiroId = userResult.insertId;
    if (Array.isArray(funcoes) && funcoes.length) {
      for (const f of funcoes) await db.query(`INSERT IGNORE INTO funcao (nome) VALUES (?)`, [f]);
      const [rows] = await db.query(`SELECT id, nome FROM funcao WHERE nome IN (${funcoes.map(()=>'?').join(',')})`, funcoes);
      if (rows.length) {
        const values = rows.map(r => [bombeiroId, r.id]);
        await db.query(`INSERT INTO bombeiro_funcao (id_bombeiro, id_funcao) VALUES ?`, [values]);
      }
    }
    await db.commit();
    return res.json({ ok: true, id: bombeiroId });
  } catch (e) {
    await db.rollback().catch(()=>{});
    if (e?.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: 'username_already_exists' });
    console.error('CREATE ERROR:', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// ========================= Start =========================
app.listen(Number(PORT), () => console.log(`Servidor a correr em http://localhost:${PORT}`));
