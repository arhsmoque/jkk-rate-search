# Known pitfalls (from real CI round-trips)

Every entry here cost at least one failed CI run before being fixed. Check these before pushing, not
after — that's what [assets/verify-deploy-unit.mjs](../assets/verify-deploy-unit.mjs) automates.

## 1. `no-undef: 'Response' is not defined` (or `Request`, `WebSocket`, etc.)

A Worker's entry file runs under `workerd`, not Node. If the repo's ESLint config only declares
Node-context globals (`process`, `console`, `fetch`, ...), any Workers-only global the file
references (`Response`, `Request`, `ExecutionContext` as a type, `crypto.subtle`, `WebSocket`, ...)
fails `no-undef` in CI even though the file is completely correct and deploys fine.

**Fix:** add a config block scoped to exactly the new Worker file(s), declaring only the Workers
globals actually used -- do not widen the whole repo's lint globals just to unblock one file:

```js
{
  files: ["apps/<unit>/src/worker.mjs"],
  languageOptions: {
    globals: { Response: "readonly", Request: "readonly" }
  }
}
```

Do this _before_ first push, as part of writing the Worker adapter -- see
[worker-from-script.md](worker-from-script.md) step ordering.

## 2. `wrangler deploy --dry-run` passing does not mean CI will pass

A clean dry-run only proves the Worker bundles and the config is structurally valid. It does not run
the repo's lint, format, typecheck, or test gates -- a file can dry-run cleanly and still fail CI on
`no-undef`, unformatted code, or a broken test. Run the repo's actual CI-equivalent checks locally
(or via [assets/verify-deploy-unit.mjt](../assets/verify-deploy-unit.mjs)) before treating a new
Worker file as done, not just the dry-run.

## 3. A failed `prettier --check` in CI does not mean the whole repo is unformatted

If a Windows working tree has `core.autocrlf` converting line endings, a local `prettier --check .`
can report dozens of files as failing that CI (Linux, LF-native) sees as perfectly formatted --
pure Windows-checkout noise, not real drift on `main`. **Do not run a blanket
`prettier --write .`** in response to a local check reporting many failures; it will rewrite files
you never touched and produce an unrelated, oversized diff.

Instead, read the actual CI failure log (`gh run view <run-id> --log-failed`) to see exactly which
file(s) CI flagged, and format only those:

```bash
npx prettier --write <the-one-file-ci-flagged>
```

If CI and a clean-checkout local run disagree about a file you did not touch, that is a
pre-existing repo formatting drift unrelated to your change -- report it, do not silently fix it as
part of an unrelated deploy PR.

## 4. Verify path-filtering actually worked, don't just trust the YAML

After the first push touching a new unit, check `gh run list` to confirm only the expected
workflows fired (the new unit's deploy + the repo's general `ci`), and that unrelated
path-filtered workflows (another unit's deploy, a migration workflow) did _not_ fire. A path filter
typo (wrong glob, missing unit's actual path) silently either over-triggers or never triggers --
both are easy to miss by reading the YAML alone.

## 5. `prettier --check` has no parser for `wrangler.toml`

Passing a `wrangler.toml` (or any non-JS/TS/JSON/MD/YAML file) to `prettier --check` fails with
`No parser could be inferred for file "..."` -- that is a tooling-support error, not a real
formatting problem. `assets/verify-deploy-unit.mjs` already filters `--check-path` arguments to
extensions prettier supports and reports the rest as skipped; if calling `prettier --check`
directly, only pass file types prettier actually formats.

## 6. Verifying only the deploy unit's own files misses everything else in the push

A real failure: a Worker's `wrangler.toml` and entry file were verified with
`--check-path apps/jobs/src/worker.mjs --check-path apps/jobs/wrangler.toml`, passed, and were
pushed together with two unrelated skill-documentation files added in the same commit -- which were
never passed to `--check-path` at all, and broke CI on `npm run format`. Scoping verification to
"the thing I'm actively working on" silently excludes anything else riding along in the same push.

**Fix:** use `--from-git` instead of manually enumerating `--check-path` -- it derives the file list
from `git diff --cached --name-only` (staged), unstaged changes, and untracked files combined, so it
verifies everything about to be committed/pushed, not just the deploy unit. Reserve explicit
`--check-path` for when you deliberately want a narrower check than the full working tree diff.

## 7. Sequence: don't push once and debug forever in CI

Each round-trip through GitHub Actions costs several minutes and burns the operator's patience.
Run [assets/verify-deploy-unit.mjs](../assets/verify-deploy-unit.mjs) locally first -- it bundles
lint, format-check (scoped to the new files only), typecheck, the repo's architecture gate if
present, and `wrangler deploy --dry-run` into one command, so an agent gets every failure in one
pass instead of discovering them one push at a time.
