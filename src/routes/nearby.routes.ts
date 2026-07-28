import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { findNearbyUsers } from "../services/nearby.service";

export const nearbyRouter = Router();

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(50).max(20000).default(1000),
});

nearbyRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { lat, lng, radius } = parsed.data;

  const results = findNearbyUsers(req.userId!, { lat, lng }, radius);
  res.json({ users: results });
});
