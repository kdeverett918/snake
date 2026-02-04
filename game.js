(() => {
  "use strict";

  const GRID_W = 24;
  const GRID_H = 24;
  const BASE_MOVES_PER_SEC = 8;
  const SPEED_PER_5_FOODS = 0.5;
  const MAX_MOVES_PER_SEC = 14;
  const CELL_SIZE = 20;
  const BEST_SCORE_KEY = "gravitySnakeBestScore";

  const DIR_UP = 0;
  const DIR_RIGHT = 1;
  const DIR_DOWN = 2;
  const DIR_LEFT = 3;

  const DIRS = [
    { dx: 0, dy: -1, ch: "↑" },
    { dx: 1, dy: 0, ch: "→" },
    { dx: 0, dy: 1, ch: "↓" },
    { dx: -1, dy: 0, ch: "←" },
  ];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const gravityEl = document.getElementById("gravity");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");

  canvas.width = GRID_W * CELL_SIZE;
  canvas.height = GRID_H * CELL_SIZE;

  /** @type {"running" | "paused" | "gameover" | "win"} */
  let status = "running";
  let hasStarted = false;

  /** @type {Array<{x:number,y:number}>} */
  let snake = [];

  /** @type {number | null} */
  let dir = null;

  /** @type {number | null} */
  let pendingDir = null;

  /** @type {number} */
  let gravityDir = DIR_RIGHT;

  /** @type {{x:number,y:number} | null} */
  let food = null;

  let score = 0;
  let bestScore = loadBestScore();

  let lastTime = performance.now();
  let accumulatorMs = 0;

  resetGame();
  requestAnimationFrame(frame);

  function loadBestScore() {
    const raw = localStorage.getItem(BEST_SCORE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function saveBestScore(value) {
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(value));
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }

  function resetGame() {
    const cx = Math.floor(GRID_W / 2);
    const cy = Math.floor(GRID_H / 2);

    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
      { x: cx - 3, y: cy },
    ];

    dir = null;
    pendingDir = null;
    gravityDir = DIR_RIGHT;
    food = spawnFood();

    score = 0;
    status = "running";
    hasStarted = false;
    accumulatorMs = 0;

    updateHud();
    updateOverlay();
  }

  function movesPerSec() {
    const bumps = Math.floor(score / 5);
    return Math.min(MAX_MOVES_PER_SEC, BASE_MOVES_PER_SEC + bumps * SPEED_PER_5_FOODS);
  }

  function tickMs() {
    return 1000 / movesPerSec();
  }

  function isOpposite(a, b) {
    return a !== null && b !== null && ((a + 2) % 4) === b;
  }

  function keyFor(x, y) {
    return `${x},${y}`;
  }

  function spawnFood() {
    const occupied = new Set();
    for (const s of snake) occupied.add(keyFor(s.x, s.y));

    const empties = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!occupied.has(keyFor(x, y))) empties.push({ x, y });
      }
    }

    if (empties.length === 0) return null;
    return empties[(Math.random() * empties.length) | 0];
  }

  function chooseNewGravityDir(dirBeforeFlip) {
    const prev = gravityDir;
    const excluded = new Set([prev]);

    if (snake.length > 1 && dirBeforeFlip !== null) {
      excluded.add((dirBeforeFlip + 2) % 4);
    }

    let options = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT].filter((d) => !excluded.has(d));

    // Fallback if exclusions are too strict (should be rare / edge-casey)
    if (options.length === 0) {
      options = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT].filter((d) => d !== prev);
    }

    return options[(Math.random() * options.length) | 0];
  }

  function wouldCollideSelf(x, y, isEating) {
    const end = isEating ? snake.length : snake.length - 1;
    for (let i = 0; i < end; i++) {
      if (snake[i].x === x && snake[i].y === y) return true;
    }
    return false;
  }

  function step() {
    if (dir === null) return;

    if (pendingDir !== null && !isOpposite(pendingDir, dir)) {
      dir = pendingDir;
    }
    pendingDir = null;

    const d = DIRS[dir];
    const head = snake[0];
    const next = { x: head.x + d.dx, y: head.y + d.dy };

    // Wall collision (die on wall)
    if (next.x < 0 || next.x >= GRID_W || next.y < 0 || next.y >= GRID_H) {
      status = "gameover";
      updateOverlay();
      return;
    }

    const isEating = !!food && next.x === food.x && next.y === food.y;

    // Self collision
    if (wouldCollideSelf(next.x, next.y, isEating)) {
      status = "gameover";
      updateOverlay();
      return;
    }

    snake.unshift(next);

    if (isEating) {
      score += 1;
      if (score > bestScore) {
        bestScore = score;
        saveBestScore(bestScore);
      }

      const dirBeforeFlip = dir;
      gravityDir = chooseNewGravityDir(dirBeforeFlip);
      dir = gravityDir;
      pendingDir = null;

      food = spawnFood();
      if (!food) {
        status = "win";
        updateHud();
        updateOverlay();
        return;
      }
      updateHud();
      return;
    }

    snake.pop();
  }

  function updateHud() {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(bestScore);
    gravityEl.textContent = DIRS[gravityDir].ch;
  }

  function setOverlay(visible, title, body) {
    overlayEl.classList.toggle("is-hidden", !visible);
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = body;
  }

  function updateOverlay() {
    if (!hasStarted && status === "running") {
      setOverlay(true, "Gravity Snake", "Press an arrow key or WASD to start.");
      return;
    }

    if (status === "paused") {
      setOverlay(true, "Paused", "Space to resume.");
      return;
    }

    if (status === "gameover") {
      setOverlay(true, "Game Over", `Score: ${score}. Press R to restart.`);
      return;
    }

    if (status === "win") {
      setOverlay(true, "You Win", `Score: ${score}. Press R to play again.`);
      return;
    }

    setOverlay(false, "", "");
  }

  function onDirectionInput(nextDir) {
    if (status === "gameover" || status === "win") return;
    if (status === "paused") return;

    if (!hasStarted) {
      hasStarted = true;
      dir = nextDir;
      pendingDir = null;
      accumulatorMs = tickMs(); // start moving immediately
      updateOverlay();
      return;
    }

    if (dir !== null && isOpposite(nextDir, dir)) return;
    pendingDir = nextDir;
  }

  window.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();

      if (k === " " || k === "spacebar") {
        e.preventDefault();
        if (!hasStarted) return;
        if (status === "running") {
          status = "paused";
        } else if (status === "paused") {
          status = "running";
        }
        updateOverlay();
        return;
      }

      if (k === "r") {
        e.preventDefault();
        resetGame();
        return;
      }

      // Direction keys
      switch (k) {
        case "arrowup":
        case "w":
          e.preventDefault();
          onDirectionInput(DIR_UP);
          break;
        case "arrowright":
        case "d":
          e.preventDefault();
          onDirectionInput(DIR_RIGHT);
          break;
        case "arrowdown":
        case "s":
          e.preventDefault();
          onDirectionInput(DIR_DOWN);
          break;
        case "arrowleft":
        case "a":
          e.preventDefault();
          onDirectionInput(DIR_LEFT);
          break;
        default:
          break;
      }
    },
    { passive: false }
  );

  function frame(now) {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;

    if (status === "running" && hasStarted) {
      accumulatorMs += dt;
      const stepSize = tickMs();

      let steps = 0;
      const maxSteps = 5;
      while (accumulatorMs >= stepSize && steps < maxSteps && status === "running") {
        step();
        accumulatorMs -= stepSize;
        steps += 1;
      }

      if (steps === maxSteps) accumulatorMs = 0;
    } else {
      accumulatorMs = 0;
    }

    render();
    requestAnimationFrame(frame);
  }

  function render() {
    // background
    ctx.fillStyle = "#070b14";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // subtle grid
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= GRID_W; x++) {
      const px = x * CELL_SIZE + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
    }
    for (let y = 0; y <= GRID_H; y++) {
      const py = y * CELL_SIZE + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(canvas.width, py);
    }
    ctx.stroke();

    // food
    if (food) {
      const cx = food.x * CELL_SIZE + CELL_SIZE / 2;
      const cy = food.y * CELL_SIZE + CELL_SIZE / 2;
      const r = CELL_SIZE * 0.34;
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // snake
    const pad = 2;
    for (let i = snake.length - 1; i >= 0; i--) {
      const s = snake[i];
      const x = s.x * CELL_SIZE + pad;
      const y = s.y * CELL_SIZE + pad;
      const w = CELL_SIZE - pad * 2;
      const h = CELL_SIZE - pad * 2;

      if (i === 0) {
        ctx.fillStyle = "#34d399";
      } else {
        ctx.fillStyle = "#22c55e";
      }
      ctx.fillRect(x, y, w, h);
    }

    // head details (simple eyes)
    if (snake.length > 0 && dir !== null) {
      const head = snake[0];
      const d = DIRS[dir];
      const hx = head.x * CELL_SIZE;
      const hy = head.y * CELL_SIZE;

      const eyeR = 2.2;
      const eyeOffsetSide = 5;
      const eyeOffsetFront = 6;
      const cx = hx + CELL_SIZE / 2;
      const cy = hy + CELL_SIZE / 2;

      let ex1 = cx;
      let ey1 = cy;
      let ex2 = cx;
      let ey2 = cy;

      if (d.dx !== 0) {
        const front = d.dx * eyeOffsetFront;
        ex1 = cx + front;
        ex2 = cx + front;
        ey1 = cy - eyeOffsetSide;
        ey2 = cy + eyeOffsetSide;
      } else {
        const front = d.dy * eyeOffsetFront;
        ey1 = cy + front;
        ey2 = cy + front;
        ex1 = cx - eyeOffsetSide;
        ex2 = cx + eyeOffsetSide;
      }

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.beginPath();
      ctx.arc(ex1, ey1, eyeR, 0, Math.PI * 2);
      ctx.arc(ex2, ey2, eyeR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
})();

