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
 *
 * Two modes:
 * 1) iOS PKCE (ASWebAuthenticationSession): state empty / `ios` / `mobile`
 *    → bounce to `auen://spotify-callback?code=…` so the sheet completes.
 *    Token exchange stays on the device → POST /auth/spotify or POST /spotify/callback.
 * 2) Web link (legacy): state = Äuen userId → exchange here (client secret, no PKCE).
 *
 * Custom schemes (`auen://…`) often fail with "redirect_uri: Not matching configuration"
 * if not added in the Spotify Dashboard — prefer the HTTPS callback and bounce.
 */
spotifyRouter.get("/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");
  const error = typeof req.query.error === "string" ? req.query.error : "";
  const errorDescription =
    typeof req.query.error_description === "string" ? req.query.error_description : "";

  // Mobile / iOS: always deep-link back into the app (do not exchange here).
  const isMobileBounce =
    !state || state === "ios" || state === "mobile" || state.startsWith("ios-");

  if (isMobileBounce) {
    const params = new URLSearchParams();
    if (error) {
      params.set("error", error);
      if (errorDescription) params.set("error_description", errorDescription);
    } else if (code) {
      params.set("code", code);
    } else {
      params.set("error", "missing_code");
    }
    if (state) params.set("state", state);

    const deepLink = `auen://spotify-callback?${params.toString()}`;
    const safeHref = deepLink
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");

    return res
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta http-equiv="refresh" content="0;url=${safeHref}"/>
  <title>Returning to Äuen…</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #F2F4FF; color: #16142A; }
    a { color: #FF5A3C; font-weight: 600; }
  </style>
</head>
<body>
  <p>Returning to Äuen…</p>
  <p><a href="${safeHref}">Tap here if the app does not open</a></p>
  <script>location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`);
  }

  if (error) {
    return res.status(400).send(`Spotify authorize error: ${error}`);
  }
  if (!code) {
    return res.status(400).send("Missing code");
  }

  // Web link path: state is Äuen user id
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
