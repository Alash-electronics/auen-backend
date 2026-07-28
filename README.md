# Äuen - backend

Express + TypeScript API. Auth, Spotify OAuth + polling, Apple Music
developer tokens, location, nearby search, privacy, and Socket.io
real-time nudges.

Storage is SQLite via Node's built-in `node:sqlite` module - no native
compilation, no external database server, no binary downloads. `npm
install` and go. Swap `src/db.ts` for Postgres later if you need it (the
rest of the app talks only to `src/repo.ts`, not raw SQL).

## Requirements

- Node.js **22.5+** (for `node:sqlite`). Check with `node -v`.

## Run it

```bash
cp .env.example .env    # defaults work as-is for local dev
npm install
npm run build
npm start                # http://localhost:4000
```

Or for auto-reload during development: `npm run dev` (uses ts-node-dev).

Verify it's up:

```bash
curl http://localhost:4000/health
# {"ok":true}
```

## Try the full flow with curl

```bash
# Register
curl -s -X POST localhost:4000/auth/register -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123","displayName":"You"}'
# -> { "token": "...", "user": {...} }

TOKEN=<paste the token>

# Opt in to sharing
curl -s -X PATCH localhost:4000/privacy -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"shareLocation":true,"shareRadiusMeters":2000,"shareNowPlaying":true}'

# Push a location
curl -s -X POST localhost:4000/location -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"lat":43.238,"lng":76.9452}'

# Look around
curl -s "localhost:4000/nearby?lat=43.238&lng=76.9452&radius=2000" \
  -H "Authorization: Bearer $TOKEN"
```

## API surface

| Route | Auth | Purpose |
|---|---|---|
| `POST /auth/register` | - | Create an account, returns a JWT |
| `POST /auth/login` | - | Returns a JWT |
| `GET /auth/me` | yes | Current user + which services are connected |
| `GET /spotify/auth-config` | yes | Client ID/redirect URI/scopes for the iOS app to build the authorize URL |
| `POST /spotify/callback` | yes | Exchange a PKCE `code` for tokens, store them |
| `POST /spotify/sync` | yes | Manually re-fetch currently-playing |
| `DELETE /spotify/disconnect` | yes | Forget the Spotify account |
| `GET /apple-music/developer-token` | yes | Signed MusicKit developer token |
| `POST /apple-music/token` | yes | Store the per-user MusicKit user token |
| `DELETE /apple-music/disconnect` | yes | Forget the Apple Music account |
| `POST /now-playing` | yes | Client-push "what's playing" (used by Apple Music) |
| `DELETE /now-playing` | yes | Clear now-playing |
| `POST /location` | yes | Update current coordinates |
| `GET /nearby?lat&lng&radius` | yes | Nearby opted-in users + their tracks |
| `GET /privacy` / `PATCH /privacy` | yes | Visibility toggle, radius, now-playing toggle |
| Socket.io `nearby:changed` event | yes (auth token in handshake) | Fired whenever anyone's location/track changes - clients should refetch `/nearby` |

## Wiring up real Spotify / Apple Music accounts

1. **Spotify** (free): https://developer.spotify.com/dashboard - create an
   app, grab the Client ID, add redirect URI `auen://spotify-callback`
   (or your own scheme). Put the Client ID in `.env` as `SPOTIFY_CLIENT_ID`.
   No client secret needed server-side if the iOS app does PKCE (recommended)
   - but the field's there if you use the confidential flow instead.
2. **Apple Music** (paid, $99/yr Apple Developer Program):
   https://developer.apple.com/account/resources/authkeys - create a
   MusicKit key, download the `.p8`. Fill `APPLE_TEAM_ID`,
   `APPLE_MUSIC_KEY_ID`, and paste the `.p8` contents into
   `APPLE_MUSIC_PRIVATE_KEY` (escape newlines as `\n`, see `.env.example`).

Until those are filled in, `/spotify/*` and `/apple-music/*` routes will
error clearly rather than silently doing nothing - everything else works
fine without them.

## Notes on the design

- **Privacy-first defaults**: `shareLocation` defaults to `false` on
  signup - a new user is invisible until they opt in.
- **No location history**: the `locations` table only ever holds the
  latest position per user, overwritten in place. Nobody's movement trail
  is stored.
- **Fuzzed coordinates**: `/nearby` responses round other users'
  coordinates to ~100m, and distance is capped by *their* chosen radius,
  not just the requester's - a viewer can't force a wider view than
  someone is comfortable sharing.
- **Stale locations drop out**: anyone who hasn't pinged `/location` in 15
  minutes stops showing up as nearby.
- **Real-time model kept simple on purpose**: rather than per-client
  geospatial fan-out, any change broadcasts one `nearby:changed` event and
  clients refetch `/nearby`. Correct and simple; revisit if this needs to
  scale past a few thousand concurrent sockets.
