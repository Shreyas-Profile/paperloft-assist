# Branching + PRs

## The rules

- **`main`** is production. Every merge to `main` triggers CI + auto-deploy
  to paperloft.uk.
- **Every change goes through a feature branch + pull request.** No
  direct commits to `main` — even for the maintainer.
- Branch naming: `<type>/<slug>`, where type is one of `feat` (new
  feature), `fix` (bug fix), `chore` (deps, docs, config), `sdlc` (SDLC
  scaffolding like tests, CI). Examples:
  - `feat/add-support-form`
  - `fix/history-query-order`
  - `sdlc/round-4`

## The workflow

```bash
# 1. Start from a fresh main
git checkout main && git pull origin main

# 2. Cut a branch
git checkout -b fix/telegram-bot-forgets-history

# 3. Do the work. Commit as you go — small commits are fine.
git add ...
git commit -m "..."

# 4. Push the branch
git push -u origin fix/telegram-bot-forgets-history

# 5. Open a PR
gh pr create --fill

# 6. Review your own diff. Read the changes as if you were an outsider.
gh pr view --web    # opens in browser

# 7. Merge (rebase-merge keeps history linear)
gh pr merge --rebase --delete-branch

# 8. Deploy fires automatically. Watch it.
gh run watch
```

## Why bother

Every big-tech team does this. Reasons that actually apply to a solo
project:

- **The diff is your final review.** Reading your own change as a
  unified PR often catches "wait, why did I do that?" — the linear
  commit stream doesn't.
- **`main` is always deployable.** No half-finished work on the branch
  that gets deployed. A branch that isn't ready just sits there; prod
  keeps running.
- **The audit trail explains itself.** Anyone reading the repo later
  sees clumps of related commits under a PR title and description —
  not 400 tiny commits.

## PR template

Every PR gets the template at `.github/PULL_REQUEST_TEMPLATE.md`
auto-filled. The template asks the same three questions every time
(what changed, why, how you tested it). Fill it in even when the PR
is only for you — future-you will thank you.

## Exceptions

The only time to commit direct-to-main is when the tooling for PRs is
itself broken (e.g. GitHub down, gh CLI misbehaving) AND the fix is
urgent. Otherwise: branch + PR.
