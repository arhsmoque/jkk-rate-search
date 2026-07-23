# Closing the Supabase local-link gap in CI

A repo can have a fully remote Cloudflare deploy and still depend on a local machine for the one
step that actually ships schema changes: running `supabase link` + `supabase db push` from an
operator's own shell. If the repo already has `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` as
GitHub Actions secrets but no workflow uses them, that is the gap -- the credentials for a remote
migration step already exist; only the workflow is missing.

## Pattern

A path-filtered workflow, independent of any Cloudflare deploy workflow, triggered only when
`supabase/migrations/**` changes on `main`:

```yaml
name: Apply Supabase migrations

on:
  push:
    branches: [main]
    paths:
      - "supabase/migrations/**"
  workflow_dispatch:

concurrency:
  group: supabase-migrate
  cancel-in-progress: false

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check Supabase credentials are configured
        run: |
          if [ -z "${{ secrets.SUPABASE_ACCESS_TOKEN }}" ] || [ -z "${{ secrets.SUPABASE_PROJECT_REF }}" ]; then
            echo "::error::SUPABASE_ACCESS_TOKEN and/or SUPABASE_PROJECT_REF repository secrets are not set."
            exit 1
          fi

      - name: Link project (non-interactive, CI-only)
        run: npx supabase@<PINNED_VERSION> link --project-ref "${{ secrets.SUPABASE_PROJECT_REF }}"
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Push migrations
        run: npx supabase@<PINNED_VERSION> db push --linked
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

## Why this is safe to add without weakening existing local-run guards

A repo's own operator-facing skill may require a local link artifact (e.g.
`supabase/.temp/project-ref`) to exist before allowing an _agent_ to run migration-adjacent work
locally -- that guard exists to stop an agent from silently drifting a shared dev database. It does
not conflict with a CI workflow doing the equivalent link+push non-interactively inside an isolated
GitHub Actions runner: the runner links fresh every run and discards state after, so there is no
persistent local link file for a stale agent session to misuse. Keep both: the local guard for
agent-run local work, the CI workflow for the actual merge-to-main migration path.

## What this does not replace

Migration review still happens in the PR that adds the migration file, same as any other code
change -- this workflow only removes the _local execution_ dependency for applying an already
reviewed, already merged migration. It is not a substitute for reviewing SQL for transactionality,
RLS correctness, or rollback consequences before merge.
