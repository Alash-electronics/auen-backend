import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../utils/jwt";
import { Users } from "../repo";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyToken(token);
    // SQLite on free Render is ephemeral — after redeploy JWTs can still
    // verify while the user row is gone. Reject those so clients re-login
    // instead of hitting FOREIGN KEY constraint failed on child tables.
    if (!Users.findById(payload.userId)) {
      return res.status(401).json({ error: "Session expired — please log in again" });
    }
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
