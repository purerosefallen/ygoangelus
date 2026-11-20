import { describe, it, expect, vi } from 'vitest';
import * as P from 'ygopro-msg-encode';
import { bounded } from '../dist/duel/duel-worker.service.js';
import { appFixture } from './app.js';
import { connect, startPacket } from './client.mjs';

describe('worker cleanup', () => {
  it('reclaims only the disconnected socket and accepts later commands on its peer', async () => {
    const env = await appFixture();
    const old = await connect(env.wsUrl),
      live = await connect(env.wsUrl);
    const create = vi.spyOn(env.workers, 'create');
    try {
      expect(await old.call(startPacket())).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      expect(await live.call(startPacket())).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      const worker = await create.mock.results[0].value;
      const finalize = vi.spyOn(worker, 'finalize');
      old.ws.terminate();
      await old.closed;
      await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(1));
      expect(
        await live.call(new P.YGOProAngelusQueryFieldInfo()),
      ).toBeInstanceOf(P.YGOProAngelusQueryFieldInfoResult);
      const wrong = await live.call(new P.YGOProAngelusStartOk());
      expect(wrong.code).toBe(P.YGOProAngelusErrorCode.BadRequest);
      await live.call(new P.YGOProAngelusFinish());
      await live.closed;
    } finally {
      old.ws.terminate();
      live.ws.terminate();
      create.mockRestore();
      await env.close();
    }
  });
  it('reports a host-side timeout and finalizes the affected proxy once', async () => {
    const env = await appFixture();
    const client = await connect(env.wsUrl);
    const finalize = vi.fn(async () => {});
    const create = vi.spyOn(env.workers, 'create').mockResolvedValue({
      execute: () => bounded(new Promise<never>(() => {}), 15),
      finalize,
    } as Awaited<ReturnType<typeof env.workers.create>>);
    try {
      const error = await client.call(startPacket());
      expect(error.code).toBe(P.YGOProAngelusErrorCode.CoreTimeout);
      expect(await client.closed).toBe(1011);
      expect(finalize).toHaveBeenCalledTimes(1);
    } finally {
      client.ws.terminate();
      create.mockRestore();
      await env.close();
    }
  });
});
