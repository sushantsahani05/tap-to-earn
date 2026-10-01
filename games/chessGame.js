import { Chess } from "chess.js";
import { GameError } from "./common.js";

// You play White, the computer plays Black.
// The bot searches with alpha-beta pruning and iterative deepening.
// Tune these two numbers to change difficulty vs. server load:
//   CHESS_BOT_DEPTH   - max moves ahead the bot looks (higher = stronger, slower)
//   CHESS_BOT_TIME_MS - hard time limit per bot move (a slow server just reaches
//                       a shallower depth instead of hanging)
const CHESS_BOT_DEPTH = 4;
const CHESS_BOT_TIME_MS = 2500;

const VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Piece-square tables (White's point of view, index 0 = a8). They nudge the
// bot toward sensible squares: centralised knights, castled kings, etc.
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

// Static evaluation from White's point of view (positive = good for White).
function evaluate(chess) {
  let score = 0;
  const board = chess.board(); // board[0] is rank 8
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      const idx = sq.color === "w" ? r * 8 + c : (7 - r) * 8 + c;
      const v = VALUES[sq.type] + PST[sq.type][idx];
      score += sq.color === "w" ? v : -v;
    }
  }
  return score;
}

// The search uses plain SAN move strings (fast) rather than chess.js's
// "verbose" move objects (much slower). Captures and promotions are searched
// first, which makes pruning far more effective.
function moveOrder(san) {
  let s = 0;
  if (san.includes("x")) s += 1000;
  if (san.includes("=")) s += 800;
  if (san.includes("+") || san.includes("#")) s += 50;
  return s;
}

// chess.js renamed inCheck() to isCheck() in v1; support either.
const inCheck = (chess) => (chess.isCheck ? chess.isCheck() : chess.inCheck());

class Timeout {}

function tick(ctx) {
  if ((++ctx.nodes & 31) === 0 && Date.now() > ctx.deadline) throw new Timeout();
}

// At the end of the main search, keep resolving captures for a couple of
// extra moves so the bot doesn't stop mid-exchange and hang pieces.
function quiesce(chess, alpha, beta, color, qdepth, ctx) {
  tick(ctx);
  const standPat = color * evaluate(chess);
  if (qdepth === 0) return standPat;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const captures = chess.moves().filter((m) => m.includes("x"));
  captures.sort((a, b) => moveOrder(b) - moveOrder(a));
  for (const san of captures) {
    chess.move(san);
    const val = -quiesce(chess, -beta, -alpha, -color, qdepth - 1, ctx);
    chess.undo();
    if (val >= beta) return beta;
    if (val > alpha) alpha = val;
  }
  return alpha;
}

function search(chess, depth, alpha, beta, color, ply, ctx) {
  tick(ctx);

  if (depth === 0) {
    // Cheap check for a mate delivered by the very last move searched.
    if (inCheck(chess) && chess.moves().length === 0) return -MATE + ply;
    return quiesce(chess, alpha, beta, color, 2, ctx);
  }

  const moves = chess.moves();
  if (moves.length === 0) return inCheck(chess) ? -MATE + ply : 0; // mate or stalemate

  moves.sort((a, b) => moveOrder(b) - moveOrder(a));
  let best = -Infinity;
  for (const san of moves) {
    chess.move(san);
    const val = -search(chess, depth - 1, -beta, -alpha, -color, ply + 1, ctx);
    chess.undo();
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Returns the bot's chosen move as a SAN string.
function findBestMove(chess) {
  // Search on a copy: if the time limit interrupts a search halfway, the real
  // game position is left untouched.
  const sim = new Chess(chess.fen());
  const color = sim.turn() === "w" ? 1 : -1;
  const ctx = { nodes: 0, deadline: Date.now() + CHESS_BOT_TIME_MS };

  let rootMoves = sim.moves();
  rootMoves.sort((a, b) => moveOrder(b) - moveOrder(a));
  let best = rootMoves[0];

  for (let depth = 1; depth <= CHESS_BOT_DEPTH; depth++) {
    try {
      let alpha = -Infinity;
      let iterBest = null;
      const scored = [];
      for (const san of rootMoves) {
        sim.move(san);
        const val = -search(sim, depth - 1, -Infinity, -alpha, -color, 1, ctx);
        sim.undo();
        scored.push({ san, val });
        if (val > alpha) {
          alpha = val;
          iterBest = san;
        }
      }
      if (iterBest) best = iterBest;
      // Search the most promising moves first on the next, deeper pass.
      rootMoves = scored.sort((a, b) => b.val - a.val).map((s) => s.san);
    } catch (e) {
      if (e instanceof Timeout) break; // out of time: keep the last finished depth's move
      throw e;
    }
  }
  return best;
}

// The game is stored as a list of moves; rebuild the position from it.
function load(state) {
  const chess = new Chess();
  for (const san of state.moves) chess.move(san);
  return chess;
}

function finishIfOver(state, chess) {
  if (!chess.isGameOver()) return;
  state.over = true;
  if (chess.isCheckmate()) {
    // The side to move is the one that got mated.
    state.winner = chess.turn() === "b" ? "p" : "b";
  } else {
    state.winner = "draw"; // stalemate, repetition, 50-move rule, etc.
  }
}

export function newGame() {
  return { state: { game: "chess", moves: [], lastMove: null, over: false, winner: null }, log: [] };
}

export function handleAction(state, action, params = {}) {
  if (state.over) throw new GameError("This game is already over.");
  if (action !== "move") throw new GameError("Unknown action.");
  if (typeof params.from !== "string" || typeof params.to !== "string") {
    throw new GameError("Illegal move.");
  }

  const chess = load(state);
  const candidates = chess
    .moves({ verbose: true })
    .filter((m) => m.from === params.from && m.to === params.to);
  if (!candidates.length) throw new GameError("Illegal move.");

  // Pawn reaching the last rank always promotes to a queen.
  const chosen = candidates.find((m) => m.promotion === "q") || candidates[0];
  const log = [];

  const played = chess.move({ from: chosen.from, to: chosen.to, promotion: chosen.promotion });
  log.push({ who: "p", san: played.san });
  state.lastMove = { from: played.from, to: played.to };
  finishIfOver(state, chess);

  if (!state.over) {
    const bp = chess.move(findBestMove(chess));
    log.push({ who: "b", san: bp.san });
    state.lastMove = { from: bp.from, to: bp.to };
    finishIfOver(state, chess);
  }

  state.moves = chess.history();
  return { log };
}

export function clientView(state) {
  const chess = load(state);
  const legal = {};
  if (!state.over) {
    for (const m of chess.moves({ verbose: true })) {
      (legal[m.from] ||= []).push(m.to);
    }
  }
  return {
    game: "chess",
    fen: chess.fen(),
    lastMove: state.lastMove,
    legal,
    inCheck: inCheck(chess),
    over: state.over,
    winner: state.winner,
  };
}
