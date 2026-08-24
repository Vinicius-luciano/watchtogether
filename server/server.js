// Servidor de sinalização - WebSocket puro, sem dependências além do "ws"
// Função única: repassar mensagens (offer/answer/ICE) entre os 2 peers de uma sala.
// Não guarda vídeo nem áudio - isso viaja direto entre os navegadores (WebRTC).

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// rooms: Map<roomId, Set<ws>>
const rooms = new Map();

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignora mensagem malformada
    }

    if (msg.type === "join") {
      const roomId = String(msg.room || "").trim();
      if (!roomId) return;

      let peers = rooms.get(roomId);
      if (!peers) {
        peers = new Set();
        rooms.set(roomId, peers);
      }

      if (peers.size >= 2) {
        ws.send(JSON.stringify({ type: "room-full" }));
        ws.close();
        return;
      }

      ws.roomId = roomId;
      peers.add(ws);
      log(`peer entrou na sala "${roomId}" (${peers.size}/2)`);

      // avisa o próprio peer se ele é o primeiro ou o segundo a entrar
      ws.send(JSON.stringify({ type: "joined", isInitiator: peers.size === 1 }));

      // avisa o outro peer (se já tiver alguém) que a sala está completa
      if (peers.size === 2) {
        for (const peer of peers) {
          peer.send(JSON.stringify({ type: "peer-ready" }));
        }
      }
      return;
    }

    // repassa offer / answer / ice-candidate / chat / sync para o outro peer da sala
    if (["offer", "answer", "ice-candidate", "chat", "sync", "leave"].includes(msg.type)) {
      const peers = rooms.get(ws.roomId);
      if (!peers) return;
      for (const peer of peers) {
        if (peer !== ws && peer.readyState === 1) {
          peer.send(JSON.stringify(msg));
        }
      }
    }
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const peers = rooms.get(ws.roomId);
    if (!peers) return;
    peers.delete(ws);
    for (const peer of peers) {
      peer.send(JSON.stringify({ type: "peer-left" }));
    }
    if (peers.size === 0) rooms.delete(ws.roomId);
    log(`peer saiu da sala "${ws.roomId}"`);
  });
});

// keep-alive: derruba conexões mortas (evita salas fantasmas)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(interval));

log(`servidor de sinalização rodando na porta ${PORT}`);
