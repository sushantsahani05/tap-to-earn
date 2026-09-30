import { createHmac, timingSafeEqual } from "node:crypto";

// Telegram gives every mini app a signed "initData" string that proves who is
// using it. Anyone can fake a userId in a request, but nobody can fake this
// signature without your bot token. Returns the verified Telegram user id (as
// a string), or null if the data is missing, forged, or too old.
//
// How Telegram signs it:
//   secret = HMAC_SHA256(key "WebAppData", message = bot token)
//   hash   = hex(HMAC_SHA256(key = secret, message = every field except
//            "hash", sorted by name, written as name=value, one per line))
export function verifyTelegramInitData(initData, botToken, maxAgeSeconds = 24 * 60 * 60) {
  if (typeof initData !== "string" || !initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  try {
    const user = JSON.parse(params.get("user"));
    return user && user.id ? String(user.id) : null;
  } catch {
    return null;
  }
}
