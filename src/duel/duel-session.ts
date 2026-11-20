import WebSocket, { type RawData } from 'ws';
import { Logger } from '@nestjs/common';
import * as P from 'ygopro-msg-encode';
import { OcgcoreMessageType } from 'koishipro-core.js';
import type { ResourceLoader } from '../resources/resource-loader.service.js';
import {
  bounded,
  DuelTimeout,
  DuelWorkerService,
  type DuelWorker,
} from './duel-worker.service.js';

export class DuelSession {
  private readonly logger = new Logger(DuelSession.name);
  private worker?: DuelWorker;
  private opening?: Promise<DuelWorker>;
  private retirement?: Promise<void>;
  private closed = false;
  private finishing = false;
  private queue = Promise.resolve();
  private lastId = 0;
  constructor(
    private readonly ws: WebSocket,
    private readonly loader: ResourceLoader,
    private readonly factory: DuelWorkerService,
    private readonly debug: boolean,
    private readonly done: () => void,
  ) {
    ws.on('error', () => ws.terminate());
    ws.once('close', () => {
      void this.close();
    });
    ws.on('message', (raw: RawData, binary: boolean) => {
      if (!binary) {
        this.ws.close(1003, 'Binary messages required');
        return;
      }
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : raw;
      this.queue = this.queue
        .then(() => this.handle(bytes))
        .catch(() => ws.terminate());
    });
  }
  private async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.releaseWorker();
    } finally {
      this.done();
    }
  }
  drain() {
    if (!this.opening) this.ws.close(1001, 'Server draining');
  }
  private releaseWorker() {
    // A disconnect may arrive while yuzuthread is still creating the proxy.
    // Wait for that exact allocation so the drain includes its termination.
    return (this.retirement ??= this.opening?.then(
      (worker) => worker.finalize(),
      () => {},
    ));
  }

  private async openWorker() {
    this.opening = this.factory.create();
    const worker = await this.opening;
    this.worker = worker;
    worker.onExit = () => {
      if (!this.closed && !this.finishing)
        this.ws.close(1011, 'Duel worker exited');
    };
    worker.onMessage = (type, message) => {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.debug) this.logger.debug(message);
      const packet = new P.YGOProAngelusCoreMessage().fromPartial({
        type:
          type === OcgcoreMessageType.DebugMessage
            ? P.YGOProAngelusCoreMessageType.DebugMessage
            : P.YGOProAngelusCoreMessageType.ScriptError,
        message,
      });
      void this.send(packet.toFullPayload()).catch(() => this.ws.terminate());
    };
  }
  private send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) =>
      this.ws.send(bytes, { binary: true }, (err) =>
        err ? reject(err) : resolve(),
      ),
    );
  }
  private async fail(
    id: number,
    code: P.YGOProAngelusErrorCode,
    message: string,
    fatal = false,
  ) {
    const error = new P.YGOProAngelusError().fromPartial({
      requestId: id,
      code,
      message,
    });
    await this.send(error.toFullPayload());
    if (fatal) {
      this.finishing = true;
      this.ws.close(1011, 'Engine closed');
    }
  }
  private async handle(bytes: Uint8Array) {
    if (this.closed || this.finishing || this.ws.readyState !== WebSocket.OPEN)
      return;
    if (bytes.length < 5) {
      this.ws.close(1002, 'Incomplete header');
      return;
    }
    const id = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(1, true);
    if (!id) {
      this.ws.close(1002, 'Missing request ID');
      return;
    }
    const E = P.YGOProAngelusErrorCode;
    if (id <= this.lastId) {
      await this.fail(id, E.BadRequest, 'Request IDs must increase');
      return;
    }
    this.lastId = id;
    let command: P.YGOProAngelusCtosBase;
    try {
      command = P.YGOProAngelusCtos.getInstanceFromPayload(bytes);
      if (!command) throw new Error('Unknown request');
    } catch {
      await this.fail(id, E.BadRequest, 'Invalid Angelus request');
      return;
    }
    const starting = command instanceof P.YGOProAngelusStart;
    if ((starting && this.worker) || (!starting && !this.worker)) {
      await this.fail(
        id,
        E.BadState,
        'Expected exactly one START per connection',
      );
      return;
    }
    try {
      const resources = starting ? this.loader.snapshot.loaded.duel : undefined;
      if (starting) {
        await this.openWorker();
        if (this.closed) return;
      }
      const finished = command instanceof P.YGOProAngelusFinish;
      const reply = await bounded(
        this.worker!.execute(bytes, resources),
        command instanceof P.YGOProAngelusProcess ? 60000 : 10000,
      );
      if (this.closed) return;
      await this.send(reply);
      if (finished) {
        this.finishing = true;
        this.ws.close(1000);
      }
    } catch (e) {
      this.finishing = true;
      try {
        await this.releaseWorker();
      } finally {
        if (!this.closed && this.ws.readyState === WebSocket.OPEN)
          await this.fail(
            id,
            e instanceof DuelTimeout ? E.CoreTimeout : E.CoreError,
            e instanceof Error ? e.message : 'Engine failed',
            true,
          );
      }
    }
  }
}
