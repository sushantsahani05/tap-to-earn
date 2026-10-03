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
function fail(reason) {
  // Logged server-side only (e.g. visible in Render's Logs tab) — never
  // sent back to the browser, so it can't help an attacker guess the fix.
  console.error("[auth] rejected initData:", reason);
  return null;
}

export function verifyTelegramInitData(initData, botTokenRaw, maxAgeSeconds = 24 * 60 * 60) {
  const botToken = typeof botTokenRaw === "string" ? botTokenRaw.trim() : botTokenRaw;
  if (typeof initData !== "string" || !initData) return fail("no initData sent by the browser");
  if (!botToken) return fail("BOT_TOKEN is not set on the server");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return fail("missing/malformed hash field");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return fail("signature mismatch — BOT_TOKEN on the server likely doesn't match the bot that issued this initData");
  }

  const authDate = Number(params.get("auth_date"));
  if (!authDate) return fail("missing auth_date");
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return fail("initData is older than " + maxAgeSeconds + "s");

  try {
    const user = JSON.parse(params.get("user"));
    if (!user || !user.id) return fail("no user.id in initData");
    return String(user.id);
  } catch {
    return fail("couldn't parse the user field");
  }
}