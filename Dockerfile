ARG NODE_IMAGE=node:26-trixie-slim
ARG BUILD_IMAGE=debian:trixie-slim
FROM ${BUILD_IMAGE} AS fetcher
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl && rm -rf /var/lib/apt/lists/*
COPY ci/checkout.sh /usr/local/bin/checkout
FROM fetcher AS resources
ARG SCRIPT_REPO=https://code.moenext.com/nanahira/ygopro-scripts.git
ARG SCRIPT_REF=master
ARG YGOPRO_REPO=https://code.moenext.com/nanahira/ygopro.git
ARG YGOPRO_REF=server
RUN checkout "$SCRIPT_REPO" "$SCRIPT_REF" /resources/script && checkout "$YGOPRO_REPO" "$YGOPRO_REF" /tmp/ygopro && \
    git -C /resources/script rev-parse HEAD > /resources/script.sha && git -C /tmp/ygopro rev-parse HEAD > /resources/ygopro.sha && \
    cp /tmp/ygopro/cards.cdb /tmp/ygopro/lflist.conf /resources && rm -rf /resources/script/.git /tmp/ygopro

FROM fetcher AS compiler
RUN apt-get update && apt-get install -y --no-install-recommends build-essential emscripten uuid-dev libssl-dev unzip && rm -rf /var/lib/apt/lists/*
FROM compiler AS premake
ARG PREMAKE_REF=4f6dab3129f86832c9ed745c69438fcaa5fee460
RUN checkout https://github.com/premake/premake-core.git "$PREMAKE_REF" /premake && cd /premake && ./Bootstrap.sh
FROM compiler AS core
ARG OCGCORE_REPO=https://code.moenext.com/nanahira/ygopro-core.git
ARG OCGCORE_REF=develop
ARG LUA_VERSION=5.4.9
ARG LUA_SHA256=2335b6c582a52654f94612bf10d2f4672805d05329aa6568b1d8cd9e5c6fb8e6
COPY --from=premake /premake/bin/release/premake5 /usr/local/bin/premake5
RUN checkout "$OCGCORE_REPO" "$OCGCORE_REF" /core && cd /core && \
    curl -fLSs --retry 3 "https://www.lua.org/ftp/lua-${LUA_VERSION}.tar.gz" -o /tmp/lua.tgz && \
    echo "$LUA_SHA256  /tmp/lua.tgz" | sha256sum -c - && tar xzf /tmp/lua.tgz && mv "lua-$LUA_VERSION" lua && \
    cp premake/lua.lua lua/premake5.lua && ln -sf premake/dll.lua dll.lua && \
    premake5 gmake --file=dll.lua --os=emscripten && make -C build config=release_wasm_esm -j4 && \
    mkdir -p /artifacts && cp build/bin/wasm_esm/Release/libocgcore.wasm /artifacts && \
    { git rev-parse HEAD; (cd /tmp && premake5 --version); emcc --version; echo "Lua $LUA_VERSION $LUA_SHA256"; cd /artifacts && sha256sum libocgcore.wasm; } > /artifacts/core-build.txt

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
FROM deps AS test-runtime
COPY . .
RUN npm run build
FROM test-runtime AS build
RUN npm prune --omit=dev
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production DEFAULT_OCGCORE_WASM_PATH=/app/engine/libocgcore.wasm
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/LICENSE /app/config.example.yaml ./
COPY --from=core /artifacts ./engine
COPY --from=resources /resources ./ygopro
EXPOSE 3000
CMD ["node", "dist/main.js"]
