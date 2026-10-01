import * as chess from "./chessGame.js";
import * as ludo from "./ludo.js";
import * as snake from "./snake.js";

// Every game module exports: newGame(), handleAction(state, action, params), clientView(state)
export const GAMES = { chess, ludo, snake };
