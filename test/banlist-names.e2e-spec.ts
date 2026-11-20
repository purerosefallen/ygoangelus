import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { expect, it } from 'vitest';
import { YGOProLFListItem } from 'ygopro-lflist-encode';
import { appFixture } from './app.js';

it('lists duplicate banlists in load order and checks decks by their returned names', async () => {
  const env = await appFixture();
  try {
    const expansions = join(env.root, 'expansions');
    await mkdir(expansions);
    await writeFile(join(expansions, 'lflist.conf'), '!OCG\n1 0\n!TCG\n3 0\n');
    await writeFile(
      join(env.root, 'lflist.conf'),
      '!OCG\n2 0\n!OCG\n1 0\n!TCG\n2 0\n!TCG (2)\n4 0\n',
    );
    await env.loader.refresh();

    const api = request(env.app.getHttpServer());
    const { body } = await api.get('/lflists').expect(200);
    const expected = [
      { name: 'OCG', banned: 1 },
      { name: 'TCG', banned: 3 },
      { name: 'OCG (2)', banned: 2 },
      { name: 'OCG (3)', banned: 1 },
      { name: 'TCG (3)', banned: 2 },
      { name: 'TCG (2)', banned: 4 },
    ];
    expect(body.data.lists).toEqual(
      expected.map(({ name, banned }) => ({
        name,
        hash:
          new YGOProLFListItem({
            entries: [{ code: banned, limit: 0 }],
          }).getHash() >>> 0,
      })),
    );

    // The deck contains cards 1 through 4. Each list forbids exactly one of them.
    for (const { name, banned } of expected) {
      const result = await api
        .post('/check-deck')
        .send({
          deck: 'ydke://AQAAAAIAAAADAAAABAAAAA==!!!',
          lflist: name,
          limits: { minMain: 0 },
        })
        .expect(200);
      expect(result.body.data).toEqual({
        valid: false,
        error: { reason: 1, code: banned },
      });
    }
  } finally {
    await env.close();
  }
});
