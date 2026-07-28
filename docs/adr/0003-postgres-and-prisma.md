# ADR 0003 — Postgres + Prisma

- **Status:** accepted, 2026-07-15 (Postgres); Prisma **pinned** at 6.19.2
- **Deciders:** Shreyas

## Context

Data store for users, reminders, messages, integrations, support
tickets. Early scaffolding used SQLite for local dev, but Auth.js +
Prisma migrations against SQLite don't behave the same way as prod,
and shipping SQLite in prod was never on the table.

## Decision

Postgres 16 in the docker compose stack. Prisma as the ORM, pinned at
**6.19.2** (both `prisma` and `@prisma/client` — must match exactly).

Prisma 7 is out but has breaking changes to the query engine and to
how enum types serialise. Migration is a whole workstream by itself —
not doing it in the middle of feature work.

## Consequences

- **Positive:** Postgres is boring, well-understood, and matches what
  every hosting target would offer. Prisma's schema-first workflow
  keeps DB drift out of the codebase.
- **Negative:** Pinning Prisma means we miss patch releases; upgrading
  requires a dedicated PR that touches every generated type. Adds one
  more "don't upgrade this" rule to CLAUDE.md.
- **Reversible?** Costly. Ripping out Prisma for raw SQL or Drizzle
  would touch every DB call in the codebase — probably a full sprint.
  We'd only do it if Prisma's generated client became a real perf
  bottleneck.
