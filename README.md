# SciVox ELN

A voice- and vision-powered **Electronic Lab Notebook**. Capture experiment
records hands-free by voice, digitise handwritten notes with OCR, plan
experiments, track reagent inventory, and keep an immutable, time-stamped audit
trail with electronic signatures.

This is a full-stack web application designed to be self-hosted and maintained
long-term. Backend: Node.js + Express + SQLite. Frontend: a dependency-light
vanilla-JS single-page app. Runs anywhere Docker runs — laptop, VPS, or on-prem
server behind your firewall.

---

## Quick start

### With Docker (recommended)

```bash
docker compose up --build
```

Then open **http://localhost:3000**. The database and uploaded scans persist in
the `scivox-data` Docker volume across restarts and rebuilds.

### With Node.js (development)

Requires **Node ≥ 22.5** (for the built-in `node:sqlite` driver).

```bash
npm install
npm start          # or: npm run dev   (auto-reload)
```

Open **http://localhost:3000**.

> Voice entry and OCR use browser capabilities, so use **Chrome or Edge** and
> allow microphone/camera access when prompted.

---

## Features

- **Voice entry** — dictate notes hands-free with Start / Pause / Resume / Stop
  control. Transcription is time-stamped the moment it is captured.
- **OCR handwriting scan** — photograph or upload a handwritten page; it is
  converted to searchable text (Tesseract.js, in-browser) and the image is
  stored with the record.
- **Experiment planner** — design protocols up front: hypothesis, variables,
  ordered steps, and materials (linked to inventory). Start a plan to spin up a
  linked experiment.
- **Inventory** — reagents/samples with quantity, unit, location, lot, expiry
  and reorder level; automatic low-stock and expiry flags; stock adjustments are
  logged.
- **Compliance layer** — content fingerprints on every entry, electronic
  signatures that lock entries immutably, experiment locking, and an exportable
  (CSV) audit trail of every action with user attribution and ISO timestamps.

---

## How voice transcription works

The browser's **Web Speech API** (`webkitSpeechRecognition`) streams microphone
audio to the platform speech service (Google's servers in Chrome/Edge) and
returns text. It is fast and free, but **not on-device** — unsuitable for
classified or clean-room labs.

The app is **Whisper-ready**: `src/routes/stt.js` is the drop-in seam for a
self-hosted engine (OpenAI Whisper / whisper.cpp / faster-whisper in its own
container). Set `STT_PROVIDER=whisper`, implement `transcribe()` (or point
`STT_URL` at a Whisper HTTP service), and the frontend routes voice through the
server automatically. Until then it uses Web Speech and needs no extra infra.

---

## Project structure

```
src/
  index.js            Express app: middleware, static serving, route mounting
  db.js               All SQL. The ONLY module that touches the database.
  seed.js             Demo data (only seeds an empty DB)
  routes/
    experiments.js    Experiments + nested entries
    entries.js        Entry signing
    plans.js          Planner CRUD + "start as experiment"
    inventory.js      Inventory CRUD + stock adjust (with flags)
    audit.js          Audit list + CSV export
    uploads.js        Image uploads (scanned notes)
    stt.js            Whisper-ready STT endpoint (stub)
public/
  index.html
  css/styles.css
  js/
    app.js            Shell: nav, routing, identity, search
    api.js            REST client (injects identity headers)
    state.js          Local identity persistence
    ui.js             Shared helpers (escape, format, toast, modal)
    voice.js          VoiceController (Start/Pause/Resume/Stop)
    ocr.js            Tesseract.js wrapper
    views/            One module per screen
Dockerfile, docker-compose.yml, .env.example
```

---

## Data & backup

All state lives under `DATA_DIR` (`/app/data` in Docker):

- `scivox.db` — the SQLite database
- `uploads/` — scanned note images

Back up by copying that directory (or the `scivox-data` volume). To start fresh,
delete `scivox.db`. Set `SEED=false` to skip demo data on an empty database.

---

## Migrating to PostgreSQL

The app never touches SQL outside `src/db.js`. Every route calls the repository
objects (`Experiments`, `Entries`, `Plans`, `Inventory`, `Audit`). To move to
Postgres/MySQL for larger multi-user deployments, re-implement those functions
against your driver of choice — the routes and frontend stay unchanged.

---

## Production notes

- **Authentication** is stubbed: the SPA sends the acting user's name/role in
  request headers for audit attribution. Before real deployment, put the app
  behind proper auth (SSO / JWT) and derive identity server-side. The seam is
  the identity middleware in `src/index.js`.
- **HTTPS**: terminate TLS at a reverse proxy (nginx/Caddy/Traefik) in front of
  the container. The browser Web Speech API and camera require a secure context
  (`https://` or `localhost`).
- **Signatures/fingerprints** here are demo-grade (djb2). For a regulated
  21 CFR Part 11 deployment, swap in cryptographic hashing/signing and enforce
  per-user credentials at signing time.

## API reference (summary)

```
GET    /api/health
GET    /api/experiments            POST /api/experiments
GET    /api/experiments/:id        PATCH /api/experiments/:id      DELETE /api/experiments/:id
POST   /api/experiments/:id/lock
POST   /api/experiments/:id/entries
POST   /api/entries/:id/sign
GET    /api/plans                  POST /api/plans
GET    /api/plans/:id              PATCH /api/plans/:id            DELETE /api/plans/:id
POST   /api/plans/:id/start
GET    /api/inventory              POST /api/inventory
PATCH  /api/inventory/:id          POST /api/inventory/:id/adjust  DELETE /api/inventory/:id
GET    /api/audit                  GET  /api/audit/export.csv
GET    /api/stt/health             POST /api/stt/transcribe
POST   /api/uploads
```
