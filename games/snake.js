import { GameError, rollDie } from "./common.js";

export const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
export const SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };

// One turn for `side`. Returns true if the side earns an extra turn (rolled a 6).
function play(state, side, log) {
  const d = rollDie();
  let pos = state.pos[side] + d;
  let note = null;

  if (pos > 100) {
    pos = state.pos[side]; // needs an exact roll to finish
    note = "needs exact roll";
  } else if (LADDERS[pos]) {
    note = `ladder ${pos} → ${LADDERS[pos]}`;
    pos = LADDERS[pos];
  } else if (SNAKES[pos]) {
    note = `snake ${pos} → ${SNAKES[pos]}`;
    pos = SNAKES[pos];
  }

  state.pos[side] = pos;
  log.push({ who: side, dice: d, to: pos, note });

  if (pos === 100) {
    state.over = true;
    state.winner = side;
    return false;
  }
  return d === 6;
}

function runBot(state, log) {
  for (let i = 0; i < 20 && !state.over; i++) {
    if (!play(state, "b", log)) break;
  }
}

export function newGame() {
  const state = { game: "snake", pos: { p: 0, b: 0 }, over: false, winner: null };
  const log = [];
  // Random first mover, so neither side always gets the head start.
  if (Math.random() < 0.5) runBot(state, log);
  return { state, log };
}

export function handleAction(state, action) {
  if (state.over) throw new GameError("This game is already over.");
  if (action !== "roll") throw new GameError("Unknown action.");

  const log = [];
  const extra = play(state, "p", log);
  if (!state.over && !extra) runBot(state, log);
  return { log };
}

export function clientView(state) {
  return {
    game: "snake",
    pos: state.pos,
    over: state.over,
    winner: state.winner,
    ladders: LADDERS,
    snakes: SNAKES,
  };
}
