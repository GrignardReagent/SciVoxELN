# TODO

## Permanent Domain And OAuth

- [ ] Decide whether to register `scivoxeln.ai` or choose another permanent
  domain after the prototype is ready.
- [ ] If using `scivoxeln.ai`, buy/register the domain and point DNS at the
  production serve
- [ ] Configure the production `.env` with the permanent URL:
  `DOMAIN=scivoxeln.ai`, `BASE_URL=https://scivoxeln.ai`,
  `COOKIE_SECURE=true`, `TRUST_PROXY=1`, `FORCE_HTTPS=true`.
- [ ] Register Google OAuth callback:
  `https://scivoxeln.ai/api/auth/oauth/google/callback`
- [ ] Register GitHub OAuth callback:
  `https://scivoxeln.ai/api/auth/oauth/github/callback`
- [ ] Register WeChat OAuth callback:
  `https://scivoxeln.ai/api/auth/oauth/wechat/callback`
- [ ] Replace any temporary `trycloudflare.com` prototype URLs in OAuth provider
  dashboards once a permanent domain is chosen.
- [x] Smart search feature to help with searching for experiments done in the past in order to help decision making. — `/api/search` ranks accessible experiments, entries and references by query relevance.
- [ ] Smart LIMS / instrument connectors to get accurate data from machines.
- [x] Feature: Link to Mendeley/Zotero to reference papers. — References panel
  per experiment: add by DOI (CrossRef), import BibTeX/RIS (Zotero or Mendeley
  export), or pull directly from a Zotero library; `src/routes/references.js`.
- [x] Fix: When the user keys in the wrong password, the error message is not
  clear enough. — login now returns "Incorrect password" for a wrong password
  (and clear messages for unknown email / OAuth-only accounts).
- [x] Make this mobile friendly. — dvh height, 16px inputs (no iOS zoom),
  horizontally-scrollable tables, safe-area insets, tighter small-screen layout,
  stacked AI input, theme-color; on top of the existing nav drawer.
