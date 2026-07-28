import { Server as IOServer } from "socket.io";
import http from "http";
import { verifyToken } from "./utils/jwt";
import { config } from "./config";

let io: IOServer | null = null;

/**
 * Deliberately simple real-time model: rather than computing per-client
 * targeted diffs (which needs geospatial fan-out logic), any change to
 * anyone's location or now-playing broadcasts a single lightweight
 * "nearby:changed" event to every connected client. Clients react by
 * re-fetching GET /nearby, which is cheap and keeps this correct-by-
 * construction. If this needs to scale to thousands of concurrent
 * sockets, replace with room-based fan-out keyed by geo cell.
 */
export function initSocket(server: http.Server): IOServer {
  io = new IOServer(server, {
    cors: { origin: config.corsOrigin },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Missing auth token"));
    try {
      const payload = verifyToken(token);
      (socket.data as any).userId = payload.userId;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`socket connected: user ${(socket.data as any).userId}`);
    socket.on("disconnect", () => {
      console.log(`socket disconnected: user ${(socket.data as any).userId}`);
    });
  });

  return io;
}

export function broadcastNearbyChanged() {
  io?.emit("nearby:changed");
}
