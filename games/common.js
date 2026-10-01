import { randomInt } from "node:crypto";

// Errors of this type are safe to show to the player (e.g. "Roll first").
export class GameError extends Error {}

// Fair six-sided die using the server's cryptographic RNG.
// Dice are always rolled on the server so players can't fake a roll.
export const rollDie = () => randomInt(1, 7);
