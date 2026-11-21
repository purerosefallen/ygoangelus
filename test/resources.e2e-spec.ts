import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { it, expect } from 'vitest';
import { DirScriptReaderEx } from 'koishipro-core.js';
import { createResources } from './fixtures/resources.mjs';
import { fixtureWasm } from './fixtures/wasm.js';
import { ResourceLoadWorker } from '../dist/resources/resource-load.worker.js';
import { ResourceSnapshot } from '../dist/resources/resource-snapshot.js';
import { resolveConfig } from '../dist/config/load-config.js';

it('preserves expansion priority and skips bad or unavailable resource files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'angelus-expansions-'));
  try {
    await createResources(root);
    const folder = join(root, 'expansions');
    await mkdir(folder);
    const SQL = await initSqlJs();
    const cardBytes = await readFile(join(root, 'cards.cdb'));
    const database = new SQL.Database(cardBytes);
    database.run('UPDATE datas SET atk=1900 WHERE id=1');
    database.run(
      'INSERT INTO datas SELECT 501,ot,500,0,type,atk,def,level,race,attribute,0 FROM datas WHERE id=1',
    );
    const pack = new JSZip();
    pack.file('expansion.cdb', database.export());
    database.close();
    pack.file('script/packed.lua', 'return 17');
    pack.file('lflist.conf', '!First\n1 2\n');
    await writeFile(
      join(folder, 'expansion.ypk'),
      await pack.generateAsync({ type: 'nodebuffer' }),
    );

    const base = new SQL.Database(cardBytes);
    base.run(
      'INSERT INTO datas SELECT 500,ot,12345,0,type,atk,def,level,race,attribute,0 FROM datas WHERE id=1',
    );
    await writeFile(join(root, 'cards.cdb'), base.export());
    base.close();

    const emptyDatabase = new SQL.Database();
    await writeFile(join(folder, 'no-datas.cdb'), emptyDatabase.export());
    emptyDatabase.close();
    await writeFile(join(folder, 'broken.cdb'), 'broken');
    await writeFile(join(folder, 'incomplete.zip'), 'broken');
    await symlink(join(root, 'missing.cdb'), join(folder, 'dangling.cdb'));
    await symlink(join(root, 'missing-dir'), join(root, 'irrelevant-link'));

    const config = resolveConfig(
      { YGOPRO_PATH: [join(root, 'missing-root'), root] },
      {},
    ).resources;
    const worker = new ResourceLoadWorker();
    const data = await worker.load(config, '');
    const snapshot = new ResourceSnapshot(data!);
    expect(snapshot.cards.read(1)?.attack).toBe(1900);
    expect(snapshot.cards.read(501)).toMatchObject({
      alias: 500,
      ruleCode: 12345,
    });
    expect(snapshot.lists.map((list) => list.name)).toEqual([
      'First',
      'Example OCG',
    ]);
    const readScript = await DirScriptReaderEx(...data!.duel.roots);
    expect(
      new TextDecoder().decode(readScript('./script/packed.lua') as Uint8Array),
    ).toBe('return 17');
    expect(await worker.load(config, data!.hash)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('publishes an empty card cache when only invalid databases remain', async () => {
  const root = await createResources();
  try {
    const config = resolveConfig({ YGOPRO_PATH: root }, {}).resources;
    const worker = new ResourceLoadWorker();
    const first = await worker.load(config, '');
    await writeFile(join(root, 'cards.cdb'), 'invalid database');
    const next = await worker.load(config, first!.hash);
    expect(next!.duel.cards.count).toBe(0);
    expect(new ResourceSnapshot(next!).lists.map((list) => list.name)).toEqual([
      'Example OCG',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('falls through missing WASM files and propagates other read or validation errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'angelus-wasm-'));
  try {
    const explicit = join(root, 'explicit.wasm');
    const fallback = join(root, 'fallback.wasm');
    const primary = await fixtureWasm(1);
    const secondary = await fixtureWasm(2);
    const config = resolveConfig(
      {
        YGOPRO_PATH: root,
        OCGCORE_WASM_PATH: explicit,
        DEFAULT_OCGCORE_WASM_PATH: fallback,
      },
      {},
    ).resources;
    const worker = new ResourceLoadWorker();
    const bundled = await worker.load(config, '');
    expect(bundled!.duel.wasm).toBeUndefined();
    await writeFile(fallback, secondary);
    const fromDefault = await worker.load(config, bundled!.hash);
    expect(Buffer.from(fromDefault!.duel.wasm!)).toEqual(secondary);
    await writeFile(explicit, primary);
    const fromExplicit = await worker.load(config, fromDefault!.hash);
    expect(Buffer.from(fromExplicit!.duel.wasm!)).toEqual(primary);
    await expect(
      worker.load({ ...config, wasmPath: root }, ''),
    ).rejects.toMatchObject({ code: 'EISDIR' });
    await writeFile(explicit, 'invalid wasm');
    await expect(worker.load(config, '')).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
