# SciVox ELN - team tracking

**Purpose:** this is the single committed source of truth for project status,
team tasks, completed work, and change tracking. Humans and AI assistants should
read this file before making changes and update it as part of the same commit.

Keep entries short. Dates use ISO format. Task IDs use `SVX-001`, `SVX-002`,
and so on; branch names should start with the matching lowercase ID, for
example `svx-001-short-description`.

---

## Current Status

Full-stack, self-hostable ELN with real authentication, project memberships,
voice/OCR capture (including live camera), planner, inventory, hash-chained
audit trail, self-hosted Whisper option, theming, mobile support, MVP API tests,
and repo-native workflow tracking.

## Active Tasks

- (none)

## Backlog

### Permanent Domain And OAuth

- [ ] Choose a permanent hostname with DNS managed in Cloudflare, e.g.
  `scivoxeln.<your-domain>`. A DuckDNS hostname works for dynamic IP hosting but
  not for the named Cloudflare Tunnel path needed on university Wi-Fi.
- [ ] Add the chosen domain/zone to Cloudflare DNS, or use a free/low-cost
  domain that can be delegated to Cloudflare nameservers.
- [ ] Create a named Cloudflare Tunnel for SciVoxELN and publish the hostname to
  `http://scivox:3000`.
- [ ] Paste the Cloudflare Docker connector token into `.env` as
  `CLOUDFLARED_TOKEN`.
- [ ] Configure the production `.env` with the permanent URL:
  `BASE_URL=https://scivoxeln.<your-domain>`, `COOKIE_SECURE=true`,
  `TRUST_PROXY=1`, `FORCE_HTTPS=true`.
- [ ] Start stable tunnel deployment:
  `docker compose --profile tunnel up -d --build`.
- [ ] Register Google OAuth callback:
  `https://scivoxeln.<your-domain>/api/auth/oauth/google/callback`.
- [ ] Register GitHub OAuth callback:
  `https://scivoxeln.<your-domain>/api/auth/oauth/github/callback`.
- [ ] Register WeChat OAuth callback:
  `https://scivoxeln.<your-domain>/api/auth/oauth/wechat/callback`.
- [ ] Replace any temporary `trycloudflare.com` prototype URLs in OAuth provider
  dashboards once a permanent domain is chosen.

### Product Follow-Ups

- [ ] SMTP delivery for email verification / password reset tokens.
- [ ] ZIP signed export bundle (MVP has hashed JSON/HTML/PDF evidence exports).
- [ ] LIMS / instrument connectors and scheduled on-prem to cloud sync.
- [ ] Smart LIMS / instrument connectors to get accurate data from machines.
- [ ] Per-project inventory scoping (inventory is still shared across the
  instance).
- [ ] GPU Whisper option and model-size tuning.
- [ ] True continuous video/realtime vision streaming for Observe run mode;
  current prototype samples still frames to control bandwidth and preserve
  reviewability.
- [ ] Postgres repository implementation for larger enterprise deployments.
- [ ] Feature improvement: "Summarise" button to summarise transcripts and notes
  into a concise summary.
- [ ] Feature improvement: Observe run.
- [ ] Feature improvement: AI assistant - predictive suggestions for user entries.
- [ ] Feature improvement: Enhance voice entry with auto-punctuation, auto-capitalization, and auto-paragraphing.
- [ ] Feature improvement: Enhance OCR functionality with better handwriting recognition.
- [ ] Repository hygiene: remove tracked runtime `data/` files from history /
  future commits in a dedicated cleanup, leaving runtime state gitignored.

### Future Enhancements

- [ ] Feature - Lab Animal Tracking: track animal movements

## Done

### Product Capabilities

- Core notebook: experiments, entries (note/voice/OCR), search, dashboard.
- Voice entry with Start / Pause / Resume / Stop: Web Speech where supported,
  mobile-safe server STT via OpenAI (`auto`/`openai`) or on-prem Whisper, and
  AI-polished drafts linked to hidden raw transcript source entries.
- Observe run mode: mobile camera preview + live speech + action timeline, with
  optional OpenAI visual observations from periodic still frames.
- OCR handwriting scan (Tesseract.js) via upload or live camera (rear camera on
  phones); image is contrast-normalized/adaptive-thresholded before OCR and
  uploaded/stored with the entry.
- Sketch-to-figure capture: browser drawing canvas, cleaned diagram upload,
  raw sketch preservation, and figure entries with raw/clean image evidence.
- Audit-ready controls: SHA-256 content fingerprints, password-confirmed
  e-signatures with signature meaning, experiment lock (409 on writes),
  deletion tombstones, hash-chained audit trail + CSV export.
- Workspaces/projects: default workspace migration, project memberships
  (`viewer|scientist|reviewer|owner`), and server-side access checks on
  experiments, plans, references, AI context, exports and search.
- Experiment evidence export as hashed JSON, HTML or PDF packages.
- Access-scoped ranked search across experiments, entries and references.
- Experiment planner and Inventory modules.
- Backend REST API + repository layer in `src/db.js` (all SQL isolated here).
- Self-hosted Whisper (compose `whisper` profile) + `transcribe()` forwarder +
  browser MediaRecorder path; composer picks mode from `GET /api/stt/health`.
- AI assistant: context-aware OpenAI chat panel in each experiment; API key stays
  server-side (`src/routes/ai.js`; `OPENAI_API_KEY`/`OPENAI_MODEL` in gitignored
  `.env`, default model `gpt-5.5`; optional `OPENAI_BASE_URL`).
- Brand icon (`public/icon.svg` + PNG favicons) wired as favicon + logos.
- Login screen reworked: prominent Sign in / Create account tabs + all three
  OAuth buttons always shown (disabled with a hint until credentials are set).
- Authentication: email/password (scrypt) + signed HttpOnly session cookies;
  Google / GitHub / WeChat OAuth (env-gated) in `src/oauth.js`.
- Roles (`viewer < scientist/user < reviewer < admin`): middleware in
  `src/auth.js`; admin Users screen + `/api/users` API; first user and
  `ADMIN_EMAILS` become admin; last admin cannot be demoted. All data routes
  require auth.
- Admin user lifecycle: reversible user archive/restore hides inactive accounts
  by default, revokes archived-user sessions, blocks archived login/reset/OAuth
  access, and preserves project membership/history.
- Server-side session rows and revocation API (`/api/auth/sessions/revoke`).
- Password reset / email verification token APIs (SMTP delivery not bundled).
- Theming: light/dark presets with the requested palettes, user-editable
  5-colour palette, live apply + no-flash pre-paint (`public/js/theme.js`),
  top-bar toggle + Settings -> Appearance.
- Mobile: responsive layout + slide-in nav drawer + viewport-fit.
- Deployment: Dockerfile, docker-compose (+ whisper, prototype tunnel, public
  HTTPS/Caddy profile, and named Cloudflare Tunnel profile), `.env.example`,
  README, CLAUDE.md.
- Backup/restore scripts (`npm run backup`, `BACKUP_PATH=... npm run restore`).
- MVP validation and pilot sales docs under `docs/`.
- Automated Node API tests covering project access, signatures, locking,
  exports, audit hash fields, search and backup/restore.

### Completed Task Items

- [x] Smart search feature to help with searching for experiments done in the
  past in order to help decision making. `/api/search` ranks accessible
  experiments, entries and references by query relevance.
- [x] Feature: Link to Mendeley/Zotero to reference papers. References panel per
  experiment: add by DOI (CrossRef), import BibTeX/RIS (Zotero or Mendeley
  export), or pull directly from a Zotero library; `src/routes/references.js`.
- [x] Fix: When the user keys in the wrong password, the error message is not
  clear enough. Login now returns "Incorrect password" for a wrong password (and
  clear messages for unknown email / OAuth-only accounts).
- [x] Make this mobile friendly. dvh height, 16px inputs (no iOS zoom),
  horizontally-scrollable tables, safe-area insets, tighter small-screen layout,
  stacked AI input, theme-color; on top of the existing nav drawer.
- [x] Enable admin users to delete experiments and entries, with deletion
  context recorded in the audit trail. Entry deletes tombstone records with
  hashes/excerpts; experiment deletes are admin-only and audit reason, status,
  project, entry count and entry hashes before removal; experiment entry cards
  show the delete affordance to all users, disabled with an admin-only hint for
  non-admins.
- [x] Enable admin users to archive and restore users without deleting lab
  history. Archived users are hidden by default, marked in project memberships,
  blocked from sign-in/session use, and covered by audit events.

## Change Log

### 2026-07-07T09:44:30Z - Require browser frontend checks

- Task: SVX-000
- Branch: `master`
- Summary: Updated assistant working notes so frontend-impacting changes must
  always be verified in a real browser before completion, with Computer Use
  preferred when available/requested and Playwright/Chromium as the documented
  fallback.
- Validation: Documentation-only change; reviewed `CLAUDE.md` instructions.
- Files:
  - `TRACKING.md`
  - `CLAUDE.md`

### 2026-07-07T09:35:22Z - Add user archiving

- Task: SVX-000
- Branch: `master`
- Summary: Added reversible user archiving for admins, including persisted
  archive metadata, archived-account auth blocking, session revocation,
  project-member archived badges, Users-screen show-archived toggle, and
  archive/restore audit events.
- Validation: Bundled Node `--test` passed with 18 tests, including archive API,
  migration and static UI coverage.
- Files:
  - `TRACKING.md`
  - `public/js/api.js`
  - `public/js/views/projects.js`
  - `public/js/views/users.js`
  - `src/auth.js`
  - `src/db.js`
  - `src/routes/auth.js`
  - `src/routes/projects.js`
  - `src/routes/users.js`
  - `tests/user-archive-ui.test.js`
  - `tests/user-archive.test.js`

### 2026-07-07T09:35:02Z - Revise voice entry review flow

- Task: SVX-000
- Branch: `master` (sandbox blocked feature branch creation because `.git` is read-only)
- Summary: Reworked the voice composer into a Granola-like ELN flow with raw lab
  notes as the primary capture surface, a quiet source transcript modal, an
  enhanced-entry review state, and template-based regeneration for Auto lab
  note, Numbered observations, or Concise paragraph.
- Validation: Bundled Node `--test` passed with 18 tests; Playwright smoke
  with mocked `SpeechRecognition` passed desktop and mobile voice capture ->
  enhanced preview -> linked raw/polished save flow.
- Files:
  - `TRACKING.md`
  - `README.md`
  - `public/css/styles.css`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/js/views/settings.js`
  - `src/routes/ai.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-06T21:34:00Z - Add polished voice drafts

- Task: SVX-000
- Branch: `master`
- Summary: Reworked voice entry capture so raw dictation stays as hidden source
  evidence while AI-polished numbered bullets or concise paragraphs become the
  visible reviewed notebook entry.
- Validation: Bundled Node `--test` passed with 13 tests; temporary Playwright
  smoke verified mocked live dictation -> polished preview -> linked entry save
  on desktop and mobile viewports.
- Files:
  - `TRACKING.md`
  - `README.md`
  - `public/css/styles.css`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/js/views/settings.js`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/entries.js`
  - `src/routes/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-06T20:47:03Z - Add PDF export menu

- Task: SVX-000
- Branch: `master`
- Summary: Added experiment PDF export generation, recorded PDF exports in the
  existing export ledger, and moved PDF/HTML/JSON export links into a compact
  three-dot menu at the top right of the experiment summary card.
- Validation: `npm test` passed with 11 tests; Playwright verified the desktop
  export menu and PDF download, Poppler rendered the PDF page, and a fresh
  mobile viewport kept the export popover inside the screen.
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/experiments.js`
  - `src/routes/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-06T20:34:49Z - Add experiment delete UI control

- Task: SVX-000
- Branch: `master`
- Summary: Added an admin-only experiment delete button on experiment detail
  pages, with locked/non-admin disabled states, a required reason prompt,
  redirect back to the experiment list after deletion, and regression coverage
  for the frontend wiring.
- Validation: `npm test` passed with 10 tests using a temporary Node v24 runtime;
  Playwright verified the desktop delete modal/delete/404 flow and a fresh
  mobile viewport delete-button visibility check.
- Files:
  - `TRACKING.md`
  - `public/js/views/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-06T14:46:53Z - Surface experiment entry delete controls

- Task: SVX-000
- Branch: `master`
- Summary: Made per-entry delete controls visible on experiment pages for all
  users, disabled with an admin-only hint for non-admins, and added a reason
  prompt plus regression coverage for single-entry deletion audit context.
- Files:
  - `TRACKING.md`
  - `public/js/views/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-06T14:29:10Z - Require admin deletion audit context

- Task: SVX-000
- Branch: `master`
- Summary: Made experiment deletion admin-only and expanded delete audit
  context with reason, project/status, deleted entry count and entry hashes;
  kept entry deletion audit coverage and optional API delete bodies aligned.
- Files:
  - `TRACKING.md`
  - `public/js/api.js`
  - `src/routes/experiments.js`
  - `tests/mvp-api.test.js`

### 2026-07-06T14:14:57Z - Merge sketch-to-figure feature

- Task: SVX-000
- Branch: `master` + `origin/sketch-to-figure`
- Summary: Safely merged the sketch-to-figure drawing tool into current
  `master`, preserving Entries Library/workflow tracking/deployment behavior
  while adding figure upload paths, raw/clean image fields, figure rendering,
  and API coverage.
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/api.js`
  - `public/js/sketchpad.js`
  - `public/js/views/experiments.js`
  - `src/db.js`
  - `src/routes/experiments.js`
  - `src/routes/uploads.js`
  - `tests/mvp-api.test.js`

### 2026-07-06T13:38:36Z - Make tracking standalone

- Task: SVX-000
- Branch: `current-worktree`
- Summary: Made `TRACKING.md` the only team workflow document, removed legacy
  pointer files, and scrubbed stale references from docs, hook logic, and tests.
- Files:
  - `TRACKING.md`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `README.md`
  - `scripts/tracking.js`
  - `tests/tracking.test.js`

### 2026-07-06T13:30:53Z - Introduce repo-native workflow tracking

- Task: SVX-000
- Branch: `current-worktree`
- Summary: Consolidated project tracking into `TRACKING.md` and added a
  commit-gated workflow that requires a reviewed tracking entry for meaningful
  staged changes.
- Files:
  - `TRACKING.md`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `README.md`
  - `package.json`
  - `scripts/tracking.js`
  - `.githooks/pre-commit`
  - `tests/tracking.test.js`

## Historical Session Log

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
- Added local Windows inbound firewall allow rules for `SciVoxELN HTTP` and
  `SciVoxELN HTTPS`, restarted Caddy, and rechecked logs. Let's Encrypt still
  times out to `192.41.125.255`, so the remaining blocker is upstream NAT/router
  port forwarding or the university/campus network blocking inbound public
  traffic.
- Switched from the blocked DuckDNS/Caddy route to the Cloudflare Quick Tunnel
  prototype profile for university Wi-Fi. Set `.env` back to tunnel mode
  (`BASE_URL=` and `FORCE_HTTPS=false`), stopped Caddy, recreated `scivox` plus
  `prototype-tunnel`, and verified
  `https://milwaukee-simon-curious-sherman.trycloudflare.com/api/health`
  returns `200`.
- Added a stable custom-domain tunnel path: Docker Compose `tunnel` profile with
  `named-tunnel`, `.env.example` / `.env` `CLOUDFLARED_TOKEN` placeholder,
  README setup instructions, and assistant notes for Cloudflare DNS-managed
  hostnames on restrictive networks.

### 2026-07-06

- Advised on free permanent-domain options for SciVox ELN: free subdomain/DDNS
  routes such as EU.org, DuckDNS, No-IP, and ngrok dev domains versus paid
  registrar domains; no code changes.

### 2026-07-03 (references, login message, mobile)

- Reviewed the Codex-updated codebase first (Observe mode, entry deletion,
  richer voice detection) before changing anything.
- References feature: `paper_refs` table + `Refs` repo;
  `src/routes/references.js` (DOI via CrossRef, BibTeX/RIS import, Zotero Web
  API, manual, dedupe); API client methods; a References panel in each
  experiment view. Verified against mock CrossRef/Zotero servers (DOI, BibTeX,
  RIS, Zotero, manual, 409 dedupe, delete, 401 gate).
- Login clarity: wrong password now returns "Incorrect password" (plus distinct
  "No account found" / OAuth-account messages). Verified via curl.
- Mobile: 100dvh, 16px inputs (no iOS zoom), scrollable tables,
  safe-area insets, <=560px refinements, stacked AI input, theme-color meta.
- Mount note: this session's edits again did not propagate to the Linux mount
  (only new files did); tested by staging authoritative copies under `/tmp`.

### 2026-07-03

- Added Internet-facing deployment support: app binds via `HOST`, supports
  `TRUST_PROXY`/`FORCE_HTTPS`, and respects explicit `COOKIE_SECURE=false` for
  local Docker while enabling secure cookies for public HTTPS.
- Added a Docker Compose `public` profile with Caddy TLS reverse proxy and
  pass-through env for domain, auth, OAuth, OpenAI, and STT settings. Updated
  README, `.env.example`, and agent notes with public deployment steps.
- Switched the prototype path to a no-domain Cloudflare Quick Tunnel
  (`prototype` profile), made OAuth callbacks infer the active request host when
  `BASE_URL` is blank, and moved permanent `scivoxeln.ai` OAuth callback work
  into the repo task tracker.
- Fixed mobile voice capture by adding OpenAI-backed server transcription in
  `STT_PROVIDER=auto|openai`, mobile-friendly MediaRecorder MIME selection, and
  clearer fallback messaging when only Web Speech is available.
- Improved OCR quality by preprocessing captured/uploaded images on canvas
  before Tesseract (scale, contrast normalization, adaptive thresholding) and
  filtering obvious noise lines.
- Re-ran the mobile browser check with Playwright in a Pixel 7 viewport. Fixed a
  Settings template-string syntax error, verified login -> experiment composer,
  `Server STT - openai`, microphone recording state, camera OCR modal, upload
  scan input, and no page errors.
- Added README shutdown instructions for closing the prototype tunnel, stopping
  public-domain Caddy access, stopping Whisper, and preserving/deleting volumes.
- Restored live voice transcription priority: supported browsers now use Web
  Speech real-time interim text even when OpenAI/Whisper server STT is
  configured; server STT remains the fallback when live dictation is unavailable.
- Added Observe run mode for experiment execution: mobile camera preview, live
  speech transcript, manual action markers, periodic frame captures, optional
  OpenAI visual observations, and save-to-notebook as an `observe` entry.
- Added admin-only notebook entry deletion with deletion context recorded in the
  audit trail.
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
- Added light/dark theming with a customisable 5-colour palette + pre-paint
  apply.
- Updated README, `.env.example`, CLAUDE.md, this log. Full static+auth
  integration test passed in a staged `/tmp` server.

### 2026-07-02

- Built the standalone prototype, then the deployable full-stack app (Express +
  `node:sqlite` + vanilla SPA); planner, inventory, audit, e-sign.
- Docker + compose + docs; wired self-hosted Whisper (compose profile), server
  `transcribe()`, browser MediaRecorder path. Created this log.

## Workflow Rules

- Read `TRACKING.md` before starting a change.
- Move task items between `Active Tasks`, `Backlog`, and `Done` when the status
  changes.
- Every meaningful code, config, or documentation change needs one `Change Log`
  entry in the same commit.
- Install the local commit gate with `npm run workflow:install`.
- The pre-commit hook appends an unreviewed draft entry when staged changes do
  not include `TRACKING.md`, then blocks the commit so the developer can review
  and stage the entry.
- Do not commit draft entries with the generated placeholder summary heading.
- The hook never auto-stages `TRACKING.md`; humans must review the entry first.

### AI / Environment Constraints

- The project folder's Linux mount can serve stale/truncated content for files
  that are edited or re-written. File tools write the authoritative copy; to
  run/test in the sandbox, stage a copy under `/tmp` when needed.
- `node:sqlite` needs Node >= 22.5 (harmless ExperimentalWarning;
  `NODE_NO_WARNINGS=1`). WAL falls back to DELETE journal on filesystems without
  shared memory.
- OAuth and Whisper cannot be fully exercised in the sandbox without real
  credentials / Docker.
- Headless mobile browser checks can run via Docker + Playwright image. Use a
  localhost target for secure-context microphone/camera APIs; Docker-network
  hostnames are treated as insecure by Chromium.
