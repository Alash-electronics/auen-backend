import fetch from "node-fetch";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { config } from "../config";
import { SpotifyAccounts, NowPlaying, Users, UserRow } from "../repo";
import { signToken } from "../utils/jwt";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const NOW_PLAYING_URL = "https://api.spotify.com/v1/me/player/currently-playing";
const SEARCH_URL = "https://api.spotify.com/v1/search";
const ME_URL = "https://api.spotify.com/v1/me";

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  email: string | null;
}

function basicAuthHeader(): string {
  return (
    "Basic " +
    Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64")
  );
}

/**
 * App-level Client Credentials token (no user). Good for Search / catalog.
 * Cannot call /me/* endpoints.
 */
export async function getClientCredentialsToken(): Promise<string> {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify client credentials failed (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as SpotifyTokenResponse;
  return data.access_token;
}

export async function searchTracks(query: string, limit = 10) {
  const token = await getClientCredentialsToken();
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify search failed (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as any;
  return (data.tracks?.items ?? []).map((t: any) => ({
    id: t.id as string,
    trackName: t.name as string,
    artistName: (t.artists ?? []).map((a: any) => a.name).join(", ") as string,
    albumArt: (t.album?.images?.[0]?.url ?? t.album?.images?.[1]?.url ?? null) as string | null,
    previewUrl: (t.preview_url ?? null) as string | null,
    spotifyUrl: (t.external_urls?.spotify ?? null) as string | null,
  }));
}

/** Exchange auth code → Spotify tokens (PKCE and/or client secret). */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier?: string,
  redirectUri?: string
): Promise<SpotifyTokenResponse> {
  const redirect = redirectUri || config.spotify.redirectUri;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (codeVerifier) {
    body.set("client_id", config.spotify.clientId);
    body.set("code_verifier", codeVerifier);
  } else {
    headers.Authorization = basicAuthHeader();
  }

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers,
    body,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as SpotifyTokenResponse;
  if (!data.refresh_token) {
    throw new Error("Spotify did not return a refresh_token — re-authorize with show_dialog");
  }
  return data;
}

/**
 * Exchange an authorization code for tokens and attach them to a known user.
 */
export async function exchangeSpotifyCode(
  userId: string,
  code: string,
  codeVerifier?: string,
  redirectUri?: string
): Promise<void> {
  const data = await exchangeCodeForTokens(code, codeVerifier, redirectUri);
  SpotifyAccounts.upsert(
    userId,
    data.access_token,
    data.refresh_token!,
    new Date(Date.now() + data.expires_in * 1000)
  );
}

export async function fetchSpotifyProfile(accessToken: string): Promise<SpotifyProfile> {
  const resp = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Spotify /me failed (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as any;
  return {
    id: data.id,
    display_name: data.display_name ?? null,
    email: data.email ?? null,
  };
}

/**
 * Full "Sign in with Spotify":
 * exchange code → load profile → find/create Äuen user → store tokens → JWT.
 */
export async function loginWithSpotify(
  code: string,
  codeVerifier: string,
  redirectUri?: string
): Promise<{ token: string; user: UserRow }> {
  const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);
  const profile = await fetchSpotifyProfile(tokens.access_token);

  let user =
    Users.findBySpotifyId(profile.id) ||
    (profile.email ? Users.findByEmail(profile.email) : undefined);

  if (!user) {
    const email = profile.email ?? `spotify_${profile.id}@spotify.auen.local`;
    const displayName = profile.display_name || profile.email?.split("@")[0] || "Spotify listener";
    // Unusable random password — login is Spotify-only for this account.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
    user = Users.create(email, passwordHash, displayName, profile.id);
  } else if (!user.spotify_id) {
    Users.setSpotifyId(user.id, profile.id);
    user = Users.findById(user.id)!;
  }

  SpotifyAccounts.upsert(
    user.id,
    tokens.access_token,
    tokens.refresh_token!,
    new Date(Date.now() + tokens.expires_in * 1000)
  );

  // Best-effort now-playing sync (user may not be playing).
  try {
    await syncSpotifyNowPlaying(user.id);
  } catch {
    /* ignore */
  }

  const token = signToken({ userId: user.id });
  return { token, user };
}

async function refreshAccessToken(refreshToken: string): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
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

export function isSpotifyConfigured(): boolean {
  const { clientId, clientSecret } = config.spotify;
  return (
    Boolean(clientId) &&
    !clientId.includes("your-spotify") &&
    Boolean(clientSecret) &&
    !clientSecret.includes("your-spotify")
  );
}
