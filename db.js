import { JSONFilePreset } from "lowdb/node";

const defaultData = { users: {} };

export async function getDb() {
  const db = await JSONFilePreset("db.json", defaultData);
  return db;
}