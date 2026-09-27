import "dotenv/config";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import { getUser, saveUser, getAllUsers, findUserByReferralCode } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const POINTS_PER_TAP = 10000;
const REFERRAL_BONUS = 500000000;
const TASK_REWARD = 100000000;
const MAX_CHARGES = 1000;
const CHARGE_REFILL_MS = 60 * 60 * 1000; // full refill 1 hour after charges hit 0
const AD_REWARD_CHARGES = 500; // charges granted per completed ad view
const AD_REWARD_POINTS = 1000000; // points granted per completed ad view (points ad)

const TASK_KEYS = ["telegram", "youtube", "instagram"];
const TELEGRAM_CHANNEL = "@bakicoins"; // used to verify channel membership

// Checks whether a user has actually joined the Telegram channel, using
// the Bot API. Returns true/false. The bot must be a member of the
// channel (it can just be added like any subscriber) for this to work.
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

// Charges no longer trickle in gradually. Once they hit 0, a 1-hour timer
// starts (chargesEmptyAt); once that hour passes, charges refill to full
// all at once. While charges are still above 0, nothing changes here.
function refillCharges(user) {
  if (user.charges > 0 || !user.chargesEmptyAt) return user;

  const emptyAt = new Date(user.chargesEmptyAt).getTime();
  if (Date.now() - emptyAt >= CHARGE_REFILL_MS) {
    user.charges = user.maxCharges;
    user.chargesEmptyAt = null;
  }
  return user;
}

// Fills in any new fields on an existing user record without touching
// their points/balance — so upgrading the app never wipes progress.
function backfillUser(user) {
  if (user.charges === undefined) user.charges = MAX_CHARGES;
  if (user.maxCharges === undefined) user.maxCharges = MAX_CHARGES;
  if (user.chargesEmptyAt === undefined) user.chargesEmptyAt = null;
  if (user.tasks === undefined) {
    user.tasks = { telegram: false, youtube: false, instagram: false };
  }
  if (user.referralCount === undefined) user.referralCount = 0;
  return user;
}

// Get or create a user. Called when the mini app first loads.
app.post("/api/user", async (req, res) => {
  const { userId, referralCode } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  let user = await getUser(userId);

  if (!user) {
    user = {
      id: userId,
      points: 0,
      charges: MAX_CHARGES,
      maxCharges: MAX_CHARGES,
      chargesEmptyAt: null,
      referralCode: nanoid(8),
      referredBy: null,
      referralCount: 0,
      tasks: { telegram: false, youtube: false, instagram: false },
      createdAt: new Date().toISOString(),
    };

    // Apply referral bonus if this user arrived via someone's invite link
    if (referralCode) {
      const referrer = await findUserByReferralCode(referralCode, userId);
      if (referrer) {
        user.referredBy = referrer.id;
        user.points += REFERRAL_BONUS;
        referrer.points += REFERRAL_BONUS;
        referrer.referralCount += 1;
        await saveUser(referrer);
      }
    }
  } else {
    backfillUser(user);
    refillCharges(user);
  }

  await saveUser(user);
  res.json(user);
});

// Register a tap — costs 1 charge, pays out points
app.post("/api/tap", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  const user = await getUser(userId);
  if (!user) return res.status(404).json({ error: "user not found" });

  backfillUser(user);
  refillCharges(user);

  if (user.charges <= 0) {
    return res.status(400).json({ error: "no charges left", user });
  }

  user.charges -= 1;
  user.points += POINTS_PER_TAP;
  if (user.charges === 0) {
    user.chargesEmptyAt = new Date().toISOString(); // starts the 1-hour refill timer
  }
  await saveUser(user);

  res.json(user);
});

// Mark a task complete and pay out its reward (once per task)
app.post("/api/task/complete", async (req, res) => {
  const { userId, task } = req.body;
  if (!userId || !TASK_KEYS.includes(task)) {
    return res.status(400).json({ error: "valid userId and task required" });
  }

  const user = await getUser(userId);
  if (!user) return res.status(404).json({ error: "user not found" });

  backfillUser(user);

  if (user.tasks[task]) {
    return res.status(400).json({ error: "task already completed", user });
  }

  // Telegram membership can actually be checked. YouTube/Instagram can't be
  // verified for free, so those are honor-system for now (see README).
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
  await saveUser(user);

  res.json(user);
});

// Grants an ad reward. Used two different ways:
//  - Adsgram calls this directly from ITS OWN servers (see Reward URL
//    setup in the README) — safer, since it can't be faked from the browser.
//  - Monetag's SDK confirms ad completion client-side, so the frontend
//    calls this endpoint itself right after the ad finishes. This is
//    weaker (a determined user could call it without watching an ad) —
//    see the README note on tightening this later.
app.get("/api/ad/reward", async (req, res) => {
  const { userId, type } = req.query;
  if (!userId) return res.status(400).send("userId required");

  const user = await getUser(userId);
  if (!user) return res.status(404).send("user not found");

  backfillUser(user);
  refillCharges(user);

  if (type === "points") {
    user.points += AD_REWARD_POINTS;
  } else {
    // Default to charges for backward compatibility
    user.charges = Math.min(user.maxCharges, user.charges + AD_REWARD_CHARGES);
    if (user.charges > 0) user.chargesEmptyAt = null; // no longer empty, cancel the refill timer
  }

  await saveUser(user);
  res.status(200).send("OK");
});

// Simple leaderboard
app.get("/api/leaderboard", async (req, res) => {
  const users = await getAllUsers();
  const top = users
    .sort((a, b) => b.points - a.points)
    .slice(0, 20)
    .map((u) => ({ id: u.id, points: u.points }));
  res.json(top);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));