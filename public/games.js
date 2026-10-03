// Games tab: Chess, Ludo and Snake & Ladder against the computer.
// All game rules run on the SERVER (dice, move checking, the bot, payouts).
// This file only draws the board and sends the player's actions.
// It relies on globals from the main script in index.html:
// API_BASE, userId, currentUser and render().
(function () {
  // Must match GAME_STAKES in server.js — this copy is only for display
  // text before a game starts; the server is what actually enforces it.
  const STAKES = {
    chess: { win: 50000000, loss: 10000000 },
    ludo: { win: 25000000, loss: 7500000 },
    snake: { win: 10000000, loss: 5000000 },
  };
  const $ = (id) => document.getElementById(id);

  const lobbyEl = $("gameLobby");
  const areaEl = $("gameArea");
  const titleEl = $("gameTitle");
  const statusEl = $("gameStatus");
  const boardEl = $("gameBoard");
  const controlsEl = $("gameControls");
  const logEl = $("gameLog");
  const resultEl = $("gameResult");
  const resignBtn = $("resignBtn");
  const lobbyNote = $("lobbyNote");

  const TITLES = { chess: "♟️ Chess", ludo: "🎲 Ludo", snake: "🐍 Snake & Ladder" };
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let view = null; // the current game, as sent by the server
  let selected = null; // selected chess square
  let busy = false; // waiting for the server
  let logLines = [];
  let result = null; // { outcome, delta } once the game ends

  // ---------- server calls ----------
  async function api(path, body) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, initData: window.Telegram?.WebApp?.initData || "", ...body }),
      });
      const data = await res.json();
      return { ok: res.ok, data };
    } catch (err) {
      return { ok: false, data: { error: "Couldn't reach the server. Try again." } };
    }
  }

  // Handles a server reply. Returns true if it succeeded.
  function handle(r) {
    if (!r.ok) {
      alert(r.data.error || "Something went wrong.");
      return false;
    }
    view = r.data.game;
    if (r.data.user) {
      currentUser = r.data.user; // updated balance
      render();
    }
    if (r.data.log) addLog(r.data.log, view.game);
    if (r.data.result) result = r.data.result;
    selected = null;
    draw();
    return true;
  }

  async function startGame(type) {
    if (busy) return;
    busy = true;
    logLines = [];
    result = null;
    selected = null;
    const r = await api("/api/game/start", { game: type });
    busy = false;
    if (handle(r)) showArea();
  }

  async function act(action, params = {}) {
    if (busy || !view || view.over) return;
    busy = true;
    draw(); // shows "thinking..."
    const r = await api("/api/game/action", { action, ...params });
    busy = false;
    if (!handle(r)) draw();
  }

  // ---------- lobby / navigation ----------
  function showArea() {
    lobbyEl.style.display = "none";
    areaEl.style.display = "block";
  }

  function showLobby() {
    view = null;
    result = null;
    logLines = [];
    areaEl.style.display = "none";
    lobbyEl.style.display = "block";
    refreshLobby();
  }

  function refreshLobby() {
    const pts = currentUser ? currentUser.points : 0;
    let anyAffordable = false;
    document.querySelectorAll("[data-game]").forEach((b) => {
      const required = STAKES[b.dataset.game].loss;
      const ok = pts >= required;
      b.disabled = !ok;
      if (ok) anyAffordable = true;
    });
    const cheapest = Math.min(...Object.values(STAKES).map((s) => s.loss));
    lobbyNote.textContent = anyAffordable
      ? ""
      : `You need at least ${fmt(cheapest)} points to play. Your balance: ${fmt(pts)}.`;
  }

  document.querySelectorAll("[data-game]").forEach((b) => {
    b.addEventListener("click", () => startGame(b.dataset.game));
  });

  resignBtn.addEventListener("click", async () => {
    if (busy || !view || view.over) return;
    if (!confirm(`Resign? You will lose ${fmt(STAKES[view.game].loss)} points.`)) return;
    busy = true;
    const r = await api("/api/game/resign", {});
    busy = false;
    handle(r);
  });

  resultEl.addEventListener("click", (e) => {
    if (e.target.id === "backLobbyBtn") showLobby();
  });

  const gamesNavBtn = document.querySelector('nav.bottom-nav [data-screen="games"]');
  if (gamesNavBtn) gamesNavBtn.addEventListener("click", refreshLobby);
  setInterval(refreshLobby, 2000);

  // ---------- log + status text ----------
  const who = (w) => (w === "p" ? "You" : "Bot");

  function describe(e, game) {
    if (game === "chess") return `${who(e.who)}: ${e.san}`;
    if (game === "snake") {
      return `${who(e.who)} rolled ${e.dice} → ${e.to}${e.note ? ` (${e.note})` : ""}`;
    }
    // ludo
    if (e.token === undefined) {
      return `${who(e.who)} rolled ${e.dice}${e.note ? " (no move possible)" : ""}`;
    }
    let s =
      e.dice !== undefined
        ? `${who(e.who)} rolled ${e.dice}, moved token ${e.token + 1}`
        : `${who(e.who)} moved token ${e.token + 1}`;
    if (e.captured) s += ", captured a token!";
    if (e.finished) s += ", reached home!";
    return s;
  }

  function addLog(entries, game) {
    logLines.push(...entries.map((e) => describe(e, game)));
    logLines = logLines.slice(-8);
  }

  function statusText() {
    if (view.over) return "Game over";
    if (busy) return view.game === "chess" ? "Bot is thinking…" : "Rolling…";
    if (view.game === "chess") return view.inCheck ? "Check! Your move" : "Your move (White)";
    if (view.game === "snake") {
      const p = view.pos.p || "start";
      const b = view.pos.b || "start";
      return `You: ${p} · Bot: ${b}. Roll the dice!`;
    }
    return view.phase === "roll" ? "Your turn: roll the dice" : `You rolled ${view.dice}. Tap a glowing token.`;
  }

  function resultHtml() {
    let outcome = result ? result.outcome : view.winner === "p" ? "win" : view.winner === "b" ? "loss" : "draw";
    let text;
    const s = STAKES[view.game];
    if (outcome === "win") text = `🎉 You won! +${fmt(result ? result.delta : s.win)} points`;
    else if (outcome === "loss") text = `💀 You lost. −${fmt(result ? -result.delta : s.loss)} points`;
    else text = "🤝 Draw. No points changed.";
    return `<div class="game-result ${outcome}">${text}<button class="btn" id="backLobbyBtn">Back to lobby</button></div>`;
  }

  // ---------- drawing ----------
  function draw() {
    if (!view) return;
    titleEl.textContent = TITLES[view.game];
    statusEl.textContent = statusText();
    resignBtn.style.display = view.over ? "none" : "";
    resultEl.innerHTML = view.over ? resultHtml() : "";
    if (view.game === "chess") drawChess();
    else if (view.game === "snake") drawSnake();
    else drawLudo();
    logEl.innerHTML = logLines.map((l) => `<div>${escapeHtml(l)}</div>`).join("");
  }

  // One click handler for all boards.
  boardEl.addEventListener("click", (e) => {
    if (!view || view.over || busy) return;

    if (view.game === "chess") {
      const sq = e.target.closest("[data-sq]");
      if (!sq) return;
      const name = sq.dataset.sq;
      if (selected && (view.legal[selected] || []).includes(name)) {
        const from = selected;
        selected = null;
        act("move", { from, to: name });
        return;
      }
      selected = view.legal[name] ? name : null;
      draw();
    } else if (view.game === "ludo") {
      const tok = e.target.closest("[data-token]");
      if (tok && tok.classList.contains("sel")) act("move", { token: Number(tok.dataset.token) });
    }
  });

  controlsEl.addEventListener("click", (e) => {
    if (e.target.id === "rollBtn") act("roll");
  });

  // ----- Chess -----
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

  function chessSquare(r, c, piece, targets) {
    const name = "abcdefgh"[c] + (8 - r);
    let cls = "sq " + ((r + c) % 2 ? "dark" : "light");
    if (name === selected) cls += " selected";
    if (targets.includes(name)) cls += " target";
    if (view.lastMove && (view.lastMove.from === name || view.lastMove.to === name)) cls += " last";
    if (piece === "K" && view.inCheck) cls += " check";
    const glyph = piece
      ? `<span class="pc ${piece === piece.toUpperCase() ? "w" : "b"}">${GLYPH[piece.toLowerCase()]}\uFE0E</span>`
      : "";
    return `<div class="${cls}" data-sq="${name}">${glyph}</div>`;
  }

  function drawChess() {
    const rows = view.fen.split(" ")[0].split("/");
    const targets = selected ? view.legal[selected] || [] : [];
    let html = '<div class="chess-board">';
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        const n = parseInt(ch, 10);
        if (Number.isNaN(n)) {
          html += chessSquare(r, c, ch, targets);
          c++;
        } else {
          for (let k = 0; k < n; k++) {
            html += chessSquare(r, c, null, targets);
            c++;
          }
        }
      }
    }
    boardEl.innerHTML = html + "</div>";
    controlsEl.innerHTML = "";
  }

  // ----- Snake & Ladder -----
  function drawSnake() {
    const { pos, ladders, snakes } = view;
    let html = '<div class="snake-board">';
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const rb = 9 - row; // row counted from the bottom
        const num = rb % 2 === 0 ? rb * 10 + col + 1 : rb * 10 + (9 - col) + 1;
        let cls = "scell";
        let extra = "";
        if (ladders[num]) {
          cls += " ladder";
          extra = `<em>🪜${ladders[num]}</em>`;
        } else if (snakes[num]) {
          cls += " snake";
          extra = `<em>🐍${snakes[num]}</em>`;
        }
        if (num === 100) cls += " goal";
        const toks = (pos.p === num ? '<i class="tk p"></i>' : "") + (pos.b === num ? '<i class="tk b"></i>' : "");
        html += `<div class="${cls}"><small>${num}</small>${extra}<div class="tks">${toks}</div></div>`;
      }
    }
    boardEl.innerHTML = html + "</div>";
    controlsEl.innerHTML = view.over
      ? ""
      : `<button class="btn" id="rollBtn" ${busy ? "disabled" : ""}>🎲 Roll dice</button>
         <div class="legend">🔵 You &nbsp; 🔴 Bot &nbsp; · 🪜 goes up &nbsp; 🐍 goes down</div>`;
  }

  // ----- Ludo -----
  // The 52 squares of the shared ring on a 15x15 grid, clockwise from (6,1).
  const RING = [];
  const put = (r, c) => RING.push([r, c]);
  for (let c = 1; c <= 5; c++) put(6, c);
  for (let r = 5; r >= 0; r--) put(r, 6);
  put(0, 7);
  put(0, 8);
  for (let r = 1; r <= 5; r++) put(r, 8);
  for (let c = 9; c <= 14; c++) put(6, c);
  put(7, 14);
  put(8, 14);
  for (let c = 13; c >= 9; c--) put(8, c);
  for (let r = 9; r <= 14; r++) put(r, 8);
  put(14, 7);
  put(14, 6);
  for (let r = 13; r >= 9; r--) put(r, 6);
  for (let c = 5; c >= 0; c--) put(8, c);
  put(7, 0);
  put(6, 0);

  const START = { p: 0, b: 26 }; // where each side enters the ring
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  const HOME = {
    p: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    b: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  };
  const BASE = {
    p: [[1, 1], [1, 4], [4, 1], [4, 4]],
    b: [[10, 10], [10, 13], [13, 10], [13, 13]],
  };

  const RING_INDEX = {};
  RING.forEach(([r, c], i) => (RING_INDEX[`${r},${c}`] = i));
  const HOME_KEYS = { hp: new Set(HOME.p.map((x) => x.join(","))), hb: new Set(HOME.b.map((x) => x.join(","))) };
  const SLOT_KEYS = new Set([...BASE.p, ...BASE.b].map((x) => x.join(",")));

  function ludoCoords(side, r, i) {
    if (r === -1) return BASE[side][i];
    if (r <= 50) return RING[(START[side] + r) % 52];
    if (r <= 55) return HOME[side][r - 51];
    return [7, 7]; // finished: the centre
  }

  function ludoCellClass(r, c) {
    const key = `${r},${c}`;
    if (key in RING_INDEX) {
      const idx = RING_INDEX[key];
      let cls = "path";
      if (SAFE.has(idx)) cls += " safe";
      if (idx === START.p) cls += " start-p";
      if (idx === START.b) cls += " start-b";
      return cls;
    }
    if (HOME_KEYS.hp.has(key)) return "hp";
    if (HOME_KEYS.hb.has(key)) return "hb";
    if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return "center";
    if (r <= 5 && c <= 5) return "base-p" + (SLOT_KEYS.has(key) ? " slot" : "");
    if (r >= 9 && c >= 9) return "base-b" + (SLOT_KEYS.has(key) ? " slot" : "");
    if ((r <= 5 && c >= 9) || (r >= 9 && c <= 5)) return "base-x";
    return "hx";
  }

  function drawLudo() {
    const at = {};
    for (const side of ["p", "b"]) {
      view.tokens[side].forEach((r, i) => {
        const [row, col] = ludoCoords(side, r, i);
        (at[`${row},${col}`] ||= []).push({ side, i });
      });
    }

    let html = '<div class="ludo-board">';
    for (let r = 0; r < 15; r++) {
      for (let c = 0; c < 15; c++) {
        const toks = (at[`${r},${c}`] || [])
          .map((t) => {
            const sel = t.side === "p" && view.phase === "move" && !view.over && view.legal.includes(t.i);
            const attr = t.side === "p" ? ` data-token="${t.i}"` : "";
            return `<span class="ltok ${t.side}${sel ? " sel" : ""}"${attr}>${t.i + 1}</span>`;
          })
          .join("");
        html += `<div class="lcell ${ludoCellClass(r, c)}">${toks}</div>`;
      }
    }
    boardEl.innerHTML = html + "</div>";

    if (view.over) controlsEl.innerHTML = "";
    else if (view.phase === "roll") {
      controlsEl.innerHTML = `<button class="btn" id="rollBtn" ${busy ? "disabled" : ""}>🎲 Roll dice</button>
        <div class="legend">🔵 You &nbsp; 🔴 Bot &nbsp; · ★ safe squares · roll a 6 to leave base</div>`;
    } else {
      controlsEl.innerHTML = `<div class="hint">You rolled <b>${view.dice}</b>. Tap a glowing token to move it.</div>`;
    }
  }

  // ---------- start: resume an unfinished game, if any ----------
  (async function init() {
    refreshLobby();
    const r = await api("/api/game/state", {});
    if (r.ok && r.data.game) {
      view = r.data.game;
      showArea();
      draw();
    }
  })();
})();
