import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { Locations } from "../repo";
import { broadcastNearbyChanged } from "../socket";

export const locationRouter = Router();

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

locationRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = locationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { lat, lng } = parsed.data;

  Locations.upsert(req.userId!, lat, lng);

  broadcastNearbyChanged();
  res.status(204).send();
});
