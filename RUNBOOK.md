# Runbook

**What this is:** a cheat-sheet for when something breaks. Read the
symptom, follow the checklist. Especially useful at 2am when the
site is down and you're groggy.

**What this is not:** exhaustive. Failure modes we haven't hit yet
aren't here. Add them the first time.

---

## First: is it actually broken?

Before diving in:

1. Open [paperloft.uk/status](https://paperloft.uk/status) — this
   shows DB + Telegram bot + LLM subsystem health in one glance.
2. If /status won't load either, it's a bigger problem — jump to
   **"Site totally down"** below.

---

## Site totally down (paperloft.uk returns nothing / times out)

```bash
# 1. Is the container running?
ssh root@37.27.193.248
docker ps --filter name=paperloft-assist-web

# 2. If it's NOT there, bring it up:
cd /opt/paperloft-assist
docker compose up -d web

# 3. If it IS there but paperloft.uk still returns nothing,
#    check container logs:
docker logs --tail 100 paperloft-assist-web

# 4. Common outcomes:
#    - "Prisma cannot connect" → the DB container fell over.
#      Restart it: docker compose up -d db && sleep 5 && docker compose up -d web
#    - Next.js startup error → the last deploy shipped bad code.
#      Roll back to :previous image (see below).
#    - No logs at all → Cloudflare Tunnel is broken.
#      SSH-check the cloudflared service on the box:
#        systemctl status cloudflared
```

## Deploy shipped bad code — roll back

```bash
# The deploy pipeline snapshots :latest as :previous before each build.
ssh root@37.27.193.248
cd /opt/paperloft-assist
docker tag paperloft-assist-web:previous paperloft-assist-web:latest
docker compose up -d web
sleep 8
curl -sSL -o /dev/null -w '%{http_code}\n' https://paperloft.uk/   # want 200
```

Then find the bad commit and `git revert <sha>` locally, push, let the
pipeline roll you forward. Do NOT edit code on the box — it'll get
overwritten on the next deploy.

## Telegram bot silent (users messaging @PaperloftAssistantBot get no reply)

```bash
# 1. Confirm Telegram itself can reach us — the webhook secret has to
#    match what BotFather sent to setWebhook.
ssh root@37.27.193.248
grep TELEGRAM_WEBHOOK_SECRET /opt/paperloft-assist/.env

# 2. Test the webhook URL directly. Substitute your secret.
curl -sSL https://paperloft.uk/api/telegram/bot-webhook/<SECRET> \
  -X POST -H 'Content-Type: application/json' \
  -d '{"update_id":1,"message":{"message_id":1,"chat":{"id":1,"type":"private"},"text":"health check"}}'
# Expect {"ok":true}. Anything else means the route is wrong.

# 3. Watch the container logs while messaging the bot yourself:
docker logs -f paperloft-assist-web 2>&1 | grep -iE 'tg-webhook|telegram-chat'

# 4. If logs show "handleTelegramMessage threw" repeatedly, check
#    /status — OpenRouter might be down and every LLM call is failing.
```

## Reminders not firing

```bash
# 1. Confirm cron.globalion.in is actually poking us. Its callbacks land
#    at /api/cron/fire and are HMAC-signed.
ssh root@37.27.193.248
docker logs --tail 200 paperloft-assist-web | grep -iE 'cron|reminder.*fire'

# 2. If cron isn't calling in at all, check the CRON_MCP_KEY on
#    cron.globalion.in matches ours. Contact Pawan if cron.globalion.in is
#    itself down — it's his box.

# 3. Manually inspect pending reminders:
docker exec -i paperloft-assist-db psql -U admin -d paperloft_assist \
  -c "SELECT id, title, \"dueAt\", status FROM reminders \
      WHERE status = 'pending' AND \"dueAt\" < NOW() \
      ORDER BY \"dueAt\" LIMIT 20"

# Any rows here are "should have fired but didn't". Cross-reference
# with logs to figure out why.
```

## Database full / running low on disk

```bash
ssh root@37.27.193.248
df -h /             # host disk
docker exec paperloft-assist-db du -sh /var/lib/postgresql/data

# The pgdata volume can bloat from Message + reminder_instances history.
# A safe purge for old chat history (older than 90 days):
docker exec -i paperloft-assist-db psql -U admin -d paperloft_assist \
  -c "DELETE FROM \"Message\" WHERE \"createdAt\" < NOW() - INTERVAL '90 days'"

# Then VACUUM to reclaim disk:
docker exec -i paperloft-assist-db psql -U admin -d paperloft_assist \
  -c "VACUUM FULL"
```

If disk fills entirely, Postgres will refuse writes and the container
health check will fail. That's a P0 — roll back, purge, restart.

## Health check reporting degraded / down when the site is actually fine

- /status "unconfigured" for one system just means the env var is
  missing on the box. Add it to `/opt/paperloft-assist/.env` and
  restart (`docker compose up -d web`).
- If Telegram check keeps failing but the bot works from your phone,
  it's usually a transient DNS / network blip on the Hetzner side.
  Ignore if it clears after a few minutes.

## Rotating the deploy SSH key

If the `HETZNER_SSH_KEY` GitHub secret gets exposed (leaked in a log,
committed by mistake, etc.), rotate immediately:

```bash
# On your local machine
ssh-keygen -t ed25519 -N '' -C 'github-actions@paperloft-assist' -f ./new_deploy_key

# Add new pubkey to Hetzner
cat new_deploy_key.pub | ssh root@37.27.193.248 'cat >> ~/.ssh/authorized_keys'

# Push new privkey to GitHub secrets
gh secret set HETZNER_SSH_KEY --repo Shreyas-Profile/paperloft-assist < new_deploy_key

# Remove the OLD line from Hetzner ~/.ssh/authorized_keys
ssh root@37.27.193.248 'nano ~/.ssh/authorized_keys'
# Delete the compromised github-actions@paperloft-assist line, save.

# Wipe the local files
rm new_deploy_key new_deploy_key.pub
```

Kick a manual deploy to prove the new key works: Actions → Deploy →
Run workflow.

## Contact routes when it's really bad

- **Pawan** (@pakki10) — owns cron.globalion.in, docs.globalion.in, tor.globalion.in,
  video-render.globalion.in. Contact if any of those show down on /status.
- **Cloudflare status** — [cloudflarestatus.com](https://www.cloudflarestatus.com/)
  if the tunnel is misbehaving.
- **Hetzner status** — [status.hetzner.com](https://status.hetzner.com/)
  for network / power issues on the box itself.
- **OpenRouter status** — [status.openrouter.ai](https://status.openrouter.ai/)
  for LLM outages.

If all four external services are green and paperloft is still down,
it's us. Roll back, then dig.
