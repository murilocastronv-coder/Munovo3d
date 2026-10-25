// MU Online Solo Classic — servidor único para a Render.
// Serve o site (pasta web/) + multiplayer em tempo real (WebSocket em /ws)
// + /health e /api/stats. Tudo no mesmo endereço, então o jogo conecta sozinho.
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 10000);
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS || 100);
const WEB_DIR = __dirname;
// Se shell_login.data for só um ponteiro do Git LFS (arquivo de ~130 bytes),
// o servidor redireciona para uma cópia real hospedada. Troque via variável de ambiente.
const SHELL_DATA_URL = process.env.SHELL_DATA_URL || "https://andvolodko.github.io/mu-online-solo-classic/shell_login.data";

const rooms = new Map();
let pool = null;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
}

function safeName(value) {
  return String(value || "Player").replace(/[^\p{L}\p{N}_ -]/gu, "").trim().slice(0, 18) || "Player";
}
function roomName(value) {
  return String(value || "Lorencia").replace(/[^\w -]/g, "").trim().slice(0, 24) || "Lorencia";
}
function snapshot(room) {
  return [...room.values()].map(p => ({ id: p.id, name: p.name, x: p.x, y: p.y, hasPos: p.hasPos, map: p.map, joinedAt: p.joinedAt }));
}
function onlineCount() {
  return [...rooms.values()].reduce((n, room) => n + room.size, 0);
}
function broadcast(room, payload, except) {
  const data = JSON.stringify(payload);
  for (const p of room.values()) {
    if (p.ws !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  }
}
function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, new Map());
  return rooms.get(name);
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

// ---------- arquivos estáticos ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".wasm": "application/wasm", ".data": "application/octet-stream",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".musav": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8"
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".wasm", ".data", ".svg", ".txt", ".musav"]);
const gzCache = new Map(); // arquivo -> { key, buf } (comprime uma vez e guarda em memória)

function isLfsPointer(file, size) {
  if (size > 512) return false;
  try { return fs.readFileSync(file, "utf8").startsWith("version https://git-lfs"); } catch (_) { return false; }
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(req.url.split("?")[0]); } catch (_) { res.writeHead(400); return res.end("Bad request"); }
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(WEB_DIR, pathname));
  if (file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404 Not Found"); }
    const ext = path.extname(file).toLowerCase();
    if (ext === ".data" && isLfsPointer(file, st.size)) {
      res.writeHead(302, { Location: SHELL_DATA_URL, "Cache-Control": "no-store" });
      return res.end();
    }
    const etag = '"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"';
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
      "ETag": etag, "Last-Modified": st.mtime.toUTCString(), "Access-Control-Allow-Origin": "*", "Vary": "Accept-Encoding"
    };
    if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
    const wantsGzip = COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (wantsGzip && st.size < 64 * 1024 * 1024) {
      const hit = gzCache.get(file);
      const send = buf => { headers["Content-Encoding"] = "gzip"; headers["Content-Length"] = buf.length; res.writeHead(200, headers); res.end(req.method === "HEAD" ? undefined : buf); };
      if (hit && hit.key === etag) return send(hit.buf);
      return fs.readFile(file, (e, raw) => {
        if (e) { res.writeHead(500); return res.end("Read error"); }
        zlib.gzip(raw, { level: 6 }, (ze, buf) => {
          if (ze) { res.writeHead(500); return res.end("Compress error"); }
          gzCache.set(file, { key: etag, buf }); send(buf);
        });
      });
    }
    headers["Content-Length"] = st.size;
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }
  if (url === "/health") {
    return sendJson(res, 200, { status: "ok", service: "mu-online-multiplayer-gateway", online: onlineCount(), rooms: rooms.size, databaseConfigured: Boolean(pool) });
  }
  if (url === "/api/stats") {
    const base = { status: "ok", onlinePlayers: onlineCount(), rooms: rooms.size, maxPlayers: MAX_PLAYERS, updatedAt: new Date().toISOString(), databaseConnected: false };
    if (!pool) return sendJson(res, 200, { ...base, databaseMessage: "DATABASE_URL ainda não configurada no serviço." });
    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM public.accounts WHERE COALESCE(deactivated_at, NULL) IS NULL AND COALESCE(is_ai, false) = false) AS total_accounts,
          (SELECT COUNT(*)::int FROM public.characters) AS total_characters,
          (SELECT COUNT(*)::int FROM public.accounts WHERE created_at >= date_trunc('day', now())) AS accounts_today
      `);
      let topCharacters = [];
      try {
        const rank = await pool.query("SELECT name, class, level, realm FROM public.characters ORDER BY level DESC, name ASC LIMIT 5");
        topCharacters = rank.rows.map(c => ({ name: c.name, class: c.class, level: c.level, realm: c.realm }));
      } catch (_) {}
      return sendJson(res, 200, { ...base, databaseConnected: true, totalAccounts: result.rows[0].total_accounts, totalCharacters: result.rows[0].total_characters, accountsCreatedToday: result.rows[0].accounts_today, topCharacters });
    } catch (e) {
      console.error("Database stats query failed:", e.message);
      return sendJson(res, 200, { ...base, databaseMessage: "Banco configurado, mas a consulta falhou. Verifique a URL e as permissões." });
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end("Method not allowed"); }
  serveStatic(req, res);
});

// ---------- multiplayer (WebSocket) ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 4096, perMessageDeflate: false });
wss.on("connection", (ws, req) => {
  // Desliga o algoritmo de Nagle: pacotes pequenos de movimento saem na hora (menos lag).
  try { ws._socket.setNoDelay(true); } catch (_) {}
  if (onlineCount() >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ type: "error", message: "Servidor cheio. Tente novamente mais tarde." }));
    return ws.close(1013, "Server full");
  }
  const player = { id: Math.random().toString(36).slice(2, 10), name: "Player", map: "Lorencia", x: 0, y: 0, joinedAt: Date.now(), ws, roomName: null, lastMove: 0, chatTimes: [], hasPos: false, moveTimer: null, pendingMove: null };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "join") {
      const nextRoomName = roomName(msg.room);
      const nextName = safeName(msg.name);
      if (player.roomName === nextRoomName && rooms.get(nextRoomName) && rooms.get(nextRoomName).has(player.id)) {
        if (nextName !== player.name) { player.name = nextName; broadcast(rooms.get(nextRoomName), { type: "rename", id: player.id, name: player.name }); }
        return;
      }
      if (player.roomName) {
        const oldRoom = rooms.get(player.roomName);
        if (oldRoom) { oldRoom.delete(player.id); broadcast(oldRoom, { type: "leave", id: player.id }); if (!oldRoom.size) rooms.delete(player.roomName); }
      }
      player.roomName = nextRoomName; player.name = nextName;
      const room = getRoom(nextRoomName);
      room.set(player.id, player);
      ws.send(JSON.stringify({ type: "welcome", id: player.id, room: nextRoomName, players: snapshot(room) }));
      broadcast(room, { type: "join", player: { id: player.id, name: player.name, x: player.x, y: player.y, hasPos: player.hasPos, map: player.map } }, ws);
      broadcast(room, { type: "system", text: player.name + " entrou na sala." });
      return;
    }
    if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong", at: msg.at || Date.now() }));
    if (!player.roomName) return;
    const room = rooms.get(player.roomName);
    if (!room) return;
    if (msg.type === "chat") {
      const now = Date.now();
      player.chatTimes = player.chatTimes.filter(t => now - t < 5000);
      if (player.chatTimes.length >= 5) return; // anti-spam: no máximo 5 mensagens a cada 5 s
      player.chatTimes.push(now);
      const text = String(msg.text || "").trim().slice(0, 240);
      if (text) broadcast(room, { type: "chat", id: player.id, name: player.name, text, at: now });
    } else if (msg.type === "move") {
      const x = Number(msg.x), y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      player.x = Math.max(0, Math.min(255, Math.round(x)));
      player.y = Math.max(0, Math.min(255, Math.round(y)));
      player.hasPos = true;
      const flush = () => {
        player.moveTimer = null; player.lastMove = Date.now();
        const r = player.roomName && rooms.get(player.roomName);
        if (r) broadcast(r, { type: "move", id: player.id, x: player.x, y: player.y }, ws);
      };
      const wait = 50 - (Date.now() - player.lastMove);
      // Nunca descarta o último destino: se veio rápido demais, agenda para depois (antes era perdido).
      if (wait <= 0) { if (player.moveTimer) { clearTimeout(player.moveTimer); } flush(); }
      else if (!player.moveTimer) player.moveTimer = setTimeout(flush, wait);
    }
  });
  ws.on("close", () => {
    if (player.moveTimer) clearTimeout(player.moveTimer);
    if (!player.roomName) return;
    const room = rooms.get(player.roomName);
    if (room) { room.delete(player.id); broadcast(room, { type: "leave", id: player.id }); broadcast(room, { type: "system", text: player.name + " saiu da sala." }); if (!room.size) rooms.delete(player.roomName); }
  });
  ws.on("error", () => {});
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));
server.listen(PORT, "0.0.0.0", () => console.log("MU Online: site + multiplayer ouvindo na porta " + PORT));
