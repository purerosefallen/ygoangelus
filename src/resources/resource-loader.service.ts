import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runInWorker } from 'yuzuthread';
import type { ResourceConfig } from '../config/load-config.js';
import { ResourceLoadWorker } from './resource-load.worker.js';
import { ResourceSnapshot } from './resource-snapshot.js';

@Injectable()
export class ResourceLoader implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResourceLoader.name);
  private current?: ResourceSnapshot;
  private loading?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private stopping = false;
  get ready() {
    return !!this.current && !this.stopping;
  }
  get snapshot() {
    if (!this.current) throw new Error('Resources unavailable');
    return this.current;
  }
  constructor(private readonly config: ConfigService) {}
  async onModuleInit() {
    await this.refresh();
    const interval =
      this.config.getOrThrow<ResourceConfig>('resources').refreshMinutes;
    if (interval > 0)
      this.timer = setInterval(() => {
        void this.refresh().catch((e) => this.logger.error(e.message));
      }, interval * 60000).unref();
  }
  refresh(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (!this.loading)
      this.loading = this.reload().finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
  private async reload() {
    const config = this.config.getOrThrow<ResourceConfig>('resources');
    const data = await runInWorker(ResourceLoadWorker, (w) =>
      w.load(config, this.current?.loaded.hash ?? ''),
    );
    if (data && !this.stopping) {
      this.current = new ResourceSnapshot(data);
      this.logger.log('Loaded resource snapshot ' + data.hash);
    }
  }
  onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.timer);
    return this.loading;
  }
}
