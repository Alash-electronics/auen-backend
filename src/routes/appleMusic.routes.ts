import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { generateAppleMusicDeveloperToken } from "../services/appleMusic.service";
import { AppleMusicAccounts } from "../repo";

export const appleMusicRouter = Router();

/** iOS app calls this, then passes the token into MusicKit's authorize step. */
appleMusicRouter.get("/developer-token", requireAuth, (_req, res) => {
  try {
    res.json({ token: generateAppleMusicDeveloperToken() });
  } catch (err: any) {
    res.status(503).json({ error: err.message });
  }
});

const tokenSchema = z.object({
  musicUserToken: z.string(),
  storefront: z.string().default("us"),
});

appleMusicRouter.post("/token", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  AppleMusicAccounts.upsert(req.userId!, parsed.data.musicUserToken, parsed.data.storefront);
  res.status(204).send();
});

appleMusicRouter.delete("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  AppleMusicAccounts.delete(req.userId!);
  res.status(204).send();
});
