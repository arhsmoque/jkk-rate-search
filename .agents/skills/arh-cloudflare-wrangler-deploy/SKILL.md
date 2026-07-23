---
name: arh-cloudflare-wrangler-deploy
description: "Deploy Cloudflare Pages and Workers from GitHub Actions using wrangler, with each deployable unit independent (path-filtered triggers, its own job) and zero local-machine dependency (auth only via GitHub Actions repo/environment secrets, never a locally-held wrangler login). Use when adding, wiring, or auditing a Cloudflare Pages or Workers deployment, standardizing CI/CD across ARH repos, converting a locally-triggered deploy into a remote/CI-only one, or wiring a background job as a scheduled Worker."
compatibility: "Requires read/write access to the target repository's .github/workflows and wrangler.toml files, and the ability to inspect or request the repo's GitHub Actions secrets (gh secret list / gh secret set)."
---

# Arh Cloudflare Wrangler Deploy

# ARH Cloudflare Wrangler Deploy

Stand up or extend a GitHub Actions -> Cloudflare deployment where every deployable unit — one
Pages app, each Worker — deploys independently and authenticates only with GitHub Actions secrets.
No unit ever depends on another unit's build succeeding, and no unit ever depends on a developer's
local machine holding a `wrangler login` session or an exported token.

## Core directive

One workflow file per deployable unit. Each workflow triggers only on changes under that unit's own
path, builds and deploys using `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from GitHub Actions
secrets, and fails fast with a clear diagnostic if those secrets are absent — never falls back to a
prompt, a cached local credential, or a silent no-op deploy.

```text
push to main (path-filtered)
→ checkout + install
→ build (app-specific)
→ verify Cloudflare secrets are present (fail fast, clear error, if not)
→ wrangler deploy (pages deploy | deploy), scoped to this unit only
```

## 1. Inventory existing deployable units

Before adding anything, find what already exists:

1. Every `wrangler.toml` / `wrangler.jsonc` in the repo (`git grep -l wrangler`), and whether each
   targets Pages (`pages_build_output_dir`) or a Worker (`main =`, `[triggers]`).
2. Every `.github/workflows/*.yml` that runs `wrangler`. Read each one fully — a working example in
   the repo is the pattern to generalize, not to replace.
3. `gh secret list` on the target repo to see which of `CLOUDFLARE_API_TOKEN`,
   `CLOUDFLARE_ACCOUNT_ID`, and any app-specific secrets (Supabase URL/keys, API keys) already
   exist. A workflow can be correctly written and still be dormant because a secret is missing —
   check both.
4. Any Node/Python script intended to run on a schedule but currently only invoked manually or via
   `npm run <script>` — these are Worker-with-cron-trigger candidates (see
   [references/worker-from-script.md](references/worker-from-script.md)).

Report what is wired-but-dormant (workflow exists, secret missing) separately from what does not
exist yet (no workflow, no wrangler.toml) — they need different fixes.

## 2. One unit, one workflow, one path filter

For each deployable unit, create or verify a workflow with:

- `on.push.branches: [main]` **and** `paths: ["<unit-root>/**"]` so unrelated changes never
  trigger it, plus `workflow_dispatch:` so it can always be run manually as a fallback.
- `concurrency.group` scoped to that unit (e.g. `deploy-<unit-name>`) with
  `cancel-in-progress: false`, so overlapping pushes queue instead of racing or clobbering an
  in-flight deploy.
- A secrets-presence check as its own step, before the deploy step, that fails with
  `::error::` output naming exactly which secret is missing and where to add it
  (Settings > Secrets and variables > Actions). Never let a missing-secret failure surface only as
  an opaque wrangler auth error deep in the deploy step.
- The deploy step itself using `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as step-scoped
  `env:`, not repository-wide `env:` — keeps the blast radius of a leaked log line to the one job.

Use [assets/pages-deploy.yml.template](assets/pages-deploy.yml.template) for a Pages app and
[assets/worker-deploy.yml.template](assets/worker-deploy.yml.template) for a Worker (cron trigger
block is optional and commented). Copy, then fill in the unit-specific build command, path filter,
and project/worker name — do not restructure the auth or fail-fast steps; that is the part that
makes this pattern reusable and safe to trust without re-reading it every time.

## 3. Wrangler config per unit

Each deployable unit gets its own `wrangler.toml` living next to its source (e.g.
`apps/<unit>/wrangler.toml`), not one shared root config once more than one unit exists — a shared
config invites one unit's settings drifting onto another's deploy. Use
[assets/wrangler.pages.toml.template](assets/wrangler.pages.toml.template) or
[assets/wrangler.worker.toml.template](assets/wrangler.worker.toml.template). Pin
`compatibility_date` explicitly; do not leave it unset.

If a repo currently has exactly one root-level `wrangler.toml` for its one existing Pages app, leave
it at root — only split into per-unit configs once a second unit is actually being added, per the
existing comment convention some ARH repos already use to explain why a config lives where it does.

## 4. Pin wrangler, do not float on `npx wrangler@latest`

`npx wrangler@latest` means Cloudflare can change deploy behavior under you with no lockfile signal
and no diff to review. Add `wrangler` as a `devDependency` pinned to a specific version, and call it
via `npx wrangler deploy` (resolves the pinned local install) instead of `npx wrangler@latest`.
Bumping the pin is then a visible, reviewable commit like any other dependency update.

## 5. Close the "still needs a local machine" gaps

Cloudflare auth is rarely the actual remaining local-machine dependency once step 2 is done — check
adjacent systems the deploy depends on:

- **Database migrations** (Supabase, or any hosted DB): if a workflow already has the DB's
  access-token secrets available but no CI step applies migrations, that is a real remaining local
  dependency even though the _Cloudflare_ half is fully remote. See
  [references/supabase-ci-migration.md](references/supabase-ci-migration.md) for the pattern:
  `supabase db push --linked` in CI using an access-token secret, with no local `supabase link` step
  required.
- **Build-time secrets** (API URLs, anon keys) baked into a static build: confirm the build step
  reads them from `env:` sourced from GitHub secrets, with a local-dev fallback (e.g. reading a
  local vault file) that CI never touches — the build script should work identically whether the
  vault file exists or not, choosing GitHub-secret env vars whenever the vault is absent. Do not
  require CI to fake a local dev-only credential store.

## 6. Run every check together before the first push

Read [references/known-pitfalls.md](references/known-pitfalls.md) once before wiring a new unit --
it is a short list of real CI failures (a Workers-only global failing `no-undef`, a Windows-checkout
`prettier --check` false-positive flood, a dry-run passing while lint still fails) each of which
cost a full push-and-wait round trip to discover the hard way. Then run
[assets/verify-deploy-unit.mjs](assets/verify-deploy-unit.mjs) from the target repo root before
pushing:

```bash
node <path-to-this-skill>/assets/verify-deploy-unit.mjs --from-git \
  --wrangler-config apps/<unit>/wrangler.toml
```

`--from-git` derives the format-check file list from everything staged, unstaged, and untracked in
the working tree -- use it by default, not a hand-enumerated `--check-path` list, so a file outside
the unit you're focused on but still part of the same push can't slip through unverified (see
known-pitfalls.md #6, a real recorded failure from exactly that gap). Pass explicit `--check-path`
only when you deliberately want a narrower check than the full pending diff.

It runs the repo's own `lint`, `typecheck`, `test:architecture`, and `test` scripts (skipping any
that don't exist), a `prettier --check` scoped only to the derived/given paths (never a blind
repo-wide check -- see known-pitfalls.md #3), and a `wrangler deploy --dry-run`, then reports every
result together. Fixing several failures found in one local run is faster than fixing one per push.

## 7. Verify without a local wrangler login

To prove a deploy actually works end-to-end without ever running `wrangler login` locally:

1. Confirm secrets exist: `gh secret list` shows the expected names (existence only — values are
   never visible).
2. Trigger the workflow: `gh workflow run <workflow-file> --ref main` (uses `workflow_dispatch`), or
   push a path-matching change.
3. Watch it: `gh run watch` or `gh run view --log` on the resulting run. A green run with a printed
   deployment URL in the wrangler step's log output is the acceptance signal — not "the YAML looks
   right."
4. If it fails, read the fail-fast secrets-check step's error first; it should name the exact
   missing secret rather than requiring a wrangler stack trace to diagnose.

Never ask an operator to paste a Cloudflare API token into a local `.env`, shell history, or
`wrangler login` flow to "test" this — that reintroduces the local-machine dependency the whole
pattern exists to remove. If a deploy needs verifying and no GitHub Actions secret is configured
yet, that is exactly the missing secret to report, not a reason to fall back to a local credential.
