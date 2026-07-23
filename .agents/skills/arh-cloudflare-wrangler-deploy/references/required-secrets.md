# Required secrets per unit type

All secrets are GitHub Actions repository (or environment) secrets, set via `gh secret set <NAME>`
or Settings > Secrets and variables > Actions. Never a local `.env`, `wrangler login` session, or
value pasted into a workflow file.

## Every unit (Pages or Worker)

| Secret                  | Purpose                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Scoped API token with Pages/Workers edit permission for the target account. Create at the Cloudflare dashboard under My Profile > API Tokens; use a scoped token, not the Global API Key. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID the project/Worker belongs to. Not secret in the sensitive sense, but kept alongside the token for convenience.                                                 |

## Pages app, additionally

Whatever build-time environment variables the app's build step needs (e.g. an API base URL, a
public/anon key). These are baked into the static build output, so they must be present at build
time in CI -- add each as its own named secret and reference it in the workflow's build step `env:`.

## Worker, additionally

Runtime secrets the Worker reads at request/schedule time are **not** passed through the GitHub
Actions workflow. Set them once, directly against the Worker, via:

```bash
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config apps/<unit>/wrangler.toml
```

This can run from CI (using `CLOUDFLARE_API_TOKEN`) as a one-time setup step, or from an operator's
own authenticated session -- it is a one-time bind, not a per-deploy step, so it does not reintroduce
a standing local-machine dependency for routine deploys.

## Verifying without exposing values

`gh secret list` shows names and last-updated timestamps only, never values -- safe to run to
confirm a secret exists before assuming a dormant workflow is a code bug rather than a missing
secret.

## Migration-adjacent secrets (Supabase or any hosted DB)

See [supabase-ci-migration.md](supabase-ci-migration.md). These are unrelated to Cloudflare auth but
are the most common "still needs a local machine" gap found alongside a Cloudflare deploy audit.
