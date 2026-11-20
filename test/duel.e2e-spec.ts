import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import * as P from 'ygopro-msg-encode';
import { connect, startPacket } from './client.mjs';
import { appFixture } from './app.js';

describe('duel worker over WebSocket', () => {
  let env: Awaited<ReturnType<typeof appFixture>>;
  beforeAll(async () => {
    env = await appFixture('secret');
  });
  afterAll(async () => {
    await env?.close();
  });
  it('rejects bad handshakes before allocating workers', async () => {
    const create = vi.spyOn(env.workers, 'create');
    try {
      for (const token of [undefined, 'wrong'])
        await expect(connect(env.wsUrl, token)).rejects.toThrow('401');
      await expect(connect(env.wsUrl, 'secret', 'unrelated')).rejects.toThrow(
        '400',
      );
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });
  it('processes one native batch, accepts responses, reports retry and finishes a tag duel', async () => {
    const client = await connect(env.wsUrl, 'secret');
    try {
      expect((await client.call(new P.YGOProAngelusProcess())).code).toBe(
        P.YGOProAngelusErrorCode.BadState,
      );
      expect(await client.call(startPacket(true))).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      expect((await client.call(startPacket(true))).code).toBe(
        P.YGOProAngelusErrorCode.BadState,
      );
      expect(
        (
          await client.call(
            new P.YGOProAngelusQueryFieldCount().fromPartial({
              player: 0,
              location: 64,
            }),
          )
        ).count,
      ).toBe(1);
      expect(
        (await client.call(new P.YGOProAngelusQueryFieldInfo())).raw.length,
      ).toBeGreaterThan(1);
      let status = 0;
      for (let i = 0; i < 200 && status !== 1; i++) {
        status = (await client.call(new P.YGOProAngelusProcess())).status;
      }
      expect(status).toBe(1);
      expect(
        await client.call(
          new P.YGOProAngelusResponse().fromPartial({
            response: Uint8Array.of(255, 255, 255, 255),
          }),
        ),
      ).toBeInstanceOf(P.YGOProAngelusResponseOk);
      let retry = 0;
      for (let i = 0; i < 20 && !retry; i++)
        retry = (await client.call(new P.YGOProAngelusProcess())).status;
      expect(retry).toBe(3);
      expect(
        (await client.call(new P.YGOProAngelusFinish())).decodeRegistry().from,
      ).toBe('fixture');
      expect(await client.closed).toBe(1000);
    } finally {
      client.ws.terminate();
    }
  });
});
