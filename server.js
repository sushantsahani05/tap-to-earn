import "dotenv/config";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keep a short rolling history per user so the assistant has context
// without you needing a real conversation database yet.
const chatHistories = new Map(); // userId -> [{role, content}, ...]
const MAX_HISTORY_MESSAGES = 10;

const ASSISTANT_SYSTEM_PROMPT = `You are the in-app assistant for a Telegram
tap-to-earn mini app. Users earn points by tapping and by inviting friends
via referral links. Be brief, friendly, and encouraging. You can explain how
the app works, answer questions about points/referrals, and chat casually.
Keep replies under ~80 words unless the user asks for more detail.`;

const POINTS_PER_TAP = 1;
const REFERRAL_BONUS = 50;

// Get or create a user. Called when the mini app first loads.
app.post("/api/user", async (req, res) => {
  const { userId, referralCode } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const db = await getDb();
  let user = db.data.users[userId];

  if (!user) {
    user = {
      id: userId,
      points: 0,
      taps: 0,
      referralCode: nanoid(8),
      referredBy: null,
      referralCount: 0,
      createdAt: new Date().toISOString(),
    };
    db.data.users[userId] = user;

    // Apply referral bonus if this user arrived via someone's invite link
    if (referralCode) {
      const referrer = Object.values(db.data.users).find(
        (u) => u.referralCode === referralCode && u.id !== userId
      );
      if (referrer) {
        user.referredBy = referrer.id;
        user.points += REFERRAL_BONUS;
        referrer.points += REFERRAL_BONUS;
        referrer.referralCount += 1;
      }
    }
    await db.write();
  }

  res.json(user);
});

// Register a tap
app.post("/api/tap", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const db = await getDb();
  const user = db.data.users[userId];
  if (!user) return res.status(404).json({ error: "user not found" });

  user.taps += 1;
  user.points += POINTS_PER_TAP;
  await db.write();

  res.json(user);
});

// Simple leaderboard
app.get("/api/leaderboard", async (req, res) => {
  const db = await getDb();
  const top = Object.values(db.data.users)
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((u) => ({ id: u.id, points: u.points }));
  res.json(top);
});

// Chat with the in-app Claude assistant
app.post("/api/chat", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) {
    return res.status(400).json({ error: "userId and message required" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on the server" });
  }

  const history = chatHistories.get(userId) || [];
  history.push({ role: "user", content: message });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: ASSISTANT_SYSTEM_PROMPT,
      messages: history,
    });

    const replyText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    history.push({ role: "assistant", content: replyText });
    // Trim history so it doesn't grow unbounded
    chatHistories.set(userId, history.slice(-MAX_HISTORY_MESSAGES));

    res.json({ reply: replyText });
  } catch (err) {
    console.error("Claude API error:", err);
    res.status(500).json({ error: "Failed to get a response from the assistant" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
