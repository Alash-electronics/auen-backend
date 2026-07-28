import { DatabaseSync } from "node:sqlite";
import path from "path";

// SQLite via Node's built-in `node:sqlite` module (stable in Node 22.5+,
// still flagged experimental) - zero native compilation, zero binary
// downloads, works anywhere `npm install` works. For production, this file
// is the only thing you'd need to swap out (e.g. for a `pg` Pool) - every
// route talks to the small repository functions in `repo.ts`, never to
// raw SQL directly.
const dbPath = process.env.DATABASE_PATH ?? path.join(__dirname, "..", "dev.db");

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS spotify_accounts (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS apple_music_accounts (
    user_id          TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    music_user_token TEXT NOT NULL,
    storefront       TEXT NOT NULL DEFAULT 'us',
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS locations (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS now_playing (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    service     TEXT NOT NULL,
    track_name  TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    album_art   TEXT,
    is_playing  INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS privacy_settings (
    user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    share_location    INTEGER NOT NULL DEFAULT 0,
    share_radius_m    INTEGER NOT NULL DEFAULT 1000,
    share_now_playing INTEGER NOT NULL DEFAULT 1
  );
`);
