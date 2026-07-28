import fetch from "node-fetch";
import { config } from "../config";
import { SpotifyAccounts, NowPlaying } from "../repo";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing";

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

/**
 * Exchange an authorization code (from the PKCE flow the iOS app runs via
 * ASWebAuthenticationSession) for an access + refresh token pair, then
 * store them against the user.
 */
export async function exchangeSpotifyCode(
  userId: string,
  code: string,
  codeVerifier: string
): Promise<void> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.spotify.redirectUri,
    client_id: config.spotify.clientId,
    code_verifier: codeVerifier,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as SpotifyTokenResponse;
  if (!data.refresh_token) {
    throw new Error("Spotify did not return a refresh_token - check the PKCE flow");
  }

  SpotifyAccounts.upsert(
    userId,
    data.access_token,
    data.refresh_token,
    new Date(Date.now() + data.expires_in * 1000)
  );
}

async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.spotify.clientId,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify token refresh failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as SpotifyTokenResponse;
}

async function validAccessToken(userId: string): Promise<string | null> {
  const account = SpotifyAccounts.find(userId);
  if (!account) return null;

  if (new Date(account.expires_at).getTime() - Date.now() > 30_000) {
    return account.access_token;
  }

  const refreshed = await refreshAccessToken(account.refresh_token);
  SpotifyAccounts.upsert(
    userId,
    refreshed.access_token,
    refreshed.refresh_token ?? account.refresh_token,
    new Date(Date.now() + refreshed.expires_in * 1000)
  );
  return refreshed.access_token;
}

/**
 * Fetches what the user is currently playing on Spotify and upserts the
 * shared NowPlaying record. Returns true if something changed.
 */
export async function syncSpotifyNowPlaying(userId: string): Promise<boolean> {
  const accessToken = await validAccessToken(userId);
  if (!accessToken) return false;

  const resp = await fetch(NOW_PLAYING_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 204 = nothing currently playing
  if (resp.status === 204 || resp.status === 202) {
    return false;
  }
  if (!resp.ok) {
    console.warn(`Spotify now-playing fetch failed for user ${userId}: ${resp.status}`);
    return false;
  }

  const data = (await resp.json()) as any;
  if (!data?.item) return false;

  NowPlaying.upsert(
    userId,
    "spotify",
    data.item.name,
    (data.item.artists ?? []).map((a: any) => a.name).join(", "),
    data.item.album?.images?.[0]?.url ?? null,
    !!data.is_playing
  );

  return true;
}
