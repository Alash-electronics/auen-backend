import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { exchangeSpotifyCode, syncSpotifyNowPlaying } from "../services/spotify.service";
import { SpotifyAccounts } from "../repo";
import { config } from "../config";

export const spotifyRouter = Router();

/** Client builds the actual authorize URL itself (or uses this helper). */
spotifyRouter.get("/auth-config", requireAuth, (_req, res) => {
  res.json({
    clientId: config.spotify.clientId,
    redirectUri: config.spotify.redirectUri,
    scopes: ["user-read-currently-playing", "user-read-playback-state"],
    authorizeUrl: "https://accounts.spotify.com/authorize",
  });
});

const callbackSchema = z.object({
  code: z.string(),
  codeVerifier: z.string(),
});

/**
 * The iOS app runs the PKCE authorize step itself (ASWebAuthenticationSession
 * with our custom URL scheme), then hands us the resulting `code` +
 * `codeVerifier` to finish the token exchange server-side (keeps refresh
 * tokens off the device).
 */
spotifyRouter.post("/callback", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    await exchangeSpotifyCode(req.userId!, parsed.data.code, parsed.data.codeVerifier);
    await syncSpotifyNowPlaying(req.userId!);
    res.status(204).send();
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

spotifyRouter.post("/sync", requireAuth, async (req: AuthedRequest, res) => {
  const changed = await syncSpotifyNowPlaying(req.userId!);
  res.json({ changed });
});

spotifyRouter.delete("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  SpotifyAccounts.delete(req.userId!);
  res.status(204).send();
});
