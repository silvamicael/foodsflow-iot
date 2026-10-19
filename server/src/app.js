import express from "express";
import session from "express-session";
import SQLiteStoreFactory from "connect-sqlite3";
import Database from "better-sqlite3";
import mqtt from "mqtt";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_TOPIC = process.env.MQTT_BASE_TOPIC || "escola/seu-grupo/foods";
const TOPIC_NEW = `${BASE_TOPIC}/pedidos/novo`;
const TOPIC_KITCHEN = `${BASE_TOPIC}/impressao/cozinha`;
const TOPIC_CASHIER = `${BASE_TOPIC}/impressao/caixa`;
const SQLiteStore = SQLiteStoreFactory(session);
const db = new Database(path.join(rootDir, "foods.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  mesa INTEGER NOT NULL,
  cliente TEXT NOT NULL,
  itens_json TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREPARANDO',
  created_at TEXT NOT NULL
);
`);

const countUsers = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (countUsers === 0) {
  const insert = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)");
  insert.run("gerencia", bcrypt.hashSync("Gerencia@123", 10), "GERENCIA");
  insert.run("cozinha", bcrypt.hashSync("Cozinha@123", 10), "COZINHA");
  insert.run("caixa", bcrypt.hashSync("Caixa@123", 10), "CAIXA");
  console.log("[DB] Usuários iniciais criados.");
}

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: rootDir }),
  secret: process.env.SESSION_SECRET || "foods-mqtt-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(rootDir, "public")));

const clients = new Set();
function broadcast(event, data) {
  const message = `data: ${JSON.stringify({ event, data })}\n\n`;
  for (const response of clients) response.write(message);
}
function userFromRequest(req) { return req.session?.user || null; }
function requireLogin(req, res, next) {
  if (!userFromRequest(req)) return res.status(401).json({ error: "Faça login primeiro." });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    const user = userFromRequest(req);
    if (!user) return res.status(401).json({ error: "Faça login primeiro." });
    if (!roles.includes(user.role)) return res.status(403).json({ error: "Você não tem permissão para esta ação." });
    next();
  };
}
function safeOrder(row) {
  return { ...row, itens: JSON.parse(row.itens_json), itens_json: undefined };
}
function listOrders() {
  return db.prepare("SELECT * FROM orders ORDER BY datetime(created_at) DESC").all().map(safeOrder);
}
function normalizeOrder(body) {
  const mesa = Number(body.mesa);
  const cliente = String(body.cliente || "").trim();
  const itens = body.itens;
  if (!Number.isInteger(mesa) || mesa < 1) throw new Error("Informe um número de mesa válido.");
  if (!cliente) throw new Error("Informe o nome do cliente.");
  if (!Array.isArray(itens) || itens.length === 0) throw new Error("O pedido precisa ter pelo menos um item.");
  const normalizedItems = itens.map((item) => {
    const nome = String(item.nome || "").trim();
    const precoUnitario = Number(item.precoUnitario ?? item.preco);
    const quantidade = Number(item.quantidade);
    if (!nome || !Number.isFinite(precoUnitario) || precoUnitario < 0 || !Number.isInteger(quantidade) || quantidade < 1) {
      throw new Error("Cada item precisa ter nome, preço válido e quantidade inteira maior que zero.");
    }
    return { nome, precoUnitario, quantidade };
  });
  const total = Number(normalizedItems.reduce((sum, item) => sum + item.precoUnitario * item.quantidade, 0).toFixed(2));
  return { mesa, cliente, itens: normalizedItems, total };
}
function createOrder(body) {
  const order = normalizeOrder(body);
  const id = randomUUID().slice(0, 8).toUpperCase();
  const created_at = new Date().toISOString();
  db.prepare("INSERT INTO orders (id, mesa, cliente, itens_json, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, order.mesa, order.cliente, JSON.stringify(order.itens), order.total, "PREPARANDO", created_at);
  return { id, ...order, status: "PREPARANDO", created_at };
}

let mqttClient;
try {
  mqttClient = mqtt.connect(process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883", {
    clientId: `foods-backend-${Math.random().toString(16).slice(2, 10)}`,
    connectTimeout: 10000,
    reconnectPeriod: 5000
  });
  mqttClient.on("connect", () => {
    console.log(`[MQTT] Conectado em ${process.env.MQTT_URL || "mqtt://broker.hivemq.com:1883"}`);
    console.log(`[MQTT] Aguardando pedidos em ${TOPIC_NEW}`);
    mqttClient.subscribe(TOPIC_NEW, (err) => {
      if (err) console.error("[MQTT] Falha ao assinar tópico:", err.message);
    });
  });
  mqttClient.on("reconnect", () => console.log("[MQTT] Reconectando..."));
  mqttClient.on("error", (err) => console.error("[MQTT] Erro:", err.message));
  mqttClient.on("message", (topic, buffer) => {
    if (topic !== TOPIC_NEW) return;
    try {
      const order = createOrder(JSON.parse(buffer.toString()));
      console.log(`[MQTT] Pedido ${order.id} recebido da mesa ${order.mesa}. Total: R$ ${order.total.toFixed(2)}`);
      mqttClient.publish(TOPIC_KITCHEN, JSON.stringify(order));
      mqttClient.publish(TOPIC_CASHIER, JSON.stringify(order));
      broadcast("orders", listOrders());
    } catch (err) {
      console.error("[MQTT] Pedido rejeitado:", err.message);
    }
  });
} catch (err) {
  console.error("[MQTT] Não foi possível iniciar o cliente:", err.message);
}

app.get("/api/me", (req, res) => res.json({ user: userFromRequest(req) }));
app.post("/api/login", (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Usuário ou senha incorretos." });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});
app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/orders", requireLogin, (req, res) => {
  const user = req.session.user;
  let orders = listOrders();
  if (user.role === "COZINHA") orders = orders.filter((o) => o.status === "PREPARANDO");
  if (user.role === "CAIXA") orders = orders.filter((o) => o.status === "PRONTO" || o.status === "PAGO");
  const { status, mesa, min, max } = req.query;
  if (status) orders = orders.filter((o) => o.status === status);
  if (mesa) orders = orders.filter((o) => o.mesa === Number(mesa));
  if (min !== undefined && min !== "") orders = orders.filter((o) => o.total >= Number(min));
  if (max !== undefined && max !== "") orders = orders.filter((o) => o.total <= Number(max));
  res.json(orders);
});
app.post("/api/orders", requireRole("GERENCIA", "CAIXA"), (req, res) => {
  try {
    const order = createOrder(req.body);
    if (mqttClient?.connected) {
      mqttClient.publish(TOPIC_KITCHEN, JSON.stringify(order));
      mqttClient.publish(TOPIC_CASHIER, JSON.stringify(order));
    }
    broadcast("orders", listOrders());
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.patch("/api/orders/:id/status", requireLogin, (req, res) => {
  const user = req.session.user;
  const status = String(req.body.status || "");
  const allowed = {
    COZINHA: ["PRONTO"],
    CAIXA: ["PAGO"],
    GERENCIA: ["PREPARANDO", "PRONTO", "PAGO"]
  };
  if (!allowed[user.role]?.includes(status)) return res.status(403).json({ error: "Perfil sem permissão para essa mudança." });
  const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  if (!result.changes) return res.status(404).json({ error: "Pedido não encontrado." });
  broadcast("orders", listOrders());
  res.json({ ok: true });
});
app.get("/api/events", requireLogin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  clients.add(res);
  res.write(`data: ${JSON.stringify({ event: "orders", data: listOrders() })}\n\n`);
  req.on("close", () => clients.delete(res));
});
app.get("*", (req, res) => res.sendFile(path.join(rootDir, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`FOODS MQTT rodando em http://localhost:${PORT}`);
  console.log(`Tópico de pedidos: ${TOPIC_NEW}`);
});
