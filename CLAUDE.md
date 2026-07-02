# CLAUDE.md — working notes for SciVox ELN

Guidance for AI assistants (and humans) working in this repo. Read this before
making changes.

> **Progress log:** read `PROGRESS.md` at the start of a session and update it at
> the end (dated Session-log entry; move items between Done / In progress /
> Backlog). It's the source of truth for what's done vs. outstanding.

## What this is

A voice- and vision-powered **Electronic Lab Notebook**. Full-stack web app,
self-hostable, aimed at regulated/on-prem labs (pharma, biotech, CROs). Core
value: capture lab records hands-free (voice), digitise handwritten notes (OCR),
plan experiments, track reagent inventory, all backed by an immutable,
time-stamped, signable audit trail.

Product context lives in a Notion page ("Venture Builder Incubator - SciVox
ELN"). Headline differentiators from the pitch: hands-free voice entry,
handwriting OCR, built-in experiment planner, and easy LIMS integration — with a
compliance/on-prem angle (clean rooms, classified data, 21 CFR Part 11 / GxP).

## Stack (and why)

- **Node.js ≥ 22.5 + Express** — API and static host.
- **`node:sqlite`** (built-in driver) — chosen deliberately: zero native builds,
  no engine downloads, works offline. Strengthens the on-prem story. Prisma and
  `better-sqlite3` were rejected because their binaries fail to install/download
  in restricted networks.
- **Vanilla ES-module frontend** — no bundler, no framework. Served straight
  from `public/`. Keep it dependency-light on purpose.
- **Docker + docker-compose** for deployment; data on a named volume.
- Only runtime deps: `express`, `multer`. Everything else is Node built-ins
  (`node:sqlite`, `node:crypto`, `node:fs`).

## Architecture rules (follow these)

1. **All SQL lives in `src/db.js`.** Nothing else touches the database. Routes
   call the exported repositories: `Experiments`, `Entries`, `Plans`,
   `Inventory`, `Audit`. This is the seam for a future Postgres migration —
   re-implement those objects, leave routes/frontend untouched.
2. **Every write goes through the audit log.** After a mutating route succeeds,
   call `Audit.log(user, role, ACTION, detail)`. Actions are SCREAMING_SNAKE
   (e.g. `SIGN_ENTRY`, `CONSUME_INVENTORY`).
3. **Identity comes from the session, server-side.** `src/auth.js` provides
   `authenticate` (reads the signed HttpOnly session cookie → `req.user`),
   `requireAuth`, and `requireRole('admin')` (hierarchy: user < admin). All
   `/api` data routes are mounted behind `requireAuth` in `src/index.js`; never
   trust client headers for identity. Passwords are scrypt (`node:crypto`);
   OAuth (Google/GitHub/WeChat) lives in `src/oauth.js`, env-gated. First user
   and `ADMIN_EMAILS` become admin. Users table + repo are in `src/db.js`.
4. **Immutability is enforced server-side.** Locked experiments reject new
   entries (409). Signed entries can't be re-signed. Don't move these checks to
   the client.
5. **Frontend: one module per screen** under `public/js/views/`. Shared helpers
   in `ui.js` (`esc`, `fmt`, `toast`, `modal`, `confirmModal`, `guard`). Always
   `esc()` user content into HTML. Wrap async view/handler bodies in `guard()`
   so errors surface as toasts.
6. **Routing** is in `public/js/app.js`. Views get a `ctx` = `{ go, search,
   setHead, refresh }`. Sub-navigation (open one experiment/plan) is passed as
   `params` (e.g. `ctx.go('experiments', { id })`); planner keeps its own
   `openId` module-local state.

## AI assistant

- `src/routes/ai.js` proxies OpenAI Chat Completions. **The API key
  (`OPENAI_API_KEY`) is server-side only** — in gitignored `.env`, never sent to
  the browser or committed. `OPENAI_MODEL` defaults to `gpt-5.5`;
  `OPENAI_BASE_URL` allows Azure/compatible proxies (and testing against a mock).
- The server injects the current experiment's context as the system message; the
  client only sends user/assistant turns. Frontend panel is `mountAssistant()` in
  `public/js/views/experiments.js` (right column), calling `api.aiChat()`.
- `.env` is loaded via `node --env-file-if-exists=.env` (package.json scripts);
  Docker passes `OPENAI_*` through compose. No dotenv dependency.

## Voice & OCR

- Voice = **Web Speech API** in `public/js/voice.js` (`VoiceController`), with
  Start/Pause/Resume/Stop. It streams audio to the browser vendor's cloud —
  **not on-device**. This is called out in the README and Settings.
- Server STT is **wired to a real Whisper container**. Default stays
  `webspeech`; set `STT_PROVIDER=whisper` and run `docker compose --profile
  whisper up` to use the on-prem `onerahmet/openai-whisper-asr-webservice`
  service. `transcribe()` in `src/routes/stt.js` forwards audio to its `/asr`
  endpoint. In Whisper mode the frontend records with `public/js/recorder.js`
  (MediaRecorder) and POSTs to `/api/stt/transcribe`; in webspeech mode it uses
  `voice.js`. The composer picks the mode from `GET /api/stt/health`.
- OCR = **Tesseract.js**, entirely in-browser (`public/js/ocr.js`). Image comes
  from a file upload **or the live camera** (`getUserMedia`, rear camera via
  `facingMode:'environment'`); it's uploaded to `/api/uploads` and stored.
- Both need Chrome/Edge and a secure context (`https://` or `localhost`).
- **Theming** in `public/js/theme.js`: light/dark presets with a user-editable
  5-colour palette; applies CSS variables and caches them so an inline `<head>`
  script in `index.html` can paint without flash. Toggle in the top bar; full
  customiser in Settings → Appearance.
- **Mobile**: sidebar becomes a slide-in drawer under 900px (hamburger in
  `.top`, scrim overlay), wired in `public/js/app.js`.

## Data & config

- State under `DATA_DIR` (`./data` locally, `/app/data` in Docker):
  `scivox.db` + `uploads/`. Back up = copy that dir / the `scivox-data` volume.
- Env: `PORT`, `DATA_DIR`, `SEED` (`true`/`false`), `STT_PROVIDER`, `STT_URL`.
- `src/seed.js` seeds demo data only when the DB is empty.
- `db.js` tries WAL journaling and **falls back to DELETE** journal if the
  filesystem doesn't support shared memory (network/on-prem shares). Don't force
  WAL.

## How to run / test

```bash
npm install && npm start        # http://localhost:3000  (Node ≥ 22.5)
docker compose up --build       # containerised
```

Backend is testable headless with curl (see git history / prior sessions):
create experiment → add entry → lock (expect 409) → sign → inventory adjust →
plan start → audit CSV. Frontend voice/OCR need a real browser.

## Sandbox / environment gotchas (important for AI sessions)

- **This project folder's Linux mount can lag or serve stale/truncated content
  for files that are *edited or re-written*.** Newly-created file paths sync
  fine; re-writes to an existing path may not appear in `mcp__workspace__bash`.
  The file tools (Read/Write/Edit) write the authoritative copy regardless — the
  staleness only affects reading back via bash. To test in the sandbox, stage a
  copy under `/tmp` and run there; don't trust `tail`/`node` on a just-edited
  file in the mount.
- `node:sqlite` prints an ExperimentalWarning — harmless. `NODE_NO_WARNINGS=1`
  silences it (set in Dockerfile).
- WAL fails on some sandbox/network filesystems ("disk I/O error"); the fallback
  handles it. Use a local ext4 path (e.g. `/tmp`) when testing.

## Conventions

- IDs: `crypto.randomUUID()`. Timestamps: ISO strings (`new Date().toISOString()`).
- Entry integrity = djb2 `fingerprint()` in `db.js`. **Demo-grade** — swap for
  cryptographic hashing/signing before any real 21 CFR Part 11 deployment.
- Statuses: experiments `planned|active|locked`; plans `draft|ready|started|archived`.
- Keep the app framework-free and dependency-light unless there's a strong reason.

## Known follow-ups (not yet built)

- Real authentication (SSO/JWT/RBAC) + server-derived identity.
- Cryptographic signatures/hashing.
- LIMS/instrument connectors and scheduled on-prem→cloud sync (from the pitch).
- GPU Whisper option / model tuning (base model wired; see docker-compose.yml).
- `SciVox-ELN.html` at the repo root is the original standalone single-file
  prototype — kept for reference, gitignored, not part of the app.
