import { expect, it } from 'vitest';
import { resolveConfig } from './load-config.js';
it('overlays environment on YAML and keeps zero and false options', () => {
  const config = resolveConfig(
    {
      NO_OPENAPI: true,
      SERVER_TOKEN: 'file',
      DECK_EXTRA_MAX: 7,
      YGOPRO_PATH: ['first', 'second'],
    },
    {
      SERVER_TOKEN: 'env',
      NO_OPENAPI: 'false',
      OCGCORE_DEBUG_LOG: '0',
      DECK_EXTRA_MAX: '0',
      EXTRA_SCRIPT_PATH: 'x.lua, y.lua',
    },
  );
  expect(config.resources.roots.map((p) => p.split('/').pop())).toEqual([
    'first',
    'second',
  ]);
  expect(config.resources.preload.slice(-2)).toEqual(['x.lua', 'y.lua']);
  expect(config).toMatchObject({
    SERVER_TOKEN: 'env',
    NO_OPENAPI: false,
    OCGCORE_DEBUG_LOG: false,
    limits: { minMain: 40, maxExtra: 0 },
  });
  expect(() => resolveConfig({ DECK_MAIN_MIN: 90 }, {})).toThrow();
});

it.each([undefined, '', '0', '-1', 'bad'])(
  'uses the legacy ten-minute interval for %s',
  (raw) => {
    const config = resolveConfig({}, { YGOPRO_RESOURCE_REFRESH_MINUTES: raw });
    expect(config.resources.refreshMinutes).toBe(10);
  },
);

it('keeps both WASM paths and preserves a positive interval', () => {
  expect(
    resolveConfig(
      {},
      {
        OCGCORE_WASM_PATH: '/data/core.wasm',
        DEFAULT_OCGCORE_WASM_PATH: '/app/engine/libocgcore.wasm',
        YGOPRO_RESOURCE_REFRESH_MINUTES: '1',
      },
    ).resources,
  ).toMatchObject({
    wasmPath: '/data/core.wasm',
    defaultWasmPath: '/app/engine/libocgcore.wasm',
    refreshMinutes: 1,
  });
});
