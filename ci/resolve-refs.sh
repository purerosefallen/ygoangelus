#!/bin/sh
set -eu
resolve() {
  if echo "$2" | grep -Eq '^[0-9a-fA-F]{40}$'; then echo "$2"; return; fi
  refs=$(git ls-remote "$1" "refs/heads/$2" "refs/tags/$2" "refs/tags/$2^{}")
  resolved=$(echo "$refs" | awk '/\^\{\}$/ {print $1; exit}')
  if [ -z "$resolved" ]; then resolved=$(echo "$refs" | awk 'NF {print $1; exit}'); fi
  test -n "$resolved" || { echo "Unresolved ref $2 in $1" >&2; return 1; }
  echo "$resolved"
}
pin_image() {
  docker pull "$1" >&2
  docker image inspect --format '{{index .RepoDigests 0}}' "$1"
}
SCRIPT_REPO=${SCRIPT_REPO:-https://code.moenext.com/nanahira/ygopro-scripts.git}
YGOPRO_REPO=${YGOPRO_REPO:-https://code.moenext.com/nanahira/ygopro.git}
OCGCORE_REPO=${OCGCORE_REPO:-https://code.moenext.com/nanahira/ygopro-core.git}
SCRIPT_REF=$(resolve "$SCRIPT_REPO" "${SCRIPT_REF:-master}")
YGOPRO_REF=$(resolve "$YGOPRO_REPO" "${YGOPRO_REF:-server}")
OCGCORE_REF=$(resolve "$OCGCORE_REPO" "${OCGCORE_REF:-develop}")
GIT_IMAGE=$(pin_image "${GIT_IMAGE:-alpine/git:v2.52.0}")
NODE_IMAGE=$(pin_image "${NODE_IMAGE:-node:26-alpine}")
BUILD_IMAGE=$(pin_image "${BUILD_IMAGE:-debian:trixie-slim}")
export SCRIPT_REPO YGOPRO_REPO OCGCORE_REPO SCRIPT_REF YGOPRO_REF OCGCORE_REF GIT_IMAGE NODE_IMAGE BUILD_IMAGE
for name in SCRIPT_REPO YGOPRO_REPO OCGCORE_REPO SCRIPT_REF YGOPRO_REF OCGCORE_REF GIT_IMAGE NODE_IMAGE BUILD_IMAGE; do
  printf '%s=%s\n' "$name" "$(printenv "$name")"
done
