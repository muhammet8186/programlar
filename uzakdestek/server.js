const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify({ok:true, service:"uzaktan-destek-signaling"}));
  }
  res.writeHead(404); res.end("Not found");
});
const wss = new WebSocket.Server({server, maxPayload: 64 * 1024});

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function makeCode() {
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); }
  while (rooms.has(code));
  return code;
}
function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const other = room.host === ws ? room.guest : room.host;
  send(other, {type:"peer-left"});
  if (room.host === ws) room.host = null;
  if (room.guest === ws) room.guest = null;
  ws.room = null;
  if (!room.host && !room.guest) rooms.delete(room.code);
}
wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "create") {
      leave(ws);
      const code = makeCode();
      rooms.set(code, {code, host:ws, guest:null, createdAt:Date.now()});
      ws.room = code;
      return send(ws, {type:"created", room:code});
    }
    if (msg.type === "join") {
      leave(ws);
      const code = String(msg.room || "").replace(/\D/g, "");
      const room = rooms.get(code);
      if (!room || !room.host || room.guest) {
        return send(ws, {type:"error", message:"Kod geçersiz, süresi dolmuş veya oda dolu."});
      }
      room.guest = ws;
      ws.room = code;
      send(ws, {type:"joined", room:code});
      send(room.host, {type:"peer-joined"});
      return;
    }
    if (msg.type === "signal") {
      const room = ws.room && rooms.get(ws.room);
      if (!room) return;
      const peer = room.host === ws ? room.guest : room.host;
      if (peer) send(peer, {type:"signal", data:msg.data});
      return;
    }
    if (msg.type === "leave") leave(ws);
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

// Remove abandoned rooms and detect dead sockets.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
  for (const [code, room] of rooms) {
    if (Date.now() - room.createdAt > 30 * 60 * 1000) {
      send(room.host, {type:"error", message:"Destek odasının süresi doldu."});
      send(room.guest, {type:"error", message:"Destek odasının süresi doldu."});
      if (room.host) room.host.room = null;
      if (room.guest) room.guest.room = null;
      rooms.delete(code);
    }
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));
server.listen(PORT, () => console.log("Uzaktan Destek signaling sunucusu port " + PORT));
