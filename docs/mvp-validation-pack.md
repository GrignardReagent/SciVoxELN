# SciVox ELN MVP Validation Pack

## Intended Use

SciVox ELN is an audit-ready electronic lab notebook for biotech R&D teams. It
supports experiment planning, hands-free record capture, OCR note capture,
inventory context, electronic signatures, project access control, and exportable
audit evidence.

This MVP is intended for non-GMP R&D pilots. It is validation-friendly, but the
software alone is not a claim of 21 CFR Part 11, GxP, GMP, GLP or predicate-rule
compliance. Regulated use requires customer SOPs, training, validation, access
review, backup procedures, and quality approval.

## User Requirements

| ID | Requirement | Evidence |
| --- | --- | --- |
| UR-001 | Authenticated users can create, view and update experiments inside allowed projects. | API tests; project membership tests |
| UR-002 | Unauthorized users cannot read experiments outside their projects. | Access-control tests |
| UR-003 | Locked experiments reject new entries. | API tests |
| UR-004 | Entries carry SHA-256 fingerprints. | DB/unit tests; export package |
| UR-005 | Signing an entry requires signer confirmation and stores signer, timestamp, meaning and signature hash. | API tests |
| UR-006 | All writes create hash-chained audit events. | Audit tests; CSV export |
| UR-007 | Experiment exports include entries, references, audit rows and export hash. | Export tests |
| UR-008 | Operators can back up and restore the data directory. | Backup/restore script test |
| UR-009 | AI and cloud STT are optional and clearly configurable. | Deployment docs |

## Risk Assessment

| Risk | Control |
| --- | --- |
| Unauthorized project access | Project memberships and server-side route checks |
| Stolen session remains usable | Server-side session rows and revocation endpoint |
| Record tampering after creation | SHA-256 entry hashes, signature hashes, audit hash chain |
| Unreviewed AI content enters notebook | AI advises only; Observe entries require review/confirm before save |
| Cloud data exposure | On-prem Whisper path; OpenAI features are optional and server-side |
| Backup loss | `npm run backup`; documented restore procedure |

## Test Protocol

1. Register the first admin and a second scientist.
2. Create a project and add the scientist as `viewer`.
3. Confirm the scientist can see the project but cannot write until promoted.
4. Promote the scientist to `scientist`; create an experiment and entry.
5. Sign the entry with password confirmation.
6. Lock the experiment as reviewer/admin; confirm entry creation returns `409`.
7. Export JSON and HTML evidence packages; verify the export hash is present.
8. Export the audit CSV and confirm hash-chain fields are present.
9. Revoke the current session; confirm authenticated API calls fail.
10. Run backup, restore into an empty data directory, and confirm the database
    and uploads are present.

## Known Limitations

- PDF/ZIP export is represented in the MVP as HTML/JSON evidence packages.
- Email verification and password reset issue server-side tokens; SMTP delivery
  is not bundled.
- Project access protects notebook records; inventory remains shared in this
  MVP.
- Current search is token-ranked, not embedding/vector semantic search.
- SQLite is the pilot datastore; larger deployments may require a Postgres
  implementation of `src/db.js`.

## Release Checklist

- `npm test` passes.
- Manual browser smoke test passes on desktop and mobile.
- `.env` uses a real `SESSION_SECRET`.
- `COOKIE_SECURE=true`, `TRUST_PROXY=1`, and HTTPS are enabled for network use.
- `STT_PROVIDER=whisper` is selected for on-prem pilots that cannot send audio
  to cloud vendors.
- Backup and restore procedure is tested for the pilot environment.
