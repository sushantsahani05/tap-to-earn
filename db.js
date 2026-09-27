// Lightweight JSON-file database — no native compilation needed.
// Good for prototyping. Swap for Postgres/Mongo once you have real traffic.
import { JSONFilePreset } from "lowdb/node";

const defaultData = { users: {} };

export async function getDb() {
  const db = await JSONFilePreset("db.json", defaultData);
  return db;
}

// Shape of a user record:
// {
//   id: "telegram_user_id",
//   points: 0,
//   taps: 0,
//   referralCode: "abc123",
//   referredBy: "other_user_id" | null,
//   referralCount: 0,
//   createdAt: ISOString
// }