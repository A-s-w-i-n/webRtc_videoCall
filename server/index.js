import { WebSocketServer } from "ws";

const PORT = 3001;
const wss = new WebSocketServer({ port: PORT });

// roomName -> { users: Array<{ id: string, name: string, ws: WebSocket }> }
const rooms = new Map();

function send(ws, type, payload = {}) {
  try {
    ws.send(JSON.stringify({ type, ...payload }));
  } catch {
    // ignore
  }
}

function broadcast(roomName, exceptWs, type, payload = {}) {
  const room = rooms.get(roomName);
  if (!room) return;
  for (const user of room.users) {
    if (user.ws !== exceptWs && user.ws.readyState === user.ws.OPEN) {
      send(user.ws, type, payload);
    }
  }
}

function getUsersPublic(roomName) {
  const room = rooms.get(roomName);
  if (!room) return [];
  return room.users.map((u) => ({ id: u.id, name: u.name }));
}

function ensureRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, { users: [] });
  }
  return rooms.get(roomName);
}

function removeUser(ws) {
  for (const [roomName, room] of rooms.entries()) {
    const idx = room.users.findIndex((u) => u.ws === ws);
    if (idx !== -1) {
      room.users.splice(idx, 1);
      if (room.users.length === 0) {
        rooms.delete(roomName);
      } else {
        broadcast(roomName, null, "user-left", { users: getUsersPublic(roomName) });
      }
      break;
    }
  }
}

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).slice(2);
  ws.userName = null;
  ws.roomName = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { type, roomName, userName } = msg;

    switch (type) {
      case "create-room": {
        if (!roomName || !userName) {
          return send(ws, "room-error", { message: "Missing roomName or userName" });
        }
        const room = ensureRoom(roomName);
        if (room.users.length >= 2) {
          return send(ws, "room-error", { message: "Room is full" });
        }
        ws.roomName = roomName;
        ws.userName = userName;
        room.users.push({ id: ws.id, name: userName, ws });
        send(ws, "room-created", { roomName });
        broadcast(roomName, ws, "user-joined", { users: getUsersPublic(roomName) });
        break;
      }

      case "join-room": {
        if (!roomName || !userName) {
          return send(ws, "room-error", { message: "Missing roomName or userName" });
        }
        const room = ensureRoom(roomName);
        if (room.users.length >= 2) {
          return send(ws, "room-error", { message: "Room is full" });
        }
        ws.roomName = roomName;
        ws.userName = userName;
        room.users.push({ id: ws.id, name: userName, ws });
        send(ws, "room-joined", { roomName, users: getUsersPublic(roomName) });
        broadcast(roomName, ws, "user-joined", { users: getUsersPublic(roomName) });
        break;
      }

      case "offer": {
        if (!ws.roomName) return;
        broadcast(ws.roomName, ws, "offer", { offer: msg.offer });
        break;
      }

      case "answer": {
        if (!ws.roomName) return;
        broadcast(ws.roomName, ws, "answer", { answer: msg.answer });
        break;
      }

      case "ice-candidate": {
        if (!ws.roomName) return;
        broadcast(ws.roomName, ws, "ice-candidate", { candidate: msg.candidate });
        break;
      }

      case "toggle-video": {
        if (!ws.roomName) return;
        broadcast(ws.roomName, ws, "user-video-toggle", { userId: ws.id, enabled: msg.enabled });
        break;
      }

      case "toggle-audio": {
        if (!ws.roomName) return;
        broadcast(ws.roomName, ws, "user-audio-toggle", { userId: ws.id, enabled: msg.enabled });
        break;
      }

      default:
        // ignore unknown
        break;
    }
  });

  ws.on("close", () => {
    removeUser(ws);
  });

  ws.on("error", () => {
    // allow close handler to do cleanup
  });
});

console.log(`WebSocket signaling server running on ws://localhost:${PORT}`); 