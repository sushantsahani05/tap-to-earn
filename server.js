import "dotenv/config";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const POINTS_PER_TAP = 1;
const REFERRAL_BONUS = 50;

// Create/get user
app.post("/api/user", async (req, res) => {
  try {
    const { telegramId, username, referrerId } = req.body;

    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }

    const db = await getDb();

    let user = db.data.users.find(
      (u) => String(u.telegramId) === String(telegramId)
    );

    if (!user) {
      user = {
        id: nanoid(),
        telegramId: String(telegramId),
        username: username || "",
        points: 0,
        taps: 0,
        referrals: 0,
        referredBy: null,
        createdAt: new Date().toISOString()
      };

      // Referral bonus
      if (
        referrerId &&
        String(referrerId) !== String(telegramId)
      ) {
        const referrer = db.data.users.find(
          (u) => String(u.telegramId) === String(referrerId)
        );

        if (referrer) {
          user.referredBy = String(referrerId);
          referrer.points += REFERRAL_BONUS;
          referrer.referrals += 1;
        }
      }

      db.data.users.push(user);
      await db.write();
    }

    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error("User error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Tap
app.post("/api/tap", async (req, res) => {
  try {
    const { telegramId } = req.body;

    if (!telegramId) {
      return res.status(400).json({ error: "telegramId is required" });
    }

    const db = await getDb();

    const user = db.data.users.find(
      (u) => String(u.telegramId) === String(telegramId)
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.points += POINTS_PER_TAP;
    user.taps += 1;

    await db.write();

    res.json({
      success: true,
      points: user.points,
      taps: user.taps
    });
  } catch (error) {
    console.error("Tap error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Leaderboard
app.get("/api/leaderboard", async (req, res) => {
  try {
    const db = await getDb();

    const leaderboard = [...db.data.users]
      .sort((a, b) => b.points - a.points)
      .slice(0, 20)
      .map((user, index) => ({
        rank: index + 1,
        username: user.username || "Anonymous",
        points: user.points
      }));

    res.json(leaderboard);
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});