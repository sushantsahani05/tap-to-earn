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

export async function findUserByReferralCode(code, excludeId) {
  const users = await getAllUsers();
  return users.find((u) => u.referralCode === code && u.id !== excludeId);
}