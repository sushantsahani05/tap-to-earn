// Lightweight JSON-file database — no native compilation needed.
// Good for prototyping. Swap for Postgres/Mongo once you have real traffic.
import { JSONFilePreset } from "lowdb/node";

const defaultData = { users: {} };

export async function getDb() {
  const db = await JSONFilePreset("db.json", defaultData);
  return db;
}