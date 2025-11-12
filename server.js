// server.js
import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import PDFDocument from "pdfkit";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const app = express();
app.set("trust proxy", 1);

const {
  NODE_ENV = "development",
  CLIENT_ORIGINS = "https://app.bombeirosdealges.pt,http://192.168.1.101:5173",
  JWT_SECRET = "muda-isto",
  DB_HOST = "localhost",
  DB_USER = "root",
  DB_PASS = "12345678",
  DB_NAME = "bombeiros",
  PORT = 3001,
} = process.env;

const IS_PROD = NODE_ENV === "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STORAGE_DIR = path.join(__dirname, "storage", "checklists");
await fsp.mkdir(STORAGE_DIR, { recursive: true });

const allowlist = CLIENT_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
function isLanDevOrigin(origin) {
  if (IS_PROD || !origin) return false;
  try {
    const u = new URL(origin);
    const isHttp = u.protocol === "http:";
    const isLocal = ["localhost","127.0.0.1","192.168.1.101","192.168.1.90"].includes(u.hostname);
    const isPort = u.port === "5173" || u.port === "";
    return isHttp && isLocal && isPort;
  } catch {
    return false;
  }
}

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowlist.includes(origin) || isLanDevOrigin(origin)) return cb(null, true);
    return cb(new Error(`CORS: origem não permitida: ${origin}`));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  maxAge: 600,
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

const db = await mysql.createConnection({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASS,
  database: DB_NAME,
  multipleStatements: false,
});

async function getSecaoPools(id_secao) {
  const [rows] = await db.query(
    `SELECT id_local, tipo
       FROM localizacao
      WHERE id_secao=? AND tipo IN ('SECAO','SECAO_MAN','SECAO_INOP')`,
    [id_secao]
  );
  const by = Object.fromEntries(rows.map(r => [r.tipo, r.id_local]));
  return { id_SECAO: by.SECAO || null, id_MAN: by.SECAO_MAN || null, id_INOP: by.SECAO_INOP || null };
}

async function ensureSecaoPools(id_secao) {
  // lê existentes
  const [rows] = await db.query(
    `SELECT id_local, tipo FROM localizacao
      WHERE id_secao=? AND tipo IN ('SECAO','SECAO_MAN','SECAO_INOP')`,
    [id_secao]
  );
  const by = Object.fromEntries(rows.map(r => [r.tipo, r.id_local]));
  let id_SECAO = by.SECAO || null;
  let id_MAN   = by.SECAO_MAN || null;
  let id_INOP  = by.SECAO_INOP || null;

  if (!id_SECAO) {
    const [ins] = await db.query(
      `INSERT INTO localizacao (tipo, id_secao, nome) VALUES ('SECAO', ?, 'Armazém')`,
      [id_secao]
    );
    id_SECAO = ins.insertId;
  }
  if (!id_MAN) {
    const [ins] = await db.query(
      `INSERT INTO localizacao (tipo, id_secao, nome) VALUES ('SECAO_MAN', ?, 'Armazém (Manut.)')`,
      [id_secao]
    );
    id_MAN = ins.insertId;
  }
  if (!id_INOP) {
    const [ins] = await db.query(
      `INSERT INTO localizacao (tipo, id_secao, nome) VALUES ('SECAO_INOP', ?, 'Armazém (INOP)')`,
      [id_secao]
    );
    id_INOP = ins.insertId;
  }
  return { id_SECAO, id_MAN, id_INOP };
}



/* ========================= Helpers DB ========================= */
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
async function getQtyForUpdate(id_local, id_equip) {
  const [[row]] = await db.query(
    `SELECT qty FROM inventario_saldo WHERE id_local=? AND id_equip=? FOR UPDATE`,
    [id_local, id_equip]
  );
  return row?.qty ?? 0;
}
async function ensureSaldoRow(id_local, id_equip) {
  await db.query(
    `INSERT IGNORE INTO inventario_saldo (id_local, id_equip, qty) VALUES (?, ?, 0)`,
    [id_local, id_equip]
  );
}

async function resolveSecaoIdForCofreEquip(id_local_cofre, id_equip) {
  const [[row]] = await db.query(
    `SELECT COALESCE(l.id_secao, e.id_secao) AS id_secao
       FROM localizacao l
       LEFT JOIN equipamento e ON e.id_equip = ?
      WHERE l.id_local = ?
      LIMIT 1`,
    [id_equip, id_local_cofre]
  );
  return row?.id_secao ?? null;
}


/* ========================= Auth (JWT) ========================= */
const JWT_EXPIRES = "7d";
function signToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    nome: user.nome,
    apelido: user.apelido,
    graduacao: user.graduacao,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PROD,
    maxAge: 7 * 24 * 60 * 60 * 1000,
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
  legacyHeaders: false,
});

async function ensureArmazemLocalBySecaoId(id_secao) {
  const [[row]] = await db.query(
    "SELECT id_local FROM localizacao WHERE tipo='SECAO' AND id_secao=? LIMIT 1",
    [id_secao]
  );
  if (row?.id_local) return row.id_local;

  const [ins] = await db.query(
    "INSERT INTO localizacao (tipo, id_secao) VALUES ('SECAO', ?)",
    [id_secao]
  );
  return ins.insertId;
}


/* === Helper: regra de admin === */
async function isUserAdmin(userId) {
  const [[row]] = await db.query(
    `
    SELECT COUNT(*) AS n
      FROM bombeiro_funcao bf
      JOIN funcao f ON f.id = bf.id_funcao
     WHERE bf.id_bombeiro = ?
       AND (
         f.nome COLLATE utf8mb4_0900_ai_ci LIKE 'administrativ%'
         OR (
           f.nome COLLATE utf8mb4_0900_ai_ci LIKE 'responsavel%'
           AND f.nome COLLATE utf8mb4_0900_ai_ci LIKE '%sec%'
           AND f.nome COLLATE utf8mb4_0900_ai_ci LIKE '%material%'
         )
       )
    `,
    [userId]
  );
  return (row?.n || 0) > 0;
}

/* ========================= Health ========================= */
app.get("/health", async (_req, res) => {
  try {
    const [[r]] = await db.query("SELECT 1 AS ok");
    res.json({ ok: r.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ========================= Veículos ========================= */
app.get("/veiculo", async (_req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id_veiculo, codigo FROM veiculo WHERE ativo = 1 ORDER BY codigo"
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/veiculo/:id/cofres", async (req, res) => {
  const idVeic = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(idVeic)) return res.status(400).json({ error: "id inválido" });
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/veiculo/:id/inventario", async (req, res) => {
  const idVeic = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(idVeic)) return res.status(400).json({ error: "id inválido" });
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ========================= Movimentos ========================= */
app.post("/veiculo/:id/cofre/:cofreId/entrada", async (req, res) => {
  const idVeic = Number.parseInt(req.params.id, 10);
  const idCofre = Number.parseInt(req.params.cofreId, 10);
  const id_equip = Number.parseInt(req.body?.id_equip, 10);
  const qty = Number.parseInt(req.body?.qty, 10);
  if (![idVeic, idCofre, id_equip, qty].every(Number.isInteger) || qty <= 0)
    return res.status(400).json({ ok: false, error: "payload_invalido" });

  await db.beginTransaction();
  try {
    const id_local_cofre = await getCofreLocalId(idVeic, idCofre);
    if (!id_local_cofre) throw new Error("cofre_nao_encontrado");
    const [[equip]] = await db.query(`SELECT id_secao FROM equipamento WHERE id_equip=?`, [id_equip]);
    if (!equip?.id_secao) throw new Error("equipamento_nao_encontrado");
    const id_local_armazem = await getLocArmazemIdBySecao(equip.id_secao);
    if (!id_local_armazem) throw new Error("armazem_secao_nao_encontrado");

    await ensureSaldoRow(id_local_armazem, id_equip);
    await ensureSaldoRow(id_local_cofre, id_equip);

    const disponivel = await getQtyForUpdate(id_local_armazem, id_equip);
    if (qty > disponivel) throw new Error(`sem_stock_armazem:${disponivel}`);

    await db.query(
      `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
      [qty, id_local_armazem, id_equip]
    );
    await db.query(
      `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
      [qty, id_local_cofre, id_equip]
    );

    await db.commit();
    return res.json({ ok: true });
  } catch (e) {
    await db.rollback().catch(() => {});
    return res.status(400).json({ ok: false, error: e.message || "erro_movimento" });
  }
});

app.post("/veiculo/:id/cofre/:cofreId/saida", async (req, res) => {
  const idVeic = Number.parseInt(req.params.id, 10);
  const idCofre = Number.parseInt(req.params.cofreId, 10);
  const id_equip = Number.parseInt(req.body?.id_equip, 10);
  const qty = Number.parseInt(req.body?.qty, 10);
  if (![idVeic, idCofre, id_equip, qty].every(Number.isInteger) || qty <= 0)
    return res.status(400).json({ ok: false, error: "payload_invalido" });

  await db.beginTransaction();
  try {
    const id_local_cofre = await getCofreLocalId(idVeic, idCofre);
    if (!id_local_cofre) throw new Error("cofre_nao_encontrado");
    const [[equip]] = await db.query(`SELECT id_secao FROM equipamento WHERE id_equip=?`, [id_equip]);
    if (!equip?.id_secao) throw new Error("equipamento_nao_encontrado");
    const id_local_armazem = await getLocArmazemIdBySecao(equip.id_secao);
    if (!id_local_armazem) throw new Error("armazem_secao_nao_encontrado");

    await ensureSaldoRow(id_local_cofre, id_equip);
    await ensureSaldoRow(id_local_armazem, id_equip);

    const noCofre = await getQtyForUpdate(id_local_cofre, id_equip);
    if (qty > noCofre) throw new Error(`sem_stock_cofre:${noCofre}`);

    await db.query(
      `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
      [qty, id_local_cofre, id_equip]
    );
    await db.query(
      `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
      [qty, id_local_armazem, id_equip]
    );

    await db.commit();
    return res.json({ ok: true });
  } catch (e) {
    await db.rollback().catch(() => {});
    return res.status(400).json({ ok: false, error: e.message || "erro_movimento" });
  }
});

/* ========================= Secção (Material) ========================= */
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/secao/:nome/inventario", async (req, res) => {
  try {
    const id_secao = await getSecaoIdByNome(req.params.nome);
    if (!id_secao) return res.json({ totais: [], breakdown: [] });

    const { id_SECAO, id_MAN, id_INOP } = await ensureSecaoPools(id_secao);

    // Totais por equipamento (normal, manut, inop)
    const [totais] = await db.query(
      `
      SELECT
        e.id_equip,
        e.nome AS equipamento,
        e.unidade,
        CAST(SUM(CASE WHEN s.id_local = ? THEN s.qty ELSE 0 END) AS UNSIGNED) AS total_normal,
        CAST(SUM(CASE WHEN s.id_local = ? THEN s.qty ELSE 0 END) AS UNSIGNED) AS total_manut,
        CAST(SUM(CASE WHEN s.id_local = ? THEN s.qty ELSE 0 END) AS UNSIGNED) AS total_inop
      FROM equipamento e
      LEFT JOIN inventario_saldo s
             ON s.id_equip = e.id_equip
      LEFT JOIN localizacao l
             ON l.id_local = s.id_local
      WHERE e.id_secao = ?
      GROUP BY e.id_equip, e.nome, e.unidade
      ORDER BY e.nome
      `,
      [id_SECAO, id_MAN, id_INOP, id_secao]
    );

  // --- Breakdown: 1 linha SECAO por equipamento + todas as linhas COFRE ---
  const [breakdown] = await db.query(
    `
    SELECT 
      e.nome AS equipamento,
      'SECAO' AS tipo,
      '' AS veiculo,
      '' AS cofre,
      CAST(COALESCE(s0.qty,0) AS UNSIGNED) AS qty,
      CAST(COALESCE(sman.qty,0) AS UNSIGNED) AS manutencao,
      CAST(COALESCE(sinop.qty,0) AS UNSIGNED) AS inop
    FROM equipamento e
    LEFT JOIN inventario_saldo s0   ON s0.id_equip = e.id_equip AND s0.id_local   = ?
    LEFT JOIN inventario_saldo sman ON sman.id_equip = e.id_equip AND sman.id_local = ?
    LEFT JOIN inventario_saldo sinop ON sinop.id_equip = e.id_equip AND sinop.id_local = ?
    WHERE e.id_secao = ?

    UNION ALL

    SELECT 
      e.nome AS equipamento,
      l.tipo,
      COALESCE(v.codigo,'') AS veiculo,
      COALESCE(c.nome,'')   AS cofre,
      CAST(s.qty AS UNSIGNED) AS qty,
      0 AS manutencao,
      0 AS inop
    FROM inventario_saldo s
    JOIN localizacao l ON l.id_local = s.id_local AND l.tipo = 'COFRE'
    JOIN equipamento  e ON e.id_equip = s.id_equip
    LEFT JOIN veiculo v ON v.id_veiculo = l.id_veiculo
    LEFT JOIN cofre   c ON c.id_cofre   = l.id_cofre
    WHERE l.id_secao = ?

    ORDER BY equipamento,
            CASE WHEN tipo='SECAO' THEN 0 ELSE 1 END,
            veiculo, cofre
    `,
    [id_SECAO, id_MAN, id_INOP, id_secao, id_secao]
  );




    res.json({ totais, breakdown });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


/* ========================= PDF Helpers ========================= */
function fmtPT(d) {
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}, ${p(dt.getHours())}:${p(
    dt.getMinutes()
  )}:${p(dt.getSeconds())}`;
}
function drawHeader(doc, meta, logoPath = null) {
  const left = 42;
  const top = 36;
  const right = doc.page.width - 42;

  if (logoPath) {
    try {
      doc.image(logoPath, left, top - 4, { width: 60 });
    } catch {}
  }

  doc.font("Helvetica-Bold").fontSize(16).text("Checklist de Verificação de Veículo", left, top, {
    width: right - left,
    align: "center",
  });

  doc.moveDown(0.6);
  doc.font("Helvetica").fontSize(10);
  const lh = 14;
  let y = top + 28;
  doc.text(`ID: ${meta.id}`, left, y);           y += lh;
  doc.text(`Veículo: ${meta.veiculo}`, left, y); y += lh;
  doc.text(`Data: ${fmtPT(meta.created_at)}`, left, y); y += lh;
  if (meta.autor || meta.autor_apelido) {
    doc.text(`Responsável: ${(meta.autor || "")} ${(meta.autor_apelido || "")}`.trim(), left, y);
    y += lh;
  }
  const sepY = y + 6;
  doc.moveTo(left, sepY).lineTo(right, sepY).lineWidth(0.7).strokeColor("#444").stroke();
  return sepY + 12;
}

/* ======= PDF: geração corrigida ======= */
async function gerarPdfChecklist(chkId, cab, linhas) {
  const filename = `checklist_${chkId}.pdf`;
  const filepath = path.join(STORAGE_DIR, filename);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 36, left: 42, right: 42, bottom: 48 },
      autoFirstPage: false,
      bufferPages: true,
      compress: true,
    });

    const out = fs.createWriteStream(filepath);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.pipe(out);

    const cols = [
      { header: "Cofre",        accessor: "cofre",        width: 100, padL: 8, padR: 8 },
      { header: "Equipamento",  accessor: "equipamento",  width: 270, padL: 8, padR: 8 },
      { header: "Pres.",        accessor: r => r.presente ?? 0,    width: 60, padL: 8, padR: 8, align: "right" },
      { header: "Falta",        accessor: r => r.falta ?? 0,       width: 60, padL: 8, padR: 8, align: "right" },
      { header: "Manut.",       accessor: r => r.manutencao ?? 0,  width: 70, padL: 8, padR: 8, align: "right" },
    ];

    const headerH = 22;
    const left = () => doc.page.margins.left;
    const usableBottom = () => doc.page.height - doc.page.margins.bottom - 2;

    function newPage() {
      doc.addPage();
      return drawHeader(doc, cab);
    }

    function paintHeaderRow(y0) {
      const x = left();
      const tableW = cols.reduce((s, c) => s + c.width, 0);
      doc.save();
      doc.rect(x, y0, tableW, headerH).fill("#f0f2f5").restore();
      doc.lineWidth(0.7).strokeColor("#d1d5db")
        .moveTo(x, y0 + headerH).lineTo(x + tableW, y0 + headerH).stroke();

      let acc = x;
      cols.forEach(c => {
        const tx = acc + c.padL;
        const tw = c.width - c.padL - c.padR;
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827")
          .text(c.header, tx, y0 + 6, { width: tw, ellipsis: true });
        acc += c.width;
      });
    }

    function drawTable(rows, yStart) {
      const xs = [];
      const x0 = left();
      xs.push(x0);
      for (let i = 1; i < cols.length; i++) xs.push(xs[i - 1] + cols[i - 1].width);
      const tableW = cols.reduce((s, c) => s + c.width, 0);

      function measureRowHeight(row) {
        let maxH = 0;
        cols.forEach(c => {
          const val = typeof c.accessor === "function" ? c.accessor(row) : row[c.accessor];
          const str = String(val ?? "");
          const width = c.width - c.padL - c.padR;
          doc.font("Helvetica").fontSize(10);
          const h = doc.heightOfString(str, { width, align: c.align || "left" });
          maxH = Math.max(maxH, h);
        });
        return Math.max(22, Math.ceil(maxH) + 12);
      }

      let y = yStart;
      paintHeaderRow(y);
      y += headerH;

      rows.forEach((r, idx) => {
        const rowH = measureRowHeight(r);

        if (y + rowH > usableBottom()) {
          const ny = newPage();
          paintHeaderRow(ny);
          y = ny + headerH;
        }

        if (idx % 2 === 0) {
          doc.save();
          doc.rect(left(), y, tableW, rowH).fill("#fafafa").restore();
        }

        cols.forEach((c, i) => {
          const tx = xs[i] + c.padL;
          const tw = c.width - c.padL - c.padR;
          const val = typeof c.accessor === "function" ? c.accessor(r) : r[c.accessor];
          doc.font("Helvetica").fontSize(10).fillColor("#0f172a")
            .text(String(val ?? ""), tx, y + 6, {
              width: tw,
              align: c.align || "left",
              ellipsis: false,
            });
        });

        doc.lineWidth(0.5).strokeColor("#e5e7eb")
          .moveTo(left(), y + rowH).lineTo(left() + tableW, y + rowH).stroke();

        y += rowH;
      });
    }

    const yStart = newPage();
    drawTable(linhas, yStart);

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const { width, height, margins } = doc.page;
      doc.font("Helvetica").fontSize(9).fillColor("#666")
        .text(`Página ${i + 1}`, margins.left, height - 36, {
          width: width - margins.left - margins.right,
          align: "right",
        });
    }

    doc.end();
  });

  await db.query(
    `UPDATE checklist SET pdf_path=?, status='closed', closed_at=IFNULL(closed_at, CURRENT_TIMESTAMP) WHERE id=?`,
    [filename, chkId]
  );

  return filepath;
}


/* ========================= Checklists ========================= */
app.post("/checklists", requireAuth, async (req, res) => {
  const id_veiculo = Number.parseInt(req.body?.id_veiculo, 10);
  const observacoes = (req.body?.observacoes || "").toString().slice(0, 500);
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];

  if (!Number.isInteger(id_veiculo) || itens.length === 0) {
    return res.status(400).json({ ok: false, error: "invalid_payload" });
  }

  await db.beginTransaction();
  try {
    // 1) Cabeçalho
    const [ins] = await db.query(
      `INSERT INTO checklist (id_veiculo, id_bombeiro, observacoes, status)
       VALUES (?,?,?,'closed')`,
      [id_veiculo, req.user.id, observacoes]
    );
    const chkId = ins.insertId;

    // 2) Agregar por (id_local do cofre, id_equip)
    //    Cada item vindo do FE tem: id_cofre, id_equip, presente, falta, manutencao
    const agg = new Map();
    for (const it of itens) {
      const id_cofre = Number.parseInt(it.id_cofre, 10);
      const id_equip = Number.parseInt(it.id_equip, 10);
      if (![id_cofre, id_equip].every(Number.isInteger)) {
        throw new Error("id_cofre/id_equip inválidos");
      }

      const id_local = await getCofreLocalId(id_veiculo, id_cofre);
      if (!id_local) throw new Error("cofre/localização não encontrado");

      const p = Math.max(0, Number(it.presente ?? 0));
      const f = Math.max(0, Number(it.falta ?? 0));
      const m = Math.max(0, Number(it.manutencao ?? 0));

      const k = `${id_local}:${id_equip}`;
      const cur = agg.get(k) || { id_local, id_equip, p: 0, f: 0, m: 0 };
      cur.p += p;
      cur.f += f;
      cur.m += m;
      agg.set(k, cur);
    }

    // 3) Persistir linhas de checklist (histórico)
    const rows = [...agg.values()].map((x) => [
      chkId, x.id_local, x.id_equip, x.p, x.f, x.m, 0 // presente, falta, manutencao, inop
    ]);
    if (rows.length === 0) throw new Error("sem linhas");
    await db.query(
      `INSERT INTO checklist_item
      (id_checklist, id_local, id_equip, presente, falta, manutencao, inop)
      VALUES ?`,
      [rows]
    );

    // 4) Aplicar deltas ao stock real
    //    - Debita do COFRE até ao máximo disponível
    //    - Da parte debitada: cobre primeiro "falta"; o remanescente é "manutenção"
    //      que vai para a piscina SECAO_MAN da secção a que pertence o cofre.
    for (const x of agg.values()) {
      const id_local_cofre = x.id_local;
      const id_equip = x.id_equip;
      const falta = x.f || 0;
      const manut = x.m || 0;

      const pretendidoTirar = falta + manut;
      if (pretendidoTirar <= 0) continue;

      await ensureSaldoRow(id_local_cofre, id_equip);

      const disponivelCofre = await getQtyForUpdate(id_local_cofre, id_equip); // FOR UPDATE
      const efetivoDebitar = Math.min(disponivelCofre, pretendidoTirar);

      if (efetivoDebitar > 0) {
        // debita do cofre
        await db.query(
          `UPDATE inventario_saldo
             SET qty = qty - ?
           WHERE id_local=? AND id_equip=?`,
          [efetivoDebitar, id_local_cofre, id_equip]
        );
      }

      // Distribuição do debitado: primeiro cobre 'falta'; o resto é 'manutenção'
      const faltaEfetiva = Math.min(falta, efetivoDebitar);
      const manutEfetivaQueVolta = Math.max(0, efetivoDebitar - faltaEfetiva);

      if (manutEfetivaQueVolta > 0) {
        // descobrir a secção pelo local do cofre
        const [[loc]] = await db.query(
          `SELECT id_secao FROM localizacao WHERE id_local=?`,
          [id_local_cofre]
        );
        // ... mantém as variáveis calculadas acima (id_local_cofre, id_equip, falta, manut)
        const id_secao = await resolveSecaoIdForCofreEquip(id_local_cofre, id_equip);
        if (id_secao) {
          const { id_MAN } = await ensureSecaoPools(id_secao);
          await ensureSaldoRow(id_MAN, id_equip);
          if (manutEfetivaQueVolta > 0) {
            await db.query(
              `UPDATE inventario_saldo
                SET qty = qty + ?
              WHERE id_local=? AND id_equip=?`,
              [manutEfetivaQueVolta, id_MAN, id_equip]
            );
          }
        }
      }
    }

    // 5) Fechar + PDF
    await db.query(
      `UPDATE checklist SET closed_at = CURRENT_TIMESTAMP WHERE id=?`,
      [chkId]
    );

    await db.commit();

    // Gera PDF fora da TX (já commitado)
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
              chki.presente, chki.falta, chki.inop, chki.manutencao
         FROM checklist_item chki
         JOIN localizacao l ON l.id_local = chki.id_local
         JOIN cofre c       ON c.id_cofre = l.id_cofre
         JOIN equipamento e ON e.id_equip = chki.id_equip
        WHERE chki.id_checklist = ?
        ORDER BY c.nome, e.nome`,
      [chkId]
    );

    await gerarPdfChecklist(chkId, cab, rowsForPdf);

    return res.json({ ok: true, id: chkId, pdf: `/checklists/${chkId}/pdf` });
  } catch (e) {
    await db.rollback().catch(() => {});
    console.error("ERRO /checklists:", e);
    return res.status(400).json({ ok: false, error: e.message || "error" });
  }
});



app.get("/checklists", requireAuth, async (req, res) => {
  const { from, to } = req.query;
  const idV = req.query.id_veiculo ? Number.parseInt(req.query.id_veiculo, 10) : null;
  const where = [];
  const params = [];
  if (from) {
    where.push("c.created_at >= ?");
    params.push(from + " 00:00:00");
  }
  if (to) {
    where.push("c.created_at <= ?");
    params.push(to + " 23:59:59");
  }
  if (idV) {
    where.push("c.id_veiculo = ?");
    params.push(idV);
  }
  const sql = `SELECT c.id, c.created_at, c.closed_at, c.status, v.codigo AS veiculo, b.nome AS autor
               FROM checklist c
               JOIN veiculo v ON v.id_veiculo = c.id_veiculo
               JOIN bombeiro b ON b.id = c.id_bombeiro
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY c.created_at DESC
               LIMIT 200`;
  const [rows] = await db.query(sql, params);
  res.json(rows);
});

app.get("/checklists/:id", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "invalid_id" });

  const [[cab]] = await db.query(
    `SELECT c.id, c.created_at, c.closed_at, c.observacoes, c.status, c.pdf_path,
            v.codigo AS veiculo, b.nome AS autor, b.apelido AS autor_apelido
       FROM checklist c
       JOIN veiculo v ON v.id_veiculo = c.id_veiculo
       JOIN bombeiro b ON b.id = c.id_bombeiro
      WHERE c.id=?`,
    [id]
  );
  if (!cab) return res.status(404).json({ ok: false, error: "not_found" });

  const [itens] = await db.query(
    `SELECT e.nome AS equipamento, e.unidade, c.nome AS cofre,
            chki.presente, chki.falta, chki.inop, chki.manutencao
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

/* ===== PDF com regen e no-cache ===== */
app.get("/checklists/:id/pdf", requireAuth, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "invalid_id" });

  const force = req.query.regen === "1";

  const [[cab]] = await db.query(
    `SELECT c.id, c.created_at, c.closed_at, c.observacoes, c.pdf_path,
            v.codigo AS veiculo, b.nome AS autor, b.apelido AS autor_apelido
       FROM checklist c
       JOIN veiculo v ON v.id_veiculo = c.id_veiculo
       JOIN bombeiro b ON b.id = c.id_bombeiro
      WHERE c.id=?`,
    [id]
  );
  if (!cab) return res.status(404).json({ ok: false, error: "not_found" });

  const filename = cab.pdf_path || `checklist_${id}.pdf`;
  const filepath = path.join(STORAGE_DIR, filename);

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!force) {
    try {
      await fsp.access(filepath, fs.constants.R_OK);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename=${path.basename(filename)}`);
      return fs.createReadStream(filepath).pipe(res);
    } catch {}
  }

  const [rows] = await db.query(
    `SELECT e.nome AS equipamento, e.unidade, c.nome AS cofre,
            chki.presente, chki.falta, chki.inop, chki.manutencao
       FROM checklist_item chki
       JOIN localizacao l ON l.id_local = chki.id_local
       JOIN cofre c       ON c.id_cofre = l.id_cofre
       JOIN equipamento e ON e.id_equip = chki.id_equip
      WHERE chki.id_checklist = ?
      ORDER BY c.nome, e.nome`,
    [id]
  );

  const regeneratedPath = await gerarPdfChecklist(id, cab, rows);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=${path.basename(regeneratedPath)}`);
  return fs.createReadStream(regeneratedPath).pipe(res);
});

/* ========================= REGISTER / LOGIN / ME / LOGOUT ========================= */
const registerLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/register", registerLimiter, async (req, res) => {
  try {
    const {
      nome, apelido, username, password, graduacao, piquete, funcoes,
    } = req.body || {};

    if (![nome, apelido, username, password].every(v => typeof v === "string" && v.trim())) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }
    if (password.length < 4) {
      return res.status(400).json({ ok: false, error: "weak_password" });
    }

    const nomeLimpo = nome.trim();
    const apelidoLimpo = apelido.trim();
    const usernameLimpo = username.trim().toLowerCase();
    const graduacaoStr = (graduacao || "").toString().trim();
    const piqueteStr = (piquete || "").toString().trim();
    const funcoesArr = Array.isArray(funcoes) ? funcoes.filter(f => !!f && String(f).trim()) : [];

    const hash = await bcrypt.hash(password, 10);

    await db.beginTransaction();

    let insertId;
    try {
      const [ins] = await db.query(
        `INSERT INTO bombeiro (nome, apelido, nome_completo, graduacao, piquete, username, password_hash)
         VALUES (?, ?, TRIM(CONCAT(?, ' ', ?)), ?, ?, ?, ?)`,
        [nomeLimpo, apelidoLimpo, nomeLimpo, apelidoLimpo, graduacaoStr, piqueteStr, usernameLimpo, hash]
      );
      insertId = ins.insertId;
    } catch (e) {
      await db.rollback().catch(() => {});
      if (e?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ ok: false, error: "username_taken" });
      }
      throw e;
    }

    for (const raw of funcoesArr) {
      const nomeFunc = String(raw).trim();
      if (!nomeFunc) continue;

      const [insF] = await db.query(
        `INSERT INTO funcao (nome) VALUES (?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
        [nomeFunc]
      );
      const idFunc = insF.insertId;

      await db.query(
        `INSERT IGNORE INTO bombeiro_funcao (id_bombeiro, id_funcao) VALUES (?, ?)`,
        [insertId, idFunc]
      );
    }

    await db.commit();

    const isAdmin = await isUserAdmin(insertId);

    const token = signToken({
      id: insertId,
      username: usernameLimpo,
      nome: nomeLimpo,
      apelido: apelidoLimpo,
      graduacao: graduacaoStr,
    });
    setAuthCookie(res, token);

    return res.json({
      ok: true,
      user: {
        id: insertId,
        username: usernameLimpo,
        nome: nomeLimpo,
        apelido: apelidoLimpo,
        graduacao: graduacaoStr,
        isAdmin,
      },
    });
  } catch (e) {
    await db.rollback().catch(() => {});
    console.error("POST /register", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password)
      return res.status(400).json({ ok: false, error: "missing_fields" });

    const [rows] = await db.query(
      `SELECT id, nome, apelido, graduacao, username, password_hash
         FROM bombeiro
        WHERE username = ?`,
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "invalid_credentials" });

    const token = signToken(user);
    setAuthCookie(res, token);

    const { id, nome, apelido, graduacao } = user;
    const isAdmin = await isUserAdmin(id);

    return res.json({
      ok: true,
      user: { id, nome, apelido, graduacao, username, isAdmin },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/me", requireAuth, async (req, res) => {
  try {
    const isAdmin = await isUserAdmin(req.user.id);
    const { id, username, nome, apelido, graduacao } = req.user || {};
    res.json({
      ok: true,
      user: { id, username, nome, apelido, graduacao, isAdmin },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get("/auth/is-admin", requireAuth, async (req, res) => {
  try {
    const isAdmin = await isUserAdmin(req.user.id);
    console.log("is-admin:", { uid: req.user.id, isAdmin });
    res.json({ ok: true, isAdmin });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});

/* ========================= Secção (Material): CREATE / MOVIMENTOS ========================= */
// Criar equipamento na secção (ou reaproveitar existente) e dar entrada no armazém da secção
app.post("/secao/:nome/equipamento", requireAuth, async (req, res) => {
  try {
    const secaoNome = req.params.nome;
    const { nome, unidade = "un", qty = 0, nr_serie = null } = req.body || {};

    if (!nome || String(nome).trim() === "")
      return res.status(400).json({ ok: false, error: "missing_nome" });

    const id_secao = await getSecaoIdByNome(secaoNome);
    if (!id_secao) return res.status(404).json({ ok: false, error: "secao_not_found" });

    const q = Number.parseInt(qty, 10) || 0;
    const uni = String(unidade || "un").slice(0, 16);

    // cria (ou obtém) equipamento na secção
    let id_equip;
    try {
      const [ins] = await db.query(
        `INSERT INTO equipamento (nome, unidade, id_secao) VALUES (TRIM(?), ?, ?)
         ON DUPLICATE KEY UPDATE id_equip = LAST_INSERT_ID(id_equip)`,
        [nome, uni, id_secao]
      );
      id_equip = ins.insertId;
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }

    // garante local de armazém da secção e linha de saldo
    const id_local = await ensureArmazemLocalBySecaoId(id_secao);
    await ensureSaldoRow(id_local, id_equip);

    if (q > 0) {
      await db.query(
        `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
        [q, id_local, id_equip]
      );
    }

    return res.json({ ok: true, id_equip, added: q, unidade: uni });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Entrada no ARMAZÉM da secção (adiciona stock)
app.post("/secao/:nome/entrada", requireAuth, async (req, res) => {
  try {
    const secaoNome = req.params.nome;
    const id_secao = await getSecaoIdByNome(secaoNome);
    if (!id_secao) return res.status(404).json({ ok: false, error: "secao_not_found" });

    const id_equip = Number.parseInt(req.body?.id_equip, 10);
    const qty = Number.parseInt(req.body?.qty, 10);
    if (!Number.isInteger(id_equip) || !Number.isInteger(qty) || qty <= 0)
      return res.status(400).json({ ok: false, error: "invalid_payload" });

    // valida que o equipamento pertence à secção
    const [[einfo]] = await db.query(
      `SELECT id_equip FROM equipamento WHERE id_equip=? AND id_secao=?`,
      [id_equip, id_secao]
    );
    if (!einfo) return res.status(404).json({ ok: false, error: "equip_not_in_secao" });

    const id_local = await ensureArmazemLocalBySecaoId(id_secao);
    await ensureSaldoRow(id_local, id_equip);

    await db.query(
      `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
      [qty, id_local, id_equip]
    );

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Saída do ARMAZÉM da secção (remove stock)
app.post("/secao/:nome/saida", requireAuth, async (req, res) => {
  try {
    const secaoNome = req.params.nome;
    const id_secao = await getSecaoIdByNome(secaoNome);
    if (!id_secao) return res.status(404).json({ ok: false, error: "secao_not_found" });

    const id_equip = Number.parseInt(req.body?.id_equip, 10);
    const qty = Number.parseInt(req.body?.qty, 10);
    // motivo é opcional: const motivo = (req.body?.motivo || "").toString().slice(0, 255);

    if (!Number.isInteger(id_equip) || !Number.isInteger(qty) || qty <= 0)
      return res.status(400).json({ ok: false, error: "invalid_payload" });

    const [[einfo]] = await db.query(
      `SELECT id_equip FROM equipamento WHERE id_equip=? AND id_secao=?`,
      [id_equip, id_secao]
    );
    if (!einfo) return res.status(404).json({ ok: false, error: "equip_not_in_secao" });

    const id_local = await ensureArmazemLocalBySecaoId(id_secao);
    await ensureSaldoRow(id_local, id_equip);

    await db.beginTransaction();
    try {
      const disponivel = await getQtyForUpdate(id_local, id_equip); // FOR UPDATE
      if (qty > disponivel) {
        await db.rollback();
        return res.status(400).json({ ok: false, error: `sem_stock:${disponivel}` });
      }
      await db.query(
        `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
        [qty, id_local, id_equip]
      );
      await db.commit();
      return res.json({ ok: true });
    } catch (e) {
      await db.rollback().catch(() => {});
      return res.status(500).json({ ok: false, error: "tx_error" });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// Apagar (soft) do catálogo da secção quando total = 0
app.delete("/secao/:nome/equipamento/:id", requireAuth, async (req, res) => {
  try {
    const secaoNome = req.params.nome;
    const id_equip = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id_equip)) return res.status(400).json({ ok: false, error: "invalid_id" });

    const id_secao = await getSecaoIdByNome(secaoNome);
    if (!id_secao) return res.status(404).json({ ok: false, error: "secao_not_found" });

    const [[einfo]] = await db.query(
      `SELECT id_equip FROM equipamento WHERE id_equip=? AND id_secao=?`,
      [id_equip, id_secao]
    );
    if (!einfo) return res.status(404).json({ ok: false, error: "equip_not_in_secao" });

    const [[tot]] = await db.query(
      `SELECT CAST(COALESCE(SUM(s.qty),0) AS UNSIGNED) AS total
         FROM inventario_saldo s
         JOIN localizacao l ON l.id_local = s.id_local
        WHERE l.id_secao = ? AND s.id_equip = ?`,
      [id_secao, id_equip]
    );
    if ((tot?.total || 0) > 0) {
      return res.status(400).json({ ok: false, error: "tem_stock" });
    }

    await db.beginTransaction();
    try {
      await db.query(
        `DELETE s FROM inventario_saldo s
          JOIN localizacao l ON l.id_local = s.id_local
         WHERE l.id_secao = ? AND s.id_equip = ?`,
        [id_secao, id_equip]
      );
      await db.query(
        `UPDATE equipamento SET ativo = 0 WHERE id_equip=? AND id_secao=?`,
        [id_equip, id_secao]
      );
      await db.commit();
    } catch (e) {
      await db.rollback().catch(() => {});
      console.error("DELETE equipamento soft:", e);
      return res.status(500).json({ ok: false, error: "tx_error" });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("DELETE equipamento:", e);
    res.status(500).json({ ok: false, error: "server_error" });
  }
});




/* ========================= Reposição: decidir (REPOSTO/INOP) ========================= */
app.post("/reposicao/decidir", requireAuth, async (req, res) => {
  try {
    const id_veiculo = Number.parseInt(req.body?.id_veiculo, 10);
    const id_cofre   = Number.parseInt(req.body?.id_cofre, 10);
    const id_equip   = Number.parseInt(req.body?.id_equip, 10);
    const decidir    = String(req.body?.decidir || "");
    const from       = String(req.body?.from || ""); // falta | manutencao | inop (apenas p/ "repor")
    const qty        = Math.max(1, Number.parseInt(req.body?.qty, 10) || 1);

    if (![id_veiculo, id_cofre, id_equip].every(Number.isInteger))
      return res.status(400).json({ ok:false, error:"invalid_ids" });
    if (!["repor","inop"].includes(decidir))
      return res.status(400).json({ ok:false, error:"invalid_decisao" });

    // Local do COFRE
    const id_local_cofre = await getCofreLocalId(id_veiculo, id_cofre);
    if (!id_local_cofre) return res.status(404).json({ ok:false, error:"cofre_not_found" });

    // Secção (via localizacao.id_secao OU equipamento.id_secao)
    const id_secao = await resolveSecaoIdForCofreEquip(id_local_cofre, id_equip);
    if (!id_secao) return res.status(404).json({ ok:false, error:"secao_not_found" });

    // Pools da secção
    const { id_SECAO, id_MAN, id_INOP } = await ensureSecaoPools(id_secao);

    // Garante linhas de saldo base
    await ensureSaldoRow(id_local_cofre, id_equip);
    await ensureSaldoRow(id_SECAO,      id_equip);
    await ensureSaldoRow(id_MAN,        id_equip);
    await ensureSaldoRow(id_INOP,       id_equip);

    // Último checklist_item para este (cofre,equip) — bloqueado
    async function lockLastChecklistItem() {
      const [[last]] = await db.query(
        `SELECT chki.id, chki.presente, chki.falta, chki.manutencao, chki.inop
           FROM checklist_item chki
           JOIN (
             SELECT id_local, id_equip, MAX(id_checklist) AS last_chk
               FROM checklist_item
              WHERE id_local=? AND id_equip=?
           ) L ON L.id_local = chki.id_local AND L.id_equip = chki.id_equip AND L.last_chk = chki.id_checklist
          WHERE chki.id_local=? AND chki.id_equip=? FOR UPDATE`,
        [id_local_cofre, id_equip, id_local_cofre, id_equip]
      );
      return last;
    }

    // ===== REPO R =====
    if (decidir === "repor") {
      if (!["falta","manutencao","inop"].includes(from))
        return res.status(400).json({ ok:false, error:"invalid_from" });

      const origemLocal =
        from === "falta"       ? id_SECAO :
        from === "manutencao"  ? id_MAN   :
                                  id_INOP;

      await db.beginTransaction();
      try {
        const last = await lockLastChecklistItem();
        if (!last) { await db.rollback(); return res.status(404).json({ ok:false, error:"checklist_item_not_found" }); }

        const originCounter = Math.max(0, Number(last[from] ?? 0));
        const disponivelSrc = await getQtyForUpdate(origemLocal, id_equip);
        const efetivo       = Math.min(qty, originCounter, disponivelSrc);

        if (efetivo <= 0) {
          await db.rollback();
          return res.status(400).json({ ok:false, error:"sem_stock_origem" });
        }

        // Movimento
        await db.query(
          `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
          [efetivo, origemLocal, id_equip]
        );
        await db.query(
          `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
          [efetivo, id_local_cofre, id_equip]
        );

        // Checklist: presente+ ; contador origem -
        await db.query(
          `UPDATE checklist_item
              SET presente = presente + ?,
                  ${from}  = GREATEST(${from} - ?, 0)
            WHERE id = ?`,
          [efetivo, efetivo, last.id]
        );

        const [[upd]] = await db.query(
          `SELECT falta, manutencao, inop FROM checklist_item WHERE id=?`,
          [last.id]
        );

        await db.commit();
        return res.json({
          ok: true,
          decidir: "repor",
          from,
          moved: efetivo,
          updated: upd,
          checklist_item_id: last.id
        });
      } catch (e) {
        await db.rollback().catch(()=>{});
        console.error(e);
        return res.status(500).json({ ok:false, error:"tx_error" });
      }
    }

    // ===== INOP =====
    // Regra pedida: preferir MAN -> INOP; se não houver stock suficiente em MAN,
    // completar o necessário tirando do COFRE -> INOP (fallback).
    await db.beginTransaction();
    try {
      const last = await lockLastChecklistItem();
      if (!last) { await db.rollback(); return res.status(404).json({ ok:false, error:"checklist_item_not_found" }); }

      const maxByChk   = Math.max(0, Number(last.manutencao || 0));
      const pedido     = Math.min(qty, maxByChk);
      if (pedido <= 0) {
        await db.rollback();
        return res.status(400).json({ ok:false, error:"sem_manutencao_para_inop" });
      }

      const dispMan    = await getQtyForUpdate(id_MAN, id_equip);
      const moveDeMan  = Math.min(pedido, dispMan);

      let moved = 0;

      // 1) MAN -> INOP
      if (moveDeMan > 0) {
        await db.query(
          `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
          [moveDeMan, id_MAN, id_equip]
        );
        await db.query(
          `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
          [moveDeMan, id_INOP, id_equip]
        );
        moved += moveDeMan;
      }

      // 2) Fallback: COFRE -> INOP para cumprir o que falta
      const faltaCumprir = pedido - moved;
      if (faltaCumprir > 0) {
        const dispCofre = await getQtyForUpdate(id_local_cofre, id_equip);
        const moveDeCofre = Math.min(faltaCumprir, dispCofre);
        if (moveDeCofre > 0) {
          await db.query(
            `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
            [moveDeCofre, id_local_cofre, id_equip]
          );
          await db.query(
            `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
            [moveDeCofre, id_INOP, id_equip]
          );
          moved += moveDeCofre;
        }
      }

      if (moved <= 0) {
        await db.rollback();
        return res.status(400).json({ ok:false, error:"sem_stock_para_inop" });
      }

      // Checklist: baixa 'manutencao' e sobe 'inop' pelo total efetivo
      await db.query(
        `UPDATE checklist_item
            SET manutencao = GREATEST(manutencao - ?, 0),
                inop       = inop + ?
          WHERE id = ?`,
        [moved, moved, last.id]
      );

      const [[upd]] = await db.query(
        `SELECT falta, manutencao, inop FROM checklist_item WHERE id=?`,
        [last.id]
      );

      await db.commit();
      return res.json({
        ok: true,
        decidir: "inop",
        moved,
        updated: upd,
        checklist_item_id: last.id
      });
    } catch (e) {
      await db.rollback().catch(()=>{});
      console.error(e);
      return res.status(500).json({ ok:false, error:"tx_error" });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
});





app.get("/reposicao", requireAuth, async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        v.id_veiculo, c.id_cofre, e.id_equip,
        v.codigo AS veiculo, c.nome AS cofre, e.nome AS equipamento,
        CAST(ci.inop AS UNSIGNED) AS inop,
        CAST(ci.falta AS UNSIGNED) AS falta,
        CAST(ci.manutencao AS UNSIGNED) AS manutencao
      FROM checklist_item ci
      JOIN (
        SELECT id_local, id_equip, MAX(id_checklist) AS last_chk
        FROM checklist_item
        GROUP BY id_local, id_equip
      ) last ON last.id_local = ci.id_local AND last.id_equip = ci.id_equip AND last.last_chk = ci.id_checklist
      JOIN localizacao l ON l.id_local = ci.id_local
      LEFT JOIN veiculo v ON v.id_veiculo = l.id_veiculo
      LEFT JOIN cofre   c ON c.id_cofre   = l.id_cofre
      JOIN equipamento  e ON e.id_equip   = ci.id_equip
      WHERE (ci.falta > 0 OR ci.manutencao > 0 OR ci.inop > 0)
      ORDER BY v.codigo, c.nome, e.nome
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ ok:false, error:e.message });
  }
});


// DELETE /veiculo/:idVeiculo/cofre/:idCofre/item/:idEquip
// DELETE total do item no cofre -> devolve tudo à SECAO e remove a linha do cofre
app.delete("/veiculo/:id/cofre/:cofreId/item/:idEquip", requireAuth, async (req, res) => {
  const idVeic  = Number.parseInt(req.params.id, 10);
  const idCofre = Number.parseInt(req.params.cofreId, 10);
  const idEquip = Number.parseInt(req.params.idEquip, 10);

  if (![idVeic, idCofre, idEquip].every(Number.isInteger)) {
    return res.status(400).json({ ok: false, error: "invalid_params" });
  }

  try {
    await db.beginTransaction();

    // 1) Local do cofre
    const id_local_cofre = await getCofreLocalId(idVeic, idCofre);
    if (!id_local_cofre) {
      await db.rollback();
      return res.status(404).json({ ok: false, error: "cofre_not_found" });
    }

    // 2) Secção (pelas tuas helpers)
    const id_secao = await resolveSecaoIdForCofreEquip(id_local_cofre, idEquip);
    if (!id_secao) {
      await db.rollback();
      return res.status(404).json({ ok: false, error: "secao_not_found" });
    }
    const { id_SECAO } = await ensureSecaoPools(id_secao);

    // 3) Garantir linhas de saldo base
    await ensureSaldoRow(id_local_cofre, idEquip);
    await ensureSaldoRow(id_SECAO,      idEquip);

    // 4) Lock + qty atual no cofre
    const qtyAtual = await getQtyForUpdate(id_local_cofre, idEquip); // FOR UPDATE
    const qty = Math.max(0, Number(qtyAtual || 0));

    // Se não tiver qty, apenas apaga a linha (se existir) e termina
    if (qty > 0) {
      // movimento: COFRE -> SECAO
      await db.query(
        `UPDATE inventario_saldo SET qty = qty - ? WHERE id_local=? AND id_equip=?`,
        [qty, id_local_cofre, idEquip]
      );
      await db.query(
        `UPDATE inventario_saldo SET qty = qty + ? WHERE id_local=? AND id_equip=?`,
        [qty, id_SECAO, idEquip]
      );
    }

    // 5) Remover completamente a row do cofre para desaparecer do FE
    await db.query(
      `DELETE FROM inventario_saldo WHERE id_local=? AND id_equip=?`,
      [id_local_cofre, idEquip]
    );

    await db.commit();
    return res.json({ ok: true, removed_qty: qty });
  } catch (e) {
    console.error("DELETE cofre item:", e);
    try { await db.rollback(); } catch {}
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});



/* ========================= Start ========================= */
app.listen(Number(PORT), () => {
  console.log(`API a correr em http://127.0.0.1:${PORT} (NODE_ENV=${NODE_ENV})`);
});
