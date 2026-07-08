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
- [ ] LIMS / instrument connectors and scheduled on-prem to cloud sync.
- [ ] Smart LIMS / instrument connectors to get accurate data from machines.
- [ ] Per-project inventory scoping (inventory is still shared across the
  instance).
- [ ] GPU Whisper option and model-size tuning.
- [ ] True continuous video/realtime vision streaming for Observe run mode;
  current prototype samples still frames to control bandwidth and preserve
  reviewability.
- [ ] Postgres repository implementation for larger enterprise deployments.
- [ ] Feature improvement: Observe run.
- [ ] Feature improvement: Add model-backed or trained handwriting OCR for
  difficult scans; current Tesseract OCR now flags low-confidence output for
  manual correction.
- [ ] Repository hygiene: remove tracked runtime `data/` files from history /
  future commits in a dedicated cleanup, leaving runtime state gitignored.

### Future Enhancements

- [ ] Feature - Lab Animal Tracking: track animal movements

## Done

### Product Capabilities

- Core notebook: experiments with scientist-facing outcome status, procedure
  step checklists, file attachments, custom experiment tags, related experiment
  links, entries (note/voice/OCR), audited entry comments, search, dashboard;
  experiment cards and dashboard rows surface the next open procedure step plus
  compact step progress, and the dashboard groups open procedure steps into a
  small click-through to-do list so scientists can resume work without opening
  each record.
- Structured experiment setup metadata: hypothesis, protocol/method, materials
  and reagents, success criteria, and safety notes persist with experiments and
  export evidence; proven setups can be saved as project-scoped experiment
  templates or repeated directly from an existing run to start follow-up
  experiments without copying observations, signatures or attachments.
- Custom experiment metadata: scientists can add compact key/value/unit fields
  such as cell line, strain, instrument, temperature or assay readout without
  expanding the main setup form. Metadata persists as structured JSON, is copied
  through templates and repeat setup, is included in exports/search/AI context,
  and stays visible as a small grid on experiment detail pages.
- Voice entry with Start / Pause / Resume / Stop: Web Speech where supported,
  mobile-safe server STT via OpenAI (`auto`/`openai`) or on-prem Whisper,
  upload of existing audio recordings when server STT is available, one-click
  cleanup for punctuation, capitalization, sample/tube IDs and paragraphing,
  and AI-polished or local-template lab-report drafts linked to hidden raw
  notes/transcript source entries.
- Observe run mode: mobile camera preview + live speech + action timeline, with
  optional OpenAI visual observations from periodic still frames.
- OCR handwriting scan (Tesseract.js) via upload or live camera (rear camera on
  phones); the browser compares OCR from the processed scan and original scan,
  selects the higher-quality candidate, flags low-confidence handwriting output
  for correction, then uploads/stores both the original scan and processed OCR
  image with the entry as reviewable evidence. Raw OCR text is preserved as
  hidden source evidence behind the corrected notebook entry, and evidence
  uploads are guarded by project write access and experiment lock state.
- Sketch-to-figure capture: browser drawing canvas, cleaned diagram upload,
  raw sketch preservation, and figure entries with raw/clean image evidence.
- Audit-ready controls: SHA-256 content fingerprints, password-confirmed
  e-signatures with project reviewer-gated reviewer/approval meanings,
  experiment lock (409 on writes), deletion tombstones, hash-chained audit trail
  + CSV export.
- Workspaces/projects: default workspace migration, project memberships
  (`viewer|scientist|reviewer|owner`), and server-side access checks on
  experiments, plans, references, AI context, exports and search; member
  management includes a visible project-role capability matrix, and experiment
  screens hide or disable write/review controls according to the current
  project role.
- Experiment evidence export as hashed JSON, HTML, PDF, RO-Crate JSON-LD
  metadata packages, or ZIP evidence bundles, including setup metadata, outcome
  status, procedure steps, entry comments, file attachments, related experiment
  links, audit data, manifests and per-file SHA-256 checksums.
- Experiment archive lifecycle: scientists can archive experiments without
  deleting lab history, archived records are hidden from the default list and
  search, remain directly viewable with entries/evidence intact, become
  read-only until restored, and are covered by archive/restore audit events.
- Access-scoped ranked search across experiments, entries and references.
- Entries Library supports selected-entry summarisation/action-plan drafting
  and keeps generated-entry provenance inspectable with source chips that open
  hidden source records such as raw voice transcripts. Multi-line text boxes
  auto-expand as scientists type and after app-filled content such as
  templates, prompts, voice drafts and live transcripts, including modal and
  dynamically-rendered forms, direct value updates, and hidden editors revealed
  for editing, so long notes do not require scrolling inside the field.
- Experiment detail pages can summarise the current notebook entries into a
  concise generated entry from the notebook header. The flow uses configured AI
  when available, falls back to a deterministic local source-only template when
  offline, saves generated summaries with source-entry provenance chips, and
  can convert notebook observations into selectable procedure checklist steps.
  The entry composer also includes a lightweight pre-save `Check draft` action
  that scores the current notebook text for sample context, conditions,
  measurements/results, observations, deviations/uncertainty and next actions,
  returning local suggestions without blocking save.
- Experiment planner and Inventory modules; starting a plan preserves planned
  hypothesis, protocol steps, materials and success criteria in the linked
  experiment, including selected inventory lot, catalogue, location, stock,
  expiry and warning status for planned reagents; inventory create/edit rejects
  negative stock fields, consumption rejects impossible over-use instead of
  silently clamping stock to zero, and shared equipment/resources can be
  reserved with overlap protection, checked through an availability calendar,
  exported as `.ics`, and subscribed to from external calendar apps through a
  tokenized feed URL.
- Backend REST API + repository layer in `src/db.js` (all SQL isolated here).
- Self-hosted Whisper (compose `whisper` profile) + `transcribe()` forwarder +
  browser MediaRecorder path; composer picks mode from `GET /api/stt/health`.
- AI assistant: context-aware OpenAI chat panel in each experiment; API key stays
  server-side (`src/routes/ai.js`; `OPENAI_API_KEY`/`OPENAI_MODEL` in gitignored
  `.env`, default model `gpt-5.5`; optional `OPENAI_BASE_URL`). Assistant
  quick actions help summarize records, check missing setup, troubleshoot, and
  plan next steps from the current experiment context.
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
- Mobile: responsive layout + slide-in nav drawer + viewport-fit; long
  experiment titles wrap inside the sticky header instead of colliding with
  search/theme controls, and Inventory switches from the desktop table to
  full-width reagent cards on phone-sized screens so status and stock actions
  stay visible.
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
- [x] Link related experiments from an experiment record. Scientists can connect
  follow-up, repeat, control or protocol-related records, navigate between
  them, export the relationships, and remove links without deleting experiments.
- [x] Repeat an existing experiment setup. Scientists can create a clean active
  follow-up run from an existing experiment; setup metadata, tags and open
  procedure steps are copied, outcome resets to Running, the repeat links back
  to the source record, and notebook observations/attachments stay behind.
- [x] Attach raw data and supporting files to experiments. Scientists can attach
  instrument output, PDFs, spreadsheets or other evidence to unlocked
  experiments, with SHA-256 file hashes, notes, audited add/remove events,
  authenticated downloads, export inclusion, and AI context awareness.
- [x] Add procedure step checklists to experiment records. Scientists can add,
  complete, reopen and remove run steps on unlocked experiments; steps are
  role/lock guarded, audit logged, exported, and visible to the AI assistant.
- [x] Add scientist-facing experiment outcome status. Scientists can mark a run
  as running, needs redo, success, fail or inconclusive with an outcome note,
  search it, export it, and expose it to the experiment AI context without
  overloading the technical planned/active/locked workflow status.
- [x] Add equipment availability calendar export and sync. Lab users can open a
  calendar for a specific inventory resource, inspect booked windows, export the
  selected window as `.ics`, and create a tokenized subscription URL for
  external calendar apps.
- [x] Auto-expand multi-line text boxes. Textareas in views and modals grow as
  users type long notes, when hidden editors or hidden containers are revealed,
  after direct app-filled value updates, and on viewport/element resize so
  wrapped mobile text remains visible without internal field scrolling.
- [x] Feature improvement: "Summarise" button to summarise notebook entries into
  a concise, source-linked summary from experiment detail pages.
- [x] Feature improvement: "Suggest steps" button to turn current notebook
  observations into selectable, source-backed procedure checklist actions.
- [x] Surface the next open procedure step on experiment indexes. Experiment
  cards and dashboard rows now show the first incomplete checklist step and
  compact open/done counts so active lab work is findable at a glance.
- [x] Add a compact dashboard procedure-step to-do list. The Attention panel
  groups open experiment steps across active records and opens the associated
  experiment with one click.
- [x] Feature improvement: AI assistant predictive suggestions for user
  entries. The composer `Check draft` action flags missing scientific details
  before saving typed notes, voice drafts or OCR-derived entries.
- [x] Add compact custom metadata fields for FAIR experiment records. Metadata
  is stored as structured JSON, copied through reusable setups, searchable and
  exportable without overloading the core notebook UI.
- [x] Add RO-Crate JSON-LD export for FAIR interoperability. Experiment exports
  now include a compact machine-readable graph for the crate root, ELN record,
  entries, attachments, references, audit integrity and custom metadata.
- [x] Add ZIP signed export bundle. Experiment exports now include a single
  `format=zip` evidence package with JSON, HTML, RO-Crate metadata, audit
  data, attachment bytes, a manifest, and SHA-256 checksums for every bundled
  file.
- [x] Add entry revision history for edited notebook records. Each text edit
  stores the previous text, hash, update timestamp and editor identity; edited
  entries show a compact revision control, expose a dedicated revisions API,
  and include prior versions in JSON/HTML/PDF experiment exports.
- [x] Add experiment archive/restore lifecycle. Archived experiments are hidden
  from default lists and search, shown under a `Show archived` toggle, marked
  read-only on detail pages, and restorable without deleting entries or
  evidence.
- [x] Improve OCR review on real handwritten notes. The OCR flow now compares
  processed and original scan candidates, keeps the cleaner result, flags
  low-confidence handwriting output with a confidence value, and expands the
  OCR review fields after programmatic extraction so scientists can correct the
  whole note without scrolling inside the field.
- [x] Enhance voice entry with auto-punctuation, auto-capitalization, and
  auto-paragraphing. Scientists can click `Clean up` to turn raw dictated
  bench notes into a concise visible entry while preserving the source
  transcript/manual notes as hidden evidence.
- [x] Fix mobile experiment header title wrapping. Long experiment titles now
  wrap within the sticky header on phone-sized screens without overlapping
  navigation, theme, or search controls.

## Change Log

### 2026-07-08T15:12:00Z - Recalculate auto-grow when hidden text boxes are revealed

- Task: SVX-000
- Branch: `master`
- Summary: Extended the shared textarea auto-grow observer to watch `hidden`,
  `style`, and `class` changes across the app shell. Textareas that are filled
  while hidden and then revealed now recalculate through the same shared helper
  as newly-rendered or directly typed fields, preventing internal field
  scrolling in late-revealed panels.
- Validation: Added failing static coverage in
  `tests\textarea-autogrow-ui.test.js`, confirmed RED for the missing attribute
  observer, then made the focused test pass with 4/4 tests. Chrome connector
  and Computer Use were attempted first, but both failed before browser attach
  with the known WSL workspace URI error. Playwright browser fallback launched
  but repeatedly timed out or was cut off by the WSL-to-Windows bridge; after
  that even `cmd.exe /C echo` failed with `UtilAcceptVsock: accept4 failed 110`.
  Browser verification for this slice is therefore blocked rather than passed.
- Files:
  - `TRACKING.md`
  - `public/js/ui.js`
  - `tests/textarea-autogrow-ui.test.js`

### 2026-07-08T13:40:19Z - Add dashboard open procedure to-do list

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW documents procedure steps as experiment/resource
  actions, shows the next step on the main index, and provides a To-Do List view
  for next steps. SciVox had index-level next-step previews but no dashboard
  aggregate for open lab actions.
- Summary: Added a compact `Open procedure steps` section to the dashboard
  Attention panel. It uses the existing experiment list step fields, shows up
  to six open next actions with experiment title and open/done counts, and
  opens the associated experiment without adding another top-level module.
- Validation: Added failing static UI coverage in
  `tests\experiment-entry-delete-ui.test.js`, confirmed RED, then made the
  focused test pass. Focused
  `node.exe --test tests/experiment-entry-delete-ui.test.js tests/tracking.test.js`
  passed with 39 tests. Chrome and Computer Use were attempted first, but both
  connectors rejected the WSL workspace URI; headed Edge/Playwright fallback at
  `http://127.0.0.1:58018/` verified account creation, experiment creation,
  adding two procedure steps, completing the first step, dashboard `Open
  procedure steps` list content, click-through from a to-do item back to the
  experiment, mobile rendering without horizontal overflow, and no relevant
  console errors beyond the expected pre-login auth 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-dashboard-todo-browser-1783518110236\dashboard-todo-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-dashboard-todo-browser-1783518110236\dashboard-todo-clickthrough-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-dashboard-todo-browser-1783518110236\dashboard-todo-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/dashboard.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T13:34:11Z - Surface next procedure step on experiment indexes

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW exposes experiment steps as a first-class workflow and
  shows the next step/to-do state from experiment indexes. SciVox already had
  audited procedure checklists on detail pages, but the next action was hidden
  until the scientist opened a specific experiment.
- Summary: Added compact procedure-step progress fields to the experiment list
  query: `stepCount`, `openStepCount`, `completedStepCount`, `next_step_id` and
  `next_step`. Experiment cards and recent dashboard rows now show the next
  open procedure step with open/done counts, or an all-complete state, without
  adding another button or extra list requests.
- Validation: Added failing API coverage in
  `tests\experiment-next-step-index.test.js` and static UI coverage in
  `tests\experiment-entry-delete-ui.test.js`, confirmed RED, then made focused
  `node.exe --test tests/experiment-next-step-index.test.js
  tests/experiment-entry-delete-ui.test.js` pass with 34 tests. Focused
  tracking coverage passed with 39 tests. Chrome and Computer Use were
  attempted first, but both connectors rejected the WSL workspace URI; headed
  Edge/Playwright fallback at `http://127.0.0.1:58016/` verified account
  creation, experiment creation, adding two procedure steps, completing the
  first step, dashboard preview of the second step as `Next step`, experiment
  card preview with `1 open · 1/2 done`, mobile rendering without horizontal
  overflow, and no relevant console errors beyond the expected pre-login auth
  401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-next-step-index-browser-1783517778953\next-step-dashboard-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-next-step-index-browser-1783517778953\next-step-experiments-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-next-step-index-browser-1783517778953\next-step-experiments-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `public/js/views/experiments.js`
  - `public/js/views/dashboard.js`
  - `public/css/styles.css`
  - `tests/experiment-next-step-index.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T13:25:51Z - Add entry draft completeness check

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW documents experiment entries with core title, status,
  tags, main text, custom fields, steps, links and attachments, while ELN
  automation research highlights that gathering metadata automatically can
  reduce documentation effort and repetitive human-entry errors.
- Summary: Added a compact `Check draft` action to the experiment entry
  composer. It calls a local rules-based draft checker for unlocked,
  scientist-writable experiments, scores whether the current note captures
  sample context, run conditions, measurements/results, observations,
  deviations or uncertainty and next actions, and shows missing-detail
  suggestions in a modal without blocking save. Checks are audit logged as
  `LOCAL_CHECK_ENTRY_DRAFT`.
- Validation: Added failing API coverage in
  `tests\entry-draft-check.test.js` and static UI coverage in
  `tests\experiment-entry-delete-ui.test.js`, confirmed RED, then made focused
  tests pass. Focused `node.exe --test tests/entry-draft-check.test.js
  tests/experiment-entry-delete-ui.test.js tests/tracking.test.js` passed with
  38 tests. Chrome and Computer Use were attempted first, but both connectors
  rejected the WSL workspace URI; headed Edge/Playwright fallback at
  `http://127.0.0.1:58014/` verified account creation, experiment creation,
  sparse raw-note `Check draft` reporting `Needs details · 40/100`, sample and
  measurement suggestions, complete raw-note `Ready · 100/100`, mobile modal
  rendering without horizontal overflow, and no relevant console errors beyond
  the expected pre-login auth 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-draft-check-browser-1783517283031\draft-check-missing-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-draft-check-browser-1783517283031\draft-check-ready-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-draft-check-browser-1783517283031\draft-check-missing-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/ai.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/entry-draft-check.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T13:08:29Z - Add AI-suggested procedure steps

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW treats experiment steps as first-class actions and
  shows the next step or to-do list for experiments; SciVox already had manual
  checklist steps and source-backed entry processing, but no experiment-detail
  workflow to turn observations into next actions.
- Summary: Added a compact `Suggest steps` button to writable, unlocked
  experiment procedure cards when notebook entries exist. The modal calls the
  existing `action_plan` entry processor, parses source-backed bullets into
  selectable candidates, supports copying, and saves selected items through the
  audited procedure-step API.
- Validation: Added failing static UI coverage in
  `tests\experiment-entry-delete-ui.test.js` and extended
  `tests\ai-entry-summary-offline.test.js` to lock the offline four-bullet
  action-plan contract, confirmed RED, then made focused tests pass. Bundled
  Node `node.exe --test` passed with 77 tests. Chrome and Computer Use were
  attempted first, but both connectors rejected the WSL workspace URI; headed
  Edge/Playwright fallback at `http://127.0.0.1:58007/` verified account
  creation, experiment setup with notebook entries, visible `Suggest steps`,
  source-backed modal suggestions, saving four suggestions into the procedure
  checklist, mobile rendering without horizontal overflow, and no relevant
  console errors beyond the expected pre-login auth 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-suggest-steps-browser-1783516236438\suggest-steps-before-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-suggest-steps-browser-1783516236438\suggest-steps-modal-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-suggest-steps-browser-1783516236438\suggest-steps-added-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-suggest-steps-browser-1783516236438\suggest-steps-before-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-suggest-steps-browser-1783516236438\suggest-steps-modal-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-suggest-steps-browser-1783516236438\suggest-steps-added-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/experiments.js`
  - `tests/ai-entry-summary-offline.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T12:46:49Z - Add ZIP experiment evidence bundle

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW's official documentation lists experiment PDF export,
  ZIP archive export, audit/revision history, immutable archives, and
  human-readable plus machine-readable exportability as ELN expectations. The
  SciVox gap was that exports were individually available but not packaged as a
  single transferable evidence bundle.
- Summary: Added `format=zip` to `/api/experiments/:id/export`, returning a
  dependency-light stored ZIP archive as `*-evidence-bundle.zip`. The bundle
  includes `manifest.json`, `experiment-export.json`, `experiment-export.html`,
  `ro-crate-metadata.json`, `audit.json`, and available attachment bytes under
  `attachments/`; the manifest records experiment identity, ELN ID, export
  fingerprint, per-file byte counts and SHA-256 checksums. The experiment
  export menu now includes `Export ZIP bundle`.
- Validation: Added failing API coverage in
  `tests\experiment-zip-export.test.js` and static UI coverage in
  `tests\experiment-entry-delete-ui.test.js`, confirmed RED, then made focused
  tests pass. Also reran `tests\experiment-rocrate-export.test.js` and
  `tests\mvp-api.test.js` to guard existing JSON/HTML/PDF/RO-Crate exports.
- Browser evidence: Chrome and Computer Use were attempted first, but both
  connectors rejected the WSL workspace URI before bootstrap; headed
  Edge/Playwright fallback at `http://127.0.0.1:57999/` verified account
  creation, experiment creation, visible `Export ZIP bundle` menu action,
  fetched `application/zip` export, ZIP entries for manifest, JSON, HTML,
  RO-Crate metadata, audit and attachment bytes, manifest file hashes, matching
  attachment SHA-256, mobile rendering without horizontal overflow, and no
  relevant console errors beyond the expected pre-login auth 401.
- Browser screenshots:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-zip-browser-1783515071214\zip-export-menu-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-zip-browser-1783515071214\zip-export-menu-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/experiments.js`
  - `public/js/views/experiments.js`
  - `tests/experiment-zip-export.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T12:31:23Z - Add RO-Crate JSON-LD experiment export

- Task: SVX-000
- Branch: `master`
- Reference scan: RO-Crate 1.1 is a Recommendation with a JSON-LD context at
  `https://w3id.org/ro/crate/1.1/context`; the FAIR export gap was that SciVox
  had hashed JSON/HTML/PDF exports but no linked-data metadata graph for
  interoperable reuse.
- Summary: Added `format=rocrate` to `/api/experiments/:id/export`, returning
  `application/ld+json` as a `*-ro-crate-metadata.json` download. The graph
  describes the crate root, experiment dataset, entries, attachments,
  references, custom metadata fields, setup fields and audit/integrity hash.
  The experiment export menu now includes `Export RO-Crate`.
- Validation: Added failing API coverage in
  `tests\experiment-rocrate-export.test.js` and static UI coverage in
  `tests\experiment-entry-delete-ui.test.js`, confirmed RED, then made focused
  tests pass. Bundled Node `node.exe --test` passed with 75 tests. Chrome and
  Computer Use were attempted first, but both connectors rejected the WSL
  workspace URI; headed Edge/Playwright fallback at `http://127.0.0.1:57990/`
  verified account creation, experiment creation, visible `Export RO-Crate`
  menu action, fetched `application/ld+json` export, experiment/entry/reference
  graph nodes, ELN ID, integrity hash, mobile rendering without horizontal
  overflow, and no relevant console errors beyond the expected pre-login auth
  401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-rocrate-browser-1783514023792\rocrate-export-menu-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-rocrate-browser-1783514023792\rocrate-export-menu-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/experiments.js`
  - `public/js/views/experiments.js`
  - `tests/experiment-rocrate-export.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T12:25:25Z - Harden auto-expanding text boxes

- Task: SVX-000
- Branch: `master`
- Summary: Hardened the shared textarea auto-grow helper so every prepared
  multiline field recalculates when users type, when a hidden editor receives
  focus after being revealed, when its rendered width changes, and when app code
  assigns directly to `.value`. Hidden textareas are no longer collapsed to a
  zero-height measurement before they become visible.
- Validation: Added failing static UI coverage in
  `tests\textarea-autogrow-ui.test.js`, confirmed RED, then made the focused
  test pass. Bundled Node `node.exe --test` passed with 74 tests. Chrome and
  Computer Use were attempted first, but both connectors rejected the WSL
  workspace URI; headed Edge/Playwright fallback at `http://127.0.0.1:57988/`
  verified account creation, New Experiment Objective typing auto-grow,
  direct programmatic Protocol `.value` auto-grow, Raw lab notes auto-grow,
  saved-entry hidden editor reveal/focus auto-grow, mobile reflow without
  internal textarea scrolling or horizontal page overflow, and no relevant
  console errors beyond the expected pre-login auth 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-browser-1783513484886\raw-notes-autogrow-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-browser-1783513484886\entry-editor-revealed-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-browser-1783513484886\entry-editor-revealed-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/ui.js`
  - `tests/textarea-autogrow-ui.test.js`

### 2026-07-08T11:49:42Z - Add entry revision history

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW exposes revision/changelog actions for experiment
  entries, which highlighted that edited notebook records should keep visible
  prior versions rather than only showing an edited timestamp.
- Summary: Added immutable entry revision storage. Editing an unsigned notebook
  entry now records the previous text, previous hash, previous update time and
  editor identity before updating the current entry and fingerprint. Experiment
  payloads expose `revision_count`, `/api/entries/:id/revisions` returns the
  prior versions, the experiment page shows a compact `View revisions` button
  and modal for edited entries, and JSON/HTML/PDF exports include entry
  revisions.
- Validation: Added failing API/export/migration coverage in
  `tests\entry-revisions.test.js` and static UI coverage in
  `tests\experiment-entry-delete-ui.test.js`, confirmed RED, then made the
  focused tests pass. `npm test` could not run because the bundled runtime has
  no `npm` binary; the equivalent project command
  `node.exe --test` passed with 67 tests.
  Chrome and Computer Use were attempted first but rejected the WSL workspace
  URI; headed Edge/Playwright fallback at `http://127.0.0.1:61110/` verified
  entry edit/save, `View revisions (1)`, revision modal previous text/hash,
  export JSON revision content, desktop and mobile rendering, no horizontal
  mobile overflow, no relevant console/page errors, and auto-growing edit and
  revision textareas with no internal overflow.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-revisions-smoke-LhobE2\screenshots\entry-revisions-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-revisions-smoke-LhobE2\screenshots\entry-revisions-modal-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-revisions-smoke-LhobE2\screenshots\entry-revisions-modal-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/entries.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/entry-revisions.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T11:40:19Z - Add custom experiment metadata fields

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW documents a `metadata` JSON attribute on
  experiments/items/templates and custom fields with types, values, units,
  positions and templates; CEDAR frames reusable structured metadata as JSON,
  JSON-LD or RDF for FAIR scientific workflows.
- Summary: Added compact custom metadata fields to experiment create/edit/detail
  flows. The database now stores normalized `metadata.extra_fields` JSON for
  experiments and experiment templates, parses it back into API objects, copies
  it through template creation, templated experiments and repeat setup, includes
  it in JSON/HTML/PDF exports, search scoring and experiment AI context, and
  renders it as a small metadata grid instead of a heavy extra screen.
- Validation: Added failing API/migration coverage and static UI coverage first,
  confirmed RED for missing metadata schema/API/UI, then made
  `tests\experiment-metadata.test.js` and
  `tests\experiment-entry-delete-ui.test.js` pass. Bundled Node
  `node.exe --test` passed with 64 tests, and `git diff --check` passed.
  Chrome and Computer Use were attempted first but rejected the WSL workspace
  URI; headed Edge/Playwright fallback at `http://127.0.0.1:57974/` verified
  UI creation of metadata fields, detail rendering, edit/save of an assay
  readout, metadata search, export JSON content, mobile viewport without
  horizontal overflow, and no relevant console/page errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-metadata-smoke-1783510803112\metadata-create-modal-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-metadata-smoke-1783510803112\metadata-detail-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-metadata-smoke-1783510803112\metadata-search-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-metadata-smoke-1783510803112\metadata-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/experiments.js`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/experiment-metadata.test.js`

### 2026-07-08T11:30:53Z - Add experiment entry summaries

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW treats experiment entries as the core ELN record and
  exposes structured fields/links/attachments/export around them; RSpace
  emphasizes reusable templates and metadata consistency. This change keeps
  summary generation source-linked instead of creating detached prose.
- Summary: Added a `Summarise entries` action to experiment detail notebook
  headers. The action calls the existing entry-processing API for the current
  visible entries, shows an editable generated summary modal, supports copy,
  and saves the generated text as a normal note with `sourceEntryIds` back to
  the summarized entries. `/api/ai/process-entries` now works without
  `OPENAI_API_KEY` by returning a deterministic `local-template` summary/action
  plan from the selected entry text, and it falls back locally if a configured
  AI request fails.
- Validation: Added failing API/static UI coverage first, confirmed RED for the
  offline `501` and missing experiment-summary controls, then made focused
  `tests\ai-entry-summary-offline.test.js` and
  `tests\experiment-entry-delete-ui.test.js` pass. Bundled Node
  `node.exe --test` passed with 61 tests, and `git diff --check` passed. Chrome
  and Computer Use were attempted first but rejected the WSL workspace URI;
  headed Edge/Playwright fallback at `http://127.0.0.1:57972/` verified
  registration, experiment creation, offline summary generation, save-as-entry
  provenance chips, mobile viewport without horizontal overflow, and no
  relevant console/page errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-summary-smoke-1783510225292\summary-modal-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-summary-smoke-1783510225292\summary-saved-source-links-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-summary-smoke-1783510225292\summary-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/experiments.js`
  - `src/routes/ai.js`
  - `tests/ai-entry-summary-offline.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-08T11:16:50Z - Guard uploaded voice drafts and save state

- Task: SVX-000
- Branch: `master`
- Summary: Added an `Upload audio` path to the experiment voice composer when
  server STT is available, preserves uploaded audio filenames for transcription,
  and keeps `Save entry` disabled while uploaded/recorded audio is still
  transcribing or generating an enhanced draft. The AI voice-draft endpoint now
  reads OpenAI configuration at request time and falls back to the local
  lab-report draft if a configured OpenAI request fails.
- Validation: Added failing static/API coverage first for uploaded-audio
  transcription and configured-AI fallback, confirmed RED, then made focused
  `tests\experiment-entry-delete-ui.test.js`,
  `tests\textarea-autogrow-ui.test.js`, and
  `tests\voice-draft-offline.test.js` pass. `npm test` could not run because
  `npm` is not installed in this shell; bundled Node
  `node.exe --test` passed with 59 tests. Chrome and Computer Use were
  attempted first, but both connectors rejected the WSL workspace URI; headed
  Edge/Playwright fallback verified textarea auto-grow at
  `http://127.0.0.1:57958/` and a mocked uploaded-audio voice flow at
  `http://127.0.0.1:57960/`. The browser pass confirmed the New Experiment
  Objective textarea grew from 88px to 2232px, composer raw notes grew to
  1495px on desktop and 4235px on mobile with zero horizontal overflow, and the
  uploaded-audio `Save entry` button stayed disabled until the enhanced draft
  was ready and saved with a source transcript chip.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-smoke-1783509271268\autogrow-modal-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-smoke-1783509271268\autogrow-composer-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-smoke-1783509271268\autogrow-composer-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-upload-mock-1783509399110\voice-upload-draft-ready.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-upload-mock-1783509399110\voice-upload-saved-source-chip.png`
- Files:
  - `TRACKING.md`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `src/routes/ai.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/voice-draft-offline.test.js`

### 2026-07-08T10:39:30Z - Harden auto-expanding text boxes

- Task: SVX-000
- Branch: `master`
- Summary: Extended textarea auto-grow recalculation to programmatic value
  changes, not only keyboard input. Experiment templates, AI quick prompts,
  voice draft output, source transcript updates, Observe-mode live transcript
  updates, review text, and composer clears now call the shared auto-grow
  helper after values are set.
- Validation: Added failing static coverage first for programmatic textarea
  fills, confirmed RED for the missing recalculation hooks, then made focused
  `tests\textarea-autogrow-ui.test.js`, related static UI/tracking tests, and
  bundled Node `--test` pass with 57 tests. Chrome and Computer Use were
  attempted first, but both connectors rejected the WSL workspace URI; headed
  Edge/Playwright fallback at `http://127.0.0.1:57944/` verified registration,
  New Experiment modal typing, Objective textarea growth from 88px to 1191px,
  saved-template programmatic fills for Protocol/Hypothesis with
  `clientHeight === scrollHeight`, mobile recalculation to 2252px, no
  horizontal overflow, and no relevant console errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-programmatic-1783507672710\autogrow-template-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-programmatic-1783507672710\autogrow-template-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/experiments.js`
  - `public/js/observer.js`
  - `tests/textarea-autogrow-ui.test.js`

### 2026-07-08T10:22:58Z - Improve OCR review on real handwritten lab notes

- Task: SVX-000
- Branch: `master`
- Reference scan: Used a real scanned handwritten lab-book page from
  ErrantScience's paper lab-book article. The article identifies it as a scanned
  page of the author's lab book and emphasizes dating, aims/materials,
  chronological records, and retaining mistakes instead of erasing them.
- Summary: Changed browser OCR to run two candidates: the existing processed
  scan and the original scan. SciVox scores candidates by Tesseract confidence
  and text readability, selects the cleaner output, and returns confidence,
  quality score, selected variant, and low-confidence status. The experiment OCR
  review UI now labels low-confidence handwriting output, shows the confidence
  value, and recalculates auto-growing corrected/raw OCR textareas after
  programmatic extraction.
- Validation: Added failing OCR candidate/UI regression coverage first and
  confirmed RED for missing `chooseOCRCandidate`. Focused
  `tests\ocr-quality.test.js` and
  `tests\experiment-entry-delete-ui.test.js` passed, and bundled Node `--test`
  passed with 55 tests. Chrome and Computer Use were
  attempted first, but both connectors rejected the WSL workspace URI; headed
  Edge/Playwright fallback at `http://127.0.0.1:57941/` verified registration,
  experiment creation, upload of the real handwritten lab-book scan,
  low-confidence OCR status at 45%, corrected textarea expansion
  (`clientHeight === scrollHeight`), mobile review without horizontal overflow,
  corrected OCR save, and raw OCR source evidence modal.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-real-repro-1783506155459\ocr-real-review.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-real-repro-1783506155459\ocr-real-review-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-real-repro-1783506155459\ocr-real-saved-entry.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-real-repro-1783506155459\ocr-real-raw-source.png`
- Files:
  - `TRACKING.md`
  - `public/js/ocr.js`
  - `public/js/views/experiments.js`
  - `tests/ocr-quality.test.js`

### 2026-07-08T10:05:12Z - Fix mobile experiment header wrapping

- Task: SVX-000
- Branch: `master`
- Reference scan: Browser smoke testing of the experiment page exposed a
  scientist-facing mobile layout issue: long experiment titles could visually
  collide with top-bar controls, making the current experiment identity hard to
  scan during bench use.
- Summary: Named the top-bar title block with `.top-title`, gave it
  shrink-safe flex sizing, wrapped long title/subtitle text with
  `overflow-wrap:anywhere`, removed the mobile spacer that competed for header
  width, and pinned the small-phone constraint in CSS.
- Validation: Added a failing static UI regression first and confirmed RED for
  the missing `.top-title` contract. Focused
  `tests\experiment-entry-delete-ui.test.js` passed. Bundled Node `--test`
  passed with 53 tests. Chrome and Computer Use were attempted first, but both
  connectors rejected the WSL workspace URI; headed Edge/Playwright fallback at
  `http://127.0.0.1:57939/` verified a long experiment title on desktop and
  mobile, no horizontal overflow, mobile subtitle hidden, title wrapping to
  multiple lines, and no title overlap with hamburger/theme/search controls.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-header-smoke-1783505084845\header-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-header-smoke-1783505084845\header-mobile.png`
- Files:
  - `public/index.html`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `TRACKING.md`

### 2026-07-08T09:57:24Z - Add clean voice-note drafting

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW documents experiment entries as the core ELN record,
  with optional templates at creation, rich main text for procedure/results,
  tags/status, steps, links, attachments and export; this change keeps SciVox's
  voice flow notebook-ready by cleaning dictated text into an editable entry
  while preserving the raw source evidence.
- Summary: Added `clean_voice_note` to `/api/ai/process-voice-draft`, including
  OpenAI instruction text and deterministic local fallback cleanup for
  punctuation, capitalization, paragraph breaks, and common lab identifiers such
  as sample/tube IDs. The experiment composer now exposes a `Clean up` button
  beside `Draft report`, adds `Clean note` to the format selector, and keeps
  disabled/source-state behavior aligned with the existing raw transcript flow.
- Validation: Added failing API/static UI coverage first and confirmed RED for
  the missing template/button. Focused tests then passed:
  `tests\voice-draft-offline.test.js` and
  `tests\experiment-entry-delete-ui.test.js`. Bundled Node `--test` passed with
  52 tests. Chrome and Computer Use were attempted first, but both connectors
  rejected the WSL workspace URI; headed Edge/Playwright fallback at
  `http://127.0.0.1:57938/` verified registration, experiment creation,
  `Clean up` disabled until source text, clean-note generation, saved visible
  voice entry, raw source modal provenance, mobile rendering without horizontal
  overflow, and no relevant console/page errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-cleanvoice-smoke-1783504730836\clean-review-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-cleanvoice-smoke-1783504730836\clean-review-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-cleanvoice-smoke-1783504730836\saved-source-modal.png`
- Files:
  - `src/routes/ai.js`
  - `public/js/views/experiments.js`
  - `tests/voice-draft-offline.test.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `TRACKING.md`

### 2026-07-07T16:03:45Z - Add experiment repeat setup

- Task: SVX-000
- Branch: `master`
- Reference scan: eLabFTW documents a toolbar Duplicate entry action that
  creates a new running entry from an existing experiment's setup and also
  documents linked experiment/resource workflows for follow-up iterations.
- Summary: Added a `POST /api/experiments/:id/duplicate` lifecycle for clean
  repeat runs. It requires project scientist access, allows repeating locked
  source experiments by creating a new active experiment, copies setup metadata,
  tags and active procedure steps as open steps, resets outcome to Running,
  links the new run back to the source, and audits `DUPLICATE_EXPERIMENT`.
  The experiment detail screen now has a `Repeat setup` action and confirmation
  modal that opens the new run after creation.
- Validation: Added failing API and static UI coverage first, confirmed RED
  failures for missing `/duplicate` and missing `data-duplicate-experiment`,
  then made focused `tests\mvp-api.test.js` and
  `tests\experiment-entry-delete-ui.test.js` pass. Bundled Node `--test`
  passed with 52 tests. Chrome and Computer Use setup were attempted first, but
  both connectors still rejected the WSL workspace URI. Rendered headed
  Edge/Playwright smoke at `http://127.0.0.1:57932/` verified registration,
  experiment creation, step and note creation, the Repeat setup modal, creation
  of the repeated run, copied setup/procedure step, active/Running reset,
  source related-experiment link, zero copied notebook entries, zero copied
  attachments, mobile rendering without horizontal overflow, and no relevant
  console/page errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-repeat-smoke-1783440200942\repeat-source-with-button.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-repeat-smoke-1783440200942\repeat-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-repeat-smoke-1783440200942\repeat-new-run.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-repeat-smoke-1783440200942\repeat-new-run-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `tests/mvp-api.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-07T15:46:50Z - Auto-expand text boxes

- Task: SVX-000
- Branch: `master`
- Summary: Added a shared textarea auto-grow helper that initializes all
  existing, modal, and dynamically-added textareas. It hides internal vertical
  textarea scrollbars, grows fields to their content on input/change, and
  recalculates on viewport resize so mobile wrapping does not reintroduce
  internal scrolling.
- Validation: Added failing static UI coverage first, confirmed RED for the
  missing shared auto-grow helper and then for missing resize recalculation,
  then made the focused test pass. Bundled Node focused
  `tests\textarea-autogrow-ui.test.js` passed. Rendered headed Edge/Playwright
  smoke at `http://127.0.0.1:62858/` verified registration, the New Experiment
  modal, long Objective textarea entry, desktop growth from 88px to 714px,
  `clientHeight === scrollHeight`, hidden textarea overflow, mobile viewport
  recalculation to 2004px with no horizontal overflow, and no relevant
  console/page errors beyond the expected initial unauthenticated
  `/api/auth/me` 401. Chrome/browser-control setup was attempted first but the
  connector still rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-smoke-1783439199697\autogrow-experiment-modal-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-autogrow-smoke-1783439199697\autogrow-experiment-modal-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/ui.js`
  - `public/js/app.js`
  - `public/css/styles.css`
  - `tests/textarea-autogrow-ui.test.js`

### 2026-07-07T15:42:00Z - Add equipment availability calendars

- Task: SVX-000
- Branch: `master`
- Summary: Added equipment/resource availability calendars on Inventory items.
  Users can open a Calendar action per resource, choose a date window, see
  existing bookings, export the selected window as an iCalendar `.ics` file, and
  create an absolute tokenized feed URL that external calendar apps can
  subscribe to without a SciVox browser session.
- Implementation: Added windowed reservation queries and hashed calendar feed
  tokens in `src/db.js`, protected availability/download/token endpoints under
  `/api/inventory`, a public token feed under `/api/calendar/inventory/*.ics`,
  shared iCalendar rendering, API client helpers, and Inventory modal controls
  with desktop/mobile styling.
- Validation: Added failing API/static UI coverage first, confirmed the expected
  RED failures for missing availability and UI hooks, then made the tests pass.
  Bundled Node focused `tests\inventory-reservations.test.js` and
  `tests\inventory-ui.test.js` passed, and bundled Node `--test` passed with 50
  tests. Chrome and Computer Use setup were attempted first; the Chrome
  connector still rejected the WSL workspace URI and no separate Computer Use
  control tools were exposed. Rendered headed Edge/Playwright smoke at
  `http://127.0.0.1:62735/` verified registration, Inventory item creation,
  reservation creation, Calendar modal availability display, authenticated
  `.ics` export content, tokenized public feed content, mobile rendering with no
  horizontal overflow, and no relevant console/page errors beyond the expected
  initial unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-calendar-smoke-1783438903974\equipment-calendar-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-calendar-smoke-1783438903974\equipment-calendar-sync-url.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-calendar-smoke-1783438903974\equipment-calendar-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/index.js`
  - `src/calendar.js`
  - `src/routes/calendar.js`
  - `src/routes/inventory.js`
  - `public/js/api.js`
  - `public/js/views/inventory.js`
  - `public/css/styles.css`
  - `tests/inventory-reservations.test.js`
  - `tests/inventory-ui.test.js`

### 2026-07-07T15:28:47Z - Add experiment outcome status

- Task: SVX-000
- Branch: `master`
- Summary: Added a separate scientist-facing experiment outcome lifecycle with
  `outcome_status` and `outcome_summary` fields. The outcome can be set from
  create/edit modals, appears as a badge on experiment cards and details, is
  searchable, is included in JSON/HTML/PDF exports, and is supplied to the AI
  assistant context while existing `planned|active|locked` workflow status keeps
  governing write/lock behavior.
- Reference scan: eLabFTW documents experiment Status as a first-class run
  field with default values such as Running, Needs to be redone, Success and
  Fail; this closes the SciVox gap where records only had technical lock state
  and no clear scientist-facing run result.
- Validation: Added failing static UI plus API/search/export/AI/migration
  coverage first, confirmed expected RED failures for missing outcome UI and DB
  columns, then made the tests pass. Bundled Node focused
  `tests\experiment-entry-delete-ui.test.js` and `tests\mvp-api.test.js`
  passed, and bundled Node `--test` passed with 49 tests. Chrome and Computer
  Use setup were attempted first but both connectors rejected the WSL workspace
  URI. Rendered headed Edge/Playwright smoke at `http://127.0.0.1:62644/`
  verified registration, experiment creation with default Running outcome,
  edit-modal Success outcome update, detail badge and outcome note, JSON export
  inclusion, frontend list search by outcome note text, mobile rendering with no
  horizontal overflow, and no relevant console/page errors; the only ignored
  console event was the expected initial unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-outcome-smoke-1783438113469\outcome-create-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-outcome-smoke-1783438113469\outcome-edit-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-outcome-smoke-1783438113469\outcome-detail.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-outcome-smoke-1783438113469\outcome-list-search.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-outcome-smoke-1783438113469\outcome-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/experiments.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T15:15:16Z - Require browser verification for every task

- Task: SVX-000
- Branch: `master`
- Summary: Tightened `CLAUDE.md` so browser verification is a mandatory
  completion gate for every repo task, including backend-only, docs-only,
  config, test, and process changes. The guidance now requires reporting the
  browser tool or fallback, URL, viewport, result, and screenshot paths.
- Validation: `git diff --check -- CLAUDE.md TRACKING.md` passed. Rendered
  headed Edge/Playwright smoke opened `http://127.0.0.1:57931/` at 1280x820 and
  390x844 with a disposable Windows temp `DATA_DIR`, verified the SciVox ELN
  auth screen rendered, exercised the Sign in/Create account tabs, and found no
  relevant console or page errors beyond the expected unauthenticated startup
  401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-claude-browser-smoke-1783437666493\claude-browser-home-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-claude-browser-smoke-1783437666493\claude-browser-home-mobile.png`
- Files:
  - `TRACKING.md`
  - `CLAUDE.md`

### 2026-07-07T15:12:48Z - Add experiment procedure step checklists

- Task: SVX-000
- Branch: `master`
- Summary: Added auditable procedure steps on experiment detail pages.
  Scientists can add a run action, see the next open step, check it complete,
  reopen it, or remove it from the active checklist while preserving audit
  events. Steps are included in JSON, HTML and PDF experiment exports and in the
  AI assistant's experiment context.
- Reference scan: eLabFTW documents experiment Steps as actions connected to an
  Experiment or Resource, with checkboxes for completion and next-step
  visibility; this closes the SciVox gap where protocol text existed but could
  not be executed as a tracked run checklist.
- Validation: Added failing static UI plus API/export/audit/migration coverage
  first, confirmed the expected failures, then made the tests pass. Bundled
  Node focused `tests\experiment-entry-delete-ui.test.js` and
  `tests\mvp-api.test.js` passed, and bundled Node `--test` passed with 48
  tests. Chrome and Computer Use setup were attempted first but both connectors
  rejected the WSL workspace URI. Rendered headed Edge/Playwright smoke at
  `http://127.0.0.1:57929/` verified registration, experiment creation,
  procedure step add modal, next-step display, step completion state, JSON
  export inclusion, mobile rendering with no horizontal overflow, step removal,
  export removal, and no unexpected console errors; the only console event was
  the expected initial unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-steps-smoke-1783437150922\procedure-step-added.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-steps-smoke-1783437150922\procedure-step-complete.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-steps-smoke-1783437150922\procedure-step-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-steps-smoke-1783437150922\procedure-step-empty-after-remove.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T15:04:46Z - Add experiment file attachments

- Task: SVX-000
- Branch: `master`
- Summary: Added auditable experiment attachments for raw data and supporting
  files. Scientists can attach a file with an optional note from the experiment
  side panel, download it through authenticated upload routes, remove it from
  the active attachment list without erasing audit history, and see file names,
  notes, sizes and SHA-256 hashes included in JSON, HTML and PDF exports plus AI
  assistant context.
- Reference scan: eLabFTW treats uploaded files as first-class experiment
  information and documents an Attach a file flow with no file-type limit and no
  number-of-files limit; this closes the SciVox gap for instrument outputs,
  PDFs, spreadsheets and other lab evidence that should live with the experiment
  record.
- Validation: Added failing static UI plus API/export/audit/migration coverage
  first, confirmed the expected failures, then made the tests pass. Bundled
  Node focused `tests\experiment-entry-delete-ui.test.js` and
  `tests\mvp-api.test.js` passed, and bundled Node `--test` passed with 47
  tests. Chrome and Computer Use setup were attempted first but both connectors
  rejected the WSL workspace URI. Rendered headed Edge/Playwright smoke at
  `http://127.0.0.1:57928/` verified
  registration, experiment creation, attachment modal, non-image CSV upload,
  attachment detail display with note and hash, JSON export inclusion,
  authenticated file download, mobile rendering with no horizontal overflow,
  attachment removal, export removal, and no unexpected console errors; the only
  console event was the expected initial unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-attachments-smoke-1783436754794\attachment-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-attachments-smoke-1783436754794\attachment-detail.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-attachments-smoke-1783436754794\attachment-mobile.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-attachments-smoke-1783436754794\attachment-empty-after-remove.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T15:03:20Z - Make browser check a final-response gate

- Task: SVX-000
- Branch: `master`
- Summary: Tightened the top-level `CLAUDE.md` browser-verification reminder so
  every repo task requires checking the running frontend in a real browser
  before the final response, including backend, config, docs and process-only
  changes.
- Validation: Documentation-only change; no automated tests run. Rendered
  headed Edge/Playwright smoke opened `http://127.0.0.1:57927/` at 1280x820
  with a disposable Windows temp `DATA_DIR`, verified the `SciVox ELN` login
  screen rendered with Sign in and Create account controls, and found no
  unexpected page errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-claude-browser-smoke-1783436589144\claude-browser-home.png`
- Files:
  - `CLAUDE.md`
  - `TRACKING.md`

### 2026-07-07T14:53:34Z - Add related experiment links

- Task: SVX-000
- Branch: `master`
- Summary: Added auditable experiment-to-experiment links. Scientists can add a
  related experiment with an optional note from the experiment side panel, open
  the linked record, remove the relationship without deleting either
  experiment, and see the relationship preserved in JSON, HTML and PDF export
  evidence plus AI assistant context.
- Reference scan: eLabFTW treats links to other experiments/resources as part
  of the experiment record, including a linked section for viewing those
  relationships; this closes the SciVox gap for follow-up, repeat, control and
  protocol-related lab runs that should remain connected without duplicating
  entries.
- Validation: Added failing static UI plus API/export/audit/migration coverage
  first, confirmed the expected failures, then made the tests pass. Bundled
  Node focused `tests\experiment-entry-delete-ui.test.js`,
  `tests\mvp-api.test.js`, `tests\user-archive.test.js` and
  `tests\user-archive-ui.test.js` passed, and bundled Node `--test` passed with
  46 tests. Chrome and Computer Use setup were attempted first but both
  connectors rejected the WSL workspace URI. Rendered headed Edge/Playwright
  smoke verified Users archive hide/toggle/restore behavior, related-experiment
  link modal, saved related link detail display, open-linked-experiment
  navigation, JSON export inclusion before removal, removal from the related
  list and export, mobile rendering with no horizontal overflow, and no
  unexpected console errors; the only console event was the expected initial
  unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-links-smoke-1783435987032\users-archive-hidden.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-links-smoke-1783435987032\users-archive-visible.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-links-smoke-1783435987032\related-link-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-links-smoke-1783435987032\related-link-detail.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-links-smoke-1783435987032\related-link-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T14:34:51Z - Add searchable experiment tags

- Task: SVX-000
- Branch: `master`
- Summary: Added lightweight experiment tags/metadata for grouping related lab
  runs. Tags persist on experiments, migrate onto legacy databases, appear as
  chips on experiment cards and detail pages, can be edited in create/edit
  modals, are included in frontend and API search, and are carried through JSON,
  HTML and PDF exports plus AI assistant context.
- Reference scan: LabArchives surfaces custom tags, metadata and metadata-aware
  search as ELN data-management expectations, and eLabFTW treats Metadata as a
  first-class user-guide area; this closes a retrieval gap for scientists who
  need to connect related experiment families without overloading titles.
- Validation: Added failing static UI, API/search/export and migration coverage
  first, confirmed the expected failures, then made the tests pass. Bundled Node
  focused `tests\experiment-entry-delete-ui.test.js` and `tests\mvp-api.test.js`
  passed, and bundled Node `--test` passed with 45 tests. Chrome and Computer
  Use setup were attempted first but both connectors rejected the WSL workspace
  URI. Rendered Edge/Playwright smoke verified registration, experiment
  creation with tags, visible tag chips on detail and list cards, editing tags,
  filtering by tag in the frontend, `/api/search` returning the experiment by
  tag, JSON export including edited tags, mobile rendering with zero
  document/body horizontal overflow and no protruding elements, and no
  unexpected console errors; the only console event was the expected initial
  unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-tags-smoke-1783434862666\tags-created-detail.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-tags-smoke-1783434862666\tags-edited-detail.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-tags-smoke-1783434862666\tags-filtered-list.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-tags-smoke-1783434862666\tags-mobile-list.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/ai.js`
  - `src/routes/experiments.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T14:20:58Z - Require browser frontend checks in agent notes

- Task: SVX-000
- Branch: `master`
- Summary: Tightened `CLAUDE.md` so future work must include a real-browser
  frontend pass before completion. The guidance now calls out a lightweight
  minimum browser check even for backend, config, docs, or process-only work,
  and keeps blocker reporting explicit when browser tooling cannot run.
- Validation: Documentation-only change; no automated tests run. Chrome and
  Computer Use setup were attempted first but both connectors rejected the WSL
  workspace URI. Rendered Edge/Playwright smoke opened
  `http://127.0.0.1:57920/` at 1280x820 against a disposable Windows temp
  `DATA_DIR`, verified the `SciVox ELN` login screen rendered with Sign in and
  Create account controls, saw no page errors, and only saw the expected initial
  unauthenticated `/api/auth/me` 401 console event.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-doc-browser-smoke-1783434344278\scivox-doc-browser-home.png`
- Files:
  - `CLAUDE.md`
  - `TRACKING.md`

### 2026-07-07T14:18:02Z - Add audited entry comments

- Task: SVX-000
- Branch: `master`
- Summary: Added collaboration comments on notebook entries. Scientists can add
  a comment to an unlocked visible entry, comments render inline under the
  entry with author/time metadata, exports carry the comments with the entry,
  and every comment write is audit logged. Also tightened the main app shell and
  fingerprint line wrapping so the verified mobile comment view has no
  horizontal overflow or clipped hashes.
- Reference scan: LabArchives lists comments/tagging on entries, real-time
  collaboration, signing/witnessing workflows, hierarchical roles, custom tags,
  links, metadata and audit/version controls as ELN collaboration/data-management
  expectations; this closes the missing entry-discussion workflow without
  changing immutable entry text.
- Validation: Added failing static UI, API, migration and mobile overflow
  coverage first, then made it pass. Bundled Node focused
  `tests\experiment-entry-delete-ui.test.js` and `tests\mvp-api.test.js` passed,
  and bundled Node `--test` passed with 44 tests. Chrome and Computer Use setup
  were attempted first but both connectors rejected the WSL workspace URI.
  Rendered Edge/Playwright smoke verified registration, experiment entry
  comment modal, saved inline comment display, JSON export comment inclusion,
  desktop rendering, mobile rendering with zero document/body/main horizontal
  overflow and no protruding elements, and no unexpected console errors; the
  only console event was the expected initial unauthenticated `/api/auth/me`
  401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-comments-smoke-ZHg0cN\entry-comment-before.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-comments-smoke-ZHg0cN\entry-comment-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-comments-smoke-ZHg0cN\entry-comment-after.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entry-comments-smoke-ZHg0cN\entry-comment-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/entries.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `public/css/styles.css`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T13:59:50Z - Clarify mandatory browser verification

- Task: SVX-000
- Branch: `master`
- Summary: Updated `CLAUDE.md` to make real-browser verification a top-level
  working rule for any frontend-affecting or user-facing change, including
  reporting blockers instead of claiming full frontend verification.
- Validation: Re-read the changed guidance in `CLAUDE.md`; no app run needed
  because this was a documentation-only change.
- Files:
  - `CLAUDE.md`
  - `TRACKING.md`

### 2026-07-07T13:58:18Z - Add reusable experiment setup templates

- Task: SVX-000
- Branch: `master`
- Summary: Added project-scoped experiment templates. Scientists can save an
  existing experiment setup as a reusable template, and the New experiment modal
  can start from that template to prefill objective, hypothesis, protocol,
  materials, success criteria and safety notes. The API supports listing
  accessible templates, saving a template from an experiment, and server-side
  template defaults when creating an experiment.
- Reference scan: LabArchives calls out customizable templates for scientists,
  and eLabFTW exposes Templates as a core user-guide area; this closes a
  repeat-protocol workflow gap for lab scientists without replacing the existing
  Planner module.
- Validation: Added failing static UI and API/migration coverage first, then
  made it pass. Bundled Node focused `tests\experiment-entry-delete-ui.test.js`
  and `tests\mvp-api.test.js` passed, and bundled Node `--test` passed with
  42 tests. Chrome and Computer Use setup were attempted first but both
  connectors rejected the WSL workspace URI. Rendered Edge/Playwright smoke
  verified registration, saving an experiment as a template, opening New
  experiment, selecting the template, seeing setup fields prefilled, creating
  the derived experiment, mobile rendering without horizontal overflow, and no
  unexpected console errors; the only console event was the expected initial
  unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-template-smoke-1783432677863\template-save-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-template-smoke-1783432677863\template-new-experiment-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-template-smoke-1783432677863\template-created-experiment.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-template-smoke-1783432677863\template-created-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/experiments.js`
  - `public/js/api.js`
  - `public/js/views/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T13:50:24Z - Add OCR correction review and raw text provenance

- Task: SVX-000
- Branch: `master`
- Summary: OCR capture now opens a review panel with editable corrected OCR
  text and read-only raw OCR output. Saving an OCR entry preserves the raw OCR
  text as a hidden `ocr_raw_text` source entry, links it to the corrected OCR
  notebook entry, hides it from normal experiment/library lists, and labels the
  source modal as "Raw OCR output".
- Reference scan: LabArchives emphasizes image annotation and connected
  metadata/context for scientific notebook data, while eLabFTW presents
  experiments, resources, scheduler, templates, inventory and metadata as core
  user guide areas; the OCR change keeps scan evidence and corrected text
  connected for review instead of silently mixing raw OCR into notes.
- Validation: Added failing static UI and API coverage first, then made it
  pass. Bundled Node focused `tests\experiment-entry-delete-ui.test.js` and
  `tests\mvp-api.test.js` passed, and bundled Node `--test` passed with
  40 tests. Chrome and Computer Use setup were attempted first but both
  connectors rejected the WSL workspace URI. Rendered Edge/Playwright smoke
  verified registration, experiment navigation, Upload scan, OCR review panel,
  corrected-text save, hidden raw OCR source modal, mobile rendering without
  horizontal overflow, and no unexpected console errors; the only console event
  was the expected initial unauthenticated `/api/auth/me` 401.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-review-smoke-1783432205656\ocr-review-panel.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-review-smoke-1783432205656\ocr-saved-entry.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-review-smoke-1783432205656\ocr-raw-source-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-review-smoke-1783432205656\ocr-mobile-entry.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/entries.js`
  - `src/routes/experiments.js`
  - `public/css/styles.css`
  - `public/js/views/entries.js`
  - `public/js/views/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T13:41:05Z - Tighten mandatory frontend browser checks

- Task: SVX-000
- Branch: `master`
- Summary: Updated `CLAUDE.md` so browser verification is explicitly a hard
  rule for every task that touches or could affect the browser experience,
  including small copy/style/client changes and frontend-facing API behavior.
- Validation: Documentation-only change; reviewed the resulting diff.
- Files:
  - `CLAUDE.md`
  - `TRACKING.md`

### 2026-07-07T13:37:35Z - Add inventory resource reservations

- Task: SVX-000
- Branch: `master`
- Summary: Added lightweight scheduling for shared lab resources from Inventory.
  Items now expose upcoming reservations and next-booking status, scientist+
  users can reserve a resource with start/end/purpose, overlapping bookings are
  rejected, reservers/admins can cancel bookings, and reservation/cancellation
  actions are audit logged.
- Reference scan: LabArchives and eLabFTW both surface scheduling/resource
  booking alongside ELN/inventory workflows, so this closes a practical lab
  workflow gap without adding a separate scheduler module yet.
- Validation: Added failing API/static UI coverage first, then made it pass.
  Bundled Node focused `tests\inventory-reservations.test.js` and
  `tests\inventory-ui.test.js` passed, and bundled Node `--test` passed with
  39 tests. Rendered Edge/Playwright smoke verified the Inventory page, Reserve
  modal, successful booking display, overlap 409 rejection, cancel flow, mobile
  card layout without horizontal overflow, and no unexpected console errors.
  Chrome and Computer Use setup were attempted first but both connectors
  rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-reservation-smoke\inventory-reservation-before.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-reservation-smoke\inventory-reservation-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-reservation-smoke\inventory-reservation-booked.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-reservation-smoke\inventory-reservation-cancelled.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-reservation-smoke\inventory-reservation-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/db.js`
  - `src/routes/inventory.js`
  - `public/js/api.js`
  - `public/js/views/inventory.js`
  - `tests/inventory-reservations.test.js`
  - `tests/inventory-ui.test.js`

### 2026-07-07T13:29:59Z - Keep voice lab-report drafting usable offline

- Task: SVX-000
- Branch: `master`
- Summary: Voice Draft report now works when OpenAI is not configured. The API
  falls back to a deterministic local template that uses only the experiment
  objective, raw notes and transcript, records `LOCAL_VOICE_DRAFT` in audit, and
  returns `model: local-template`. The experiment composer keeps Draft report
  enabled for source-backed notes and labels the offline review state as
  `Local draft`.
- Validation: Added failing API/static UI coverage first, then made it pass.
  Bundled Node focused `tests\voice-draft-offline.test.js` and
  `tests\experiment-entry-delete-ui.test.js` passed, and bundled Node `--test`
  passed with 37 tests. Rendered Edge/Playwright smoke with no `OPENAI_API_KEY`
  verified the Draft report button is enabled, the review panel shows
  `Local draft`, local report sections are generated, source notes remain
  inspectable, saving creates a source-linked voice entry, mobile has no
  horizontal overflow, and no relevant console errors occurred. Chrome and
  Computer Use setup were attempted first but both connectors rejected the WSL
  workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-offline-smoke\voice-offline-capture.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-offline-smoke\voice-offline-review.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-offline-smoke\voice-offline-saved.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-offline-smoke\voice-offline-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/ai.js`
  - `public/js/views/experiments.js`
  - `tests/voice-draft-offline.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-07T13:25:31Z - Make browser checks explicit in CLAUDE.md

- Task: SVX-000
- Branch: `master`
- Summary: Tightened the mandatory browser verification guidance so frontend
  or user-facing completion claims require opening the running app and checking
  the visible flow in a real browser, not just relying on static tests,
  existing screenshots, API tests or code inspection.
- Validation: Documentation-only change; reviewed `CLAUDE.md` wording.
- Files:
  - `CLAUDE.md`
  - `TRACKING.md`

### 2026-07-07T13:22:00Z - Keep experiment side panels in one sidebar

- Task: SVX-000
- Branch: `master`
- Summary: Experiment detail now wraps AI assistant, Integrity and References
  in a single right-side sidebar column instead of letting the two-column grid
  place those cards into separate grid cells. Added grid shrink rules so the
  same layout stacks without horizontal overflow on mobile.
- Validation: Added failing static UI coverage first, then made it pass.
  Bundled Node focused `tests\experiment-entry-delete-ui.test.js` passed, and
  bundled Node `--test` passed with 36 tests. Rendered Edge/Playwright smoke
  verified experiment detail page identity, non-blank render, exactly two direct
  split children, a three-card sidebar containing AI assistant, Integrity and
  References, AI quick-action prompt population, no desktop overflow, mobile
  one-column split layout, no mobile overflow, and no relevant console errors.
  Chrome and Computer Use setup were attempted first but both connectors
  rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-experiment-sidebar-smoke\experiment-sidebar-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-experiment-sidebar-smoke\experiment-sidebar-ai-action.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-experiment-sidebar-smoke\experiment-sidebar-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-07T13:05:16Z - Make Entries Library metadata scannable

- Task: SVX-000
- Branch: `master`
- Summary: Entries Library rows now show labelled metadata cards for experiment,
  project, created time, author and fingerprint instead of a dense unlabelled
  header, improving reviewability of notebook records and generated-source rows.
- Validation: Added failing static UI coverage first, then made it pass.
  Bundled Node focused `tests\entries-ui.test.js` passed, and bundled Node
  `--test` passed with 35 tests. Rendered Edge/Playwright smoke verified the
  Entries Library page identity, non-blank render, visible labelled metadata,
  removal of the old dense row header, no metadata overflow, source-chip modal
  interaction, mobile one-column metadata layout, and no relevant console
  errors. Chrome and Computer Use setup were attempted first but both connectors
  rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entries-metadata-smoke\entries-metadata-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entries-metadata-smoke\entries-metadata-source-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entries-metadata-smoke\entries-metadata-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/entries.js`
  - `tests/entries-ui.test.js`

### 2026-07-07T12:47:21Z - Clarify mandatory browser frontend checks

- Task: SVX-000
- Branch: `master`
- Summary: Strengthened `CLAUDE.md` so future frontend or user-facing changes
  must be checked in a real browser before claiming completion, with static/API
  tests explicitly called out as insufficient on their own.
- Validation: Documentation-only change; reviewed `CLAUDE.md` wording and no
  app smoke test was required.
- Files:
  - `CLAUDE.md`
  - `TRACKING.md`

### 2026-07-07T12:44:22Z - Make Entries Library source chips inspectable

- Task: SVX-000
- Branch: `master`
- Summary: Entries Library provenance chips are now clickable. If the source row
  is visible the library scrolls to and highlights it; if the source is hidden,
  such as a raw voice transcript, the chip opens a read-only source modal with
  the source text, type and fingerprint.
- Validation: Added failing static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 34 tests. Rendered Edge/Playwright smoke
  verified a sourced voice entry in Entries Library, confirmed the hidden raw
  transcript was not shown inline, opened the source transcript modal from the
  chip, checked fingerprint visibility, checked mobile rendering, and found no
  unexpected console errors. Chrome and Computer Use setup were attempted first
  but both connectors rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entries-source-smoke\entries-source-library.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entries-source-smoke\entries-source-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-entries-source-smoke\entries-source-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/entries.js`
  - `tests/entries-ui.test.js`

### 2026-07-07T12:39:55Z - Make inventory usable on mobile

- Task: SVX-000
- Branch: `master`
- Summary: Inventory now keeps the desktop table for wide screens but switches
  to mobile reagent cards on phone-sized viewports. Each card keeps status,
  quantity/reorder level, location, lot, expiry, and Stock/Edit controls visible
  without horizontal side-scrolling.
- Validation: Added failing static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 33 tests. Rendered Edge/Playwright smoke
  verified desktop table rendering, mobile card rendering with the table hidden,
  visible status and Stock/Edit actions inside the viewport, a mobile Stock
  adjustment, and no unexpected console errors. Chrome and Computer Use setup
  were attempted first but both connectors rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-mobile-smoke\inventory-mobile-desktop-table.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-mobile-smoke\inventory-mobile-cards.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-mobile-smoke\inventory-mobile-stock-updated.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/inventory.js`
  - `tests/inventory-ui.test.js`

### 2026-07-07T12:34:48Z - Reject negative inventory stock fields

- Task: SVX-000
- Branch: `master`
- Summary: Inventory create/edit now rejects negative quantity and reorder-level
  values at the API boundary, and the item modal mirrors the rule with
  non-negative number inputs plus inline validation before save.
- Validation: Added failing API and static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 32 tests. Rendered Edge/Playwright smoke
  verified negative create quantity and reorder-level errors, direct API 400s,
  valid create persistence, negative edit rejection with unchanged stored
  quantity, mobile rendering, and no unexpected console errors. Chrome/Computer
  setup was attempted first but the connector rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-negative-smoke\inventory-negative-create-quantity.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-negative-smoke\inventory-negative-create-reorder.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-negative-smoke\inventory-negative-valid-create.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-negative-smoke\inventory-negative-edit.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-negative-smoke\inventory-negative-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/inventory.js`
  - `public/js/views/inventory.js`
  - `tests/inventory-role.test.js`
  - `tests/inventory-ui.test.js`

### 2026-07-07T12:28:15Z - Reject impossible inventory consumption

- Task: SVX-000
- Branch: `master`
- Summary: Inventory stock adjustments now reject consume deltas larger than the
  available quantity with a clear insufficient-stock error. The Stock modal
  mirrors this with inline validation before submission, while valid consumption
  still updates quantity and audit history normally.
- Validation: Added failing API and static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 31 tests. Rendered Chromium headless-shell
  smoke verified the insufficient-stock modal warning, API 409 with unchanged
  quantity, a valid consume that updates the table, mobile rendering, and no
  unexpected console errors. Chrome/Computer setup was attempted first but the
  connector rejected the WSL workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-stock-smoke\scivox-inventory-insufficient-stock.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-stock-smoke\scivox-inventory-valid-consume.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-stock-smoke\scivox-inventory-stock-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/inventory.js`
  - `public/js/views/inventory.js`
  - `tests/inventory-role.test.js`
  - `tests/inventory-ui.test.js`

### 2026-07-07T12:22:35Z - Carry inventory evidence through planned materials

- Task: SVX-000
- Branch: `master`
- Summary: Planner materials selected from Inventory now show inline reagent
  evidence (lot, catalogue number, location, available stock, expiry and status)
  and starting the plan carries those details into the experiment setup and the
  seeded plan snapshot entry.
- Validation: Added failing API and static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 30 tests. Rendered Chromium headless-shell
  smoke verified selecting a low-stock antibody in the Planner, seeing the
  inventory warning, starting the plan as an experiment, and seeing the
  inventory evidence on desktop and mobile with no unexpected console errors.
  Chrome/Computer setup was attempted first but the connector rejected the WSL
  workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-planner-inventory-smoke\scivox-planner-inventory-evidence.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-planner-inventory-smoke\scivox-planner-inventory-experiment.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-planner-inventory-smoke\scivox-planner-inventory-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/planner.js`
  - `src/routes/plans.js`
  - `tests/planner-start.test.js`
  - `tests/planner-inventory-ui.test.js`

### 2026-07-07T12:14:57Z - Gate reviewer signature meanings by project role

- Task: SVX-000
- Branch: `master`
- Summary: Reviewer and approval signature meanings now require reviewer-or-higher
  project access. Scientist project members can still apply author signatures,
  but the API rejects review/approval signatures and the sign modal disables
  those options with a role hint.
- Validation: Added failing API and static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 28 tests. Rendered Chromium headless-shell
  smoke verified scientist-disabled reviewer/approval options, deliberate 403
  from reviewer signing as a scientist, successful author signing, successful
  reviewer signing, desktop/mobile screenshots and no unexpected console errors.
  Chrome/Computer setup was attempted first but the connector rejected the WSL
  workspace URI.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-signature-role-smoke\scivox-signature-scientist-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-signature-role-smoke\scivox-signature-reviewer-signed.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-signature-role-smoke\scivox-signature-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/entries.js`
  - `public/js/views/experiments.js`
  - `tests/signature-role.test.js`
  - `tests/experiment-entry-delete-ui.test.js`

### 2026-07-07T12:05:28Z - Preserve plan setup when starting experiments

- Task: SVX-000
- Branch: `master`
- Summary: Starting an experiment from a plan now carries over the plan
  hypothesis, numbered protocol steps, material list and expected outcome into
  the experiment setup, and seeds a hashed `plan` entry containing the original
  variables, steps and materials for reviewable provenance.
- Validation: Added failing API coverage first, then made it pass. Bundled Node
  `--test` passed with 26 tests. Rendered Chromium headless-shell smoke started
  a planned protocol from the Planner screen and verified the generated
  experiment page shows the copied setup and plan snapshot entry on desktop and
  mobile, with no unexpected console errors. Chrome and Computer Use setup were
  attempted first but failed on the WSL workspace URI bridge.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-planner-start-smoke\scivox-planner-start-before.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-planner-start-smoke\scivox-planner-start-experiment.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-planner-start-smoke\scivox-planner-start-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/plans.js`
  - `tests/planner-start.test.js`

### 2026-07-07T12:01:11Z - Make inventory read-only for viewer accounts

- Task: SVX-000
- Branch: `master`
- Summary: Inventory remains readable to authenticated users, but create, edit,
  consume/restock, and delete operations now require a scientist-or-higher
  account role. The Inventory screen mirrors this with a read-only hint and
  disabled Add, Stock, and Edit controls for broad viewer accounts.
- Validation: Added failing API and static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 25 tests. Rendered Chromium headless-shell
  smoke verified viewer read-only controls and API 403, scientist add-item flow,
  mobile viewer layout, and no unexpected console errors. Chrome and Computer
  Use setup were attempted first but failed on the WSL workspace URI bridge.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-role-smoke\scivox-inventory-viewer-readonly.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-role-smoke\scivox-inventory-scientist-editable.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-inventory-role-smoke\scivox-inventory-viewer-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/inventory.js`
  - `public/js/views/inventory.js`
  - `tests/inventory-role.test.js`
  - `tests/inventory-ui.test.js`

### 2026-07-07T11:55:54Z - Audit evidence upload writes

- Task: SVX-000
- Branch: `master`
- Summary: Successful OCR and figure evidence uploads now write project-scoped
  `UPLOAD_EVIDENCE` audit events after the file is stored, including the
  evidence kind, original filename, experiment id, stored URL, byte size, and a
  SHA-256 hash of the uploaded file.
- Validation: Added failing API audit coverage first, then made it pass.
  Bundled Node `--test` passed with 23 tests. Rendered Chromium headless-shell
  smoke verified viewer upload rejection, scientist upload success, locked
  upload rejection, no unexpected console errors, and a visible
  `UPLOAD_EVIDENCE` audit row with a file hash.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-viewer.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-scientist.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-locked.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/uploads.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T11:51:51Z - Guard OCR and figure evidence uploads

- Task: SVX-000
- Branch: `master`
- Summary: Added server-side authorization for experiment evidence uploads so
  OCR/figure raw and processed images require scientist project access and an
  unlocked experiment before files are stored. Rejected uploads now remove the
  temporary multer file before returning the error.
- Validation: Added failing upload-permission API coverage first, then made it
  pass. Bundled Node `--test` passed with 23 tests. Rendered Chromium
  headless-shell smoke verified viewer upload controls are absent and API upload
  returns 403, scientist upload controls are visible and API upload returns 201,
  locked experiments hide upload controls and API upload returns 409, including
  mobile scientist layout, with no unexpected console errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-viewer.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-scientist.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-locked.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-upload-access-smoke\scivox-upload-access-mobile.png`
- Files:
  - `TRACKING.md`
  - `src/routes/uploads.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T11:47:05Z - Align experiment controls with project roles

- Task: SVX-000
- Branch: `master`
- Summary: Added explicit project access metadata to project/experiment API
  responses, made reference add/import/delete require scientist access on
  unlocked experiments, made locked experiments immutable through normal edit
  APIs, and updated experiment/detail/reference controls so viewer, scientist,
  reviewer and admin states match backend permissions.
- Validation: Added failing API/static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 23 tests. Rendered Chromium headless-shell
  smoke logged in as viewer, scientist and reviewer, verified viewer read-only
  controls, scientist write-but-no-lock controls, reviewer lock controls,
  locked read-only state, mobile viewer layout, and no relevant console errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-access-smoke\scivox-role-access-viewer.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-access-smoke\scivox-role-access-scientist.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-access-smoke\scivox-role-access-reviewer-locked.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-access-smoke\scivox-role-access-viewer-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/experiments.js`
  - `src/db.js`
  - `src/routes/experiments.js`
  - `src/routes/references.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T11:34:59Z - Explain project role capabilities in member management

- Task: SVX-000
- Branch: `master`
- Summary: Replaced the terse project-role hint with a reusable role capability
  matrix in the Projects member panel and add/update member modal. Member rows
  now show readable role labels and descriptions on desktop, while mobile keeps
  rows compact and relies on the stacked matrix for permissions detail.
- Validation: Added failing static UI coverage first, then made it pass.
  Bundled Node `--test` passed with 22 tests. Rendered Chromium headless-shell
  smoke registered admin/scientist accounts, created a project, assigned a
  reviewer membership, verified the matrix in the project detail and modal,
  checked mobile layout, and found no relevant console errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-matrix-smoke\scivox-role-matrix-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-matrix-smoke\scivox-role-matrix-modal.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-role-matrix-smoke\scivox-role-matrix-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/projects.js`
  - `tests/user-archive-ui.test.js`

### 2026-07-07T11:27:47Z - Add voice-to-lab-report drafting

- Task: SVX-000
- Branch: `master`
- Summary: Added a `lab_report` voice drafting template and a visible
  "Draft report" composer action so raw dictated notes can be converted into
  structured Objective, Method, Results/Observations, Deviations/Uncertainty,
  and Next Actions sections while preserving the raw notes/transcript as hidden
  source evidence.
- Validation: Added failing API/static UI tests first, then made them pass.
  Bundled Node `--test` passed with 21 tests. Rendered Chromium headless-shell
  smoke typed raw notes, clicked "Draft report", verified the lab-report review
  draft, opened source evidence, saved the entry, confirmed the source link, and
  checked desktop/mobile layouts with no relevant console errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-report-smoke\scivox-voice-report-review.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-report-smoke\scivox-voice-report-saved.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-voice-report-smoke\scivox-voice-report-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/js/views/experiments.js`
  - `src/routes/ai.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T11:22:05Z - Preserve OCR source and processed image evidence

- Task: SVX-000
- Branch: `master`
- Summary: Updated OCR capture so entries preserve both the original scan and
  the processed OCR image, store them under OCR-specific upload folders, render
  them as labelled evidence on experiment entries, and emit `ADD_OCR_ENTRY`
  audit records.
- Validation: Added failing OCR evidence tests first, then made them pass.
  Bundled Node `--test` passed with 21 tests. Rendered Chromium headless-shell
  smoke opened an OCR experiment, verified loaded original/processed OCR images,
  checked desktop/mobile layouts, and found no relevant console errors.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-smoke\scivox-ocr-evidence-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ocr-smoke\scivox-ocr-evidence-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/ocr.js`
  - `public/js/views/experiments.js`
  - `src/routes/experiments.js`
  - `src/routes/uploads.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T11:12:13Z - Strengthen browser verification guidance

- Task: SVX-000
- Branch: `master`
- Summary: Promoted frontend browser checks into a dedicated mandatory
  verification section in `CLAUDE.md`, including Computer Use preference,
  Playwright/Chromium fallback, interaction, console and screenshot reporting
  requirements.
- Validation: Documentation-only change; reviewed `CLAUDE.md` instructions.
- Files:
  - `TRACKING.md`
  - `CLAUDE.md`

### 2026-07-07T11:09:47Z - Add experiment AI quick actions

- Task: SVX-000
- Branch: `master`
- Summary: Made the experiment AI assistant use structured setup metadata in
  its server-side context and added quick prompt actions for summarizing the
  record, checking missing setup, troubleshooting, and suggesting next steps.
- Validation: Bundled Node `--test` passed with 20 tests; rendered Chromium
  headless-shell smoke opened an experiment, verified the four prompt actions,
  clicked "Check missing setup", confirmed prompt text insertion, and captured
  desktop/mobile views with no relevant console issues.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ai-quick-actions-desktop.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-ai-quick-actions-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/experiments.js`
  - `src/routes/ai.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

### 2026-07-07T11:03:02Z - Add structured experiment setup metadata

- Task: SVX-000
- Branch: `master`
- Summary: Added structured setup fields to experiments so scientists can record
  hypothesis, protocol/method, materials/reagents, success criteria, and safety
  notes during create/edit, view them on the experiment page, search across
  them, and carry them into JSON/HTML/PDF exports.
- Validation: Bundled Node `--test` passed with 19 tests; rendered Chromium
  headless-shell smoke created an experiment through the SPA and verified the
  Study setup section on desktop and mobile with no relevant console issues.
- Browser evidence:
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-experiment-setup-detail.png`
  - `C:\Users\s1732775\AppData\Local\Temp\scivox-experiment-setup-mobile.png`
- Files:
  - `TRACKING.md`
  - `public/css/styles.css`
  - `public/js/views/experiments.js`
  - `src/db.js`
  - `src/routes/experiments.js`
  - `tests/experiment-entry-delete-ui.test.js`
  - `tests/mvp-api.test.js`

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
