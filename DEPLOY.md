# Deployment

Everything below runs against **paperloft.uk** on Hetzner
(`37.27.193.248`, `/opt/paperloft-assist/`).

## How a deploy happens

You never run `scp` yourself. The flow is:

```
git push origin main
        │
        ▼
┌─────────────────────┐
│  CI  (ci.yml)       │  install → prisma generate → typecheck → 28 tests
└─────────────────────┘
        │  passes
        ▼
┌─────────────────────┐
│  Deploy (deploy.yml)│  snapshot current image as :previous
│                     │  rsync source to Hetzner
│                     │  docker compose build web + up -d
│                     │  curl paperloft.uk (3 attempts)
│                     │  ✅ green? done.  ❌ red? rollback.
└─────────────────────┘
```

Both workflows fire on push to `main`. **A red CI blocks the deploy** —
that's the point of testing before shipping.

## Manual redeploy

Actions tab → **Deploy** → *Run workflow* → main → *Run*. Uses the current
tip of `main` — no push needed. Same rsync + rebuild + health-check as
the automatic path.

Useful when:

- Prod-only config changed (`.env` edited on the box, container needs a
  restart to pick it up).
- A deploy step flaked on network (rare) and you want to retry.
- You've hot-fixed something directly on Hetzner (**don't**) and want to
  bring the box back in sync with git.

## What travels with the deploy

`rsync -avz --delete` from repo root, excluding:

- `.git`, `node_modules`, `.next`, `.open-next`
- `.env`, `.env.local`, `.env.bak` — secrets never leave the box
- `dev.db*` — local SQLite artefacts, not used in prod
- `tsconfig.tsbuildinfo`

`--delete` means files removed locally get removed on the remote too.
No stale files linger.

Docker volumes (`pgdata`, `userfiles`) are untouched — user data survives
every deploy.

## Rollback

**Automatic** on failed health check: the deploy workflow retags the
previous docker image (which it snapshotted before rebuilding) back to
`:latest` and restarts.

**Manual** at any time:

```bash
ssh root@37.27.193.248
cd /opt/paperloft-assist
docker tag paperloft-assist-web:previous paperloft-assist-web:latest
docker compose up -d web
```

Only one image back. If you need to go further, `git revert <sha>` and
push — the CI+deploy pipeline will roll you forward to the earlier code.

## Environments

| Env | Where | DB | Domain |
|---|---|---|---|
| **dev** | your laptop | local Docker Postgres (`docker-compose.dev.yml`) | http://localhost:3000 |
| **prod** | Hetzner | Postgres in Docker (`paperloft-assist-db`) | https://paperloft.uk |

There is no separate staging today — one dev + one prod is enough at
current scale. When we start onboarding external users we'll add a
`staging.paperloft.uk` subdomain that lives on the same box but reads
its own DB.

## Secrets & config

Prod-only `.env` lives at `/opt/paperloft-assist/.env` on Hetzner and
is loaded by `docker-compose.yml` via `env_file`. It is:

- **NEVER** committed to git (see `.gitignore`).
- **NEVER** rsync'd from CI (see `--exclude` list in deploy.yml).
- **NEVER** logged in Actions output (secrets referenced as
  `${{ secrets.NAME }}` are masked automatically).

To add a new env var:

1. `ssh root@37.27.193.248`, edit `/opt/paperloft-assist/.env`, add the
   line.
2. Add the same key (with a placeholder value) to `.env.example` in the
   repo so future contributors know it exists.
3. `docker compose up -d web` on Hetzner (or hit *Run workflow* on
   Deploy) to pick up the new value.

## GitHub secrets used by the deploy workflow

Set at Settings → Secrets → Actions:

| Secret | What it is |
|---|---|
| `HETZNER_SSH_KEY` | ed25519 private key, `github-actions@paperloft-assist`. Public half is in `~/.ssh/authorized_keys` on Hetzner. |
| `HETZNER_HOST` | `37.27.193.248` |
| `HETZNER_USER` | `root` |

If the deploy key ever gets exposed, rotate it:

```bash
# On your machine
ssh-keygen -t ed25519 -N '' -C 'github-actions@paperloft-assist' -f ./new_deploy_key

# Add new pubkey to Hetzner
cat new_deploy_key.pub | ssh root@37.27.193.248 'cat >> ~/.ssh/authorized_keys'

# Store new privkey in GitHub
gh secret set HETZNER_SSH_KEY --repo Shreyas-Profile/paperloft-assist < new_deploy_key

# Remove the OLD line from Hetzner ~/.ssh/authorized_keys
ssh root@37.27.193.248 'nano ~/.ssh/authorized_keys'   # delete the leaked one

# Wipe the local file
rm new_deploy_key new_deploy_key.pub
```

## Health check

The workflow curls `https://paperloft.uk/` up to 3 times, 6 seconds
apart. Anything other than `HTTP 200` triggers the rollback.

**Cases the health check does NOT catch:**

- The homepage renders but `/api/telegram/bot-webhook/...` is 500.
- Telegram messages fail silently in the LLM pipeline.

Those need real user traffic (or an integration test — a Round 2+ item).
