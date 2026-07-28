import { SpotifyAccounts } from "../repo";
import { syncSpotifyNowPlaying } from "../services/spotify.service";
import { broadcastNearbyChanged } from "../socket";

const POLL_INTERVAL_MS = 30_000;

/**
 * Background loop that keeps NowPlaying fresh for every user who has
 * connected Spotify, without the iOS app needing to stay open. Simple
 * sequential polling is fine at prototype scale; if this grows past a few
 * hundred connected accounts, shard by user id across workers or move to a
 * queue (BullMQ, etc.).
 */
export function startSpotifyPoller() {
  setInterval(async () => {
    const userIds = SpotifyAccounts.allUserIds();
    for (const userId of userIds) {
      try {
        const changed = await syncSpotifyNowPlaying(userId);
        if (changed) broadcastNearbyChanged();
      } catch (err) {
        console.warn(`Spotify poll failed for ${userId}:`, err);
      }
    }
  }, POLL_INTERVAL_MS);

  console.log(`Spotify poller running every ${POLL_INTERVAL_MS / 1000}s`);
}
