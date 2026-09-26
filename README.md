# Telegram Tap-to-Earn — Starter

A minimal but working tap-to-earn Telegram mini app: a tap button, a points
balance, and a referral system (the actual growth engine behind apps like
Notcoin). No token/crypto included — add that later once retention is proven.

## What's included
- `bot.js` — the Telegram bot that opens the mini app and passes referral codes
- `server.js` — the backend API (tap, user, leaderboard, Claude chat assistant)
- `public/index.html` — the mini app UI shown inside Telegram, including a chat panel
- `db.js` — simple JSON-file storage (swap for a real DB before scaling)

### In-app Claude assistant
Users can chat with a Claude-powered assistant inside the app (bottom card).
It knows about the app's points/referral system via a system prompt in
`server.js`. This requires an Anthropic API key — see step 3 below. Each
user's recent chat history is kept in memory on the server (not persisted),
so it resets if the server restarts; that's fine for testing but worth
moving to your database once you add real storage.

## Requirements before you start
1. **A Telegram account** and the **Telegram desktop or mobile app** (to talk to @BotFather).
2. **Node.js 18+** installed locally.
3. **A place to host the app with HTTPS.** Telegram mini apps refuse to load
   over plain HTTP or localhost — you need a real public HTTPS URL. Easiest
   free/cheap options: Render, Railway, Fly.io, or a VPS with a domain + SSL.
4. (Optional, later) **A TON wallet** if you eventually add crypto rewards.

## Step-by-step setup

### 1. Create your bot
- Open Telegram, message **@BotFather**
- Send `/newbot`, follow the prompts, and save the **bot token** it gives you
- Send `/setmenubutton` (or use `/mybots` → your bot → Bot Settings → Menu Button)
  to eventually point the button at your hosted app URL

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env` and fill in:
```
BOT_TOKEN=<from BotFather>
WEBAPP_URL=<your hosted https URL, added after step 4>
ANTHROPIC_API_KEY=<from console.anthropic.com — API Keys>
```
Note: the Claude API is billed per token used. Costs stay small for casual
chat volume, but keep an eye on usage once you have real users — see
https://docs.claude.com for current pricing.

### 4. Deploy the server
Push this project to GitHub and connect it to Render/Railway (or any Node
host). Add `BOT_TOKEN` and `ANTHROPIC_API_KEY` in your hosting provider's
environment variable settings. Once deployed, copy the live HTTPS URL into
`WEBAPP_URL` (both locally in `.env` and in the provider's env settings).

### 5. Update the bot username in the frontend
In `public/index.html`, change:
```js
const BOT_USERNAME = "your_bot_username";
```
to your actual bot's username (no `@`), so referral links work.

### 6. Run the bot
```bash
npm run bot
```
Keep this running (or deploy it too — bots need to stay online to respond).

### 7. Test it
Message your bot on Telegram, tap "Open App", and confirm tapping increases
your points and the invite link works.

## Before a real launch
- Swap `db.json` for a real database (Postgres, MongoDB, etc.) — the JSON
  file will not hold up under concurrent users
- Add basic anti-abuse limits (e.g. rate-limit taps server-side, since right
  now nothing stops a bot script from spamming `/api/tap`)
- Decide your monetization layer (Telegram Stars for boosts/cosmetics, ads
  between sessions, or sponsorships) and wire it in before scaling traffic
- Only after retention looks healthy: consider a TON token/NFT layer

## Useful references
- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram Mini Apps docs: https://core.telegram.org/bots/webapps
- Telegram Stars (payments): https://core.telegram.org/bots/payments-stars
