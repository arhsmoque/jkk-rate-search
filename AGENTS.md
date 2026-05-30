# AGENTS.md — JKK Rate Search

Operating instructions for coding agents. Read this before touching any file.
For human onboarding, read `README.md` instead.

Governing protocol: [AODP v1.7](D:\00_ARH\.ARH-AGENT-ENV\_environment-kernel\ARH Universal Design Charter\universal-base-adapter-protocol\AODP_CORE.md)

---

## Agent quick commands

```powershell
# Local smoke test (serve the deployable assets)
cd public; python -m http.server 8000
# Then open http://localhost:8000

# Rebuild database (after PDF updates)
cd ..\..\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa
pwsh -File scripts/build-static-site.ps1

# Validate before deploy
pwsh -File scripts/validate-deployment.ps1
```

---

## Architecture in one paragraph

Zero-build static PWA. SQLite database (with FTS5) runs in-browser via sql.js WASM. Data is cached in IndexedDB after first download. The deployable site lives in `public/`, served as an assets-only Cloudflare Worker (Workers Static Assets). No backend, no API keys, no Firebase.

---

## File roles

All served files live under `public/` (= site root). Tooling/docs stay at repo root.

| File | AODP role | Who edits it |
|---|---|---|
| `public/index.html` | **Base** — entry point + CSP | Engine changes only |
| `public/app.js` | **Base** — search logic, storage, UI | Engine changes only |
| `public/styles.css` | **Base** — stylesheet | Engine changes only |
| `wrangler.jsonc` | **Adapter** — deployment config (serves `./public`) | Infra changes only |
| `public/service-worker.js` | **Adapter** — offline cache | Cache strategy changes |
| `public/manifest.webmanifest` | **Adapter** — PWA manifest | App metadata changes |
| `public/assets/jkk-master.db` | **Data** — generated SQLite | Rebuilt by extractor only |

---

## Critical invariants

### 1. `app.js` must not hardcode DB schema

The SQL queries live in the `SearchPort` and `build_search_query` functions. If the schema changes (e.g. adding a new column), update both the extractor (`build-jkk-database.py`) AND the query builder in `app.js`.

### 2. CSP must include `'wasm-unsafe-eval'` for sql.js WASM

Current CSP in `index.html` **and** `_headers` (both must stay in sync):
```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
```

`'wasm-unsafe-eval'` is **required** — `initSqlJs()` calls `new WebAssembly.Instance()` which the browser blocks without this directive. Removing it causes a silent CSP violation and the app shows "Failed to load database."

If moving sql.js back to a CDN, add the CDN origin to both `script-src` and `connect-src`.

### 3. Offline-first caching

The service worker caches:
- App shell: `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`
- Runtime: `vendor/sql-wasm.js`, `vendor/sql-wasm.wasm`

The DB file (`assets/jkk-master.db`) is NOT cached by the service worker. It is cached by the app logic in IndexedDB. This avoids service worker cache invalidation issues when the DB updates.

### 4. FTS5 prefix matching

Search uses SQLite FTS5 with `prefix='2 3 4'` and word-level `*` suffixes. This means:
- `konkrit` matches `konkrit`, `konkrits`, `konkritting`
- It does NOT match typos like `konkrete` or `concrete`
- For typo tolerance, a future version needs trigram indexing or client-side fallback

---

## Build, test, deploy

**There is no build step.** The output is the source.

To verify the app works after a change:
1. Serve locally: `python -m http.server 8000`
2. Open `http://localhost:8000`
3. Search for `konkrit` — should return ~70 items
4. Tap a result — detail panel should show rates
5. Check DevTools console for errors

**Deploy (Cloudflare Workers Static Assets — authoritative):**

The GitHub integration for this repo is a **Workers** service ("Workers Builds").
A push to `main` triggers an automatic build+deploy of the assets-only Worker
(`wrangler.jsonc` → `assets.directory: ./public`). No build command, no script.

```powershell
# From D:\00_ARH\.ARH-Cloned-Github-Repo\jkk-rate-search
git add <files>
git commit -m "<component>: <what changed>"
git push origin main          # git integration auto-deploys
python deploy-cf-pages.py      # optional: manual deploy to the same target
```

`deploy-cf-pages.py` reads the Cloudflare API token from the ARH vault and calls
`wrangler deploy` (which reads `wrangler.jsonc`). **Always run from the repo
directory.**

**Hard rule:** `wrangler.jsonc` must stay a **Workers** config (`assets` block),
never a Pages config (`pages_build_output_dir`). The git integration is Workers —
a Pages config has no entry point and fails the build. Do NOT re-add
`pages_build_output_dir` or switch to `wrangler pages deploy`.

---

## Failure modes

| Symptom | Cause | Recovery |
|---|---|---|
| "Failed to load database. Refresh to retry." | CSP blocks WASM compilation | Verify `script-src 'self' 'wasm-unsafe-eval'` in both `index.html` and `_headers` |
| `deploy-cf-pages.py` exits with auth error 9106 | Cloudflare API token expired or wrong scope | Re-generate at https://dash.cloudflare.com/profile/api-tokens (needs Workers Scripts:Edit + Account:Read), update vault key `cloudflare_api_token` |
| Workers build fails: "no entry point" / "Missing entry-point" | `wrangler.jsonc` reverted to a Pages config (`pages_build_output_dir`) | Restore the `assets` block pointing at `./public`; remove any `pages_build_output_dir` |
| Workers build uploads `.git` or tooling files | `assets.directory` points at repo root (`.`) instead of `./public` | Keep `assets.directory` = `./public`; never serve the repo root |
| DB rebuild scripts not found | `260527-08_web_kimi_jkk-rate-search-pwa` folder missing from `_agent-output` | Scripts are at `D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa\scripts\`. If folder is gone, re-extract from git history or request rebuild from the generating agent. |

---

## Rebuilding the database

When new JKK PDFs are released:

1. Place PDFs in `D:\00_ARH\_agent-input\jkr-pdf-manuals\`
2. Run extractor:
   ```powershell
   cd D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa
   pwsh -File scripts/build-static-site.ps1
   ```
3. Copy the generated DB to this repo:
   ```powershell
   Copy-Item D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa\webapp\assets\jkk-master.db D:\00_ARH\.ARH-Cloned-Github-Repo\jkk-rate-search\public\assets\
   ```
4. Commit and push

**Note:** Existing users will keep their old IndexedDB cache until they clear site data or the app version bumps. To force a cache refresh, increment the IndexedDB key in `app.js` (`IndexedDbStorageAdapter.KEY`).

---

## Risk classification

| Surface | Risk class | Notes |
|---|---|---|
| `index.html` render | `read_only` | No mutation |
| `app.js` search | `read_only` | Queries local SQLite only |
| `app.js` IndexedDB cache | `local_mutation` | Writes DB snapshot to browser storage |
| Deploy to Cloudflare Workers | `external_mutation` | Public URL change |

---

## What not to do

- Do not add hardcoded JKK data to `app.js` or `index.html` — all data lives in the SQLite file.
- Do not add a build step or bundler. The no-dependency constraint is intentional.
- Do not store API keys or secrets in source — this app has none.
- Do not change the WhatsApp button colour (wait, this isn't fnb-webapp — there is no WhatsApp button).

---

## Commit and push policy

Agents commit and push automatically after completing a change set.

```powershell
git add <files>
git commit -m "<component>: <what changed>"
git push origin main
```

---

## Deployment target

**Cloudflare Workers — Static Assets** (assets-only Worker via `wrangler.jsonc`,
serving `./public`). The repo's GitHub integration is a Workers service, so a push
to `main` auto-deploys.

Preferred for:
- Faster global CDN (important for the ~1 MB DB file)
- Unlimited bandwidth
- Git-push auto-deploy with no separate build config
- Consistency with existing ARH infrastructure
