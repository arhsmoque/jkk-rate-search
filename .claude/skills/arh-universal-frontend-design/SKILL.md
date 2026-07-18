---
name: arh-universal-frontend-design
description: Use when designing, reviewing, redesigning, implementing, or quality-checking frontend interfaces in jkk-rate-search.
---

# Universal Frontend Design — jkk-rate-search

Shared quality is mandatory; shared visual themes are forbidden.

## Workflow

1. Read this repository's `AGENTS.md`, README, active UI entrypoint, stack/config, and verification commands.
2. Read [the repository profile](references/repo-profile.md).
3. State audience, job, dominant environment/device, primary action, and failure cost.
4. Choose the dominant archetype and one content-derived signature behavior before selecting palette, effects, libraries, or components.
5. Preserve repository contracts, state ownership, tokens, and stack. Name user-facing and operator-facing ports.
6. Implement the smallest coherent vertical slice with relevant empty, loading, error, offline, saving, and permission states.
7. Run repository gates plus responsive, keyboard/focus, touch, reduced-motion, security-boundary, and performance checks.

## Non-negotiables

- NEVER copy another ARH product's theme merely because it succeeded.
- NEVER style before understanding the audience and job.
- NEVER treat a polished happy path as complete.
- NEVER add a frontend dependency or rewrite the stack without necessity.
- STOP and restart discovery if critical states or accessible fallbacks are missing.

## Output contract

Report the archetype, signature behavior, files changed, commands/browser states verified, and residual risks. Done means the interface fits this product, remains distinct for defensible reasons, passes local gates, and leaves operator-visible evidence.

