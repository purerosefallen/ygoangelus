import {
  Injectable,
  BeforeApplicationShutdown,
  OnModuleDestroy,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import { ConfigService } from '@nestjs/config';
import { TokenGuard, BlankReturnMessageDto } from 'nesties';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { ResourceLoader } from '../resources/resource-loader.service.js';
import { DuelWorkerService } from './duel-worker.service.js';
import { DuelSession } from './duel-session.js';

const protocol = 'ygoangelus.v1';

function rejectUpgrade(socket: Duplex, status: number, reason: string) {
  const body = JSON.stringify(new BlankReturnMessageDto(status, reason));
  socket.end(
    [
      `HTTP/1.1 ${status} ${reason}`,
      'Connection: close',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      '',
      body,
    ].join('\r\n'),
  );
}
@Injectable()
export class DuelUpgradeService
  implements OnApplicationBootstrap, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    handleProtocols: () => protocol,
  });
  private readonly sessions = new Set<DuelSession>();
  private draining = false;
  private drained?: () => void;
  constructor(
    private readonly adapter: HttpAdapterHost,
    private readonly guard: TokenGuard,
    private readonly resources: ResourceLoader,
    private readonly workers: DuelWorkerService,
    private readonly config: ConfigService,
  ) {}
  get activeSessions() {
    return this.sessions.size;
  }
  onApplicationBootstrap() {
    this.server.on('upgrade', this.onUpgrade);
  }
  private get server(): Server {
    return this.adapter.httpAdapter.getHttpServer();
  }
  private readonly onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    socket.once('error', () => socket.destroy());
    void this.upgrade(req, socket, head).catch(() => socket.destroy());
  };
  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (req.url?.split('?')[0] !== '/duel')
      return rejectUpgrade(socket, 404, 'Not Found');
    try {
      if (!(await this.guard.canActivate(new ExecutionContextHost([req]))))
        return rejectUpgrade(socket, 401, 'Unauthorized');
    } catch {
      return rejectUpgrade(socket, 401, 'Unauthorized');
    }
    if (this.draining || !this.resources.ready)
      return rejectUpgrade(socket, 503, 'Service Unavailable');
    const offered = req.headers['sec-websocket-protocol']
      ?.split(',')
      .map((name) => name.trim());
    if (!offered?.includes(protocol))
      return rejectUpgrade(socket, 400, 'Bad Request');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.openSession(ws));
  }
  private openSession(ws: WebSocket) {
    const session = new DuelSession(
      ws,
      this.resources,
      this.workers,
      this.config.get('OCGCORE_DEBUG_LOG'),
      () => {
        this.sessions.delete(session);
        if (this.draining && !this.sessions.size) this.drained?.();
      },
    );
    this.sessions.add(session);
  }
  onModuleDestroy() {
    this.draining = true;
    for (const session of this.sessions) session.drain();
  }
  async beforeApplicationShutdown() {
    if (this.sessions.size)
      await new Promise<void>((resolve) => {
        this.drained = resolve;
      });
    this.server.off('upgrade', this.onUpgrade);
    this.wss.close();
  }
}
