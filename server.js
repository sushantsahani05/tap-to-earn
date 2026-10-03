import "dotenv/config";
import express from "express";
import cors from "cors";
import { nanoid } from "nanoid";
import {
  getUser,
  saveUser,
  getAllUsers,
  findUserByReferralCode,
  getGame,
  createGame,
  saveGame,
  deleteGame,
  acquireGameLock,
  releaseGameLock,
} from "./db.js";
import { GAMES } from "./games/index.js";
import { GameError } from "./games/common.js";
import { verifyTelegramInitData } from "./auth.js";

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
// Each game has its own win amount, loss amount, and minimum points needed
// to start (set to that game's loss amount, since that's the most you can
// be charged). Chess pays more because it's the hardest to win.
const GAME_STAKES = {
  chess: { win: 50_000_000, loss: 10_000_000 },
  ludo: { win: 25_000_000, loss: 7_500_000 },
  snake: { win: 10_000_000, loss: 5_000_000 },
};

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
  let changed = false;

  if (!user) {
    changed = true;
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
    // Only write back if something really changed. The app polls this endpoint
    // every few seconds; writing every time could overwrite a game payout
    // that landed a moment earlier.
    const before = JSON.stringify(user);
    backfillUser(user);
    refillCharges(user);
    changed = JSON.stringify(user) !== before;
  }

  if (changed) await saveUser(user);
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

// ---------- Games vs the computer ----------
// All game logic runs here on the server: dice are rolled here and chess moves
// are checked here, so the browser can't fake a win. Each game is staked
// (see GAME_STAKES above — win/loss amounts differ per game), draw = no
// change. A player needs at least that game's loss amount to start, and
// can't dodge a loss by closing the app (the game just resumes), only by
// resigning, which counts as a loss.

// Games move points around, so the server must know WHO is really playing.
// The browser sends Telegram's signed login data; we check the signature and
// use the user id inside it, ignoring any userId the browser claims.
app.use("/api/game", (req, res, next) => {
  const verifiedId = verifyTelegramInitData(req.body?.initData, process.env.BOT_TOKEN);
  if (!verifiedId) {
    return res.status(401).json({ error: "Please open the app from Telegram to play games." });
  }
  req.body.userId = verifiedId;
  delete req.body.initData;
  next();
});

const viewOf = (state) => GAMES[state.game].clientView(state);

// Pays out (or charges) a finished game exactly once.
async function settleGame(userId, state) {
  const removed = await deleteGame(userId);
  if (removed !== 1) return null; // another request already settled this game

  const user = await getUser(userId);
  if (!user) return null;
  backfillUser(user);

  const stakes = GAME_STAKES[state.game];
  let outcome = "draw";
  let delta = 0;
  if (state.winner === "p") {
    outcome = "win";
    delta = stakes.win;
  } else if (state.winner === "b") {
    outcome = "loss";
    delta = -stakes.loss;
  }
  user.points = Math.max(0, user.points + delta);
  await saveUser(user);
  return { outcome, delta, user };
}

// Runs fn while holding the player's game lock, and turns errors into responses.
async function withGameLock(userId, res, fn) {
  if (!(await acquireGameLock(userId))) {
    return res.status(429).json({ error: "Slow down, your last move is still being processed." });
  }
  try {
    await fn();
  } catch (err) {
    if (err instanceof GameError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error("Game error:", err);
      res.status(500).json({ error: "Something went wrong with the game." });
    }
  } finally {
    await releaseGameLock(userId);
  }
}

// The player's current game, if any (lets the app resume after a reload).
app.post("/api/game/state", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  const state = await getGame(userId);
  res.json({ game: state ? viewOf(state) : null });
});

app.post("/api/game/start", async (req, res) => {
  const { userId, game } = req.body;
  if (!userId || typeof game !== "string" || !Object.hasOwn(GAMES, game)) {
    return res.status(400).json({ error: "valid userId and game required" });
  }

  await withGameLock(userId, res, async () => {
    const user = await getUser(userId);
    if (!user) return res.status(404).json({ error: "user not found" });

    if (await getGame(userId)) {
      return res.status(400).json({ error: "Finish or resign your current game first." });
    }
    const required = GAME_STAKES[game].loss;
    if (user.points < required) {
      return res
        .status(400)
        .json({ error: `You need at least ${required.toLocaleString("en-US")} points to play ${game}.` });
    }

    const { state, log } = GAMES[game].newGame();
    if (!(await createGame(userId, state))) {
      return res.status(400).json({ error: "Finish or resign your current game first." });
    }
    res.json({ game: viewOf(state), log, user });
  });
});

app.post("/api/game/action", async (req, res) => {
  const { userId, action, ...params } = req.body;
  if (!userId || typeof action !== "string") {
    return res.status(400).json({ error: "userId and action required" });
  }

  await withGameLock(userId, res, async () => {
    const state = await getGame(userId);
    if (!state) return res.status(404).json({ error: "No active game." });

    const { log } = GAMES[state.game].handleAction(state, action, params);

    if (state.over) {
      const settled = await settleGame(userId, state);
      return res.json({
        game: viewOf(state),
        log,
        result: settled ? { outcome: settled.outcome, delta: settled.delta } : undefined,
        user: settled?.user,
      });
    }

    await saveGame(userId, state);
    res.json({ game: viewOf(state), log });
  });
});

app.post("/api/game/resign", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });

  await withGameLock(userId, res, async () => {
    const state = await getGame(userId);
    if (!state) return res.status(404).json({ error: "No active game." });

    state.over = true;
    state.winner = "b";
    const settled = await settleGame(userId, state);
    res.json({
      game: viewOf(state),
      log: [],
      result: settled ? { outcome: settled.outcome, delta: settled.delta } : undefined,
      user: settled?.user,
    });
  });
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
