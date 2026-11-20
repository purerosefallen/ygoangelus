#!/bin/sh
set -eu
build() {
  docker build --build-arg NPM_TARBALL_CACHE --build-arg PREMAKE_REPO --build-arg PREMAKE_REF --build-arg SCRIPT_REPO --build-arg SCRIPT_REF --build-arg YGOPRO_REPO --build-arg YGOPRO_REF \
    --build-arg OCGCORE_REPO --build-arg OCGCORE_REF --build-arg GIT_IMAGE --build-arg BUILD_IMAGE --build-arg NODE_IMAGE "$@" .
}
image="$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA-$ARCH"
test_image="angelus-test:$CI_JOB_ID"
build --target test-runtime -t "$test_image"
docker run --rm "$test_image" sh -ec 'npm run lint && npm test && npm run typecheck'
build -t "$image"
test "$(docker image inspect --format '{{.Architecture}}' "$image")" = "$ARCH"
# Copy the fixture runner into a stopped container. This also works with remote Docker daemons.
container=$(docker create "$image" node test/image-smoke.mjs)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker cp test "$container:/app/test"
docker start -a "$container"
test "$(docker inspect --format '{{.State.ExitCode}}' "$container")" = 0
docker run --rm "$image" cat /app/engine/core-build.txt /app/ygopro/script.sha /app/ygopro/ygopro.sha
docker push "$image"
