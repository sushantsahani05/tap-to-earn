# Telegram Tap-to-Earn — Starter

A tap-to-earn Telegram mini app with four sections: Home (tap for points,
limited by regenerating "charges"), Refer (invite friends for a bonus),
Tasks (social follows for points), and Airdrop (placeholder for later).

## What's included
- `bot.js` — the Telegram bot that opens the mini app and passes referral codes
- `server.js` — the backend API (user state, tap, tasks, leaderboard)
- `public/index.html` — the mini app UI with bottom-tab navigation
- `db.js` — persistent storage using Upstash Redis (see setup below —
  **required**, the app won't start without it), plus game-session
  storage (one active game per player, with a short lock so a player
  can't submit two moves at once)
- `auth.js` — verifies Telegram's signed `initData` server-side, so game
  requests can be trusted
- `games/` — one file per game (`chessGame.js`, `ludo.js`, `snake.js`)
  plus `common.js` (shared errors/dice) and `index.js` (registers them)
- `public/games.js`, `public/games.css` — the Games tab's UI (board
  drawing, clicks → API calls) and its styling

## How the app works
- **Home** — balance and a TAP button showing your `tap-icon.png` image,
  with a press animation and a floating "+10,000" popup on each tap. Each
  tap costs 1 charge and pays 10,000 points. Charges max out at 1000.
  **Charges no longer regenerate gradually** — once they hit 0, a 1-hour
  timer starts, and after that hour passes they refill to full all at
  once (not a trickle). A "Refills in MM:SS" countdown shows under the
  button while waiting.
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
- **Games** — Chess, Ludo, and Snake & Ladder, one player vs the computer.
  Every game is staked: win +10,000,000 points, lose −10,000,000, a draw
  changes nothing. A player needs at least the stake to start.
  - **Everything runs on the server** — dice rolls, chess legality, the
    bot's moves, and the payout. The browser only draws the board and
    sends what the player clicked; it can't fake a win, fake a dice roll,
    or claim a payout that didn't happen.
  - **Bots are hard on purpose:**
    - *Chess* — a real alpha-beta search (chess.js for rules, a
      hand-written evaluator + search on top) roughly 4 moves deep.
      Strong club-player level; expect to lose most games unless you
      actually know chess.
    - *Ludo* — the bot scores every legal move each turn (captures,
      reaching home, dodging danger, racing to escape capture range) and
      always plays the best-scoring one. In simulation, a sensible human
      strategy wins only around 1 game in 6.
    - *Snake & Ladder* — pure luck by nature, so both sides use the same
      fair dice. Simulated at a true 50/50 win rate — nothing is
      rigged here, the stake is what makes it feel like something's on
      the line.
  - **You can't dodge a loss by closing the app** — an unfinished game
    just resumes where it left off next time. The only way out of a game
    early is Resign, which counts as a loss.
  - **Identity is verified, not trusted.** Every `/api/game/*` request
    must include Telegram's signed `initData` (sent automatically by the
    app); the server checks that signature against `BOT_TOKEN` and uses
    the Telegram user id embedded in it — never whatever `userId` the
    browser sends. This is what stops one player from starting or
    resigning a game as if they were someone else. If `BOT_TOKEN` is
    wrong or the app isn't opened through Telegram, games are refused
    with "Please open the app from Telegram to play games."
- **Airdrop** — placeholder screen for a future token/reward drop.
- **Watch Ad buttons (Monetag)** — two reward buttons using Monetag:
  Rewarded Interstitial for +500 charges, Rewarded
  Popup for +1,000,000 points. Also enables Monetag's In-App Interstitial,
  which shows ads automatically in the background (up to 2 per 6-minute
  window) purely for extra ad revenue, with no reward attached.
  **Important trust difference from Adsgram:** Monetag's SDK confirms ad
  completion in the browser itself, so the frontend calls
  `/api/ad/reward` directly once the ad finishes. This is weaker than
  Adsgram's setup — a technically determined user could in theory call
  that endpoint without actually watching an ad. Worth revisiting later
  (e.g. Monetag also supports a server-to-server postback similar to
  Adsgram's, or add basic rate-limiting/cooldowns per user) once real
  money is on the line.
- **Existing balances are preserved** — the backend fills in new fields
  (charges, tasks, etc.) on existing user records without ever touching
  their points, so upgrading the app doesn't reset anyone's progress.

## Requirements before you start
1. **A Telegram account** and the **Telegram desktop or mobile app** (to talk to @BotFather).
2. **Node.js 18+** installed locally.
3. **A place to host the app with HTTPS.** Telegram mini apps refuse to load
   over plain HTTP or localhost — you need a real public HTTPS URL. Easiest
   free/cheap options: Render, Railway, Fly.io, or a VPS with a domain + SSL.
4. **A free Upstash Redis database** — this is what makes user data (points,
   charges, etc.) actually persist. Without it, everyone's progress resets
   every time you redeploy. See step 2 below.

## Step-by-step setup

### 1. Create your bot
- Open Telegram, message **@BotFather**
- Send `/newbot`, follow the prompts, and save the **bot token** it gives you

### 2. Set up persistent storage (Upstash Redis) — fixes the data-loss bug
This is what makes everyone's points/charges actually stick around.
1. Go to **upstash.com**, sign up (free), and create a new **Redis**
   database. Region doesn't matter much for a small app — pick the
   closest one.
2. On the database's page, find the **REST API** section. Copy the two
   values shown: `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. You'll paste these into your `.env` in the next step, and into your
   hosting provider's environment variables in step 5.

### 3. Install dependencies
```bash
npm install
```

### 4. Configure environment variables
Copy `.env.example` to `.env` and fill in:
```
BOT_TOKEN=<from BotFather>
WEBAPP_URL=<your hosted https URL, added after step 5>
UPSTASH_REDIS_REST_URL=<from step 2>
UPSTASH_REDIS_REST_TOKEN=<from step 2>
```

### 5. Deploy the server
Push this project to GitHub and connect it to Render/Railway (or any Node
host). Add `BOT_TOKEN`, `UPSTASH_REDIS_REST_URL`, and
`UPSTASH_REDIS_REST_TOKEN` in your hosting provider's environment
variables — **all three are required**, the server won't start without
the Redis ones. Once deployed, copy the live HTTPS URL into `WEBAPP_URL`
(both locally in `.env` and in the provider's env settings).

### 6. Update the bot username in the frontend
In `public/index.html`, change:
```js
const BOT_USERNAME = "your_bot_username";
```
to your actual bot's username (no `@`), so referral links work.

### 7. Point the task buttons at your real links
In `public/index.html`, the Telegram/YouTube/Instagram task rows currently
just mark themselves "done" on click with no real verification. Add your
real channel/profile URLs, and see the note below on verifying task
completion properly before launch.

### 8. Run the bot
```bash
npm run bot
```
Keep this running (or deploy it too — bots need to stay online to respond).

## Before a real launch
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
