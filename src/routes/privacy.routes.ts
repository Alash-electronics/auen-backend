import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { Privacy } from "../repo";

export const privacyRouter = Router();

privacyRouter.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const settings = Privacy.get(req.userId!);
  res.json({
    shareLocation: !!settings.share_location,
    shareRadiusMeters: settings.share_radius_m,
    shareNowPlaying: !!settings.share_now_playing,
  });
});

const updateSchema = z.object({
  shareLocation: z.boolean(),
  shareRadiusMeters: z.number().int().min(50).max(20000),
  shareNowPlaying: z.boolean(),
});

privacyRouter.patch("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { shareLocation, shareRadiusMeters, shareNowPlaying } = parsed.data;

  Privacy.update(req.userId!, shareLocation, shareRadiusMeters, shareNowPlaying);
  res.status(204).send();
});
