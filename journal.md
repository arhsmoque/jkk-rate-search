# Journal — JKK Rate Search

Living record of decisions, reasoning, and context. Not a changelog.
For what exists now, read `AGENTS.md`. For what changed when, read `git log`.
This is for understanding *why* — the weight behind decisions, what was tried and rejected, what the user wanted and why it matters.

---

## 260527 — Project origin

Built by Kimi agent, output folder `D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa`. The brief was a searchable offline-capable PWA for JKR's Jadual Kadar Kerja (JKK) price schedules — Civil, Electrical, and Pukal editions. These are the reference documents Malaysian contractors use for tender pricing.

The JKR official portal (`jkr.gov.my/page/jadual-kadar-harga`) returns 403 for public access. The only reliable public source is Construction Professionals Malaysia (`construction.org.my/jabatan-kerja-raya-jkr/`), which mirrors the PDFs on Google Drive.

The app loads the entire JKK dataset from a SQLite file, caches it in IndexedDB after first download, and does all search in-memory in the browser. No backend. No API keys. No server round-trips on search.

---

## Why no build step

The entire deployable site is `public/`. What you see in the repo is exactly what gets served. This was intentional — it means any agent can make a change and push without needing to know a build pipeline, run an install, or understand a bundler config. The cost is that the vendor WASM and the DB file live in git, which bloats history slightly. Worth it.

`wrangler.jsonc` tells Cloudflare Workers to serve `./public` as static assets. Push to `main`, it deploys. That's the entire pipeline.

---

## Why the DB is in git

The DB (`public/assets/jkk-master.db`) is a generated SQLite file derived from the JKK PDFs. It's committed to git because there is no build step — Cloudflare Workers Static Assets just serves whatever is in `./public`. There is no pre-deploy hook, no CI build command, no artifact storage. If the DB weren't in git, the deployed site would have no data.

This was initially flagged as a problem ("binary blob in git") but that was wrong. The correct mental model: the DB is a data artifact, and git is the deployment vehicle. When new JKK editions are released, the DB is rebuilt externally and committed here.

---

## Why Workers, not Pages

Early config used `pages_build_output_dir` (Cloudflare Pages style). This fails with Workers Static Assets because the Workers runtime expects an `assets` block pointing at the static directory, not a Pages build output path. A Pages config produces a "no entry point / Missing entry-point" error at deploy time because Workers needs an entry point.

The GitHub integration for this repo is registered as a **Workers** service ("Workers Builds"), not a Pages project. They look similar but are different Cloudflare products with different `wrangler.jsonc` shapes. Do not switch back to Pages config. The hard rule in AGENTS.md exists because this mistake is easy to make and silent until deploy.

---

## Why sql.js instead of a server-side search API

The brief was offline-capable. A server-side search API requires network. sql.js runs SQLite in the browser via WASM — the entire DB (~1 MB) is downloaded once, cached in IndexedDB, and all subsequent searches are local. Zero latency on search, works on a plane.

The tradeoff: the DB file is ~1 MB on first load. Acceptable for a professional reference tool where users expect to wait once.

---

## Why in-memory search instead of FTS5

The vendored `sql-wasm.js` build does not include the FTS5 extension. The DB schema has an `fts5` table from when FTS5 was the plan, but calling `MATCH` on it throws `"no such module: fts5"` at runtime. The in-memory prefix + Levenshtein fuzzy search was written as a replacement.

The in-memory approach works well because the dataset is small (~2.4k items). A full fuzzy scan over 2.4k items runs in milliseconds even on low-end mobile. If the dataset ever grows significantly (say, 50k+ items), revisit: either compile a custom sql.js with FTS5 enabled (`-DSQLITE_ENABLE_FTS5`), or use fts4 which is included in the default sql.js build.

Do not reintroduce `MATCH` against the current vendored build — it throws, silently breaks search.

---

## The patch scripts — agent tools, not human tools

The `scripts/patch-*.ps1` files were written alongside the app as a scripted interface for changing the most common things without reading source. Early documentation described them as "for humans running one-off CLI patches" — this was wrong framing.

The user clarified the intent explicitly (260531):

> "the script for patching was not meant for user, its meant for agent, instead of dive deep into codebases, call the script, pass to it the parameters, and it get done, token cheap, agent as orchestrator and think tank rather than mechanics, thats the intention"

The correct mental model: an agent reads the task from the user, reasons about what needs to change, then calls a patch script with parameters. The script handles all file I/O, regex, encoding, and output. The agent never reads the source files for routine changes.

Before this was clarified, an agent session manually edited three `href=` attributes in `index.html` by reading the file, grep-ing, and making three separate edits. The correct call would have been:

```powershell
pwsh -File scripts/patch-ui-text.ps1 -CivilHref "..." -ElectricalHref "..." -PukalHref "..." -Json
```

After clarification: `-CivilHref`, `-ElectricalHref`, `-PukalHref` were added to `patch-ui-text.ps1`, along with `-PageTitle`, `-MetaDescription`, `-DownloadsNote`. All three scripts got a `-Json` flag with a shared output contract so agents can parse results without string matching.

---

## The edit map — two versions, one correct

The first edit map added to AGENTS.md (260531) pointed agents at source file paths and line numbers:

> `| PDF download links | public/index.html:86 | href= on <a class="download-card"> |`

This was wrong. It required the agent to read the source file to make the change — exactly what the patch scripts exist to prevent.

The corrected edit map shows script calls with parameters. An agent reading it goes: "I need to update a PDF link → call `patch-ui-text.ps1 -CivilHref`" without opening any file.

---

## PDF download links — source

The three card links point to Google Drive files hosted by Construction Professionals Malaysia. The official JKR portal returns 403. Links sourced from `jkr_links.md` (a curated reference file the user maintains), verified 2026-05-27.

- Civil 2023: `1eeD9PtgX5xZteEEEt50dE3j-bxNksrZP`
- Electrical 2023: `18S6gpNRy3QQPSK4xjUyFZ1CZT6BbItlx`
- Pukal (undated): `12skCTyZIJa7clStwVaHFEL7ZdsCUop5K`

If these links break, check `construction.org.my/jabatan-kerja-raya-jkr/` for the current mirrors.

---

## On AGENTS.md — philosophy

The user's position (260531):

> "agents.md and any docs doesnt have change log annotation? it should only reflect latest state to cut noises for stateless agent, when doing task they dont need to know whats changed, they need to know where to go to do what"

> "journal.md is different from changelog.md which serve purely as transcription without the soul, to understand the gravity and weight, read the journal.md"

AGENTS.md is a stateless reference. It describes what is true now. It should not contain "was renamed", "previously X", "added in session Y", or any other temporal language. If something is no longer true, update or remove the line. History lives here and in `git log`.

This journal is where reasoning goes. Decisions that look arbitrary from the outside (why Workers not Pages, why in-memory not FTS5, why scripts not direct edits) have explanations here so future agents and future maintainers understand the weight behind them — not just the rule, but why the rule exists.

---

## DB rebuild path — external dependency note

The rebuild scripts live outside this repo at:
`D:\00_ARH\_agent-output\260527-08_web_kimi_jkk-rate-search-pwa\scripts\`

This is a fragile reference. If that folder moves or is cleaned up, the rebuild path in AGENTS.md goes stale. The scripts should eventually be moved into `scripts/` in this repo. Until then, if a future agent can't find them, check git history of the output folder or ask the user to regenerate from the original Kimi agent session.
