import { GameError, rollDie } from "./common.js";

// Two-player Ludo (you vs the computer), 4 tokens each.
//
// Token position `r` (relative to its owner's start):
//   -1      = still in base (needs a 6 to come out)
//   0..50   = on the shared 52-square ring (0 is the owner's start square)
//   51..55  = in the owner's private home column
//   56      = finished
// Rules kept simple: a 6, a capture, or reaching home earns an extra turn.
// A token needs an exact roll to reach 56.

const START = { p: 0, b: 26 };
const RING = 52;
const FINISH = 56;
// 4 start squares + 4 "star" squares. Tokens on these can't be captured.
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const other = (side) => (side === "p" ? "b" : "p");
const absPos = (side, r) => (START[side] + r) % RING; // valid for r in 0..50

function legalMoves(state, side, d) {
  const moves = [];
  state.tokens[side].forEach((r, i) => {
    if (r === -1) {
      if (d === 6) moves.push(i);
    } else if (r + d <= FINISH) {
      moves.push(i);
    }
  });
  return moves;
}

// Applies a move in place. Returns what happened.
function applyMove(state, side, i, d) {
  const tokens = state.tokens[side];
  const to = tokens[i] === -1 ? 0 : tokens[i] + d;
  tokens[i] = to;

  let captured = false;
  let lostProgress = 0;

  if (to <= 50) {
    const a = absPos(side, to);
    if (!SAFE.has(a)) {
      const foe = other(side);
      state.tokens[foe] = state.tokens[foe].map((r) => {
        if (r >= 0 && r <= 50 && absPos(foe, r) === a) {
          captured = true;
          lostProgress += r;
          return -1;
        }
        return r;
      });
    }
  }

  return {
    captured,
    lostProgress,
    finished: to === FINISH,
    won: tokens.every((r) => r === FINISH),
  };
}

// Could an opposing token land on this square with a single roll (1-6)?
function isThreatened(state, side, r) {
  if (r < 0 || r > 50) return false;
  const a = absPos(side, r);
  if (SAFE.has(a)) return false;
  const foe = other(side);
  return state.tokens[foe].some((ro) => {
    if (ro < 0 || ro > 50) return false;
    const dist = (a - absPos(foe, ro) + RING) % RING;
    return dist >= 1 && dist <= 6 && ro + dist <= 50;
  });
}

// The bot: scores every legal move and picks the best one.
function scoreMove(state, side, i, d) {
  const before = state.tokens[side][i];
  const sim = structuredClone(state);
  const res = applyMove(sim, side, i, d);
  const after = sim.tokens[side][i];

  let score = 0;
  if (res.won) score += 10000;
  if (res.finished) score += 500;
  if (res.captured) score += 400 + res.lostProgress * 4;
  if (before === -1) score += 250; // getting a token out
  if (after >= 51 && before < 51) score += 200; // reaching the home column
  if (after <= 50 && SAFE.has(absPos(side, after))) score += 120; // landing safe
  if (isThreatened(state, side, before)) score += 150 + before * 2; // running from danger
  if (after <= 50 && isThreatened(sim, side, after)) score -= 220 + after * 2; // walking into danger
  score += d * 4 + after; // otherwise, keep advancing
  return score;
}

function chooseBotMove(state, d, moves) {
  let best = moves[0];
  let bestScore = -Infinity;
  for (const i of moves) {
    const s = scoreMove(state, "b", i, d);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

function runBot(state, log) {
  for (let n = 0; n < 40 && !state.over; n++) {
    const d = rollDie();
    const moves = legalMoves(state, "b", d);
    if (!moves.length) {
      log.push({ who: "b", dice: d, note: "no move" });
      break;
    }
    const token = chooseBotMove(state, d, moves);
    const res = applyMove(state, "b", token, d);
    log.push({ who: "b", dice: d, token, captured: res.captured, finished: res.finished });
    if (res.won) {
      state.over = true;
      state.winner = "b";
      break;
    }
    if (!(d === 6 || res.captured || res.finished)) break;
  }
}

export function newGame() {
  const state = {
    game: "ludo",
    tokens: { p: [-1, -1, -1, -1], b: [-1, -1, -1, -1] },
    phase: "roll", // "roll" = player must roll, "move" = player must pick a token
    dice: null,
    legal: [],
    over: false,
    winner: null,
  };
  const log = [];
  if (Math.random() < 0.5) runBot(state, log);
  return { state, log };
}

export function handleAction(state, action, params = {}) {
  if (state.over) throw new GameError("This game is already over.");
  const log = [];

  if (action === "roll") {
    if (state.phase !== "roll") throw new GameError("Pick a token to move first.");
    const d = rollDie();
    state.dice = d;
    const moves = legalMoves(state, "p", d);
    if (moves.length) {
      log.push({ who: "p", dice: d });
      state.phase = "move";
      state.legal = moves;
    } else {
      log.push({ who: "p", dice: d, note: "no move" });
      runBot(state, log);
    }
  } else if (action === "move") {
    if (state.phase !== "move") throw new GameError("Roll the dice first.");
    const token = Number(params.token);
    if (!state.legal.includes(token)) throw new GameError("That token can't move.");

    const d = state.dice;
    const res = applyMove(state, "p", token, d);
    log.push({ who: "p", token, captured: res.captured, finished: res.finished });
    state.legal = [];
    state.phase = "roll";

    if (res.won) {
      state.over = true;
      state.winner = "p";
    } else if (!(d === 6 || res.captured || res.finished)) {
      runBot(state, log);
    }
  } else {
    throw new GameError("Unknown action.");
  }

  return { log };
}

export function clientView(state) {
  return {
    game: "ludo",
    tokens: state.tokens,
    phase: state.phase,
    dice: state.dice,
    legal: state.legal,
    over: state.over,
    winner: state.winner,
  };
}
