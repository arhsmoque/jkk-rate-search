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
- **Hosting:** Cloudflare Workers Static Assets (assets-only Worker, auto-deploy on push)

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
├── public/                 # Served assets (= site root). assets.directory in wrangler.jsonc
│   ├── index.html          # Entry point + CSP
│   ├── styles.css          # Mobile-first CSS
│   ├── app.js              # Core / Port / Adapter structure
│   ├── manifest.webmanifest# PWA manifest
│   ├── service-worker.js   # Offline shell caching
│   ├── _headers            # Security / content-type headers
│   ├── vendor/
│   │   ├── sql-wasm.js     # sql.js engine (vendored for offline)
│   │   └── sql-wasm.wasm   # sql.js WASM binary
│   └── assets/
│       └── jkk-master.db   # Generated SQLite database
├── wrangler.jsonc          # Cloudflare Workers Static Assets config
├── deploy-cf-pages.py      # Manual deploy (wrangler deploy)
├── AGENTS.md               # Operating rules for agents
└── METADATA.yml            # AODP artifact declaration
```

## Rebuilding the database

When new JKK PDFs are released, rebuild the database:

```powershell
# From the extractor workspace
cd D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa
pwsh -File scripts/build-static-site.ps1

# Then copy the new DB into this repo
Copy-Item webapp\assets\jkk-master.db D:\00_ARH\.ARH-Cloned-Github-Repo\jkk-rate-search\public\assets\
git add public/assets/jkk-master.db
git commit -m "data: update JKK database"
git push origin main
```

## Deployment

### Cloudflare Workers — Static Assets (primary)

This repo's GitHub integration is a **Workers** service ("Workers Builds"). On every
push to `main`, Cloudflare builds and deploys the assets-only Worker defined in
`wrangler.jsonc` (which serves `./public`). No build command, no Worker script.

Manual / fallback deploy from a workstation:

```powershell
python deploy-cf-pages.py   # runs `wrangler deploy`
```

> Note: the config must stay a **Workers** config (`assets`), not a Pages config
> (`pages_build_output_dir`) — the git integration is Workers, so a Pages config
> fails the build.

## Notes

- First load requires internet to download the DB and sql.js WASM
- Subsequent loads work fully offline
- Private browsing may block IndexedDB; the app will re-download each session
- FTS5 uses prefix matching (`scaffold*`), not typo-tolerant fuzzy search

## License

Data sourced from publicly available JKR documents. Code: MIT.
