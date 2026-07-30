import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { NowPlaying } from "../repo";
import { broadcastNearbyChanged } from "../socket";

export const nowPlayingRouter = Router();

const pushSchema = z.object({
  service: z.enum(["spotify", "apple_music"]),
  trackName: z.string().min(1),
  artistName: z.string().min(1),
  albumArt: z.string().url().nullish(),
  isPlaying: z.boolean().default(true),
});

/** Current user's now-playing row (after Spotify sync or client push). */
nowPlayingRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const row = NowPlaying.find(req.userId!);
  if (!row) return res.json({ nowPlaying: null });
  res.json({
    nowPlaying: {
      service: row.service,
      trackName: row.track_name,
      artistName: row.artist_name,
      albumArt: row.album_art,
      isPlaying: !!row.is_playing,
      updatedAt: row.updated_at,
    },
  });
});

/**
 * Client-push endpoint - used by Apple Music (no server-side "currently
 * playing" API exists) and as a manual fallback for Spotify.
 */
nowPlayingRouter.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = pushSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { service, trackName, artistName, albumArt, isPlaying } = parsed.data;

  NowPlaying.upsert(req.userId!, service, trackName, artistName, albumArt ?? null, isPlaying);

  broadcastNearbyChanged();
  res.status(204).send();
});

nowPlayingRouter.delete("/", requireAuth, async (req: AuthedRequest, res) => {
  NowPlaying.delete(req.userId!);
  broadcastNearbyChanged();
  res.status(204).send();
});
