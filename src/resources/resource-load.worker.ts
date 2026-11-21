import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import initSqlJs from 'sql.js';
import { YGOProCdb, type CardDataEntry } from 'ygopro-cdb-encode';
import { createOcgcoreWrapper, searchYGOProResource } from 'koishipro-core.js';
import { DefineWorker, WorkerMethod } from 'yuzuthread';
import type { ResourceConfig } from '../config/load-config.js';
import { packCards } from './card-storage.js';
import type { LoadedResources } from './resource-snapshot.js';

async function readWasm(paths: string[]) {
  for (const path of paths) {
    if (!path) continue;
    try {
      return { path, binary: await readFile(path) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

@DefineWorker({ moduleUrl: import.meta.url })
export class ResourceLoadWorker {
  private readonly logger = new Logger(ResourceLoadWorker.name);

  @WorkerMethod()
  async load(
    config: ResourceConfig,
    previousHash: string,
  ): Promise<LoadedResources | null> {
    const SQL = await initSqlJs();
    const dbs: YGOProCdb[] = [];
    const cards = new Map<number, CardDataEntry>();
    const listFiles: string[] = [];
    const hash = createHash('sha256');
    const add = (b: Uint8Array | string) => {
      const bytes = typeof b === 'string' ? Buffer.from(b) : b;
      hash.update(String(bytes.length) + ':');
      hash.update(bytes);
    };
    try {
      for await (const file of searchYGOProResource(...config.roots)) {
        const source = file.zipPath
          ? file.zipPath + ':' + file.path
          : file.path;
        if (basename(file.path) === 'lflist.conf') {
          const bytes = await file.read();
          listFiles.push(Buffer.from(bytes).toString('utf8'));
          add(source);
          add(bytes);
          continue;
        }
        if (!file.path.endsWith('.cdb')) continue;
        let db: YGOProCdb | undefined;
        try {
          const bytes = await file.read();
          db = new YGOProCdb(new SQL.Database(bytes)).noTexts();
          const entries = Array.from(db.step());
          for (const card of entries) {
            if (
              card.code > 0 &&
              card.code <= 0x7fffffff &&
              !cards.has(card.code)
            ) {
              cards.set(card.code, card);
            }
          }
          add(source);
          add(bytes);
          dbs.push(db);
        } catch (error) {
          db?.finalize();
          this.logger.warn('Failed to read ' + source + ': ' + String(error));
        }
      }
      const uniqueCards = Array.from(cards.values());
      for (const db of dbs) db.resolveRuleCode(uniqueCards);
    } finally {
      for (const db of dbs) db.finalize();
    }

    const engine = await readWasm([config.wasmPath, config.defaultWasmPath]);
    if (engine) {
      add(engine.path);
      add(engine.binary);
    }
    const digest = hash.digest('hex');
    if (digest === previousHash) return null;
    const wrapper = await createOcgcoreWrapper(
      engine ? { wasmBinary: engine.binary } : undefined,
    );
    wrapper.finalize();
    let wasm: SharedArrayBuffer | undefined;
    if (engine) {
      wasm = new SharedArrayBuffer(engine.binary.length);
      new Uint8Array(wasm).set(engine.binary);
    }
    return {
      hash: digest,
      listFiles,
      duel: {
        cards: packCards(cards.values()),
        roots: config.roots,
        wasm,
        preload: config.preload,
      },
    };
  }
}
