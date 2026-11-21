import { readFile } from 'node:fs/promises';

export async function fixtureWasm(marker: number) {
  const wasm = await readFile(
    new URL(
      './vendor/wasm_esm/libocgcore.wasm',
      import.meta.resolve('koishipro-core.js'),
    ),
  );
  const section = Buffer.from([0, 3, 1, 120, marker]);
  return Buffer.concat([wasm, section]);
}
