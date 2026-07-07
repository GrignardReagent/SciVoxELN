# CLAUDE.md — working notes for SciVox ELN

Guidance for AI assistants (and humans) working in this repo. Read this before
making changes.

> **Team tracking:** read `TRACKING.md` at the start of a session and update it
> before finishing whenever code, config, docs, or deployment state changes. It
> is the source of truth for active tasks, backlog, done work, change log, and
> historical session notes.

> **Browser verification is mandatory:** always check the running frontend in a
> real browser before the final response for every task in this repo, including
> backend-only, docs-only, config, test, and process changes. Exercise the
> changed flow when there is one; otherwise load the app, verify it renders,
> inspect console/page state, and report any browser-tool blocker instead of
> calling the frontend verified.

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
   `requireAuth`, and `requireRole('admin')` (hierarchy: viewer < scientist/user
   < reviewer < admin). All
   `/api` data routes are mounted behind `requireAuth` in `src/index.js`; never
   trust client headers for identity. Passwords are scrypt (`node:crypto`);
   OAuth (Google/GitHub/WeChat) lives in `src/oauth.js`, env-gated. First user
   and `ADMIN_EMAILS` become admin. Users, server-side sessions, orgs/projects,
   memberships and token repos are in `src/db.js`.
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
- Server STT supports `auto|webspeech|openai|whisper`. `auto` uses OpenAI
  transcription when `OPENAI_API_KEY` is set, otherwise browser Web Speech.
  `openai` and `whisper` use `public/js/recorder.js` (MediaRecorder), which is
  the mobile-safe path; `webspeech` uses `voice.js` and is weak on mobile Safari.
  `STT_OPENAI_MODEL` defaults to `gpt-4o-mini-transcribe`. `whisper` forwards
  audio to the on-prem `onerahmet/openai-whisper-asr-webservice` `/asr`
  endpoint.
- OCR = **Tesseract.js**, entirely in-browser (`public/js/ocr.js`). Image comes
  from a file upload **or the live camera** (`getUserMedia`, rear camera via
  `facingMode:'environment'`); it is preprocessed on canvas (contrast normalize
  + adaptive threshold) before OCR, then the original image is uploaded to
  `/api/uploads` and stored.
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
- Env: `PORT`, `HOST`, `DATA_DIR`, `SEED` (`true`/`false`), `BASE_URL`,
  `COOKIE_SECURE`, `TRUST_PROXY`, `FORCE_HTTPS`, `ADMIN_EMAILS`,
  `STT_PROVIDER`, `STT_URL`.
- No-domain prototype deployment uses the Docker Compose `prototype` profile
  with Cloudflare Quick Tunnel: set `COOKIE_SECURE=true`, `TRUST_PROXY=1`,
  leave `BASE_URL` blank, run `docker compose --profile prototype up -d --build`,
  then copy the `https://*.trycloudflare.com` URL from
  `docker compose logs -f prototype-tunnel`.
- Stable custom-domain deployment on restrictive networks (e.g. university
  Wi-Fi) uses the Docker Compose `tunnel` profile with a named Cloudflare Tunnel:
  the hostname must live in a DNS zone managed by Cloudflare, the Cloudflare
  public hostname points to `http://scivox:3000`, `.env` contains
  `BASE_URL=https://HOSTNAME`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`,
  `FORCE_HTTPS=true`, and `CLOUDFLARED_TOKEN`, then run
  `docker compose --profile tunnel up -d --build`.
- Permanent-domain deployment uses the Docker Compose `public` profile with
  Caddy (`deploy/Caddyfile`): set `DOMAIN`, `BASE_URL=https://DOMAIN`,
  `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `FORCE_HTTPS=true`, and a real
  `SESSION_SECRET`; then run `docker compose --profile public up -d --build`.
  OAuth callbacks must match `{BASE_URL}/api/auth/oauth/{provider}/callback`.
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

### Mandatory browser verification

Always open the running app and check the frontend in a real browser before
claiming completion for any work in this repo. Treat this as a hard completion
gate, not an optional extra, and do it even when the change appears unrelated to
the frontend. For frontend-affecting or user-facing work, exercise the changed
flow. For backend, config, docs, tests, or process-only work, still make a
lightweight browser pass: load the app, confirm it renders the expected screen,
inspect console/page state, and note the result. This applies to tiny copy,
HTML, CSS, client JS, frontend-facing API responses, auth/navigation flows,
rendered data shape, theming, voice/OCR/AI panels, responsive layout, and
anything that could change what a user sees, clicks, enters, uploads, signs,
archives, restores, or exports. Do not rely on static tests, API tests,
screenshots from old sessions, or code inspection alone.

Use Chrome/Edge with Computer Use when the user requests it or when it is
available. If Computer Use cannot bootstrap, use Playwright/Chromium as the
fallback and record the reason. Exercise the changed flow with at least one
meaningful interaction, verify page identity, non-blank render, responsive
behavior where relevant, and no relevant console errors, then include the
browser tool/fallback, URL, viewport, result, and screenshot paths in the final
report. Use a disposable `DATA_DIR` for smoke checks that create users, entries
or other lab data.

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
- The browser verification rule above is mandatory. If no browser can be opened,
  do not describe the frontend work as fully verified; report the blocker and
  the non-browser checks that did run.

## Conventions

- IDs: `crypto.randomUUID()`. Timestamps: ISO strings (`new Date().toISOString()`).
- Entry/export/audit integrity uses SHA-256 `fingerprint()` in `db.js`.
  Part 11/GxP readiness still needs customer validation, SOPs and training.
- Statuses: experiments `planned|active|locked`; plans `draft|ready|started|archived`.
- Keep the app framework-free and dependency-light unless there's a strong reason.

## Known follow-ups (not yet built)

- Enterprise authentication hardening (SSO/JWT/RBAC beyond the current
  password/OAuth/session-revocation auth).
- SMTP delivery for password reset / email verification tokens.
- PDF/ZIP signed export bundle (MVP has hashed JSON/HTML evidence exports).
- LIMS/instrument connectors and scheduled on-prem→cloud sync (from the pitch).
- Per-project inventory scoping (inventory is currently instance-wide).
- GPU Whisper option / model tuning (base model wired; see docker-compose.yml).
