import request from 'supertest';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { appFixture } from './app.js';
describe('resource HTTP API', () => {
  let env: Awaited<ReturnType<typeof appFixture>>;
  beforeAll(async () => {
    env = await appFixture('secret');
  });
  afterAll(async () => {
    await env?.close();
  });
  const get = (path: string) =>
    request(env.app.getHttpServer()).get(path).set('x-server-token', 'secret');
  const post = (body: object) =>
    request(env.app.getHttpServer())
      .post('/check-deck')
      .set('x-server-token', 'secret')
      .send(body);
  it('documents real routes, response DTOs, optional token and errors', async () => {
    const { body } = await get('/docs-json').expect(200);
    expect(Object.keys(body.paths).sort()).toEqual([
      '/card-data',
      '/check-deck',
      '/lflists',
      '/readyz',
    ]);
    const op = body.paths['/card-data'].get;
    expect(op.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', required: false }),
        expect.objectContaining({ name: 'x-server-token', required: false }),
      ]),
    );
    expect(body.paths['/check-deck'].post.responses).toHaveProperty('404');
    expect(JSON.stringify(body.components.schemas)).toContain('maxCopies');
    expect(body.info.description).toContain(
      'github.com/purerosefallen/ygoangelus/blob/master/docs/websocket.md',
    );
  });
  it('requires the configured token only for business endpoints', async () => {
    const server = request(env.app.getHttpServer());
    await server.get('/readyz').expect(200);
    for (const token of ['', 'wrong'])
      expect(
        (await server.get('/lflists').set('x-server-token', token).expect(401))
          .body.success,
      ).toBe(false);
    expect((await get('/lflists').expect(200)).body.data.lists[0].name).toBe(
      'Example OCG',
    );
  });
  it('lists parsed cards and distinguishes omitted from invalid IDs', async () => {
    const all = (await get('/card-data').expect(200)).body.data;
    expect(all.length).toBe(41);
    expect(all[40]).toMatchObject({
      code: 101,
      defense: 0,
      linkMarker: 2,
      setcode: Array(16).fill(0),
    });
    expect(Object.keys(all[40])).toHaveLength(14);
    expect((await get('/card-data?id=101,x,1,,101,99999')).body.data).toEqual([
      all[40],
      all[0],
    ]);
    for (const query of ['', 'x,-1,1.5', '99999'])
      expect((await get('/card-data?id=' + query)).body.data).toEqual([]);
  });
  it('validates YDKE, preserves zero limits and reports unknown titles separately', async () => {
    const deck = 'ydke://AQAAAA==!!!';
    expect((await post({ deck })).body.data).toEqual({
      valid: false,
      error: { reason: 6, code: 1 },
    });
    expect((await post({ deck, limits: { minMain: 0 } })).body.data).toEqual({
      valid: true,
    });
    expect(
      (await post({ deck, lflist: 'Example OCG', limits: { minMain: 0 } })).body
        .data.error.reason,
    ).toBe(1);
    expect(
      (await post({ deck, lflist: 'absent' }).expect(404)).body.message,
    ).toBe('LFLIST_NOT_FOUND');
    for (const input of [
      { deck: 'bad' },
      { deck, limits: { minMain: 90 } },
      { deck, limits: { minMain: -1 } },
    ]) {
      const res = await post(input).expect(400);
      expect(res.body).toMatchObject({
        success: false,
        message: 'INVALID_REQUEST',
      });
    }
  });
});
