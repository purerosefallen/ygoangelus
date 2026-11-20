import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import * as P from 'ygopro-msg-encode';
import type { DuelWorker } from '../dist/duel/duel-worker.service.js';
import { appFixture } from './app.js';
import { connect, startPacket } from './client.mjs';

it(
  'terminates a real OCGCore PROCESS stuck inside Lua at the production deadline',
  { timeout: 100_000 },
  async () => {
    const env = await appFixture();
    const live = await connect(env.wsUrl);
    const stuck = await connect(env.wsUrl);
    const create = vi.spyOn(env.workers, 'create');
    try {
      expect(await live.call(startPacket())).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      // The normal duel keeps its original script snapshot. This isolated test
      // generation first yields a real prompt, then occupies the WASM thread.
      await writeFile(
        join(env.root, 'script/patches/entry.lua'),
        [
          'local effect = Effect.GlobalEffect()',
          'effect:SetType(0x02 + 0x800)',
          'effect:SetCode(1040)',
          'effect:SetOperation(function(effect)',
          '  effect:Reset()',
          '  if Duel.SelectYesNo(0,1) then while true do end end',
          'end)',
          'Duel.RegisterEffect(effect,0)',
        ].join('\n'),
      );
      await env.loader.refresh();
      expect(await stuck.call(startPacket())).toBeInstanceOf(
        P.YGOProAngelusStartOk,
      );
      const worker: DuelWorker = await create.mock.results[1].value;
      const finalize = vi.spyOn(worker, 'finalize');
      let prompt: P.YGOProMsgSelectYesNo | undefined;
      for (let i = 0; i < 64 && !prompt; i++) {
        const result = await stuck.call(new P.YGOProAngelusProcess());
        prompt = result
          .decodeMessages()
          .find((message) => message instanceof P.YGOProMsgSelectYesNo);
      }
      expect(prompt).toBeInstanceOf(P.YGOProMsgSelectYesNo);
      const response = new P.YGOProAngelusResponse().fromPartial({
        response: prompt!.prepareResponse(true),
      });
      expect(await stuck.call(response)).toBeInstanceOf(
        P.YGOProAngelusResponseOk,
      );

      const started = performance.now();
      const blocked = stuck.call(new P.YGOProAngelusProcess());
      // Give the command time to enter the real native call, then use another
      // duel and the HTTP server while that call is still outstanding.
      await delay(150);
      expect((await fetch(env.url + '/readyz')).status).toBe(200);
      expect(await live.call(new P.YGOProAngelusProcess())).toBeInstanceOf(
        P.YGOProAngelusProcessResult,
      );
      const pendingQuery = stuck.call(new P.YGOProAngelusQueryFieldInfo()).then(
        () => false,
        () => true,
      );
      const timeout = await blocked;
      expect(timeout).toBeInstanceOf(P.YGOProAngelusError);
      expect(timeout.code).toBe(P.YGOProAngelusErrorCode.CoreTimeout);
      expect(performance.now() - started).toBeGreaterThanOrEqual(59_000);
      expect(await stuck.closed).toBe(1011);
      expect(await pendingQuery).toBe(true);
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(await live.call(new P.YGOProAngelusFinish())).toBeInstanceOf(
        P.YGOProAngelusFinishOk,
      );
    } finally {
      stuck.ws.terminate();
      live.ws.terminate();
      create.mockRestore();
      await env.close();
    }
  },
);

it('pipelines 256 requests on one socket in FIFO order with a single worker call in flight', async () => {
  const env = await appFixture();
  const client = await connect(env.wsUrl);
  const create = vi.spyOn(env.workers, 'create');
  let enteredFirst!: () => void;
  let unblock!: () => void;
  const firstCall = new Promise<void>((resolve) => {
    enteredFirst = resolve;
  });
  const releaseFirst = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  try {
    expect(await client.call(startPacket())).toBeInstanceOf(
      P.YGOProAngelusStartOk,
    );
    const worker: DuelWorker = await create.mock.results[0].value;
    const execute = worker.execute.bind(worker);
    const entered: number[] = [],
      received: number[] = [];
    let active = 0,
      maxActive = 0;
    vi.spyOn(worker, 'execute').mockImplementation(async (frame, resources) => {
      const id = new DataView(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      ).getUint32(1, true);
      entered.push(id);
      active++;
      maxActive = Math.max(active, maxActive);
      try {
        if (entered.length === 1) {
          enteredFirst();
          await releaseFirst;
        }
        return await execute(frame, resources);
      } finally {
        active--;
      }
    });
    client.ws.on('message', (data) => {
      const packet = P.YGOProAngelusStoc.getInstanceFromPayload(data);
      if (packet?.requestId) received.push(packet.requestId);
    });
    const requests = Array.from({ length: 256 }, (_, index) =>
      index % 2 === 0
        ? new P.YGOProAngelusQueryFieldCount().fromPartial({
            player: 0,
            location: 64,
          })
        : new P.YGOProAngelusQueryFieldInfo(),
    );
    const pending = Promise.all(requests.map((packet) => client.call(packet)));
    await firstCall;
    await delay(25);
    const enteredBeforeRelease = [...entered];
    unblock();
    const results = await pending;
    expect(enteredBeforeRelease).toEqual([2]);
    expect(maxActive).toBe(1);
    const ids = requests.map((p) => p.requestId);
    expect(entered).toEqual(ids);
    expect(received).toEqual(ids);
    for (const [index, result] of results.entries()) {
      expect(result.requestId).toBe(ids[index]);
      if (index % 2 === 0) expect(result.count).toBe(1);
      else expect(result.raw.length).toBeGreaterThan(0);
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(await client.call(new P.YGOProAngelusFinish())).toBeInstanceOf(
      P.YGOProAngelusFinishOk,
    );
    expect(await client.closed).toBe(1000);
  } finally {
    unblock();
    client.ws.terminate();
    create.mockRestore();
    await env.close();
  }
});
