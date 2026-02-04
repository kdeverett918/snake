# Portal Snake

A tiny browser Snake game with **portal food**: eating the portal fruit teleports your head to the portal exit.

## Run
- Open `index.html` in a browser, or
- Serve it locally and open the printed URL:
  - `npm start`

## Controls
- Move: Arrow keys / WASD
- Pause: Space
- Restart: R

## Render deployment
This repo includes a `render.yaml` Blueprint.

- **Blueprint (recommended):** In Render, choose "New" -> "Blueprint", select this GitHub repo, then deploy.
- **Manual:** Create a **Web Service**:
  - Build Command: `npm install` (or `yarn install`)
  - Start Command: `npm start` (or `yarn start`)
  - Health Check Path: `/healthz`
