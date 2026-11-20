import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as P from 'ygopro-msg-encode';
import { connect, startPacket } from './client.mjs';
import { createResources } from './fixtures/resources.mjs';

async function trace(root, wasm, port) {
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      YGOPRO_PATH: root,
      DEFAULT_OCGCORE_WASM_PATH: '',
      OCGCORE_WASM_PATH: wasm,
      SERVER_TOKEN: 'smoke',
      port: String(port),
    },
    stdio: 'inherit',
  });
  const exited = once(child, 'exit');
  try {
    let ready = false;
    for (let n = 0; n < 200; n++) {
      if (child.exitCode !== null)
        throw new Error('Image server exited during startup');
      if (
        await fetch('http://127.0.0.1:' + port + '/readyz')
          .then((r) => r.ok)
          .catch(() => false)
      ) {
        ready = true;
        break;
      }
      await delay(100);
    }
    assert(ready, 'Timed out waiting for resource readiness');
    const http = await fetch('http://127.0.0.1:' + port + '/card-data?id=101', {
      headers: { 'x-server-token': 'smoke' },
    });
    assert.equal((await http.json()).data[0].linkMarker, 2);
    const client = await connect('ws://127.0.0.1:' + port + '/duel', 'smoke');
    try {
      const start = startPacket().setRegistry({ smoke: '1' });
      assert((await client.call(start)) instanceof P.YGOProAngelusStartOk);
      child.kill('SIGTERM');
      let draining = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          (await fetch('http://127.0.0.1:' + port + '/readyz')).status === 503
        ) {
          draining = true;
          break;
        }
        await delay(25);
      }
      assert(
        draining,
        'Active duel must remain reachable while the instance drains',
      );
      await assert.rejects(
        connect('ws://127.0.0.1:' + port + '/duel', 'smoke'),
        /503/,
      );
      const field = await client.call(new P.YGOProAngelusQueryFieldInfo());
      const query = await client.call(
        new P.YGOProAngelusQueryFieldCard().fromPartial({
          player: 0,
          location: 1,
          queryFlag: 1,
          useCache: 0,
        }),
      );
      const frames = [];
      let won = false,
        answered = false;
      for (let i = 0; i < 256; i++) {
        const result = await client.call(new P.YGOProAngelusProcess());
        assert(result instanceof P.YGOProAngelusProcessResult, result.message);
        frames.push(Buffer.from(result.toPayload()).toString('hex'));
        if (result.status === 2) {
          won = true;
          break;
        }
        if (result.status === 1) {
          const prompt = result
            .decodeMessages()
            .find((m) => m instanceof P.YGOProMsgResponseBase);
          assert(
            prompt instanceof P.YGOProMsgSelectYesNo,
            'Expected fixture prompt',
          );
          await client.call(
            new P.YGOProAngelusResponse().fromPartial({
              response: prompt.prepareResponse(true),
            }),
          );
          answered = true;
        }
      }
      assert(
        won && answered,
        'Expected a completed duel and at least one response',
      );
      const finish = await client.call(new P.YGOProAngelusFinish());
      assert.equal(finish.decodeRegistry().generation, 'first');
      assert(
        client.events.some((event) =>
          event.message.includes('late script ran'),
        ),
        'Missing Lua callback',
      );
      assert.equal(await client.closed, 1000);
      return {
        frames,
        field: Buffer.from(field.raw).toString('hex'),
        query: Buffer.from(query.raw).toString('hex'),
        events: client.events.map((e) => [e.type, e.message]),
        registry: finish.decodeRegistry(),
      };
    } finally {
      client.ws.terminate();
    }
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
}

const root = await mkdtemp(join(tmpdir(), 'angelus-image-'));
try {
  await createResources(root);
  const wasm = process.env.DEFAULT_OCGCORE_WASM_PATH;
  assert(wasm && (await readFile(wasm)).length, 'Expected a source-built WASM');
  const expected = await trace(root, '', 18127);
  const actual = await trace(root, wasm, 18128);
  assert.deepEqual(actual, expected);
  console.log(
    'Bundled and source-built engines agree on',
    actual.frames.length,
    'native batches, field/card queries, script callbacks, registry and win',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
