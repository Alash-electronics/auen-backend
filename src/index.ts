import express from "express";
import cors from "cors";
import http from "http";
import { config } from "./config";
import { initSocket } from "./socket";
import { startSpotifyPoller } from "./jobs/spotifyPoller";

import { authRouter } from "./routes/auth.routes";
import { spotifyRouter } from "./routes/spotify.routes";
import { appleMusicRouter } from "./routes/appleMusic.routes";
import { locationRouter } from "./routes/location.routes";
import { nearbyRouter } from "./routes/nearby.routes";
import { nowPlayingRouter } from "./routes/nowPlaying.routes";
import { privacyRouter } from "./routes/privacy.routes";

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/spotify", spotifyRouter);
app.use("/apple-music", appleMusicRouter);
app.use("/location", locationRouter);
app.use("/nearby", nearbyRouter);
app.use("/now-playing", nowPlayingRouter);
app.use("/privacy", privacyRouter);

// Fallback error handler so unexpected exceptions return JSON, not an HTML stack trace.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = http.createServer(app);
initSocket(server);
startSpotifyPoller();

// Bind 0.0.0.0 so Render (and other hosts) can reach the process.
server.listen(config.port, "0.0.0.0", () => {
  console.log(`Äuen API listening on http://0.0.0.0:${config.port}`);
});
