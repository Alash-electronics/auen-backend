import { randomUUID } from "crypto";
import { db } from "./db";

// Small typed repository layer over the raw tables in db.ts, so route
// files never write SQL directly.

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  spotify_id?: string | null;
}

export const Users = {
  create(email: string, passwordHash: string, displayName: string, spotifyId?: string): UserRow {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, spotify_id) VALUES (?, ?, ?, ?, ?)`
    ).run(id, email, passwordHash, displayName, spotifyId ?? null);
    Privacy.ensureDefaults(id);
    return Users.findById(id)!;
  },
  findByEmail(email: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
  },
  findById(id: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  },
  findBySpotifyId(spotifyId: string): UserRow | undefined {
    return db.prepare(`SELECT * FROM users WHERE spotify_id = ?`).get(spotifyId) as
      | UserRow
      | undefined;
  },
  setSpotifyId(userId: string, spotifyId: string) {
    db.prepare(`UPDATE users SET spotify_id = ? WHERE id = ?`).run(spotifyId, userId);
  },
};

export interface SpotifyAccountRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

export const SpotifyAccounts = {
  find(userId: string): SpotifyAccountRow | undefined {
    return db.prepare(`SELECT * FROM spotify_accounts WHERE user_id = ?`).get(userId) as
      | SpotifyAccountRow
      | undefined;
  },
  upsert(userId: string, accessToken: string, refreshToken: string, expiresAt: Date) {
    db.prepare(
      `INSERT INTO spotify_accounts (user_id, access_token, refresh_token, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at`
    ).run(userId, accessToken, refreshToken, expiresAt.toISOString());
  },
  delete(userId: string) {
    db.prepare(`DELETE FROM spotify_accounts WHERE user_id = ?`).run(userId);
  },
  allUserIds(): string[] {
    return (db.prepare(`SELECT user_id FROM spotify_accounts`).all() as { user_id: string }[]).map(
      (r) => r.user_id
    );
  },
};

export const AppleMusicAccounts = {
  find(userId: string) {
    return db.prepare(`SELECT * FROM apple_music_accounts WHERE user_id = ?`).get(userId) as
      | { user_id: string; music_user_token: string; storefront: string }
      | undefined;
  },
  upsert(userId: string, musicUserToken: string, storefront: string) {
    db.prepare(
      `INSERT INTO apple_music_accounts (user_id, music_user_token, storefront)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         music_user_token = excluded.music_user_token,
         storefront = excluded.storefront`
    ).run(userId, musicUserToken, storefront);
  },
  delete(userId: string) {
    db.prepare(`DELETE FROM apple_music_accounts WHERE user_id = ?`).run(userId);
  },
};

export const Locations = {
  upsert(userId: string, lat: number, lng: number) {
    // Timestamp generated in JS (ISO 8601) rather than SQLite's
    // datetime('now') - keeping every stored timestamp in the same format
    // matters because "freshness" filtering compares these as strings.
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO locations (user_id, lat, lng, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, updated_at = excluded.updated_at`
    ).run(userId, lat, lng, now);
  },
};

export interface NowPlayingRow {
  user_id: string;
  service: string;
  track_name: string;
  artist_name: string;
  album_art: string | null;
  is_playing: number;
  updated_at: string;
}

export const NowPlaying = {
  upsert(
    userId: string,
    service: string,
    trackName: string,
    artistName: string,
    albumArt: string | null,
    isPlaying: boolean
  ) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO now_playing (user_id, service, track_name, artist_name, album_art, is_playing, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         service = excluded.service,
         track_name = excluded.track_name,
         artist_name = excluded.artist_name,
         album_art = excluded.album_art,
         is_playing = excluded.is_playing,
         updated_at = excluded.updated_at`
    ).run(userId, service, trackName, artistName, albumArt, isPlaying ? 1 : 0, now);
  },
  find(userId: string): NowPlayingRow | undefined {
    return db.prepare(`SELECT * FROM now_playing WHERE user_id = ?`).get(userId) as
      | NowPlayingRow
      | undefined;
  },
  delete(userId: string) {
    db.prepare(`DELETE FROM now_playing WHERE user_id = ?`).run(userId);
  },
};

export interface PrivacyRow {
  user_id: string;
  share_location: number;
  share_radius_m: number;
  share_now_playing: number;
}

export const Privacy = {
  ensureDefaults(userId: string) {
    db.prepare(
      `INSERT OR IGNORE INTO privacy_settings (user_id) VALUES (?)`
    ).run(userId);
  },
  get(userId: string): PrivacyRow {
    Privacy.ensureDefaults(userId);
    return db.prepare(`SELECT * FROM privacy_settings WHERE user_id = ?`).get(userId) as unknown as PrivacyRow;
  },
  update(userId: string, shareLocation: boolean, shareRadiusM: number, shareNowPlaying: boolean) {
    db.prepare(
      `INSERT INTO privacy_settings (user_id, share_location, share_radius_m, share_now_playing)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         share_location = excluded.share_location,
         share_radius_m = excluded.share_radius_m,
         share_now_playing = excluded.share_now_playing`
    ).run(userId, shareLocation ? 1 : 0, shareRadiusM, shareNowPlaying ? 1 : 0);
  },
};

export interface NearbyCandidateRow {
  id: string;
  display_name: string;
  lat: number;
  lng: number;
  share_radius_m: number;
  share_now_playing: number;
  np_service: string | null;
  np_track_name: string | null;
  np_artist_name: string | null;
  np_album_art: string | null;
  np_is_playing: number | null;
}

/** Everyone sharing their location, freshly enough, excluding the requester. */
export function findShareableUsers(requesterId: string, staleCutoffIso: string): NearbyCandidateRow[] {
  return db
    .prepare(
      `SELECT
         u.id,
         u.display_name,
         l.lat,
         l.lng,
         p.share_radius_m,
         p.share_now_playing,
         np.service     AS np_service,
         np.track_name  AS np_track_name,
         np.artist_name AS np_artist_name,
         np.album_art   AS np_album_art,
         np.is_playing  AS np_is_playing
       FROM users u
       JOIN locations l ON l.user_id = u.id
       JOIN privacy_settings p ON p.user_id = u.id
       LEFT JOIN now_playing np ON np.user_id = u.id
       WHERE u.id != ?
         AND p.share_location = 1
         AND l.updated_at >= ?`
    )
    .all(requesterId, staleCutoffIso) as unknown as NearbyCandidateRow[];
}
