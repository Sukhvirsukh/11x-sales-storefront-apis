#!/usr/bin/env bash
# Deploys one commit of 11x-sales-storefront-apis on the server. Installed at
# /opt/apps/deploy/deploy-xsales-storefront.sh; Forge's deploy script (or a person) runs:
#
#   git archive HEAD | /opt/apps/deploy/deploy-xsales-storefront.sh <commit-sha>
#
# It also works as an SSH forced command (the SHA then comes from SSH_ORIGINAL_COMMAND).
#
# Reads the commit's files (a tar) on stdin, builds the image (no migrations: the
# schema belongs to 11xsales-be), restarts the API and waits until it's healthy.
# If the build or the health check fails, the previous source and image are put
# back and the API restarted on them.
set -euo pipefail

APPS=/opt/apps
SERVICE=xsales-storefront
SRC=$APPS/xsales-storefront
RELEASES=$APPS/releases/xsales-storefront
LOG=$APPS/deploy/xsales-storefront.log
CONTAINER=apps-xsales-storefront-1
KEEP=5

say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }

# One deploy at a time.
exec 9>/var/lock/deploy-xsales-storefront.lock
flock -w 900 9 || { echo "Another deploy is still running; try again later."; exit 1; }

SHA="${SSH_ORIGINAL_COMMAND:-${1:-}}"
[[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]] || { echo "Expected a commit SHA, got: '${SHA}'"; exit 2; }

mkdir -p "$RELEASES" "$(dirname "$LOG")"
NEW="$RELEASES/${SHA:0:12}-$(date -u +%Y%m%d%H%M%S)"
mkdir "$NEW"
say "deploy ${SHA:0:12}: receiving files"
# At most 200 MB, no owners/permissions from the archive.
head -c 209715200 | tar -x --warning=no-unknown-keyword --no-same-owner --no-same-permissions -C "$NEW"
for f in package.json package-lock.json Dockerfile src; do
  [ -e "$NEW/$f" ] || { say "deploy ${SHA:0:12}: FAILED — the archive has no $f"; rm -rf "$NEW"; exit 3; }
done

cd "$APPS"
# What to go back to: the current source (minus its secrets) and the current image.
PREV="$RELEASES/previous"
rm -rf "$PREV"
rsync -a --exclude .env "$SRC/" "$PREV/"
docker image tag xsales-storefront:latest xsales-storefront:rollback
PREV_SHA=$(cat "$APPS/deploy/xsales-storefront.current" 2>/dev/null || echo unknown)

# Puts the previous source and image back. Until the restart step the old API is
# still running untouched, so it's only restarted when the new one was started.
rollback() {
  say "deploy ${SHA:0:12}: FAILED — $1; back on ${PREV_SHA:0:12}"
  rsync -a --delete --exclude .env "$PREV/" "$SRC/"
  docker image tag xsales-storefront:rollback xsales-storefront:latest
  if [ "${2:-}" = restart ]; then
    docker compose up -d --no-deps --force-recreate "$SERVICE" >/dev/null 2>&1 || say "  restarting the previous version failed too — check the server"
  fi
  exit 1
}

rsync -a --delete --exclude .env --exclude node_modules --exclude logs "$NEW/" "$SRC/"

say "deploy ${SHA:0:12}: building"
# pipefail (set above) makes these pipelines fail when the build does, not just tail.
if ! docker compose build "$SERVICE" 2>&1 | tail -n 25; then rollback "the build failed"; fi

say "deploy ${SHA:0:12}: restarting the API"
docker compose up -d --no-deps --force-recreate "$SERVICE" >/dev/null 2>&1 || rollback "the API didn't start" restart

status=starting
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo missing)
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && break
  sleep 3
done
if [ "$status" != healthy ]; then
  docker logs --tail 40 "$CONTAINER" 2>&1 | sed 's/^/  | /' || true
  rollback "the API isn't healthy ($status)" restart
fi

echo "$SHA" > "$APPS/deploy/xsales-storefront.current"
# Keep the last few received releases, not counting "previous".
ls -1dt "$RELEASES"/*-* 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf
docker image prune -f >/dev/null 2>&1 || true
say "deploy ${SHA:0:12}: live (was ${PREV_SHA:0:12})"
