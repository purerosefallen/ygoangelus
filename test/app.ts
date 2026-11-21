import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/bootstrap.js';
import {
  type ResourceConfig,
  resolveConfig,
} from '../dist/config/load-config.js';
import { ResourceLoader } from '../dist/resources/resource-loader.service.js';
import { DuelWorkerService } from '../dist/duel/duel-worker.service.js';
import { createResources } from './fixtures/resources.mjs';
export async function appFixture(
  token = '',
  configureResources?: (root: string) => Promise<Partial<ResourceConfig>>,
) {
  const root = await mkdtemp(join(tmpdir(), 'angelus-e2e-'));
  await createResources(root);
  const settings = resolveConfig(
    {},
    {
      YGOPRO_PATH: root,
      SERVER_TOKEN: token,
    },
  );
  if (configureResources)
    Object.assign(settings.resources, await configureResources(root));
  const config = new ConfigService(settings);
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  return {
    app,
    root,
    url,
    wsUrl: url.replace('http', 'ws') + '/duel',
    loader: app.get(ResourceLoader),
    workers: app.get(DuelWorkerService),
    async close() {
      await app.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
