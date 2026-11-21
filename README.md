# ygoangelus

Angelus serves YGOPro card data and banlists and runs each duel in a separate OCGCore Worker. It uses NestJS 12, Node.js 26, the MIT license and the `ygoangelus.v1` binary protocol.

## Run locally

```sh
npm ci
cp config.example.yaml config.yaml
npm run build
YGOPRO_PATH=/path/to/ygopro npm run start:prod
```

A resource root contains `cards.cdb`, `lflist.conf` and the `script` tree. See [the configuration example](config.example.yaml). Environment settings override YAML, which overrides built-in defaults. The server listens on `[::]:3001` by default.

| Setting | Default / meaning |
| --- | --- |
| `YGOPRO_PATH` | `./ygopro`. Supply ordered root paths as a YAML list or comma-separated environment value. |
| `EXTRA_SCRIPT_PATH` | Additional Lua preload paths after `./script/patches/entry.lua`, `./script/special.lua` and `./script/init.lua`. Paths like `./special/special.lua` are relative to a resource root. |
| `YGOPRO_RESOURCE_REFRESH_MINUTES` | Refreshes the CDB, banlists and WASM. An unset, invalid or nonpositive interval uses 10 minutes. Each duel retains the card data and WASM loaded at START. Loose Lua files are read when the core requests them. YPK scripts are loaded at START. |
| `OCGCORE_WASM_PATH` | Explicit WASM override, followed by `DEFAULT_OCGCORE_WASM_PATH`. The image sets the latter to `/app/engine/libocgcore.wasm`. An empty or missing path falls through to the next source. If both paths are empty or missing, the wrapper loads its bundled engine. |
| `OCGCORE_DEBUG_LOG` | Mirror core callbacks to local debug logs. All callbacks are delivered to the duel socket. |
| `DECK_MAIN_MIN`, `DECK_MAIN_MAX`, `DECK_EXTRA_MAX`, `DECK_SIDE_MAX`, `DECK_MAX_COPIES` | 40, 60, 15, 15 and 3. A deck check may override individual limits. |
| `SERVER_TOKEN` | Empty enables anonymous access. A configured value requires the matching `x-server-token` HTTP header on business requests and WebSocket upgrades. |
| `NO_OPENAPI` | Set to 1 to disable the documentation routes. |
| `host`, `port` | Bind address and port. |

## API

See the [HTTP API reference](docs/api.md) for resource queries, deck validation, readiness and the OpenAPI document. See the [WebSocket protocol](docs/websocket.md) for duel sessions.

## Build and verify

```sh
npm run lint
npm test
npm run typecheck
docker build -t ygoangelus:local .
docker compose -f test/docker-compose.yml up -d angelus
docker compose -f test/docker-compose.yml run --rm smoke
docker compose -f test/docker-compose.yml down
```

The amd64 CI runner uses its local npm tarball cache and verifies the lockfile integrity hashes. The arm64 runner downloads from the public npm registry.

The resource container image includes default card data and scripts. Mount additional resource roots read-only and add them to `YGOPRO_PATH` for an alternate environment. Send SIGTERM to stop admitting sessions and allow active duels to finish within the platform's termination grace period.

The Docker build accepts `OCGCORE_REF` (develop), `SCRIPT_REF` (master) and `YGOPRO_REF` (server) as branches, tags or full commits. Premake uses `PREMAKE_REPO` (the upstream premake-core repository) and `PREMAKE_REF` (the `v5.0.0` tag). CI resolves the three resource/core refs once, pins the base image digests, then passes the same inputs to the native amd64 and arm64 builds. Resources are checked out with Alpine Git. The application, tests and runtime use Node 26 on Alpine. The WASM is compiled using Debian 13 Emscripten, Lua 5.4.9 and Premake 5.0.0 for the ESM glue shipped with `koishipro-core.js@2.0.0-0`. The compiler, source commit and WASM hash are recorded in `/app/engine/core-build.txt`. CI saves `build-inputs.env` and publishes manifests after both architecture jobs run the fixture replay against the bundled and source-built engines. The WS tests include a real 60-second native PROCESS stall and 256 pipelined requests on a single connection.

## License

[MIT](LICENSE), matching srvpro2.
