(() => {
  "use strict";

  // Time-Warp Snake (Mobile-first)
  // - Swipe anywhere (except the rewind pedal) to turn
  // - Hold the rewind pedal (bottom) or Space to rewind frame-by-frame
  // - Rewind can recover from crashes (rewind out of game-over)

  const GRID_W = 40;
  const GRID_H = 40;
  const CELL_SIZE = 16;

  const SWIPE_DEADZONE_PX = 24;

  const BEST_SCORE_KEY = "timeWarpSnakeBestScore";

  const DIR_UP = 0;
  const DIR_RIGHT = 1;
  const DIR_DOWN = 2;
  const DIR_LEFT = 3;

  const DIRS = [
    { dx: 0, dy: -1, x: 0, y: -1 },
    { dx: 1, dy: 0, x: 1, y: 0 },
    { dx: 0, dy: 1, x: 0, y: 1 },
    { dx: -1, dy: 0, x: -1, y: 0 },
  ];

  const DEFAULT_CONFIG = {
    tps: 20,
    historySeconds: 8,
    rewindMode: "hold", // "hold" | "toggle"
  };

  const ALLOWED_TPS = new Set([15, 20]);
  const ALLOWED_HISTORY_SECONDS = new Set([6, 8, 10]);
  const ALLOWED_REWIND_MODE = new Set(["hold", "toggle"]);

  const params = new URLSearchParams(window.location.search);

  function parseIntChoice(name, allowedSet, fallback) {
    const raw = params.get(name);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    return allowedSet.has(i) ? i : fallback;
  }

  function parseStringChoice(name, allowedSet, fallback) {
    const raw = params.get(name);
    if (!raw) return fallback;
    return allowedSet.has(raw) ? raw : fallback;
  }

  const CONFIG = {
    tps: parseIntChoice("tps", ALLOWED_TPS, DEFAULT_CONFIG.tps),
    historySeconds: parseIntChoice("history", ALLOWED_HISTORY_SECONDS, DEFAULT_CONFIG.historySeconds),
    rewindMode: parseStringChoice("rewind", ALLOWED_REWIND_MODE, DEFAULT_CONFIG.rewindMode),
  };

  const STEP_MS = 1000 / CONFIG.tps;
  const HISTORY_CAPACITY = CONFIG.tps * CONFIG.historySeconds;

  const canvas = document.getElementById("game");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const rewindModeEl = document.getElementById("rewindMode");
  const overlayEl = document.getElementById("overlay");
  const overlayTitleEl = document.getElementById("overlayTitle");
  const overlayBodyEl = document.getElementById("overlayBody");
  const rewindFxEl = document.getElementById("rewindFx");
  const pedalEl = document.getElementById("rewindPedal");

  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return;

  canvas.width = GRID_W * CELL_SIZE;
  canvas.height = GRID_H * CELL_SIZE;

  if (rewindModeEl) rewindModeEl.textContent = CONFIG.rewindMode === "hold" ? "Hold" : "Toggle";
  if (pedalEl) {
    const t = pedalEl.querySelector(".pedal__title");
    if (t) t.textContent = CONFIG.rewindMode === "hold" ? "HOLD TO REWIND" : "TAP TO REWIND";
  }

  /** @type {Array<{x:number,y:number}>} */
  let snake = [];
  /** @type {{x:number,y:number} | null} */
  let food = null;
  /** @type {number | null} */
  let dir = null;
  /** @type {number[]} */
  let dirQueue = [];
  let score = 0;
  let bestScore = loadBestScore();
  let gameOver = false;
  let hasStarted = false;

  /** @type {boolean} */
  let isRewinding = false;

  /** @type {boolean} */
  let keyboardRewindHeld = false;

  /** @type {Map<number, { kind: "rewind" | "swipe", startX: number, startY: number }>} */
  const activeTouches = new Map();
  let rewindTouchCount = 0;

  /** @type {Array<any>} */
  let history = new Array(HISTORY_CAPACITY);
  let historyHead = -1;
  let historySize = 0;

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

  function resetGame() {
    const cx = Math.floor(GRID_W / 2);
    const cy = Math.floor(GRID_H / 2);

    snake = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
      { x: cx - 3, y: cy },
    ];

    food = spawnFood();
    dir = null;
    dirQueue = [];
    score = 0;
    gameOver = false;
    hasStarted = false;

    history = new Array(HISTORY_CAPACITY);
    historyHead = -1;
    historySize = 0;

    isRewinding = false;
    keyboardRewindHeld = false;
    activeTouches.clear();
    rewindTouchCount = 0;

    accumulatorMs = 0;
    lastTime = performance.now();

    updateHud();
    updateOverlay();
    updateRewindUi();
  }

  function isOpposite(a, b) {
    return a !== null && b !== null && ((a + 2) % 4) === b;
  }

  function queueDirection(nextDir) {
    if (isRewinding) return;

    if (!hasStarted) {
      hasStarted = true;
      dir = nextDir;
      dirQueue = [];
      accumulatorMs = STEP_MS; // start moving immediately
      updateOverlay();
      return;
    }

    if (gameOver) return;

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

  function pushHistory(snapshot) {
    historyHead = (historyHead + 1) % HISTORY_CAPACITY;
    history[historyHead] = snapshot;
    if (historySize < HISTORY_CAPACITY) historySize += 1;
  }

  function popHistory() {
    if (historySize <= 0) return null;
    const snap = history[historyHead];
    history[historyHead] = undefined;
    historyHead = (historyHead - 1 + HISTORY_CAPACITY) % HISTORY_CAPACITY;
    historySize -= 1;
    return snap ?? null;
  }

  function snapshotState() {
    const v = dir !== null ? DIRS[dir] : { x: 1, y: 0 };
    return {
      snake: snake.map((s) => ({ x: s.x, y: s.y })),
      food: food ? { x: food.x, y: food.y } : null,
      dir: { x: v.x, y: v.y },
      score,
      gameOver,
    };
  }

  function dirFromVec(vec) {
    if (!vec) return DIR_RIGHT;
    for (let i = 0; i < DIRS.length; i++) {
      const d = DIRS[i];
      if (d.x === vec.x && d.y === vec.y) return i;
    }
    return DIR_RIGHT;
  }

  function restoreFromSnapshot(snapshot) {
    // Re-clone on restore to prevent mutation corruption of stored snapshots.
    snake = snapshot.snake.map((s) => ({ x: s.x, y: s.y }));
    food = snapshot.food ? { x: snapshot.food.x, y: snapshot.food.y } : null;
    dir = dirFromVec(snapshot.dir);
    score = snapshot.score;
    gameOver = snapshot.gameOver;
    hasStarted = true;
    dirQueue = [];
    updateHud();
  }

  function wouldCollideSelf(x, y, isEating) {
    const end = isEating ? snake.length : snake.length - 1;
    for (let i = 0; i < end; i++) {
      if (snake[i].x === x && snake[i].y === y) return true;
    }
    return false;
  }

  function simTick() {
    if (isRewinding) {
      const snap = popHistory();
      if (snap) {
        restoreFromSnapshot(snap);
        updateOverlay();
      }
      return;
    }

    if (!hasStarted) return;
    if (gameOver) return;
    if (dir === null) return;

    // Store state BEFORE stepping so crashes can be rewound out of.
    pushHistory(snapshotState());

    if (dirQueue.length > 0) {
      const nextDir = dirQueue.shift();
      if (typeof nextDir === "number" && !isOpposite(nextDir, dir)) {
        dir = nextDir;
      }
    }

    const d = DIRS[dir];
    const head = snake[0];
    const nx = head.x + d.dx;
    const ny = head.y + d.dy;

    // Wall collision
    if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) {
      gameOver = true;
      updateOverlay();
      return;
    }

    const isEating = !!food && nx === food.x && ny === food.y;

    // Self collision
    if (wouldCollideSelf(nx, ny, isEating)) {
      gameOver = true;
      updateOverlay();
      return;
    }

    snake.unshift({ x: nx, y: ny });

    if (isEating) {
      score += 1;
      if (score > bestScore) {
        bestScore = score;
        saveBestScore(bestScore);
      }

      food = spawnFood();
      updateHud();
      return;
    }

    snake.pop();
  }

  function updateHud() {
    if (scoreEl) scoreEl.textContent = String(score);
    if (bestEl) bestEl.textContent = String(bestScore);
  }

  function setOverlay(visible, title, body) {
    if (!overlayEl || !overlayTitleEl || !overlayBodyEl) return;
    overlayEl.classList.toggle("is-hidden", !visible);
    overlayTitleEl.textContent = title;
    overlayBodyEl.textContent = body;
  }

  function updateOverlay() {
    if (isRewinding) {
      setOverlay(false, "", "");
      return;
    }

    if (!hasStarted) {
      setOverlay(
        true,
        "Time-Warp Snake",
        `Swipe to turn. Hold the bottom rewind pedal (or Space) to rewind. TPS=${CONFIG.tps}, history=${CONFIG.historySeconds}s.`
      );
      return;
    }

    if (gameOver) {
      setOverlay(true, "CRASH!", "Hold REWIND (bottom pedal / Space) to go back, or press R to restart.");
      return;
    }

    setOverlay(false, "", "");
  }

  function updateRewindUi() {
    if (pedalEl) pedalEl.classList.toggle("is-active", isRewinding);
    if (rewindFxEl) rewindFxEl.classList.toggle("is-active", isRewinding);
  }

  function setRewinding(next) {
    if (isRewinding === next) return;
    isRewinding = next;
    updateRewindUi();
    updateOverlay();
  }

  function toggleRewinding() {
    setRewinding(!isRewinding);
  }

  function syncRewindHoldState() {
    if (CONFIG.rewindMode !== "hold") return;
    setRewinding(keyboardRewindHeld || rewindTouchCount > 0);
  }

  window.addEventListener(
    "keydown",
    (e) => {
      const k = e.key.toLowerCase();

      if (k === "r") {
        e.preventDefault();
        resetGame();
        return;
      }

      if (k === " " || k === "spacebar") {
        e.preventDefault();
        if (CONFIG.rewindMode === "toggle") {
          if (!e.repeat) toggleRewinding();
          return;
        }
        keyboardRewindHeld = true;
        syncRewindHoldState();
        return;
      }

      if (isRewinding) return;

      switch (k) {
        case "arrowup":
        case "w":
          e.preventDefault();
          queueDirection(DIR_UP);
          break;
        case "arrowright":
        case "d":
          e.preventDefault();
          queueDirection(DIR_RIGHT);
          break;
        case "arrowdown":
        case "s":
          e.preventDefault();
          queueDirection(DIR_DOWN);
          break;
        case "arrowleft":
        case "a":
          e.preventDefault();
          queueDirection(DIR_LEFT);
          break;
        default:
          break;
      }
    },
    { passive: false }
  );

  window.addEventListener(
    "keyup",
    (e) => {
      const k = e.key.toLowerCase();
      if (k !== " " && k !== "spacebar") return;
      if (CONFIG.rewindMode !== "hold") return;
      keyboardRewindHeld = false;
      syncRewindHoldState();
    },
    { passive: true }
  );

  function pedalRect() {
    if (!pedalEl) return null;
    return pedalEl.getBoundingClientRect();
  }

  function isInPedalZone(clientX, clientY) {
    const r = pedalRect();
    if (!r) return false;
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const inPedal = isInPedalZone(t.clientX, t.clientY);
      activeTouches.set(t.identifier, {
        kind: inPedal ? "rewind" : "swipe",
        startX: t.clientX,
        startY: t.clientY,
      });

      if (inPedal) {
        if (CONFIG.rewindMode === "toggle") {
          toggleRewinding();
        } else {
          rewindTouchCount += 1;
          syncRewindHoldState();
        }
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();

    if (isRewinding) return;

    for (const t of e.changedTouches) {
      const info = activeTouches.get(t.identifier);
      if (!info || info.kind !== "swipe") continue;

      const dx = t.clientX - info.startX;
      const dy = t.clientY - info.startY;
      if (Math.abs(dx) < SWIPE_DEADZONE_PX && Math.abs(dy) < SWIPE_DEADZONE_PX) continue;

      let nextDir;
      if (Math.abs(dx) > Math.abs(dy)) {
        nextDir = dx > 0 ? DIR_RIGHT : DIR_LEFT;
      } else {
        nextDir = dy > 0 ? DIR_DOWN : DIR_UP;
      }

      queueDirection(nextDir);
      // Reset the swipe origin so one finger can chain multiple swipes.
      info.startX = t.clientX;
      info.startY = t.clientY;
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const info = activeTouches.get(t.identifier);
      if (info && info.kind === "rewind" && CONFIG.rewindMode === "hold") {
        rewindTouchCount = Math.max(0, rewindTouchCount - 1);
      }
      activeTouches.delete(t.identifier);
    }

    syncRewindHoldState();
  }

  document.addEventListener("touchstart", onTouchStart, { passive: false });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onTouchEnd, { passive: false });
  document.addEventListener("touchcancel", onTouchEnd, { passive: false });

  function frame(now) {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;

    const simActive = isRewinding || (hasStarted && !gameOver);
    if (simActive) {
      accumulatorMs += dt;
      let steps = 0;
      const maxSteps = 8;
      while (accumulatorMs >= STEP_MS && steps < maxSteps) {
        simTick();
        accumulatorMs -= STEP_MS;
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
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
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
      const r = CELL_SIZE * 0.32;
      ctx.fillStyle = "#f59e0b";
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
        ctx.fillStyle = isRewinding ? "#a855f7" : "#34d399";
      } else {
        ctx.fillStyle = isRewinding ? "#7c3aed" : "#22c55e";
      }
      ctx.fillRect(x, y, w, h);
    }

    // head eyes (simple)
    if (snake.length > 0 && dir !== null) {
      const head = snake[0];
      const d = DIRS[dir];
      const hx = head.x * CELL_SIZE;
      const hy = head.y * CELL_SIZE;

      const eyeR = Math.max(1.8, CELL_SIZE * 0.12);
      const eyeOffsetSide = CELL_SIZE * 0.22;
      const eyeOffsetFront = CELL_SIZE * 0.26;
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

