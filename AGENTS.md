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

## Edit map — go here first

**Agent workflow: decide what to change → call the matching patch script → done.**
Scripts handle all file I/O. Pass `-Json` to get machine-readable output.
Only touch source files directly for changes not covered by a script (rate table columns, IndexedDB key, PWA manifest, wrangler config).

### `scripts/patch-ui-text.ps1` — text and PDF links

```powershell
# Update all three PDF download card links (most common task)
pwsh -File scripts/patch-ui-text.ps1 `
    -CivilHref      "https://drive.google.com/file/d/FILEID/view" `
    -ElectricalHref "https://drive.google.com/file/d/FILEID/view" `
    -PukalHref      "https://drive.google.com/file/d/FILEID/view" `
    -Json
```

| Parameter | What it patches |
|---|---|
| `-CivilHref` | `href=` on the Civil download card |
| `-ElectricalHref` | `href=` on the Elektrik download card |
| `-PukalHref` | `href=` on the Pukal download card |
| `-PageTitle` | `<title>` tag (browser tab / PWA name) |
| `-MetaDescription` | `<meta name="description" content="...">` |
| `-Title` | `<h1>` heading |
| `-Subtitle` | Subtitle `<p>` under `<h1>` |
| `-Placeholder` | Search input `placeholder=` |
| `-DownloadsNote` | `<p class="downloads-note">` caption |
| `-Footer` | `<footer>` text |

### `scripts/patch-theme.ps1` — colours and typography

```powershell
# Change brand colour
pwsh -File scripts/patch-theme.ps1 -Accent "#1a56db" -Json
```

Key parameters: `-Accent`, `-AccentLight`, `-Bg`, `-Surface`, `-Success`, `-Muted`, `-Border`, `-ChipBg`, `-ChipText`, `-FontFamily`, `-FsTitle`, `-FsBody`, `-FsItem`, `-FsMeta`, `-FsCode`, `-FsTiny`, `-FsMicro`

### `scripts/patch-search-settings.ps1` — search behaviour (app.js CONFIG block)

```powershell
# Raise result limit, tighten debounce
pwsh -File scripts/patch-search-settings.ps1 -SearchLimit 30 -Debounce 100 -Json
```

| Parameter | What it patches | Default |
|---|---|---|
| `-SearchLimit` | Max results returned | `20` |
| `-FuzzyMinSim` | Fuzzy match threshold 0.0–1.0 (lower = more lenient) | `0.6` |
| `-Debounce` | Search input debounce in ms | `150` |
| `-Locale` | Currency format locale | `"en-MY"` |
| `-DbPath` | DB asset path served to browser | `"assets/jkk-master.db"` |

### Script output contract (`-Json`)

```json
{ "status": "ok",    "changed": ["civil-href", "pukal-href"], "count": 2 }
{ "status": "ok",    "changed": [],                           "count": 0 }
{ "status": "error", "message": "File not found: ..." }
```

### Direct source edits (no script)

| What | Where |
|---|---|
| Rate table columns (add/remove/reorder) | `public/app.js` → `RATE_TABLE_COLS` array between `// ── App: RATE_TABLE_COLS` and `// END RATE_TABLE_COLS` |
| Force IndexedDB cache refresh | `public/app.js` → `IndexedDbStorageAdapter.KEY` — increment version suffix |
| PWA app name / icons | `public/manifest.webmanifest` |
| CF Worker name / compatibility date | `wrangler.jsonc` |

---

## Architecture in one paragraph

Zero-build static PWA. SQLite database is read in-browser via sql.js (WASM) and cached in IndexedDB after first download. **Search runs in-memory** (prefix match, with a Levenshtein fuzzy fallback) over the ~2.4k-row index — the vendored sql.js build has **no FTS5 module**, so the DB's `fts5` table is unused and `MATCH` must never be called. The deployable site lives in `public/`, served as an assets-only Cloudflare Worker (Workers Static Assets). No backend, no API keys, no Firebase.

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

Item/rate reads use plain `SELECT`s in `load_all_items` and `SearchPort.get_item_detail`. Search itself is in-memory (`prefix_search` / `fuzzy_search`) over the rows returned by `load_all_items`. If the schema changes (e.g. adding a new column), update both the extractor (`build-jkk-database.py`) AND `load_all_items` in `app.js`.

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

### 4. In-memory prefix + fuzzy search (NOT FTS5)

Search is pure JS over the cached `allItems` index — **do not reintroduce `MATCH`**
(the vendored sql.js has no fts5 module; `MATCH` throws "no such module: fts5").
- `prefix_search`: every query token must prefix some item token (AND semantics).
  `konkrit` matches `konkrit`, `konkrits`; `scaffold` matches `scaffolding`.
- `fuzzy_search`: runs only when prefix search returns 0 rows. Bounded Levenshtein
  per token (floor `minSim`), so `konkret`→`konkrit`, `scafold`→`scaffold`.
- If you ever need server-side FTS again, ship an sql.js build compiled with
  `-DSQLITE_ENABLE_FTS5` and re-test, or rebuild the DB with an fts4 table.

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

---

## Documentation policy

Working docs (`AGENTS.md`, `README.md`, script `.SYNOPSIS` blocks) reflect **current state only**.
No temporal annotations: no "(updated)", "(new)", "(was X)", "(added in session Y)", no version suffixes on section headings.
If something changed, update the line. History is in `git log` and `journal.md`.

**Where to record changes:**

| Type | Where |
|---|---|
| Architectural decision, rejected approach, user intent, "why not X" | `journal.md` — narrative, quoted context, reasoning |
| Routine edit (link update, colour tweak, config change, script call) | `changes.jsonl` — one JSON line per change |

**`changes.jsonl` format** (append one line per agent action, never rewrite existing lines):
```json
{"date":"YYYY-MM-DD","agent":"<model>","action":"<verb>","target":"<file or param>","note":"<one line>"}
```

Pipe patch script `-Json` output into it or write the line manually before committing.

---

## Commit and push policy

Agents commit and push automatically after completing a change set.

```powershell
git add <files>
git commit -m "<component>: <what changed>"
git push origin main
```

