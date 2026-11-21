import { it, expect, vi } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import JSZip from 'jszip';
import { join } from 'node:path';
import * as P from 'ygopro-msg-encode';
import request from 'supertest';
import { appFixture } from './app.js';
import { connect, startPacket } from './client.mjs';
import { fixtureWasm } from './fixtures/wasm.js';
import type { DuelResources } from '../dist/resources/resource-snapshot.js';

async function writeScriptPack(root: string, marker: string) {
  const pack = new JSZip();
  pack.file(
    'script/packed.lua',
    'Duel.SetRegistryValue("pack", "' + marker + '")',
  );
  await writeFile(
    join(root, 'scripts.ypk'),
    await pack.generateAsync({ type: 'nodebuffer' }),
  );
}

it('refreshes card data, banlists and WASM together and reads loose Lua on demand', async () => {
  const originalWasm = await fixtureWasm(1);
  const nextWasm = await fixtureWasm(2);
  const env = await appFixture('', async (root) => {
    await mkdir(join(root, 'special'));
    await writeFile(
      join(root, 'special/special.lua'),
      'Duel.SetRegistryValue("extra_preload", "loaded")',
    );
    const wasmPath = join(root, 'core.wasm');
    await writeFile(wasmPath, originalWasm);
    await writeScriptPack(root, 'first');
    return {
      wasmPath,
      preload: [
        './script/patches/entry.lua',
        './script/special.lua',
        './script/init.lua',
        './special/special.lua',
      ],
    };
  });
  const engines: Buffer[] = [];
  const create = env.workers.create.bind(env.workers);
  const spy = vi.spyOn(env.workers, 'create').mockImplementation(async () => {
    const worker = await create();
    const execute = worker.execute.bind(worker);
    vi.spyOn(worker, 'execute').mockImplementation(
      (data, resources?: DuelResources) => {
        if (resources?.wasm) engines.push(Buffer.from(resources.wasm));
        return execute(data, resources);
      },
    );
    return worker;
  });
  const a = await connect(env.wsUrl);
  const b = await connect(env.wsUrl);
  try {
    expect(await a.call(startPacket())).toBeInstanceOf(P.YGOProAngelusStartOk);
    const oldHash = env.loader.snapshot.loaded.hash;
    await writeFile(
      join(env.root, 'script/late.lua'),
      'Duel.SetRegistryValue("generation","second") Duel.LoadScript("packed.lua")',
    );
    await writeScriptPack(env.root, 'second');
    await env.loader.refresh();
    expect(env.loader.snapshot.loaded.hash).toBe(oldHash);

    const cardFile = join(env.root, 'cards.cdb');
    await writeFile(join(env.root, 'lflist.conf'), '!New list\n2 0\n');
    await writeFile(join(env.root, 'core.wasm'), nextWasm);
    const SQL = await initSqlJs();
    const db = new SQL.Database(await readFile(cardFile));
    db.run('UPDATE datas SET type=17, def=2100 WHERE id=101');
    await writeFile(cardFile, db.export());
    db.close();

    const api = request(env.app.getHttpServer());
    expect((await api.get('/lflists')).body.data.lists[0].name).toBe(
      'Example OCG',
    );
    expect((await api.get('/card-data?id=101')).body.data[0].type).toBe(
      67108897,
    );
    const newListCheck = () =>
      api.post('/check-deck').send({
        deck: 'ydke://AgAAAA==!!!',
        lflist: 'New list',
        limits: { minMain: 0 },
      });
    await newListCheck().expect(404);

    await env.loader.refresh();
    expect((await api.get('/card-data?id=101')).body.data[0]).toMatchObject({
      type: 17,
      defense: 2100,
      linkMarker: 0,
    });
    expect((await api.get('/lflists')).body.data.lists[0].name).toBe(
      'New list',
    );
    expect((await newListCheck().expect(200)).body.data).toEqual({
      valid: false,
      error: { reason: 1, code: 2 },
    });
    expect(await b.call(startPacket())).toBeInstanceOf(P.YGOProAngelusStartOk);
    expect(engines).toEqual([originalWasm, nextWasm]);
    const query = new P.YGOProAngelusQueryFieldCount().fromPartial({
      player: 0,
      location: 64,
    });
    expect((await a.call(query)).count).toBe(1);
    expect((await b.call(query)).count).toBe(0);
    for (const [client, marker] of [
      [a, 'first'],
      [b, 'second'],
    ] as const) {
      for (let i = 0; i < 64; i++) {
        if ((await client.call(new P.YGOProAngelusProcess())).status === 1)
          break;
      }
      const end = await client.call(new P.YGOProAngelusFinish());
      expect(end.decodeRegistry()).toMatchObject({
        generation: 'second',
        extra_preload: 'loaded',
        pack: marker,
      });
    }

    await writeFile(join(env.root, 'core.wasm'), 'invalid wasm');
    const lastGood = env.loader.snapshot;
    await expect(env.loader.refresh()).rejects.toThrow();
    expect(env.loader.snapshot).toBe(lastGood);
  } finally {
    a.ws.terminate();
    b.ws.terminate();
    spy.mockRestore();
    await env.close();
  }
});
