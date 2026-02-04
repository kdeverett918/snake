# Time-Warp Snake

A tiny browser Snake game with a **rewind / time-warp** mechanic.

- Hold the bottom pedal (mobile) or Space (desktop) to rewind frame-by-frame.
- You can rewind out of crashes (game-over is recoverable).

## Run
- Open `index.html` in a browser, or
- Serve it locally and open the printed URL:
  - `npm start`

## Controls
- Move: Swipe (mobile) or Arrow keys / WASD
- Rewind: Hold bottom pedal (mobile) or Space (desktop)
- Restart: R

## Tuning (A/B params)
You can override a few MVP parameters via query params:

- `?tps=15` or `?tps=20`
- `?history=6` / `?history=8` / `?history=10`
- `?rewind=hold` or `?rewind=toggle`

## Render deployment
This repo includes a `render.yaml` Blueprint.

- **Blueprint (recommended):** In Render, choose "New" -> "Blueprint", select this GitHub repo, then deploy.
- **Manual:** Create a **Web Service**:
  - Build Command: `npm install` (or `yarn install`)
  - Start Command: `npm start` (or `yarn start`)
  - Health Check Path: `/healthz`
