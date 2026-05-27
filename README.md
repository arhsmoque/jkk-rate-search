# JKK Rate Search

A cross-platform, offline-capable PWA for searching JKR Jadual Kadar Kerja (JKK) price schedules.

🔗 **Live demo:** *(deploy via Cloudflare Pages after connecting repo)*

## What it does

- Search across **Civil & Building**, **Electrical**, and **Pukal** rate tables
- Instant prefix search via SQLite FTS5 (e.g. `scaffold*` reveals scaffolding items)
- Works offline after first load — database cached in browser IndexedDB
- No backend, no API keys, no install friction — just a URL

## Data coverage

| Document | Year | Items | Rates |
|---|---|---|---|
| JKK Awam & Bangunan (Civil) | 2023 | 904 | multi-rate (grades, materials) |
| JKK Elektrik (Electrical) | 2023 | 1,516 | single-rate |
| JKK Kerja Pukal | — | 9 | single-rate |

Civil tables include multi-rate rows (e.g. Concrete Gred 15/20/25/30/35/40).

## Tech stack

- **Frontend:** Vanilla HTML/JS/CSS, no framework, no build step
- **Database:** SQLite with FTS5, running in-browser via sql.js (WASM)
- **Persistence:** IndexedDB snapshot pattern
- **Hosting:** Cloudflare Pages (primary) / GitHub Pages (fallback)

## Usage

1. Open the deployed URL in any modern browser
2. The app downloads the database once (≈1 MB)
3. Type in the search bar — results appear instantly
4. Tap/click a result to see full rate detail
5. Add to Home Screen for app-like experience

### Keyboard shortcut

Press `/` anywhere to focus the search bar.

## Project layout

```
.
├── index.html              # Entry point + CSP
├── styles.css              # Mobile-first CSS
├── app.js                  # Core / Port / Adapter structure
├── manifest.webmanifest    # PWA manifest
├── service-worker.js       # Offline shell caching
├── wrangler.jsonc          # Cloudflare Pages config
├── AGENTS.md               # Operating rules for agents
├── METADATA.yml            # AODP artifact declaration
├── vendor/
│   ├── sql-wasm.js         # sql.js engine (vendored for offline)
│   └── sql-wasm.wasm       # sql.js WASM binary
└── assets/
    └── jkk-master.db       # Generated SQLite database
```

## Rebuilding the database

When new JKK PDFs are released, rebuild the database:

```powershell
# From the extractor workspace
cd D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa
pwsh -File scripts/build-static-site.ps1

# Then copy the new DB into this repo
Copy-Item webapp\assets\jkk-master.db D:\00_ARH\.ARH-Cloned-Github-Repo\jkk-rate-search\assets\
git add assets/jkk-master.db
git commit -m "data: update JKK database"
git push origin main
```

## Deployment

### Cloudflare Pages (recommended)

1. Connect this GitHub repo to [Cloudflare Pages](https://dash.cloudflare.com)
2. Set build output directory to `/` (root)
3. Deploys automatically on every push to `main`

### GitHub Pages (fallback)

1. Go to repo Settings → Pages
2. Source: Deploy from a branch → `main` / root
3. Push to `main`

## Notes

- First load requires internet to download the DB and sql.js WASM
- Subsequent loads work fully offline
- Private browsing may block IndexedDB; the app will re-download each session
- FTS5 uses prefix matching (`scaffold*`), not typo-tolerant fuzzy search

## License

Data sourced from publicly available JKR documents. Code: MIT.
