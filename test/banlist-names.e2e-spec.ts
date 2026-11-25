import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import initSqlJs from 'sql.js';
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

it('checks artwork limits and the rule-name copy cap through the HTTP API', async () => {
  const albaz = 68468459;
  const albazArtwork = 68468460;
  const white = 73819701;
  const env = await appFixture('', async (root) => {
    const path = join(root, 'cards.cdb');
    const SQL = await initSqlJs();
    const db = new SQL.Database(await readFile(path));
    try {
      for (const [code, alias] of [
        [albaz, 0],
        [albazArtwork, albaz],
        [white, albaz],
      ]) {
        db.run('INSERT INTO datas VALUES (?,3,?,0,17,1000,800,4,1,1,0)', [
          code,
          alias,
        ]);
      }
      await writeFile(path, db.export());
      await writeFile(
        join(root, 'lflist.conf'),
        `!White Limited\n${white} 1\n!Albaz Limited\n${albaz} 1\n`,
      );
    } finally {
      db.close();
    }
    return {};
  });
  try {
    const api = request(env.app.getHttpServer());
    const encode = (codes: number[]) => {
      const bytes = Buffer.alloc(codes.length * 4);
      codes.forEach((code, i) => bytes.writeUInt32LE(code, i * 4));
      return bytes.toString('base64');
    };
    const check = async (
      main: number[],
      side: number[],
      lflist = 'White Limited',
      maxCopies = 3,
    ) => {
      const { body } = await api
        .post('/check-deck')
        .send({
          deck: `ydke://${encode(main)}!!${encode(side)}!`,
          lflist,
          limits: { minMain: 0, maxCopies },
        })
        .expect(200);
      return body.data;
    };
    expect(await check([albaz, albazArtwork], [albaz])).toEqual({ valid: true });
    expect(await check([white, albaz], [albazArtwork])).toEqual({ valid: true });
    expect(await check([white], [white])).toEqual({
      valid: false,
      error: { reason: 1, code: white },
    });
    expect(await check([white, albaz], [albaz, albazArtwork])).toEqual({
      valid: false,
      error: { reason: 5, code: albazArtwork },
    });
    expect(await check([albaz], [albazArtwork], 'Albaz Limited')).toEqual({
      valid: false,
      error: { reason: 1, code: albaz },
    });
    expect(await check([white, albaz], [albazArtwork], 'White Limited', 2)).toEqual({
      valid: false,
      error: { reason: 5, code: albazArtwork },
    });
  } finally {
    await env.close();
  }
});
