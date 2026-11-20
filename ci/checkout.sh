#!/bin/sh
# Resolve a branch, tag or SHA. Optional sparse patterns select just the
# runtime data files from large repositories.
set -eu
repo=$1
ref=$2
target=$3
shift 3

retry() {
  for wait_seconds in 0 2 6; do
    sleep "$wait_seconds"
    if "$@"; then return 0; fi
  done
  return 1
}

git init -q "$target"
git -C "$target" remote add origin "$repo"
git -C "$target" config http.version HTTP/1.1
if [ "$#" -gt 0 ]; then
  git -C "$target" sparse-checkout set --no-cone "$@"
  git -C "$target" config remote.origin.promisor true
  git -C "$target" config remote.origin.partialclonefilter blob:none
  retry git -C "$target" fetch -q --depth=1 --filter=blob:none origin "$ref"
else
  retry git -C "$target" fetch -q --depth=1 origin "$ref"
fi
retry git -C "$target" checkout -q --detach FETCH_HEAD
