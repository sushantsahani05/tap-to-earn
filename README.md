# Telegram Tap-to-Earn — Starter

A tap-to-earn Telegram mini app with four sections: Home (tap for points,
limited by regenerating "charges"), Refer (invite friends for a bonus),
Tasks (social follows for points), and Airdrop (placeholder for later).

## What's included
- `bot.js` — the Telegram bot that opens the mini app and passes referral codes
- `server.js` — the backend API (user state, tap, tasks, leaderboard)
- `public/index.html` — the mini app UI with bottom-tab navigation
- `db.js` — simple JSON-file storage (swap for a real DB before scaling)

## How the app works
- **Home** — balance and a TAP button. Each tap costs 1 charge and pays
  10,000 points. Charges max out at 1000 and regenerate at 1 per second,
  even while the app is closed (calculated from elapsed time on each load).
- **Refer** — a personal invite link. When someone joins through it, both
  the inviter and the new user get 500,000,000 points.
- **Tasks** — one-time social tasks (join Telegram, subscribe on YouTube,
  follow on Instagram), each worth 100,000,000 points. Tapping "Go" opens
  the real link (t.me/bakicoins for Telegram, your YouTube channel — the
  Instagram link is still a placeholder, add yours in `public/index.html`).
  Tapping "Go" again (now labeled "Verify") checks completion:
  - **Telegram is actually verified** — the backend calls the Bot API's
    `getChatMember` to confirm the user really joined `@bakicoins` before
    paying out. Your bot needs to be a member of that channel for this to
    work (just add it like any subscriber).
  - **YouTube and Instagram are honor-system** — there's no free API to
    verify a subscribe/follow, so clicking Verify pays out immediately.
    See the note below if you want to tighten this later.
- **Airdrop** — placeholder screen for a future token/reward drop.
- **Watch Ad buttons (Home)** — two rewarded ads via Adsgram, a
  Telegram-native ad network: one grants +500 charges, the other grants
  +1,000,000 points. Each needs its **own** Adsgram ad block (create two
  in the dashboard). Setup for each:
  1. In `public/index.html`, replace `"your-charges-block-id"` and
     `"your-points-block-id"` with the real Block IDs from the Adsgram
     dashboard.
  2. In the Adsgram dashboard, set each block's **Reward URL**:
     - Charges block: `https://YOUR-DOMAIN/api/ad/reward?userId=[userId]&type=charges`
     - Points block: `https://YOUR-DOMAIN/api/ad/reward?userId=[userId]&type=points`
     Leave `[userId]` exactly as-is — Adsgram fills it in automatically.
     This is what actually credits the reward server-side once someone
     finishes watching, so it can't be faked by just clicking through in
     the browser.
- **Existing balances are preserved** — the backend fills in new fields
  (charges, tasks, etc.) on existing user records without ever touching
  their points, so upgrading the app doesn't reset anyone's progress.

## Requirements before you start
1. **A Telegram account** and the **Telegram desktop or mobile app** (to talk to @BotFather).
2. **Node.js 18+** installed locally.
3. **A place to host the app with HTTPS.** Telegram mini apps refuse to load
   over plain HTTP or localhost — you need a real public HTTPS URL. Easiest
   free/cheap options: Render, Railway, Fly.io, or a VPS with a domain + SSL.

## Step-by-step setup

### 1. Create your bot
- Open Telegram, message **@BotFather**
- Send `/newbot`, follow the prompts, and save the **bot token** it gives you

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env` and fill in:
```
BOT_TOKEN=<from BotFather>
WEBAPP_URL=<your hosted https URL, added after step 4>
```

### 4. Deploy the server
Push this project to GitHub and connect it to Render/Railway (or any Node
host). Add `BOT_TOKEN` in your hosting provider's environment variables.
Once deployed, copy the live HTTPS URL into `WEBAPP_URL` (both locally in
`.env` and in the provider's env settings).

### 5. Update the bot username in the frontend
In `public/index.html`, change:
```js
const BOT_USERNAME = "your_bot_username";
```
to your actual bot's username (no `@`), so referral links work.

### 6. Point the task buttons at your real links
In `public/index.html`, the Telegram/YouTube/Instagram task rows currently
just mark themselves "done" on click with no real verification. Add your
real channel/profile URLs, and see the note below on verifying task
completion properly before launch.

### 7. Run the bot
```bash
npm run bot
```
Keep this running (or deploy it too — bots need to stay online to respond).

## Before a real launch
- Swap `db.json` for a real database (Postgres, MongoDB, etc.) — the JSON
  file will not hold up under concurrent users
- **Tighten YouTube/Instagram verification.** These currently pay out on
  the honor system (see above). Options if abuse becomes a problem:
  require manual review above a point threshold, use YouTube's Data API
  (requires OAuth per user, more setup) for subscribe checks, or simply
  accept the honor-system limitation, as many tap-to-earn apps do.
- Add basic anti-abuse limits (e.g. rate-limit taps server-side)
- Decide your monetization layer (Telegram Stars for boosts/cosmetics, ads
  between sessions, or sponsorships) and wire it in before scaling traffic
- Only after retention looks healthy: consider a TON token/NFT layer for
  the Airdrop section

## Useful references
- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Mini Apps docs: https://core.telegram.org/bots/webapps
- Telegram Stars (payments): https://core.telegram.org/bots/payments-stars