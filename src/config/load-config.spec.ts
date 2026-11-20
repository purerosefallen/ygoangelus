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
