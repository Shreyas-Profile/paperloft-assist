# Contributing

Right now this is a one-dev project. If that changes, or if future-me
forgets the rules, everything is here.

## Setup

See the [README](./README.md) — local dev needs Node 22, pnpm 11,
Docker Desktop, and a filled-in `.env`.

## Branching + PRs

Every change goes through a feature branch. Full rules in
[docs/branching.md](./docs/branching.md).

## Tests

Every fix for a bug that hit production should ship with a test that
would have caught it. See existing tests in `src/lib/*.test.ts` for
the style — pure functions extracted to make them testable, one
`describe` per unit, tight `it("does X")` cases.

```bash
pnpm test          # run once
pnpm test:watch    # keep re-running on save
pnpm typecheck     # tsc --noEmit
```

CI runs all three on every push. A red PR is a blocked PR.

## Style

- **Comments explain WHY, not WHAT.** Code says what.
- **No `console.log` in shipped code.** Use `console.warn` / `console.error`
  and only for things the on-call human would need to see.
- **Follow the existing patterns.** If half the codebase does something
  a certain way, don't invent a second way just because you'd prefer it.

## Adding a new external secret

1. Add the variable to `.env.example` with a placeholder + a comment
   explaining what it's for.
2. Add the variable to `.env` on Hetzner (SSH in, edit
   `/opt/paperloft-assist/.env`).
3. If the deploy needs CI to know about it too, add it to
   `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.
4. Document it in [DEPLOY.md](./DEPLOY.md).

## Adding a new admin

Edit `ADMIN_EMAILS` in `src/lib/admin.ts`. The set covers every sign-in
identity the same person might have (Google, phone, Telegram).

## Adding a new ADR

An ADR (architecture decision record) documents a non-trivial technical
decision — what and why, not how. Format is in
[docs/adr/README.md](./docs/adr/README.md). Number sequentially. Once
merged, never edit — supersede with a new ADR pointing back.
