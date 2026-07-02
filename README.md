# SciVox ELN

A voice- and vision-powered **Electronic Lab Notebook**. Capture experiment
records hands-free by voice, digitise handwritten notes with OCR (upload *or*
live camera), plan experiments, track reagent inventory, and keep an immutable,
time-stamped audit trail with electronic signatures — behind proper accounts
and role-based access.

Full-stack, self-hostable web app. Backend: Node.js + Express + SQLite.
Frontend: a dependency-light vanilla-JS single-page app that works on desktop
and mobile browsers. Runs anywhere Docker runs.

---

## Quick start

### With Docker (recommended)

```bash
docker compose up --build
```

Open **http://localhost:3000** and create an account. **The first account
registered becomes the administrator.**

### With Node.js (development)

Requires **Node ≥ 22.5** (for the built-in `node:sqlite` driver).

```bash
npm install
npm start          # or: npm run dev
```

> Voice, OCR and camera use browser capabilities — use **Chrome/Edge** (or any
> modern mobile browser) and allow microphone/camera access. These require a
> secure context: `http://localhost` works; over a network use **HTTPS**.

---

## Features

- **Accounts & roles** — email/password sign-up and login, plus optional
  Google, GitHub and WeChat sign-in. Two roles in a hierarchy: **user** and
  **admin**. Admins manage accounts and roles; all data sits behind login.
- **Voice entry** — hands-free dictation with Start / Pause / Resume / Stop.
- **OCR handwriting scan** — from an uploaded image **or the live camera**
  (rear camera on phones); converted to searchable text (Tesseract.js) with the
  image stored on the record.
- **Experiment planner** — hypothesis, variables, protocol steps, and materials
  linked to inventory; start a plan to create a linked experiment.
- **Inventory** — quantity, unit, location, lot, expiry, reorder level; low-stock
  and expiry flags; logged stock adjustments.
- **Compliance** — content fingerprints, electronic signatures that lock entries,
  experiment locking, and an exportable (CSV) audit trail attributing every
  action to the authenticated user.
- **AI assistant** — a context-aware chat panel in each experiment (OpenAI),
  with the API key kept server-side.
- **Theming** — light/dark presets with a fully customisable 5-colour palette.
- **Mobile-ready** — responsive layout with a slide-in nav drawer; ideal for
  snapping OCR photos at the bench.

---

## Accounts, roles & login

Login is required for everything. Identity is derived server-side from a signed,
HttpOnly session cookie — never trusted from client headers. Passwords are
hashed with scrypt (`node:crypto`).

**Roles** form a hierarchy: `admin > user`.

- **user** — full use of the notebook, planner and inventory.
- **admin** — everything, plus the **Users** screen to view accounts and change
  roles. The last remaining admin cannot be demoted.

**Becoming admin:** the first account ever created is made admin automatically.
You can also list emails in `ADMIN_EMAILS` (comma-separated) to grant admin on
sign-up.

### OAuth sign-in (Google / GitHub / WeChat)

All three providers are shown on the login page; each is **enabled once its
credentials are set** (until then it appears disabled with a "not configured"
hint). Set the client credentials (and `BASE_URL`) in the environment, then
register each provider's callback URL as:

```
{BASE_URL}/api/auth/oauth/{provider}/callback
```

| Provider | Env vars                                   | Where to register the app |
|----------|--------------------------------------------|---------------------------|
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud → Credentials → OAuth client |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub → Settings → Developer settings → OAuth Apps |
| WeChat   | `WECHAT_APPID`, `WECHAT_SECRET`            | WeChat Open Platform → Website App |

Notes: Google/GitHub return an email (used to link accounts); WeChat identifies
users by their `unionid`/`openid` and provides no email. Callbacks must be
reachable over HTTPS in production, and the redirect URL must match exactly.

---

## Voice transcription: Web Speech vs. self-hosted Whisper

Selected by `STT_PROVIDER`:

- **`webspeech` (default)** — the browser's Web Speech API. Live text, no server
  infra, but audio is streamed to the browser vendor's cloud — not for
  classified/clean-room labs.
- **`whisper` (on-prem)** — runs a Whisper container; audio never leaves your
  network. The browser records audio and POSTs it to `/api/stt/transcribe`,
  which forwards to Whisper. Enable with the bundled Compose profile:

```bash
STT_PROVIDER=whisper docker compose --profile whisper up --build
```

Config: `STT_URL` (default `http://whisper:9000`), `ASR_MODEL` (`tiny`…`large-v3`),
`ASR_ENGINE` (`faster_whisper`/`openai_whisper`). Image:
[`onerahmet/openai-whisper-asr-webservice`]. Swap-in point on the app side:
`transcribe()` in `src/routes/stt.js`.

---

## AI assistant

Each experiment view has a right-hand chat panel powered by OpenAI. The server
injects that experiment's context (title, objective, status, recent entries) so
answers are grounded in the actual record; the assistant advises only — it never
modifies the notebook.

**The API key is server-side only** and never sent to the browser. Set it in
`.env` (which is gitignored — never commit it):

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5        # default; e.g. gpt-5.5-pro, gpt-5.4-mini
# OPENAI_BASE_URL=          # optional: Azure/OpenAI-compatible proxy base URL
```

If `OPENAI_API_KEY` is unset, the panel shows a "not configured" message and the
rest of the app is unaffected. Requests go through `POST /api/ai/chat`
(auth-required) → `src/routes/ai.js`.

## Theming

Light and dark presets ship with these palettes (customisable in **Settings →
Appearance**, or use the ◐ toggle in the top bar):

- **light**: `#0081a7 #00afb9 #fdfcdc #fed9b7 #f07167`
- **dark**: `#0b132b #1c2541 #3a506b #5bc0be #6fffe9`

Each mode exposes its five brand colours as swatches; the full CSS-variable
theme is derived from them, applied live, and saved per-device (with a pre-paint
step so there's no flash on reload). See `public/js/theme.js`.

---

## Project structure

```
src/
  index.js            Express app: auth middleware, route protection, static host
  db.js               All SQL (users, experiments, entries, plans, inventory, audit)
  auth.js             scrypt passwords, signed session cookies, role middleware
  oauth.js            Google / GitHub / WeChat OAuth flows (env-gated)
  seed.js             Demo data (only seeds an empty DB)
  routes/
    auth.js           register / login / logout / me / providers / oauth
    users.js          admin-only user list + role changes
    experiments.js    experiments + nested entries
    entries.js        entry signing
    plans.js          planner CRUD + "start as experiment"
    inventory.js      inventory CRUD + stock adjust
    audit.js          audit list + CSV export
    uploads.js        image uploads (scanned notes)
    stt.js            Web Speech default, Whisper forwarder
    ai.js             OpenAI assistant proxy (server-side key)
public/
  index.html
  css/styles.css
  js/
    app.js            shell: auth gating, routing, mobile drawer, theme toggle
    api.js            REST client (cookie auth)
    state.js          current-user state
    theme.js          light/dark presets + custom palette
    ui.js             shared helpers
    voice.js          Web Speech dictation (Start/Pause/Resume/Stop)
    recorder.js       MediaRecorder capture for Whisper mode
    ocr.js            Tesseract.js + camera capture helpers
    views/            one module per screen (incl. auth.js, users.js)
Dockerfile, docker-compose.yml, .env.example
```

---

## Data & backup

State lives under `DATA_DIR` (`/app/data` in Docker): `scivox.db`, `uploads/`,
and `.session_secret`. Back up by copying that directory (or the `scivox-data`
volume). `SEED=false` skips demo data on an empty DB.

## Production notes

- **HTTPS is required** for camera, microphone and secure cookies over a network.
  Terminate TLS at a reverse proxy and set `COOKIE_SECURE=true` and `BASE_URL`.
- Set an explicit `SESSION_SECRET` in production.
- Sessions are stateless (signed cookie): logout clears the client cookie; a
  stolen token stays valid until expiry. Add a server-side revocation list if you
  need immediate invalidation.
- **Signatures/fingerprints** are demo-grade (djb2). For 21 CFR Part 11, swap in
  cryptographic hashing/signing.
- Migrating to Postgres: all SQL is in `src/db.js` — re-implement the repository
  objects; routes and frontend are unchanged.

## API reference (summary)

```
GET  /api/health
POST /api/auth/register | /login | /logout    GET /api/auth/me | /providers
GET  /api/auth/oauth/:provider/start | /callback
GET  /api/users            PATCH /api/users/:id/role                (admin)
GET/POST/PATCH/DELETE /api/experiments[...]    POST /api/experiments/:id/lock|entries
POST /api/entries/:id/sign
GET/POST/PATCH/DELETE /api/plans[...]          POST /api/plans/:id/start
GET/POST/PATCH/DELETE /api/inventory[...]      POST /api/inventory/:id/adjust
GET  /api/audit            GET /api/audit/export.csv
GET  /api/stt/health       POST /api/stt/transcribe
POST /api/uploads
```
