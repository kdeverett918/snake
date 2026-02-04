(() => {
  "use strict";

  const GRID_W = 32;
  const GRID_H = 32;
  const BASE_MOVES_PER_SEC = 6;
  const SPEED_PER_5_FOODS = 0.4;
  const MAX_MOVES_PER_SEC = 12;
  const CELL_SIZE = 20;
  const BEST_SCORE_KEY = "portalSnakeBestScore";

  const DIR_UP = 0;
  const DIR_RIGHT = 1;
  const DIR_DOWN = 2;
  const DIR_LEFT = 3;

  const DIRS = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
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

  /** @type {number[]} */
  let dirQueue = [];

  /** @type {{x:number,y:number} | null} */
  let portalFood = null;

  /** @type {{x:number,y:number} | null} */
  let portalExit = null;

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
    dirQueue = [];
    const portalPair = spawnPortalPair();
    portalFood = portalPair ? portalPair.food : null;
    portalExit = portalPair ? portalPair.exit : null;

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

  function collectEmptyCells() {
    const occupied = new Set();
    for (const s of snake) occupied.add(keyFor(s.x, s.y));

    const empties = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        if (!occupied.has(keyFor(x, y))) empties.push({ x, y });
      }
    }

    return empties;
  }

  function pickRandomIndex(maxExclusive) {
    return (Math.random() * maxExclusive) | 0;
  }

  function spawnPortalPair() {
    const empties = collectEmptyCells();
    if (empties.length < 2) return null;

    const isSafePortalCell = (c) => c.x >= 1 && c.x < GRID_W - 1 && c.y >= 1 && c.y < GRID_H - 1;

    const safeForFood = empties.filter(isSafePortalCell);
    const foodPool = safeForFood.length >= 2 ? safeForFood : empties;
    const foodCell = foodPool[pickRandomIndex(foodPool.length)];

    const remaining = empties.filter((c) => c.x !== foodCell.x || c.y !== foodCell.y);
    const safeForExit = remaining.filter(isSafePortalCell);
    const exitPool = safeForExit.length >= 1 ? safeForExit : remaining;
    const exitCell = exitPool[pickRandomIndex(exitPool.length)];

    return { food: foodCell, exit: exitCell };
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

    if (dirQueue.length > 0) {
      const nextDir = dirQueue.shift();
      if (typeof nextDir === "number" && !isOpposite(nextDir, dir)) {
        dir = nextDir;
      }
    }

    const d = DIRS[dir];
    const head = snake[0];
    const stepTo = { x: head.x + d.dx, y: head.y + d.dy };

    // Wall collision (die on wall)
    if (stepTo.x < 0 || stepTo.x >= GRID_W || stepTo.y < 0 || stepTo.y >= GRID_H) {
      status = "gameover";
      updateOverlay();
      return;
    }

    const isEatingPortal = !!portalFood && stepTo.x === portalFood.x && stepTo.y === portalFood.y;
    const next = isEatingPortal ? portalExit : stepTo;
    if (!next) {
      status = "win";
      updateHud();
      updateOverlay();
      return;
    }

    // Self collision
    if (wouldCollideSelf(next.x, next.y, isEatingPortal)) {
      status = "gameover";
      updateOverlay();
      return;
    }

    snake.unshift(next);

    if (isEatingPortal) {
      score += 1;
      if (score > bestScore) {
        bestScore = score;
        saveBestScore(bestScore);
      }

      // Teleport changes context a lot; clear buffered inputs so controls feel snappy.
      dirQueue = [];

      const portalPair = spawnPortalPair();
      portalFood = portalPair ? portalPair.food : null;
      portalExit = portalPair ? portalPair.exit : null;
      if (!portalFood || !portalExit) {
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
  }

  function setOverlay(visible, title, body) {
    overlayEl.classList.toggle("is-hidden", !visible);
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = body;
  }

  function updateOverlay() {
    if (!hasStarted && status === "running") {
      setOverlay(true, "Portal Snake", "Press an arrow key or WASD to start. Eat pink to teleport to cyan.");
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
      dirQueue = [];
      accumulatorMs = tickMs(); // start moving immediately
      updateOverlay();
      return;
    }

    const lastPlannedDir = dirQueue.length > 0 ? dirQueue[dirQueue.length - 1] : dir;
    if (lastPlannedDir !== null) {
      if (nextDir === lastPlannedDir) return;
      if (isOpposite(nextDir, lastPlannedDir)) return;
    }

    const MAX_QUEUE = 2;
    if (dirQueue.length < MAX_QUEUE) {
      dirQueue.push(nextDir);
    } else {
      dirQueue[dirQueue.length - 1] = nextDir;
    }
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

    // portal exit
    if (portalExit) {
      const ex = portalExit.x * CELL_SIZE + CELL_SIZE / 2;
      const ey = portalExit.y * CELL_SIZE + CELL_SIZE / 2;
      const r = CELL_SIZE * 0.36;

      ctx.strokeStyle = "rgba(34, 211, 238, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ex, ey, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(34, 211, 238, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(34, 211, 238, 0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ex, ey, r, Math.PI * 0.15, Math.PI * 0.55);
      ctx.arc(ex, ey, r, Math.PI * 1.15, Math.PI * 1.45);
      ctx.stroke();
    }

    // portal food
    if (portalFood) {
      const fx = portalFood.x * CELL_SIZE + CELL_SIZE / 2;
      const fy = portalFood.y * CELL_SIZE + CELL_SIZE / 2;
      const r = CELL_SIZE * 0.34;
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.arc(fx - r * 0.25, fy - r * 0.25, r * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx, fy, r + 2, 0, Math.PI * 2);
      ctx.stroke();
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
