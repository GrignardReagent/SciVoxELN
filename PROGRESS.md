# SciVox ELN — progress & editing log

**Purpose:** running record of what has been built, what changed, and what is
still open. Humans use it to track the project; AI agents **must read this at the
start of a session and update it at the end** (add a dated entry to the Session
log, and move items between Done / In progress / Backlog).

Keep entries short. Newest session on top. Dates are ISO (YYYY-MM-DD).

---

## Current status

Full-stack, self-hostable ELN with real authentication, project memberships,
voice/OCR capture (incl. live camera), planner, inventory, hash-chained audit
trail, self-hosted Whisper option, theming, mobile support, and MVP API tests.

## Done

- Core notebook: experiments, entries (note/voice/OCR), search, dashboard.
- Sketch-to-figure capture: mobile-friendly canvas sketchpad with a microscope
  slide template, typed labels, raw sketch + cleaned diagram export, experiment-
  scoped figure upload folders, figure notebook entries, and audit logging.
- Voice entry with Start / Pause / Resume / Stop: Web Speech where supported,
  plus mobile-safe server STT via OpenAI (`auto`/`openai`) or on-prem Whisper.
- Observe run mode: mobile camera preview + live speech + action timeline,
  with optional OpenAI visual observations from periodic still frames.
- OCR handwriting scan (Tesseract.js) via **upload or live camera** (rear camera
  on phones); image is contrast-normalized/adaptive-thresholded before OCR and
  uploaded/stored with the entry.
- Audit-ready controls: SHA-256 content fingerprints, password-confirmed
  e-signatures with signature meaning, experiment lock (409 on writes),
  deletion tombstones, hash-chained audit trail + CSV export.
- Workspaces/projects: default workspace migration, project memberships
  (`viewer|scientist|reviewer|owner`), and server-side access checks on
  experiments, plans, references, AI context, exports and search.
- Experiment evidence export as hashed JSON or HTML packages.
- Access-scoped ranked search across experiments, entries and references.
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
- **Roles** (`viewer < scientist/user < reviewer < admin`): middleware in
  `src/auth.js`; admin Users screen + `/api/users` API; first user and
  `ADMIN_EMAILS` become admin; last admin can't be demoted. All data routes
  require auth.
- Server-side session rows and revocation API (`/api/auth/sessions/revoke`).
- Password reset / email verification token APIs (SMTP delivery not bundled).
- **Theming**: light/dark presets with the requested palettes, user-editable
  5-colour palette, live apply + no-flash pre-paint (`public/js/theme.js`),
  top-bar toggle + Settings → Appearance.
- **Mobile**: responsive layout + slide-in nav drawer + viewport-fit.
- Deployment: Dockerfile, docker-compose (+ whisper, prototype tunnel, and
  public HTTPS/Caddy profiles), `.env.example`, README, CLAUDE.md.
- Backup/restore scripts (`npm run backup`, `BACKUP_PATH=... npm run restore`).
- MVP validation and pilot sales docs under `docs/`.
- Automated Node API tests covering project access, signatures, locking,
  exports, audit hash fields, search and backup/restore.

## In progress

- (none)

## Backlog / not yet done

- SMTP delivery for email verification / password reset tokens.
- PDF/ZIP signed export bundle (MVP has hashed JSON/HTML evidence exports).
- LIMS / instrument connectors and scheduled on-prem→cloud sync (from the pitch).
- Per-project inventory scoping (inventory is still shared across the instance).
- GPU Whisper option and model-size tuning.
- True continuous video/realtime vision streaming for Observe run mode; current
  prototype samples still frames to control bandwidth and preserve reviewability.
- Postgres repository implementation for larger enterprise deployments.

## Known constraints for AI sessions

- The project folder's Linux mount serves **stale/truncated** content for files
  that are *edited/re-written* (new files sync fine). File tools write the
  authoritative copy; to run/test in the sandbox, stage a copy under `/tmp`
  (heredoc the rewritten files) and run there.
- `node:sqlite` needs Node ≥ 22.5 (harmless ExperimentalWarning; `NODE_NO_WARNINGS=1`).
  WAL falls back to DELETE journal on filesystems without shared memory.
- OAuth and Whisper can't be exercised in the sandbox (need real credentials /
  Docker); STT was verified against a mock `/asr`, auth via curl cookie jars.
- Headless mobile browser checks can run via Docker + Playwright image. Use a
  localhost target for secure-context microphone/camera APIs; Docker-network
  hostnames are treated as insecure by Chromium.

---

## Session log

### 2026-07-06 (sketch-to-figure branch)
- Created branch `sketch-to-figure` for mobile scientific sketch capture.
- Added a phone/tablet canvas sketchpad in the experiment composer with pen,
  eraser, colour/width controls, typed label placement, a microscope slide
  template, clean-preview rendering, and attach-to-experiment flow.
- Refined label placement after mobile trial feedback: labels are now added
  directly to the canvas, can be selected, dragged, updated and deleted.
- Added a laptop-friendly label move mode, larger label hit targets, and clean
  rendering that smooths freehand curves; intentional straight lines are locked
  by holding at the stroke endpoint.
- Extended hold-to-lock cleanup to simple geometric shapes: open strokes lock as
  lines, while closed strokes can snap into rectangles, triangles, circles or
  ellipses.
- Improved phone hold detection by tolerating small touch jitter at the stroke
  endpoint and shortening the lock delay.
- Strengthened clean-preview smoothing for freehand strokes with resampling,
  repeated weighted smoothing and a light curve-rounding pass.
- Added a smoothing slider so clean-preview/saved-clean stroke smoothing can be
  adjusted per sketch without changing the raw sketch.
- Added local vector templates for synapse, microscope slide, cell, neuron, XY
  axes plots and Y-axis experiment timelines; inserted templates can be undone
  as a single action.
- Added prompt-style template insertion with phrase matching, and simplified the
  built-ins into minimal scaffolds intended for drawing/labeling on top.
- Restyled prompt templates toward BioRender-like schematic scaffolds with
  soft fills, crisp outlines and no default labels.
- Refined biological templates so synapse, cell and neuron insertions read as
  presynaptic/postsynaptic membrane scaffolds, organic cells and branched neurons.
- Added imported-image underlays in the sketchpad: images are fitted faintly
  behind the canvas so users can sketch on top, clear them, and include them in
  raw/clean figure exports.
- Changed OCR **Upload scan** on mobile to open the gallery/file picker; the
  separate Camera button remains the direct camera capture path.
- Added an undo control, with Cmd/Ctrl+Z support outside text fields, so
  accidental strokes/templates can be removed as whole actions instead of
  manually erased.
- Added experiment-scoped figure upload paths under
  `uploads/figures/{experimentId}/raw` and `/clean`; figure entries retain both
  raw sketch and cleaned diagram URLs and render both in the notebook feed.
- Added `ADD_FIGURE_ENTRY` audit logging and MVP API coverage for figure uploads,
  attachment fields, and audit action. `npm test` passes.

### 2026-07-06 (MVP foundation implementation)
- Implemented workspace/project foundations: `orgs`, `projects`,
  `memberships`, default workspace migration, Projects screen, and server-side
  access checks across experiments, plans, references, AI context, exports and
  search.
- Replaced new-entry/signature/audit fingerprints with SHA-256 hashes, added
  audit hash chaining, password-confirmed entry signatures with signature
  meaning, and deletion tombstones.
- Added server-side session rows + revocation, password reset / email
  verification token APIs, audit filters, experiment JSON/HTML exports, ranked
  access-scoped search, and backup/restore scripts.
- Added MVP validation and pilot sales docs; updated README and `.env.example`.
- Added `tests/mvp-api.test.js`; `npm test` passes (3 tests: pilot API workflow,
  backup/restore and legacy migration).
- Fixed Docker prototype deployment on upgraded databases: migration now creates
  the `audit(project_id)` index only after adding the column. Added a legacy-DB
  migration regression test; rebuilt the prototype and verified the public
  Cloudflare URL returns `200`.
- Configured `.env` for `scivoxeln.duckdns.org` and started the Caddy public
  profile. App and Caddy containers run, but Let's Encrypt cannot validate yet
  because public TCP 80/443 to `192.41.125.255` time out; next step is router /
  network / Windows firewall forwarding to the Windows Wi-Fi host
  `10.124.117.174`.

### 2026-07-06
- Advised on free permanent-domain options for SciVox ELN: free subdomain/DDNS
  routes such as EU.org, DuckDNS, No-IP, and ngrok dev domains versus paid
  registrar domains; no code changes.

### 2026-07-03 (TODO batch: references, login message, mobile)
- Reviewed the Codex-updated codebase first (Observe mode, entry deletion,
  richer voice detection) before changing anything.
- References feature: `paper_refs` table + `Refs` repo; `src/routes/references.js`
  (DOI via CrossRef, BibTeX/RIS import, Zotero Web API, manual, dedupe); API
  client methods; a References panel in each experiment view. Verified against
  mock CrossRef/Zotero servers (DOI, BibTeX, RIS, Zotero, manual, 409 dedupe,
  delete, 401 gate).
- Login clarity: wrong password now returns "Incorrect password" (plus distinct
  "No account found" / OAuth-account messages). Verified via curl.
- Mobile: 100dvh, 16px inputs (no iOS zoom), scrollable tables, safe-area insets,
  ≤560px refinements, stacked AI input, theme-color meta.
- Mount note: this session's *edits* again did not propagate to the Linux mount
  (only new files did); tested by staging authoritative copies under /tmp.

### 2026-07-03
- Added Internet-facing deployment support: app binds via `HOST`, supports
  `TRUST_PROXY`/`FORCE_HTTPS`, and respects explicit `COOKIE_SECURE=false` for
  local Docker while enabling secure cookies for public HTTPS.
- Added a Docker Compose `public` profile with Caddy TLS reverse proxy and
  pass-through env for domain, auth, OAuth, OpenAI, and STT settings. Updated
  README, `.env.example`, and agent notes with public deployment steps.
- Switched the prototype path to a no-domain Cloudflare Quick Tunnel
  (`prototype` profile), made OAuth callbacks infer the active request host when
  `BASE_URL` is blank, and moved permanent `scivoxeln.ai` OAuth callback work to
  `TODO.md`.
- Fixed mobile voice capture by adding OpenAI-backed server transcription in
  `STT_PROVIDER=auto|openai`, mobile-friendly MediaRecorder MIME selection, and
  clearer fallback messaging when only Web Speech is available.
- Improved OCR quality by preprocessing captured/uploaded images on canvas
  before Tesseract (scale, contrast normalization, adaptive thresholding) and
  filtering obvious noise lines.
- Re-ran the mobile browser check with Playwright in a Pixel 7 viewport. Fixed a
  Settings template-string syntax error, verified login -> experiment composer,
  `Server STT · openai`, microphone recording state, camera OCR modal, upload
  scan input, and no page errors.
- Added README shutdown instructions for closing the prototype tunnel, stopping
  public-domain Caddy access, stopping Whisper, and preserving/deleting volumes.
- Restored live voice transcription priority: supported browsers now use Web
  Speech real-time interim text even when OpenAI/Whisper server STT is configured;
  server STT remains the fallback when live dictation is unavailable.
- Added Observe run mode for experiment execution: mobile camera preview, live
  speech transcript, manual action markers, periodic frame captures, optional
  OpenAI visual observations, and save-to-notebook as an `observe` entry.
- Added admin-only notebook entry deletion with deletion context recorded in
  the audit trail.
- Added Observe run review/confirm step before writing to the experiment; the
  confirmed transcript/timeline is stored in the entry and audit detail.

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
