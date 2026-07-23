# Converting a Node/cron script into a scheduled Worker

A repo often has a real, tested script (e.g. an outbox publisher, a digest job) that only runs
manually or via a `--watch` polling loop, "not yet wired into a scheduler" because no hosting target
was chosen. Cloudflare Workers with a Cron Trigger is one such target; the conversion is small if the
script is already a plain function over environment variables.

## Preconditions

- The script's side effects (DB calls, HTTP calls) already go through `fetch`-compatible APIs, or
  through a client library that works in the Workers runtime (no Node-only APIs like `fs`, native
  `child_process`, or ambient Node globals the Workers runtime does not provide).
- Configuration is already read from environment variables, not from a local file path or CLI flag
  that assumes an interactive shell.

If either precondition fails, the pull request should say so explicitly rather than silently
wrapping a Node-only script in a Worker shim that will fail at deploy or at first invocation.

## Shape

```js
// apps/<unit>/src/index.mjs
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runOncePass(env));
  }
};

async function runOncePass(env) {
  // same logic the script's single-pass mode already has, reading env.SUPABASE_URL etc.
  // instead of process.env.SUPABASE_URL.
}
```

- `scheduled` replaces the script's `--watch` polling loop entirely -- Cloudflare's Cron Trigger
  calls it on schedule; the Worker does not poll or sleep.
- `env` replaces `process.env`; bind each required variable via `wrangler secret put` (see
  [required-secrets.md](required-secrets.md)) or `[vars]` in `wrangler.toml` for non-secret config.
- Keep the original script's single-pass function importable and unit-testable independent of the
  Workers runtime -- the `scheduled` handler should be a thin adapter calling it, not a rewrite.

## Repo lint config, before first push

If the repo's ESLint config declares Node-context globals (`process`, `console`, `fetch`, ...) but
not Workers-only globals, the new Worker file will fail `no-undef` in CI on `Response`, `Request`,
or any other Workers runtime global it references -- a real recorded failure, see
[known-pitfalls.md #1](known-pitfalls.md). Add a config block scoped to exactly the new file before
running lint, not after CI reports it:

```js
{
  files: ["apps/<unit>/src/worker.mjs"],
  languageOptions: { globals: { Response: "readonly", Request: "readonly" } }
}
```

## wrangler.toml

Use [assets/wrangler.worker.toml.template](../assets/wrangler.worker.toml.template) with the cron
block uncommented:

```toml
[triggers]
crons = ["*/15 * * * *"]
```

## Verification before treating the conversion as done

1. `npx wrangler dev` locally to confirm the Worker starts and the scheduled handler is invocable
   (`wrangler dev --test-scheduled`), catching Workers-runtime incompatibilities before deploy.
2. Deploy via the standard [worker-deploy.yml.template](../assets/worker-deploy.yml.template).
3. Confirm the first scheduled invocation actually ran: `npx wrangler tail` briefly after the next
   cron fire, or check the effect the script is supposed to produce (e.g. a row's `published_at`
   getting set) rather than trusting a green deploy alone -- a deploy succeeding only proves the
   Worker was uploaded, not that its schedule or logic executed correctly.
