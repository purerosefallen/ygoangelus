import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { join } from 'node:path';
import * as P from 'ygopro-msg-encode';
import request from 'supertest';
import { appFixture } from './app.js';
import { connect, startPacket } from './client.mjs';

describe('resource generations', () => {
  it('preserves scripts for an active duel and survives a broken refresh', async () => {
    const env = await appFixture();
    const a = await connect(env.wsUrl),
      b = await connect(env.wsUrl);
    try {
      expect(await a.call(startPacket())).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      await writeFile(
        join(env.root, 'script/late.lua'),
        'Duel.SetRegistryValue("generation","second")',
      );
      await writeFile(join(env.root, 'lflist.conf'), '!New list\n2 0\n');
      const cardFile = join(env.root, 'cards.cdb');
      const SQL = await initSqlJs();
      const db = new SQL.Database(await readFile(cardFile));
      db.run('UPDATE datas SET type=17, def=2100 WHERE id=101');
      await writeFile(cardFile, db.export());
      db.close();
      await env.loader.refresh();
      expect(
        (await request(env.app.getHttpServer()).get('/card-data?id=101')).body
          .data[0],
      ).toMatchObject({ type: 17, defense: 2100, linkMarker: 0 });
      expect(
        (await request(env.app.getHttpServer()).get('/lflists')).body.data
          .lists[0].name,
      ).toBe('New list');
      expect(await b.call(startPacket())).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      const query = new P.YGOProAngelusQueryFieldCount().fromPartial({
        player: 0,
        location: 64,
      });
      expect((await a.call(query)).count).toBe(1);
      expect((await b.call(query)).count).toBe(0);
      for (const [client, expected] of [
        [a, 'first'],
        [b, 'second'],
      ] as const) {
        for (let i = 0; i < 64; i++) {
          if ((await client.call(new P.YGOProAngelusProcess())).status === 1)
            break;
        }
        const end = await client.call(new P.YGOProAngelusFinish());
        expect(end.decodeRegistry().generation).toBe(expected);
      }
      await writeFile(join(env.root, 'cards.cdb'), 'broken');
      await expect(env.loader.refresh()).rejects.toThrow();
      expect(
        (await request(env.app.getHttpServer()).get('/card-data?id=1')).body
          .data[0].code,
      ).toBe(1);
    } finally {
      a.ws.terminate();
      b.ws.terminate();
      await env.close();
    }
  });
});
