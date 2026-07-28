import { findShareableUsers } from "../repo";
import { haversineDistanceMeters, fuzzCoordinate } from "../utils/geo";

const STALE_AFTER_MS = 15 * 60 * 1000; // ignore locations older than 15 min

export interface NearbyResult {
  id: string;
  displayName: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  nowPlaying: {
    service: string;
    trackName: string;
    artistName: string;
    albumArt: string | null;
    isPlaying: boolean;
  } | null;
}

/**
 * Finds users near `origin` who have opted in to sharing. Distance is
 * computed in application code with Haversine rather than a SQL geo query,
 * which keeps the project runnable on plain SQLite with zero extensions.
 * Fine up to tens of thousands of active users; beyond that, pre-filter
 * with a bounding box in SQL or move to PostGIS ST_DWithin on Postgres.
 *
 * Each candidate is visible only if the requested radius AND that user's
 * own max share radius both allow it - a viewer can't force a wider view
 * than someone is comfortable sharing at.
 */
export function findNearbyUsers(
  requesterId: string,
  origin: { lat: number; lng: number },
  requestedRadiusMeters: number
): NearbyResult[] {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const candidates = findShareableUsers(requesterId, cutoff);

  const results: NearbyResult[] = [];
  for (const u of candidates) {
    const distance = haversineDistanceMeters(origin.lat, origin.lng, u.lat, u.lng);
    const effectiveRadius = Math.min(requestedRadiusMeters, u.share_radius_m);
    if (distance > effectiveRadius) continue;

    results.push({
      id: u.id,
      displayName: u.display_name,
      lat: fuzzCoordinate(u.lat),
      lng: fuzzCoordinate(u.lng),
      distanceMeters: Math.round(distance),
      nowPlaying:
        u.np_service && u.share_now_playing
          ? {
              service: u.np_service,
              trackName: u.np_track_name!,
              artistName: u.np_artist_name!,
              albumArt: u.np_album_art,
              isPlaying: !!u.np_is_playing,
            }
          : null,
    });
  }

  results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return results;
}
