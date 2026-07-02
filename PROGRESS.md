# SciVox ELN — progress & editing log

**Purpose:** running record of what has been built, what changed, and what is
still open. Humans use it to track the project; AI agents **must read this at the
start of a session and update it at the end** (add a dated entry to the Session
log, and move items between Done / In progress / Backlog).

Keep entries short. Newest session on top. Dates are ISO (YYYY-MM-DD).

---

## Current status

Full-stack, self-hostable ELN with real authentication, roles, voice/OCR capture
(incl. live camera), planner, inventory, compliant audit trail, self-hosted
Whisper option, theming, and mobile support. Backend + auth verified end-to-end.

## Done

- Core notebook: experiments, entries (note/voice/OCR), search, dashboard.
- Voice entry (Web Speech) with Start / Pause / Resume / Stop.
- OCR handwriting scan (Tesseract.js) via **upload or live camera** (rear camera
  on phones); image uploaded and stored with the entry.
- Compliance: content fingerprints, e-signatures, experiment lock (409 on
  writes), immutable audit trail + CSV export (attributed to the logged-in user).
- Experiment planner and Inventory modules.
- Backend REST API + repository layer in `src/db.js` (all SQL isolated here).
- Self-hosted **Whisper** (compose `whisper` profile) + `transcribe()` forwarder
  + browser MediaRecorder path; composer picks mode from `GET /api/stt/health`.
- **AI assistant**: context-aware OpenAI chat panel in each experiment; API key
  stays server-side (`src/routes/ai.js`; `OPENAI_API_KEY`/`OPENAI_MODEL` in
  gitignored `.env`, default model `gpt-5.5`; optional `OPENAI_BASE_URL`).
- **Brand icon** (`public/icon.svg` + PNG favicons) wired as favicon + logos.
- Login screen reworked: prominent Sign in / Create account tabs + all three
  OAuth buttons always shown (disabled with a hint until credentials are set).
- **Authentication**: email/password (scrypt) + signed HttpOnly session cookies;
  Google / GitHub / WeChat OAuth (env-gated) in `src/oauth.js`.
- **Roles** (user < admin): middleware in `src/auth.js`; admin Users screen +
  `/api/users` API; first user and `ADMIN_EMAILS` become admin; last admin can't
  be demoted. All data routes require auth.
- **Theming**: light/dark presets with the requested palettes, user-editable
  5-colour palette, live apply + no-flash pre-paint (`public/js/theme.js`),
  top-bar toggle + Settings → Appearance.
- **Mobile**: responsive layout + slide-in nav drawer + viewport-fit.
- Deployment: Dockerfile, docker-compose (+ whisper profile), `.env.example`,
  README, CLAUDE.md.

## In progress

- (none)

## Backlog / not yet done

- Email verification / password reset (no SMTP wired).
- Server-side session revocation (sessions are stateless — logout is client-side;
  tokens stay valid until expiry).
- Cryptographic signatures/hashing (current `fingerprint()` is demo-grade djb2).
- LIMS / instrument connectors and scheduled on-prem→cloud sync (from the pitch).
- Per-experiment access control / teams (currently any logged-in user sees all).
- GPU Whisper option and model-size tuning.
- Automated test suite (verified via curl + headless checks; no committed tests).

## Known constraints for AI sessions

- The project folder's Linux mount serves **stale/truncated** content for files
  that are *edited/re-written* (new files sync fine). File tools write the
  authoritative copy; to run/test in the sandbox, stage a copy under `/tmp`
  (heredoc the rewritten files) and run there.
- `node:sqlite` needs Node ≥ 22.5 (harmless ExperimentalWarning; `NODE_NO_WARNINGS=1`).
  WAL falls back to DELETE journal on filesystems without shared memory.
- OAuth and Whisper can't be exercised in the sandbox (need real credentials /
  Docker); STT was verified against a mock `/asr`, auth via curl cookie jars.

---

## Session log

### 2026-07-02 (session 3)
- Added the AI assistant (OpenAI proxy with server-side key from `.env`, a
  context-aware chat panel in each experiment view). Verified end-to-end against
  a mock OpenAI: 401 unauth, `configured/gpt-5.5`, context injected into replies.
- Reworked the login screen: tabs + all three OAuth buttons always render.
- Designed `public/icon.svg` (mic + waveform on a teal tile), generated PNG
  favicons, wired favicon + sidebar/auth logos. Updated docs.

### 2026-07-02 (later)
- Added authentication (email/password + Google/GitHub/WeChat OAuth), user/admin
  roles, and route protection; admin Users screen. Verified register/login/
  session/role-gating/tampered-cookie via curl.
- Added live-camera OCR capture and a mobile nav drawer.
- Added light/dark theming with a customisable 5-colour palette + pre-paint apply.
- Updated README, `.env.example`, CLAUDE.md, this log. Full static+auth
  integration test passed in a staged `/tmp` server.

### 2026-07-02
- Built the standalone prototype, then the deployable full-stack app
  (Express + `node:sqlite` + vanilla SPA); planner, inventory, audit, e-sign.
- Docker + compose + docs; wired self-hosted Whisper (compose profile),
  server `transcribe()`, browser MediaRecorder path. Created this log.
