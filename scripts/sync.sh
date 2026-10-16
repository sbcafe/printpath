#!/usr/bin/env bash
# Local-only git sync between Alex's Ubuntu (source of truth) and the box mirror.
# Moves commits as a git bundle file; never pushes anywhere, never forces or resets.
#
#   scripts/sync.sh status                 # branch, HEAD, clean?
#   scripts/sync.sh export [bundle]        # sender: refuse if dirty, write a bundle of the branch
#   scripts/sync.sh import [bundle]        # receiver: refuse if dirty or not fast-forward, then ff-only pull
#
# Branch: master. Default bundle path: .sync/printpath.bundle (.sync/ is gitignored).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
branch=master
cmd="${1:-status}"
bundle="${2:-.sync/printpath.bundle}"

clean() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "ABORT: working tree not clean. Commit (or stash) first:" >&2
    git status --short >&2
    exit 1
  fi
  [ "$(git rev-parse --abbrev-ref HEAD)" = "$branch" ] || { echo "ABORT: not on $branch" >&2; exit 1; }
}

case "$cmd" in
  status)
    echo "branch: $(git rev-parse --abbrev-ref HEAD)  HEAD: $(git log -1 --format='%h %s')"
    if [ -n "$(git status --porcelain)" ]; then echo "tree: DIRTY"; git status --short; else echo "tree: clean"; fi
    ;;
  export)
    clean
    mkdir -p "$(dirname "$bundle")"
    git bundle create -q "$bundle" "$branch"
    git bundle verify -q "$bundle" >/dev/null
    echo "wrote $bundle  ($branch = $(git rev-parse --short "$branch"))"
    ;;
  import)
    clean
    [ -f "$bundle" ] || { echo "ABORT: no bundle at $bundle" >&2; exit 1; }
    git bundle verify -q "$bundle" >/dev/null
    tip="$(git bundle list-heads "$bundle" | awk -v r="refs/heads/$branch" '$2==r{print $1}')"
    [ -n "$tip" ] || { echo "ABORT: bundle has no refs/heads/$branch" >&2; exit 1; }
    git fetch -q "$bundle" "$branch"
    if git merge-base --is-ancestor "$tip" HEAD; then echo "already up to date ($(git rev-parse --short HEAD))"; exit 0; fi
    if ! git merge-base --is-ancestor HEAD "$tip"; then
      echo "ABORT: histories diverged (HEAD $(git rev-parse --short HEAD) vs bundle $(git rev-parse --short "$tip")). Not forcing; sort it out by hand." >&2
      exit 1
    fi
    git pull -q --ff-only "$bundle" "$branch"
    echo "fast-forwarded to $(git log -1 --format='%h %s')"
    ;;
  *) echo "usage: scripts/sync.sh status|export [bundle]|import [bundle]" >&2; exit 2 ;;
esac
