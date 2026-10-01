/**
 * Minimal Socket.IO (Engine.IO v4) client built on Node's global WebSocket.
 *
 * Written by hand rather than pulled from npm because the backend already has
 * `socket.io` as a server dependency but not `socket.io-client`, and the brief
 * asks for no new project dependencies for the harness. It speaks just enough
 * of the protocol to connect, join a match room, and try to score.
 *
 * Used by the negative tests: the brief requires that a score cannot be
 * recorded through the socket, so the suite joins a live match as an
 * *unauthenticated* client and attempts every plausible scoring event, then
 * proves via the REST API that the scorecard did not move.
 */

const CONNECT_TIMEOUT_MS = 8000;

export function socketUrl(apiBase, path = "/socket.io/") {
  const url = new URL(apiBase);
  const scheme = url.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${url.host}${path}?EIO=4&transport=websocket`;
}

export function connectSocket(apiBase, { label = "anon" } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(apiBase));
    const received = [];
    const ackWaiters = [];
    let connected = false;
    let opened = false;

    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* already gone */ }
      reject(new Error(`socket ${label}: connect timed out`));
    }, CONNECT_TIMEOUT_MS);

    const sendPacket = (data) => {
      if (ws.readyState === 1) ws.send(typeof data === "string" ? data : JSON.stringify(data));
    };

    ws.onerror = () => { /* close handler reports the real problem */ };

    ws.onclose = () => {
      clearTimeout(timer);
      if (!connected && !opened) reject(new Error(`socket ${label}: closed before handshake`));
    };

    ws.onmessage = (event) => {
      const raw = String(event.data);
      received.push(raw);

      // Engine.IO: "0" open, "2" ping -> answer "3", "4" namespace connect.
      const type = raw[0];
      if (type === "0") {
        opened = true;
        sendPacket("40"); // CONNECT to the default namespace
        return;
      }
      if (type === "2") {
        sendPacket("3"); // PONG
        return;
      }
      if (type === "4") {
        if (raw === "40" || raw.startsWith("40{")) {
          connected = true;
          clearTimeout(timer);
          resolve({
            connected: true,
            ws,
            received,
            /** Emits a Socket.IO event and resolves with an ack if one arrives. */
            emit(event, payload, { waitForAckMs = 1200 } = {}) {
              const ack = new Promise((res) => {
                ackWaiters.push({ event, resolve: res });
                setTimeout(() => res(null), waitForAckMs);
              });
              sendPacket(`42${JSON.stringify([event, payload])}`);
              return ack;
            },
            joinRoom(room) {
              sendPacket(`42${JSON.stringify(["joinRoom", room])}`);
            },
            close() {
              try { ws.close(); } catch { /* already gone */ }
            },
            get connected() {
              return connected;
            },
            raw: received,
          });
        }
        return;
      }
      if (type === "4" || raw.startsWith("42")) {
        try {
          const [event, ...rest] = JSON.parse(raw.slice(2));
          for (const w of ackWaiters) if (w.event === event) w.resolve(rest[0]);
        } catch { /* not an event packet */ }
      }
    };
  });
}

/**
 * Event names a scorer UI might plausibly try to push score state through.
 * None of them is handled server-side (the socket only accepts room joins), so
 * every ack must come back null and the scorecard must be unchanged.
 */
export const SCORING_EVENT_ATTEMPTS = [
  "score:update",
  "scoreUpdate",
  "ballScored",
  "ball:recorded",
  "updateScore",
  "score",
  "delivery",
];

export const ROOM_EVENT_ATTEMPTS = ["joinRoom", "join-match", "subscribe", "watch"];

export async function attemptScoreOverSocket({ apiBase, matchId, inningsIndex, batsmanOnStrikeId, batsmanNonStrikeId, bowlerId }) {
  const client = await connectSocket(apiBase, { label: "unauth-scorer" });
  const result = {
    connected: client.connected,
    roomsJoined: [],
    attempts: [],
  };

  for (const room of [`match-${matchId}`, String(matchId), `imatch_${matchId}`, `m_${matchId}`]) {
    client.joinRoom(room);
    result.roomsJoined.push(room);
  }
  await new Promise((r) => setTimeout(r, 400));

  for (const event of SCORING_EVENT_ATTEMPTS) {
    const ack = await client.emit(event, {
      matchId,
      inningsIndex,
      runs: 6,
      isWicket: true,
      wicketType: "bowled",
      batsmanOnStrikeId,
      batsmanNonStrikeId,
      bowlerId,
    });
    result.attempts.push({ event, ackReceived: ack !== null && ack !== undefined });
  }

  // Also try the event names the server *does* listen for, but with a payload
  // shaped like a score, in case one of them is wired to a write path.
  for (const event of ROOM_EVENT_ATTEMPTS) {
    const ack = await client.emit(event, { matchId, runs: 6, isWicket: true, wicketType: "bowled" });
    result.attempts.push({ event, ackReceived: ack !== null && ack !== undefined });
  }

  await new Promise((r) => setTimeout(r, 500));
  client.close();
  return result;
}
