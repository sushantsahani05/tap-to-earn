// Persistent storage using Upstash Redis (a free, HTTP-based Redis host).
// Unlike the old JSON-file version, this survives redeploys/restarts on
// Render, since the data lives in Upstash's cloud, not on Render's disk.
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN

const USER_IDS_KEY = "user_ids"; // a Redis set holding every known userId

function userKey(userId) {
  return `user:${userId}`;
}

export async function getUser(userId) {
  return await redis.get(userKey(userId)); // returns null if not found
}

export async function saveUser(user) {
  await redis.set(userKey(user.id), user);
  await redis.sadd(USER_IDS_KEY, user.id);
}

export async function getAllUsers() {
  const ids = await redis.smembers(USER_IDS_KEY);
  if (!ids.length) return [];
  const users = await redis.mget(...ids.map(userKey));
  return users.filter(Boolean);
}

// --- Game sessions (one active game per player) ---
const gameKey = (userId) => `game:${userId}`;

export async function getGame(userId) {
  return await redis.get(gameKey(userId));
}

// Only creates the game if none exists yet. Returns true if it was created.
export async function createGame(userId, state) {
  const res = await redis.set(gameKey(userId), state, { nx: true });
  return res === "OK";
}

export async function saveGame(userId, state) {
  await redis.set(gameKey(userId), state);
}

// Returns how many keys were removed (1 = this call removed it). Used so a
// finished game pays out exactly once, even if two requests race.
export async function deleteGame(userId) {
  return await redis.del(gameKey(userId));
}

// Short-lived lock so one player can't run two game actions at the same time.
export async function acquireGameLock(userId) {
  const res = await redis.set(`lock:game:${userId}`, 1, { nx: true, ex: 15 });
  return res === "OK";
}

export async function releaseGameLock(userId) {
  await redis.del(`lock:game:${userId}`);
}

export async function findUserByReferralCode(code, excludeId) {
  const users = await getAllUsers();
  return users.find((u) => u.referralCode === code && u.id !== excludeId);
}
