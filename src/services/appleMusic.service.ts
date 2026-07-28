import jwt from "jsonwebtoken";
import { config } from "../config";

/**
 * Apple Music has no server-side "currently playing" API like Spotify's.
 * The developer token below is only used by the iOS app to authorize
 * MusicKit and request a per-user music-user-token; "now playing" itself
 * is read on-device (MPMusicPlayerController / MusicKit) and pushed to us
 * via POST /now-playing.
 *
 * Requires a paid Apple Developer Program membership + a MusicKit key
 * (.p8 file) from https://developer.apple.com/account/resources/authkeys.
 */
export function generateAppleMusicDeveloperToken(): string {
  const { teamId, keyId, privateKey } = config.appleMusic;
  if (!teamId || !keyId || !privateKey) {
    throw new Error(
      "Apple Music is not configured yet - set APPLE_TEAM_ID, APPLE_MUSIC_KEY_ID and APPLE_MUSIC_PRIVATE_KEY in .env"
    );
  }

  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    expiresIn: "180d", // Apple's documented maximum
    issuer: teamId,
    header: { alg: "ES256", kid: keyId },
  });
}
