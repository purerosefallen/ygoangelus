import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { YGOProCdb, type CardDataEntry } from 'ygopro-cdb-encode';
import { createOcgcoreWrapper } from 'koishipro-core.js';
import { DefineWorker, WorkerMethod } from 'yuzuthread';
import type { ResourceConfig } from '../config/load-config.js';
import { packCards } from './card-storage.js';
import { resourceFiles, type ScriptFiles } from './resource-files.js';
import { snapshotScripts } from './script-reader.js';
import type { LoadedResources } from './resource-snapshot.js';

@DefineWorker({ moduleUrl: import.meta.url })
export class ResourceLoadWorker {
  @WorkerMethod()
  async load(
    config: ResourceConfig,
    previousHash: string,
  ): Promise<LoadedResources | null> {
    const SQL = await initSqlJs();
    const dbs: YGOProCdb[] = [];
    const cards = new Map<number, CardDataEntry>();
    const listFiles: string[] = [];
    const archives: ScriptFiles[] = [];
    const hash = createHash('sha256');
    const add = (b: Uint8Array | string) => {
      const bytes = typeof b === 'string' ? Buffer.from(b) : b;
      hash.update(String(bytes.length) + ':');
      hash.update(bytes);
    };
    try {
      for await (const file of resourceFiles(config.roots)) {
        if (file.kind === 'packedScripts') {
          archives.push(file.files);
          continue;
        }
        add(file.name);
        add(file.bytes);
        if (file.kind === 'lflist') {
          listFiles.push(Buffer.from(file.bytes).toString('utf8'));
          continue;
        }
        const db = new YGOProCdb(new SQL.Database(file.bytes));
        dbs.push(db);
        for (const card of db.noTexts().step()) {
          if (
            card.code > 0 &&
            card.code <= 0x7fffffff &&
            !cards.has(card.code)
          ) {
            cards.set(card.code, card);
          }
        }
      }
      if (!cards.size)
        throw new Error('No usable cards in configured resource roots');
      const uniqueCards = Array.from(cards.values());
      for (const db of dbs) db.resolveRuleCode(uniqueCards);
    } finally {
      for (const db of dbs) db.finalize();
    }
    const scripts = await snapshotScripts(config.roots, archives);
    add(
      JSON.stringify([scripts.directories, scripts.archives, config.preload]),
    );
    add(new Uint8Array(scripts.bytes));
    let wasm: SharedArrayBuffer | undefined;
    if (config.wasmPath) {
      const binary = await readFile(config.wasmPath);
      add(binary);
      wasm = new SharedArrayBuffer(binary.length);
      new Uint8Array(wasm).set(binary);
    }
    const digest = hash.digest('hex');
    if (digest === previousHash) return null;
    const wrapper = await createOcgcoreWrapper(
      wasm ? { wasmBinary: new Uint8Array(wasm) } : undefined,
    );
    wrapper.finalize();
    return {
      hash: digest,
      listFiles,
      duel: {
        cards: packCards(cards.values()),
        scripts,
        wasm,
        preload: config.preload,
      },
    };
  }
}
