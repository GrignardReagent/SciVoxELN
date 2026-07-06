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

### Public prototype without buying a domain

For a prototype, use the bundled Cloudflare Quick Tunnel profile. It gives you
a temporary public HTTPS URL such as `https://something.trycloudflare.com`
without buying a domain, changing DNS, or opening router ports.

1. Copy `.env.example` to `.env`.
2. For tunnel access, set:

```bash
COOKIE_SECURE=true
TRUST_PROXY=1
FORCE_HTTPS=false
STT_PROVIDER=auto
# OPENAI_API_KEY=sk-...   # required for mobile voice unless using Whisper
SESSION_SECRET=<long-random-secret>
ADMIN_EMAILS=you@lab.org
```

Leave `BASE_URL` blank for this prototype mode; the app infers the active tunnel
host for OAuth callbacks.

3. Start the app and tunnel:

```bash
docker compose --profile prototype up -d --build
```

4. Copy the public URL from the tunnel logs:

```bash
docker compose logs -f prototype-tunnel
```

Open the printed `https://*.trycloudflare.com` URL. Email/password sign-up is
always available; the first account becomes admin. Google, GitHub and WeChat
buttons become active when their corresponding client credentials are set in
`.env`.

To close the public prototype URL immediately while leaving the local app up:

```bash
docker compose stop prototype-tunnel
```

To stop the prototype app and tunnel together:

```bash
docker compose --profile prototype down
```

If you test OAuth on the tunnel URL, register callbacks using the printed host:

```text
https://<printed-tunnel-host>/api/auth/oauth/google/callback
https://<printed-tunnel-host>/api/auth/oauth/github/callback
https://<printed-tunnel-host>/api/auth/oauth/wechat/callback
```

### Permanent domain deployment

Later, when you have a real domain, use the bundled Caddy profile:

1. Point a DNS `A`/`AAAA` record for the domain at the server.
2. Open ports **80** and **443** on the server/firewall.
3. Set `DOMAIN`, `BASE_URL=https://DOMAIN`, `COOKIE_SECURE=true`,
   `TRUST_PROXY=1`, `FORCE_HTTPS=true`, and `SESSION_SECRET` in `.env`.
4. Start the permanent-domain deployment:

```bash
docker compose --profile public up -d --build
```

To close public-domain access:

```bash
docker compose stop caddy
```

To shut down the public-domain deployment:

```bash
docker compose --profile public down
```

For the optional local Whisper service:

```bash
docker compose --profile whisper down
```

These shutdown commands keep the database, uploads and model cache volumes. Use
`docker compose down -v` only when you deliberately want to delete stored app
data and uploaded scans.

---

## Features

- **Accounts, roles & projects** — email/password sign-up and login, plus
  optional Google, GitHub and WeChat sign-in. Account roles support
  viewer/scientist/reviewer/admin, while project memberships decide which
  notebooks a user can read, write, review or administer.
- **Voice entry** — hands-free dictation with Start / Pause / Resume / Stop.
- **Observe run mode** — mobile camera + live speech capture for an experiment,
  with a time-stamped action timeline and optional AI visual observations.
- **OCR handwriting scan** — from an uploaded image **or the live camera**
  (rear camera on phones); converted to searchable text (Tesseract.js) with the
  image stored on the record.
- **Experiment planner** — hypothesis, variables, protocol steps, and materials
  linked to inventory; start a plan to create a linked experiment.
- **Inventory** — quantity, unit, location, lot, expiry, reorder level; low-stock
  and expiry flags; logged stock adjustments.
- **Audit-ready controls** — SHA-256 content fingerprints, password-confirmed
  electronic signatures with signature meaning, experiment locking, immutable
  deletion tombstones, hash-chained audit rows, CSV audit export, and hashed
  experiment evidence exports.
- **AI assistant** — a context-aware chat panel in each experiment (OpenAI),
  with the API key kept server-side. The same server-side key can power optional
  visual observations in Observe run mode.
- **Theming** — light/dark presets with a fully customisable 5-colour palette.
- **Mobile-ready** — responsive layout with a slide-in nav drawer; ideal for
  snapping OCR photos at the bench.

---

## Accounts, roles & login

Login is required for everything. Identity is derived server-side from a signed,
HttpOnly session cookie — never trusted from client headers. Passwords are
hashed with scrypt (`node:crypto`).

**Account roles** form a hierarchy: `admin > reviewer > scientist > viewer`.
Project memberships separately use `owner > reviewer > scientist > viewer`.

- **viewer** — read access where project membership allows it.
- **scientist** / legacy **user** — create and update records where project
  membership allows it.
- **reviewer** — scientist capabilities plus review/lock workflows where project
  membership allows it.
- **admin** — everything, plus the **Users** screen to view accounts and change
  roles, and the **Projects** screen to create projects and manage membership.
  Admins can also tombstone notebook entries; each deletion is recorded in the
  audit trail with the entry type, hash, signed state and an excerpt. The last
  remaining admin cannot be demoted.

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
reachable over HTTPS, and the redirect URL must match exactly. In prototype
tunnel mode, leave `BASE_URL` blank so the app uses the active
`trycloudflare.com` host; if you test OAuth, register that current tunnel
callback URL with the provider. The tunnel URL can change between runs.

---

## Voice transcription: live first, server fallback

The composer prefers the browser Web Speech API when available, because it
shows interim text while you speak. Server STT is the fallback for browsers or
phones that cannot provide live dictation.

`STT_PROVIDER` selects that server fallback:

- **`webspeech`** — the browser's Web Speech API. Live text, no server
  infra, but audio is streamed to the browser vendor's cloud and support is weak
  on mobile Safari.
- **`auto` (default)** — enables the OpenAI fallback when `OPENAI_API_KEY` is
  set; otherwise the app only uses browser Web Speech.
- **`openai`** — fallback mode where the browser records audio with
  MediaRecorder and the server submits it to OpenAI's audio transcription API.
  Set `OPENAI_API_KEY`; optional `STT_OPENAI_MODEL` defaults to
  `gpt-4o-mini-transcribe`.
- **`whisper` (on-prem)** — runs a Whisper container; audio never leaves your
  network. When browser live dictation is unavailable, the browser records audio
  and POSTs it to `/api/stt/transcribe`, which forwards to Whisper. Enable with
  the bundled Compose profile:

```bash
STT_PROVIDER=whisper docker compose --profile whisper up --build
```

Config: `STT_OPENAI_MODEL`, `STT_URL` (default `http://whisper:9000`),
`ASR_MODEL` (`tiny`…`large-v3`), `ASR_ENGINE`
(`faster_whisper`/`openai_whisper`). Image:
[`onerahmet/openai-whisper-asr-webservice`]. Swap-in point on the app side:
`src/routes/stt.js`.

---

## Observe run mode

Open an experiment and choose **Observe run**. The mode is designed for a phone
at the bench:

- starts the rear camera and shows a live preview;
- uses live browser dictation when supported, so speech appears while the user
  talks;
- captures periodic frames into a time-stamped action timeline;
- accepts manual action markers such as `added 5 mL buffer to vial A1`;
- when `OPENAI_API_KEY` is set, sends compact still frames to the server-side
  vision observer (`/api/ai/observe`) for concise visible-action notes;
- saves the transcript, visual notes, markers, and final frame as one immutable
  notebook entry after the user reviews and confirms the generated entry.

Visual observation is intentionally still-frame based in this prototype, not
continuous video upload. It reduces bandwidth and keeps the saved record easy to
review. Set `OPENAI_VISION_MODEL` only if you want a different model for frame
analysis; otherwise it defaults to `OPENAI_MODEL`. Confirmed Observe run entries
also write the transcript/timeline text into the audit trail, so it can be
reviewed from the experiment entry or from Audit Trail / CSV export.

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
OPENAI_VISION_MODEL=        # optional; defaults to OPENAI_MODEL
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
    orgs.js           workspace list/create
    projects.js       project list/create + project memberships
    users.js          admin-only user list + role changes
    experiments.js    experiments + nested entries
    entries.js        entry signing
    plans.js          planner CRUD + "start as experiment"
    inventory.js      inventory CRUD + stock adjust
    audit.js          audit list + CSV export
    uploads.js        image uploads (scanned notes)
    stt.js            Server STT forwarder (OpenAI or Whisper)
    ai.js             OpenAI assistant proxy (server-side key)
    references.js     DOI / BibTeX / RIS / Zotero paper references
    search.js         access-scoped ranked experiment/entry/reference search
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
    recorder.js       MediaRecorder capture for server STT
    ocr.js            Tesseract.js + preprocessing + camera capture helpers
    observer.js       Observe run camera/speech timeline mode
    views/            one module per screen (incl. auth.js, users.js)
Dockerfile, docker-compose.yml, .env.example
deploy/Caddyfile      Optional public HTTPS reverse proxy profile
```

---

## Data & backup

State lives under `DATA_DIR` (`/app/data` in Docker): `scivox.db`, `uploads/`,
`.session_secret`, and local backup folders. Back up by copying that directory
(or the `scivox-data` volume), or run:

```bash
npm run backup
BACKUP_PATH=/path/to/scivox-backup-... npm run restore
```

Stop the app before restore. `SEED=false` skips demo data on an empty DB.

## Production notes

- **HTTPS is required** for camera, microphone and secure cookies over a network.
  The bundled `prototype` tunnel provides HTTPS without a purchased domain. The
  bundled Caddy `public` profile handles HTTPS for a permanent domain; with
  another reverse proxy, forward to port 3000 and set `COOKIE_SECURE=true`,
  `TRUST_PROXY=1`, `FORCE_HTTPS=true`, and `BASE_URL=https://your-domain`.
- For direct port exposure without Caddy, set `APP_BIND=0.0.0.0`; use this only
  behind a separate TLS-terminating proxy/firewall.
- Set an explicit `SESSION_SECRET` in production.
- Sessions use signed HttpOnly cookies backed by server-side session rows, so
  logout and `/api/auth/sessions/revoke` can invalidate active tokens.
- Entry fingerprints, signature hashes, export hashes and audit rows use
  SHA-256. Part 11/GxP readiness still depends on customer validation, SOPs,
  training, access review and predicate-rule fit; see `docs/mvp-validation-pack.md`.
- Migrating to Postgres: all SQL is in `src/db.js` — re-implement the repository
  objects; routes and frontend are unchanged.

## API reference (summary)

```
GET  /api/health
POST /api/auth/register | /login | /logout    GET /api/auth/me | /providers
POST /api/auth/password-reset | /verify-email | /sessions/revoke
GET  /api/auth/oauth/:provider/start | /callback
GET/POST /api/orgs        GET/POST /api/projects    PATCH /api/projects/:id/members
GET  /api/users            PATCH /api/users/:id/role                (admin)
GET/POST/PATCH/DELETE /api/experiments[...]    POST /api/experiments/:id/lock|entries
GET  /api/experiments/:id/export[?format=html] POST /api/entries/:id/sign
GET/POST/PATCH/DELETE /api/plans[...]          POST /api/plans/:id/start
GET/POST/PATCH/DELETE /api/inventory[...]      POST /api/inventory/:id/adjust
GET  /api/audit            GET /api/audit/export.csv
GET  /api/search?q=...
GET  /api/stt/health       POST /api/stt/transcribe
POST /api/uploads
```
