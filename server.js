import http from "http";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";

const PORT = process.env.PORT || 8080;

const server = http.createServer();
const wss = new WebSocketServer({ server });

// roomId -> Set(client)
const rooms = new Map();

// client -> { id, name, roomId }
const clientMeta = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function broadcast(roomId, data, exceptClient = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(data);
  for (const c of room) {
    if (c.readyState === 1 && c !== exceptClient) c.send(msg);
  }
}

function roomMembers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  const members = [];
  for (const c of room) {
    const meta = clientMeta.get(c);
    if (meta) members.push({ id: meta.id, name: meta.name });
  }
  return members;
}

wss.on("connection", (ws) => {
  const id = nanoid(8);
  clientMeta.set(ws, { id, name: "Anonymous", roomId: null });

  ws.send(JSON.stringify({ type: "welcome", payload: { id } }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(
        JSON.stringify({ type: "error", payload: { message: "Invalid JSON" } })
      );
      return;
    }

    const meta = clientMeta.get(ws);
    if (!meta) return;

    // { type, payload }
    switch (msg.type) {
      case "createRoom": {
        const { name } = msg.payload || {};
        meta.name = (name || meta.name || "Anonymous").trim().slice(0, 24);

        const roomId = nanoid(6).toUpperCase(); // e.g. "A9K2QZ"
        // move user into that room
        if (meta.roomId) {
          const prev = rooms.get(meta.roomId);
          prev?.delete(ws);
          broadcast(meta.roomId, {
            type: "presence",
            payload: { members: roomMembers(meta.roomId) },
          });
        }

        meta.roomId = roomId;
        getRoom(roomId).add(ws);

        ws.send(
          JSON.stringify({
            type: "roomCreated",
            payload: { roomId, members: roomMembers(roomId) },
          })
        );
        broadcast(roomId, {
          type: "presence",
          payload: { members: roomMembers(roomId) },
        });

        break;
      }

      case "join": {
        const { roomId, name } = msg.payload || {};
        if (!roomId) return;

        // leave previous room if any
        if (meta.roomId) {
          const prev = rooms.get(meta.roomId);
          prev?.delete(ws);
          broadcast(meta.roomId, {
            type: "presence",
            payload: { members: roomMembers(meta.roomId) },
          });
        }

        meta.roomId = roomId;
        meta.name = (name || "Anonymous").trim().slice(0, 24);

        const room = getRoom(roomId);
        room.add(ws);

        ws.send(
          JSON.stringify({
            type: "joined",
            payload: { roomId, members: roomMembers(roomId) },
          })
        );

        broadcast(roomId, {
          type: "presence",
          payload: { members: roomMembers(roomId) },
        });
        break;
      }

      case "chat": {
        if (!meta.roomId) return;
        const text = (msg.payload?.text ?? "").toString().trim();
        if (!text) return;

        const payload = {
          id: nanoid(10),
          roomId: meta.roomId,
          from: { id: meta.id, name: meta.name },
          text: text.slice(0, 2000),
          ts: Date.now(),
        };

        // send to everyone in room (including sender)
        broadcast(meta.roomId, { type: "chat", payload });
        break;
      }

      case "typing": {
        if (!meta.roomId) return;
        broadcast(
          meta.roomId,
          {
            type: "typing",
            payload: {
              from: { id: meta.id, name: meta.name },
              isTyping: !!msg.payload?.isTyping,
            },
          },
          ws
        );
        break;
      }

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            payload: { message: "Unknown type" },
          })
        );
    }
  });

  ws.on("close", () => {
    const meta = clientMeta.get(ws);
    if (meta?.roomId) {
      const room = rooms.get(meta.roomId);
      room?.delete(ws);
      broadcast(meta.roomId, {
        type: "presence",
        payload: { members: roomMembers(meta.roomId) },
      });
      if (room && room.size === 0) rooms.delete(meta.roomId);
    }
    clientMeta.delete(ws);
  });
});

server.listen(PORT, () =>
  console.log(`WS server running on ws://localhost:${PORT}`)
);
