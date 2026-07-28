import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Users, SpotifyAccounts, AppleMusicAccounts } from "../repo";
import { signToken } from "../utils/jwt";
import { requireAuth, AuthedRequest } from "../middleware/auth";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(60),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password, displayName } = parsed.data;

  if (Users.findByEmail(email)) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = Users.create(email, passwordHash, displayName);

  const token = signToken({ userId: user.id });
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { email, password } = parsed.data;

  const user = Users.findByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken({ userId: user.id });
  res.json({
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name },
  });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = Users.findById(req.userId!);
  if (!user) return res.status(404).json({ error: "Not found" });

  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    connectedSpotify: !!SpotifyAccounts.find(user.id),
    connectedAppleMusic: !!AppleMusicAccounts.find(user.id),
  });
});
