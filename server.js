import "dotenv/config";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { getDb } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const POINTS_PER_TAP = 10000;
const REFERRAL_BONUS = 500000000;
const TASK_REWARD = 100000000;
const MAX_CHARGES = 1000;
const CHARGE_REGEN_PER_SEC = 1;
const AD_REWARD_CHARGES = 500;
const AD_REWARD_POINTS = 1000000;

const TASK_KEYS = ["telegram", "youtube", "instagram"];
const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL || "@your_channel";

async function verifyTelegramMembership(userId) {
  const token = process.env.BOT_TOKEN;
  if (!token) return false;

  try {
    const url = `https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(
      TELEGRAM_CHANNEL
    )}&user_id=${encodeURIComponent(userId)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return false;

    const status = data.result?.status;
    return ["member", "administrator", "creator"].includes(status);
  } catch (err) {
    console.error("Telegram membership check failed:", err);
    return false;
  }
}

function regenCharges(user) {
  const now = Date.now();
  const last = new Date(user.lastChargeTime).getTime();
  const elapsedSec = Math.floor((now - last) / 1000);

  if (elapsedSec > 0 && user.charges < user.maxCharges) {
    user.charges = Math.min(user.maxCharges, user.charges + elapsedSec * CHARGE_REGEN_PER_SEC);
    user.lastChargeTime = new Date().toISOString();
  }
  return user;
}

function backfillUser(user) {
  if (user.charges === undefined) user.charges = MAX_CHARGES;
  if (user.maxCharges === undefined) user.maxCharges = MAX_CHARGES;
  if (user.lastChargeTime === undefined) user.lastChargeTime = new Date().toISOString();
  if (user.tasks === undefined) {
    user.tasks = { telegram: false, youtube: false, instagram: false };
  }
  if (user.referralCount === undefined) user.referralCount = 0;
  return user;
}

app.post("/api/user", async (req, res) => {
  const { userId, referralCode } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const db = await getDb();
  let user = db.data.users[userId];

  if (!user) {
    user = {
      id: String(userId),
      points: 0,
      charges: MAX_CHARGES,
      maxCharges: MAX_CHARGES,
      lastChargeTime: new Date().toISOString(),
      referralCode: nanoid(8),
      referredBy: null,
      referralCount: 0,
      tasks: { telegram: false, youtube: false, instagram: false },
      createdAt: new Date().toISOString(),
    };
    db.data.users[userId] = user;

    if (referralCode) {
      const referrer = Object.values(db.data.users).find(
        (u) => u.referralCode === referralCode && u.id !== String(userId)
      );
      if (referrer) {
        user.referredBy = referrer.id;
        user.points += REFERRAL_BONUS;
        referrer.points += REFERRAL_BONUS;
        referrer.referralCount += 1;
      }
    }
  } else {
    backfillUser(user);
    regenCharges(user);
  }

  await db.write();
  res.json(user);
});

app.post("/api/tap", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const db = await getDb();
  const user = db.data.users[userId];
  if (!user) return res.status(404).json({ error: "user not found" });

  backfillUser(user);
  regenCharges(user);

  if (user.charges <= 0) {
    return res.status(400).json({ error: "no charges left", user });
  }

  user.charges -= 1;
  user.points += POINTS_PER_TAP;
  await db.write();

  res.json(user);
});

app.post("/api/task/complete", async (req, res) => {
  const { userId, task } = req.body;
  if (!userId || !TASK_KEYS.includes(task)) {
    return res.status(400).json({ error: "valid userId and task required" });
  }

  const db = await getDb();
  const user = db.data.users[userId];
  if (!user) return res.status(404).json({ error: "user not found" });

  backfillUser(user);

  if (user.tasks[task]) {
    return res.status(400).json({ error: "task already completed", user });
  }

  if (task === "telegram") {
    const joined = await verifyTelegramMembership(userId);
    if (!joined) {
      return res.status(400).json({
        error: "You need to join the channel first, then tap Verify again.",
        user,
      });
    }
  }

  user.tasks[task] = true;
  user.points += TASK_REWARD;
  await db.write();

  res.json(user);
});

// Adsgram Webhook Reward Endpoint
// Reward URL in Adsgram Dashboard: https://YOUR-DOMAIN/api/ad/reward?userId=[userId]&type=points
app.get("/api/ad/reward", async (req, res) => {
  const { userId, type } = req.query;
  if (!userId) return res.status(400).send("userId required");

  const db = await getDb();
  const user = db.data.users[userId];
  if (!user) return res.status(404).send("user not found");

  backfillUser(user);
  regenCharges(user);

  if (type === "points") {
    user.points += AD_REWARD_POINTS;
  } else {
    user.charges = Math.min(user.maxCharges, user.charges + AD_REWARD_CHARGES);
  }

  await db.write();
  res.status(200).send("OK");
});

app.get("/api/leaderboard", async (req, res) => {
  const db = await getDb();
  const top = Object.values(db.data.users)
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((u) => ({ id: u.id, points: u.points }));
  res.json(top);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));