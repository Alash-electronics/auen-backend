import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",

  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? "",
    /** Web / server redirect (Render). */
    redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? "auen://spotify-callback",
    /** iOS ASWebAuthenticationSession scheme — add both URIs in Spotify Dashboard. */
    mobileRedirectUri: process.env.SPOTIFY_MOBILE_REDIRECT_URI ?? "auen://spotify-callback",
  },

  appleMusic: {
    teamId: process.env.APPLE_TEAM_ID ?? "",
    keyId: process.env.APPLE_MUSIC_KEY_ID ?? "",
    privateKey: (process.env.APPLE_MUSIC_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  },
};
