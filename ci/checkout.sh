#!/bin/sh
set -eu
git init -q "$3"
git -C "$3" fetch -q --depth=1 "$1" "$2"
git -C "$3" checkout -q --detach FETCH_HEAD
