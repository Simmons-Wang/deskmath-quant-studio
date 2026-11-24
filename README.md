# DeskMath — Quant Trader Mental Math Studio

Full-stack cloud-ready mental math exercise platform designed for quantitative trading speed training on **PC Chrome** and **iPhone** (installable PWA).

## Features
- **Mixed Integer Operations (`+`, `−`, `×`, `÷`)**: 3-digit addition (`154 + 353`), 2×2 multiplication (`56 × 23`), integer subtraction (with optional negative answers + iPhone `±` sign toggle), and exact integer division (`1288 ÷ 23`).
- **Visual & Voice Training Modes**:
  - **Visual Mode**: Crisp, high-contrast tabular display with real-time pace bar and live attempt tape.
  - **Voice: Audio + Keys**: Spoken equations (`0.8×–2.0×`) with Blind Audio toggle and split timing (`reactionMs` vs. post-speech `processingMs`).
  - **Voice: Hands-Free**: Web Speech Synthesis + SpeechRecognition integer/command parser (`skip`, `repeat`, `stop`) with seamless keyboard fallback.
- **Submission & Speed Discipline**: Configurable `Enter Key (Strict)`, `Auto at Digit Length`, or `Exact Match Auto (Zetamac)`, plus optional per-question cutoffs.
- **Mistake Review & Hybrid Quant Coach**:
  - Filterable, sortable mistake & slow-solve log (`Carry / Place-Value Slip`, `Units-Digit Slip`, `Sign Inversion`, `Slow Process Speed`).
  - Step-by-step left-to-right trick breakdown (`Distributive Split`, `Round & Compensate`, `Difference of Squares`, `Anchor Chunk + Remainder Peel`) + inline **Practice Similar** sibling drill + trader reflection notes.
  - Interactive **Quant Coach** grounded in live SQLite telemetry, with optional BYO OpenAI or Gemini API key.
- **iPhone & Desktop PWA Ready**: Web app manifest, Apple Touch icons, safe-area layout, and instant light/dark mode.

---

## Deploy 24/7 to the Cloud (with Persistent SQLite)

> **Important for iPhone Voice Mode:** iOS Safari and Chrome require an **HTTPS** URL for microphone/speech APIs and PWA installation. Fly.io, Railway, and Render all provision automatic HTTPS certificates.

### Option A: Railway (Fastest 1-Click GitHub Deploy)
1. In [Railway](https://railway.app), click **New Project → Deploy from GitHub repo** and select this repository.
2. Add a **Volume** mounted at `/app/data` so your SQLite database persists across redeploys.
3. Set environment variables:
   - `NODE_ENV=production`
   - `PORT=3001`
   - `DATABASE_PATH=/app/data/quantmath.db`
4. Click **Generate Domain** under Settings → Networking to get your permanent `https://...up.railway.app` URL.

### Option B: Fly.io (`fly.toml` included)
```bash
fly launch --copy-config --no-deploy
fly volumes create quantmath_data --size 1
fly deploy
```
Your app runs 24/7 (`min_machines_running = 1`) at `https://<your-app>.fly.dev`.

### Option C: Render (`render.yaml` Blueprint included)
1. In [Render](https://render.com), click **New → Blueprint** and connect this GitHub repository.
2. Confirm the `quantmath-data` disk mounted at `/app/data` (1 GB).
3. Render builds the Dockerfile and exposes your permanent `https://...onrender.com` URL.

### Using on iPhone
1. Open your deployed `https://...` URL in Safari or Chrome on iPhone.
2. Tap **Share → Add to Home Screen** (in Safari) to launch DeskMath full-screen like a native app.

---

## Local Development

```bash
npm install && npm --prefix client install && npm --prefix server install
npm run dev
```

- Frontend Vite dev server: `http://localhost:5173` (proxies `/api` to `:3001`)
- Backend Express + SQLite API: `http://localhost:3001`

## Tests & Production Build

```bash
npm test
npm run build
npm start
```
