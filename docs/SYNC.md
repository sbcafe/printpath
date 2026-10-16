# Keeping Ubuntu and the box in sync (local git only)

- **Source of truth:** Alex's Ubuntu, `~/projects/printpath` (branch `master`).
- **Mirror:** the agent box, `/workspace/printpath`, with the same history.
- **Never** push to GitHub or any remote (neither repo has a remote). **Never** force, reset, rebase or amend shared commits.
- Commits move as a `git bundle` file, copied between the machines (CopyFromBox / CopyToBox).
- Each repo has a repo-local identity only (`PrintPath bot <printpath-bot@localhost>`). Global git config is never touched.
- `.sync/` (bundles) and `.shots/` (screenshots) are gitignored on both sides.

## Rules before every sync

1. Both sides are on `master` with a clean tree (`scripts/sync.sh status`).
2. The receiver's `HEAD` is an ancestor of the incoming tip, so it's a fast-forward.
   `scripts/sync.sh import` checks this and refuses otherwise.
3. If the histories diverged, stop and sort it out by hand (e.g. re-apply the box edits on top of
   Ubuntu as new commits). Do not force anything.

## Ubuntu → box (normal direction)

```bash
# Ubuntu
cd ~/projects/printpath && npm test && npm run build && git add -A && git commit -m "..."
scripts/sync.sh export                     # writes .sync/printpath.bundle
# CopyToBox ~/projects/printpath/.sync/printpath.bundle -> /workspace/printpath/.sync/printpath.bundle
# box
cd /workspace/printpath && scripts/sync.sh import    # = git pull --ff-only .sync/printpath.bundle master
```

## Box → Ubuntu (if something was edited on the box)

```bash
# box
cd /workspace/printpath && git add -A && git commit -m "..." && scripts/sync.sh export
# CopyFromBox /workspace/printpath/.sync/printpath.bundle -> ~/projects/printpath/.sync/printpath.bundle
# Ubuntu
cd ~/projects/printpath && scripts/sync.sh import
```

Check afterwards: `git log --oneline -3` matches on both machines and `git status` is clean on both.

## Build output

`dist-single/printpath.html` (the self-contained offline file) is committed on purpose so it travels
with the history; rebuild it with `npm run build` before committing. `dist/` is not committed.

## Dev server (Ubuntu)

Vite on `0.0.0.0:5190` (`http://10.88.111.9:5190/` on the LAN), log `/tmp/printpath-dev.log`.
Vite hot-reloads on file changes and on a ff-pull, so there's no restart needed (restart after `npm install`).

## Screenshots

`CHROME_PATH=~/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome node tools/edu-shots.mjs`
writes to `.shots/edu/` and prints overlap / font-size checks. (The installed Playwright expects a newer browser
build; the cached Chromium 1208 is used instead of downloading one.)
