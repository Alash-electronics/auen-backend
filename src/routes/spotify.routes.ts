import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import {
  exchangeSpotifyCode,
  syncSpotifyNowPlaying,
  searchTracks,
  isSpotifyConfigured,
  getClientCredentialsToken,
} from "../services/spotify.service";
import { SpotifyAccounts } from "../repo";
import { config } from "../config";

export const spotifyRouter = Router();

/** Public readiness probe — no secrets, no auth. */
spotifyRouter.get("/status", async (_req, res) => {
  const configured = isSpotifyConfigured();
  let clientCredentialsOk: boolean | null = null;
  if (configured) {
    try {
      await getClientCredentialsToken();
      clientCredentialsOk = true;
    } catch {
      clientCredentialsOk = false;
    }
  }

  res.json({
    configured,
    clientIdPresent: Boolean(config.spotify.clientId) && !config.spotify.clientId.includes("your-spotify"),
    clientCredentialsOk,
    redirectUri: config.spotify.redirectUri,
    scopes: [
      "user-read-email",
      "user-read-private",
      "user-read-currently-playing",
      "user-read-playback-state",
    ],
    authorizeUrl: "https://accounts.spotify.com/authorize",
    authLoginPath: "POST /auth/spotify",
    note: configured
      ? "Credentials set. Use POST /auth/spotify for Sign in with Spotify (PKCE)."
      : "Set SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET (+ REDIRECT_URI) in env",
  });
});

/**
 * Public catalog search via Client Credentials (no user login).
 * GET /spotify/search?q=weeknd&limit=8
 */
spotifyRouter.get("/search", async (req, res) => {
  if (!isSpotifyConfigured()) {
    return res.status(503).json({ error: "Spotify is not configured on this server" });
  }
  const q = String(req.query.q ?? "").trim();
  if (q.length < 1) return res.status(400).json({ error: "q is required" });
  const limit = Math.min(20, Math.max(1, parseInt(String(req.query.limit ?? "8"), 10) || 8));
  try {
    const tracks = await searchTracks(q, limit);
    res.json({ tracks });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

/** Client builds the actual authorize URL itself (or uses this helper). */
spotifyRouter.get("/auth-config", requireAuth, (_req, res) => {
  res.json({
    clientId: config.spotify.clientId,
    redirectUri: config.spotify.redirectUri,
    mobileRedirectUri: config.spotify.mobileRedirectUri,
    scopes: [
      "user-read-email",
      "user-read-private",
      "user-read-currently-playing",
      "user-read-playback-state",
    ],
    authorizeUrl: "https://accounts.spotify.com/authorize",
    configured: isSpotifyConfigured(),
  });
});

const callbackSchema = z.object({
  code: z.string(),
  codeVerifier: z.string().optional(),
  /** Must match authorize redirect_uri (e.g. auen://spotify-callback). */
  redirectUri: z.string().min(1).optional(),
  userId: z.string().optional(),
});

/**
 * Browser redirect from Spotify Dashboard redirect URI.
 * Example: GET /spotify/callback?code=...&state=userId
 *
 * For confidential clients (client secret set) no PKCE verifier is required.
 * `state` should be the Äuen user id when linking an account.
 */
spotifyRouter.get("/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? ""); // userId
  const error = req.query.error;

  if (error) {
    return res.status(400).send(`Spotify authorize error: ${error}`);
  }
  if (!code) {
    return res.status(400).send("Missing code");
  }
  if (!state) {
    return res
      .status(400)
      .send("Missing state (Äuen user id). Open authorize URL with state=<userId>.");
  }

  try {
    await exchangeSpotifyCode(state, code);
    await syncSpotifyNowPlaying(state);
    res
      .status(200)
      .type("html")
      .send(
        `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
        <h1>Spotify connected</h1>
        <p>You can close this window and return to Äuen.</p>
        </body></html>`
      );
  } catch (err: any) {
    res.status(502).send(`Token exchange failed: ${err.message}`);
  }
});

/**
 * iOS app PKCE path: hands code + optional codeVerifier after ASWebAuthenticationSession.
 */
spotifyRouter.post("/callback", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    await exchangeSpotifyCode(
      req.userId!,
      parsed.data.code,
      parsed.data.codeVerifier,
      parsed.data.redirectUri
    );
    const synced = await syncSpotifyNowPlaying(req.userId!);
    res.status(200).json({ connected: true, synced });
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
