#!/usr/bin/env node
/**
 * Diagnose Spotify integration for Äuen backend.
 *
 * Usage:
 *   node scripts/check-spotify.mjs
 *   SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… node scripts/check-spotify.mjs
 *
 * Without credentials: documents what's missing.
 * With Client ID + Secret: runs Client Credentials and searches real tracks.
 */

import "dotenv/config";
import fetch from "node-fetch";

const clientId = process.env.SPOTIFY_CLIENT_ID ?? "";
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? "auen://spotify-callback";

const report = [];
const ok = (msg) => report.push(`✅ ${msg}`);
const bad = (msg) => report.push(`❌ ${msg}`);
const info = (msg) => report.push(`ℹ️  ${msg}`);

console.log("Äuen · Spotify integration check\n");

if (!clientId || clientId.includes("your-spotify")) {
  bad("SPOTIFY_CLIENT_ID is missing or still a placeholder");
  info("Create an app at https://developer.spotify.com/dashboard");
  info("Copy Client ID into backend/.env");
} else {
  ok(`SPOTIFY_CLIENT_ID set (${clientId.slice(0, 6)}…)`);
}

if (!clientSecret || clientSecret.includes("your-spotify")) {
  bad("SPOTIFY_CLIENT_SECRET is missing or still a placeholder");
  info("Dashboard → your app → View client secret");
} else {
  ok("SPOTIFY_CLIENT_SECRET set");
}

ok(`Redirect URI (config): ${redirectUri}`);
info("Must match exactly in Spotify Dashboard → Redirect URIs");

async function clientCredentials() {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) {
    bad(`Client Credentials token failed (${resp.status}): ${text}`);
    return null;
  }
  const data = JSON.parse(text);
  ok(`Client Credentials token OK (expires_in=${data.expires_in}s)`);
  return data.access_token;
}

async function searchTracks(token) {
  const q = encodeURIComponent("Blinding Lights");
  const resp = await fetch(
    `https://api.spotify.com/v1/search?q=${q}&type=track&limit=3`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) {
    bad(`Search failed (${resp.status}): ${await resp.text()}`);
    return;
  }
  const data = await resp.json();
  const items = data.tracks?.items ?? [];
  if (!items.length) {
    bad("Search returned 0 tracks");
    return;
  }
  ok(`Search OK — ${items.length} tracks`);
  for (const t of items) {
    const art = t.album?.images?.[0]?.url ?? "(no art)";
    console.log(`   • ${t.artists.map((a) => a.name).join(", ")} — ${t.name}`);
    console.log(`     art: ${art}`);
  }
}

async function checkNowPlayingNeedsUser() {
  info(
    "user-read-currently-playing requires Authorization Code + PKCE (iOS ASWebAuthenticationSession)"
  );
  info("Client Credentials cannot call /me/player/currently-playing (403/401)");
}

async function main() {
  const canAuth =
    clientId &&
    clientSecret &&
    !clientId.includes("your-spotify") &&
    !clientSecret.includes("your-spotify");

  if (canAuth) {
    const token = await clientCredentials();
    if (token) {
      await searchTracks(token);
    }
  } else {
    bad("Skipping live Spotify API calls — credentials incomplete");
    info("iOS mock map still shows real track art via iTunes-seeded RealTrackCatalog");
  }

  await checkNowPlayingNeedsUser();

  console.log("\n--- summary ---");
  for (const line of report) console.log(line);

  const hardFail = report.some((l) => l.startsWith("❌") && l.includes("CLIENT"));
  process.exit(canAuth && !report.some((l) => l.includes("failed")) ? 0 : hardFail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
