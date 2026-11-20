import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';
import { it, expect } from 'vitest';
import { createResources } from './fixtures/resources.mjs';
import { ResourceLoadWorker } from '../dist/resources/resource-load.worker.js';
import { ResourceSnapshot } from '../dist/resources/resource-snapshot.js';
import { scriptReader } from '../dist/resources/script-reader.js';
import { resolveConfig } from '../dist/config/load-config.js';

it('resolves expansion CDB priority, alias chains, YPK scripts and damaged archives', async () => {
  const root = await mkdtemp(join(tmpdir(), 'angelus-expansions-'));
  try {
    await createResources(root);
    const folder = join(root, 'expansions');
    await mkdir(folder);
    const SQL = await initSqlJs();
    const database = new SQL.Database(await readFile(join(root, 'cards.cdb')));
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
    const base = new SQL.Database(await readFile(join(root, 'cards.cdb')));
    base.run(
      'INSERT INTO datas SELECT 500,ot,12345,0,type,atk,def,level,race,attribute,0 FROM datas WHERE id=1',
    );
    await writeFile(join(root, 'cards.cdb'), base.export());
    base.close();
    const config = resolveConfig({ YGOPRO_PATH: root }, {}).resources;
    const worker = new ResourceLoadWorker();
    const data = await worker.load(config, '');
    const snapshot = new ResourceSnapshot(data!);
    expect(snapshot.cards.read(1)?.attack).toBe(1900);
    expect(snapshot.cards.read(501)).toMatchObject({
      alias: 500,
      ruleCode: 12345,
    });
    expect(snapshot.lists.map((l) => l.name)).toEqual(['First', 'Example OCG']);
    const script = scriptReader(data!.duel.scripts)('./script/packed.lua');
    expect(new TextDecoder().decode(script as Uint8Array)).toBe('return 17');
    expect(await worker.load(config, data!.hash)).toBeNull();
    await writeFile(join(folder, 'incomplete.zip'), 'broken');
    await expect(worker.load(config, data!.hash)).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
