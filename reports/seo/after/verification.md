# SEO Verification

## Commands Run

| Check | Result | Notes |
|---|---|---|
| `npm ci` in `/tmp/elixis-agency-build` | Pass | Installed from `package-lock.json`; npm reported existing audit findings: 1 low, 2 high. Dependencies were not changed. |
| `npm run build:styles` in `/tmp/elixis-agency-build` | Pass | Tailwind CSS v4.3.0 completed in 46ms. Generated CSS was copied back to `public/styles.css`. |
| `npm ci` in `/tmp/elixis-agency-fullcheck` | Pass | Installed from `package-lock.json`; same existing npm audit findings reported. |
| `npm run build` in `/tmp/elixis-agency-fullcheck` | Pass | Tailwind CSS v4.3.0 completed, then `tsc -p tsconfig.json` completed with exit 0. |
| `npm run lint` in `/tmp/elixis-agency-fullcheck` | Pass | `tsc -p tsconfig.json --noEmit` completed with exit 0. |
| `npm test` in `/tmp/elixis-agency-fullcheck` | Pass | 4 test files passed; 36 tests passed. |
| `node --check public/site.js` | Pass | No syntax errors. |
| `node --check scripts/setDemoUrl.mjs` | Pass | No syntax errors. |
| `xmllint --noout public/sitemap.xml` | Pass | XML is valid. |
| Targeted `git diff --check` on edited source/docs | Pass | Full `git diff --check` over generated minified CSS was avoided after earlier git timeouts. |
| Direct trailing whitespace scan on edited source/docs | Pass | No trailing whitespace found. |
| Refined secret scan on public/frontend/docs/reports | Pass | No API keys, provider secrets, or private keys found. |
| Disallowed path mtime scan | Pass | No changed files found under protected paths after setup notes were created. |
| `npm run build` in Documents checkout | Stalled | Stopped after 30s. Stalled at Tailwind startup in local Documents workspace. |
| `npm run lint` in Documents checkout | Stalled | Stopped after 30s. Stalled at `tsc -p tsconfig.json --noEmit`. |
| `npm test` in Documents checkout | Stalled | Stopped after 30s. Stalled at Vitest startup. |

## Browser QA

Local static server:

```text
python3 -m http.server 4173 --directory public
```

In-app Browser checked `http://127.0.0.1:4173` at desktop `1440x900` and mobile `390x844`.

| Route | Desktop/mobile result |
|---|---|
| `/` | One H1, zero horizontal overflow, FAQ present, schema present, updated emails present. |
| `/collections/` | One H1, zero horizontal overflow, active service link present, updated emails present, Service schema present. |
| `/demo/` | One H1, zero horizontal overflow, active service link present, Retell iframe URL populated, demo phone link uses `tel:+19842075346`. |
| `/ai-seo/` | One H1, zero horizontal overflow, active service link present, updated emails present, Service schema present. |
| `/booking/` | One H1, zero horizontal overflow, noindex retained, Cal embed iframe populated during mobile check. |

Services dropdown:

- Desktop menu opened and exposed `/collections/`, `/demo/`, `/ai-seo/`, and `/#custom-workflows`.
- Mobile menu opened and exposed the same service links.
- No horizontal overflow was detected with menus open.

Console:

- Owned-code console errors were not observed.
- Browser logs captured third-party Retell iframe warnings/errors from `agent.retellai.com`; these are outside owned site code.

Scroll:

- Computed styles on `/demo/` and `/booking/` showed `body` overflow `visible`, `.page-shell` overflow `clip visible`, and document height greater than viewport.
- Browser CUA wheel/keyboard scroll events did not move `scrollY` in this session, even after Browser reset. This appears to be a Browser input limitation in the session. The original `overflow: hidden` condition was not present.

## Production Smoke Checks

Run against `https://elixis.agency` before deployment of this change:

| URL | HTTP status |
|---|---|
| `/` | 200 |
| `/collections/` | 200 |
| `/demo/` | 200 |
| `/ai-seo/` | 200 |
| `/booking/` | 200 |
| `/health` | 200 |
| `/outbound` | 401 |
| `/api/outbound/setup/status` | 401 |
| `/retell/webhook` GET | 404 |

The `GET /retell/webhook` 404 is expected because the Express app mounts the webhook as a POST route.
