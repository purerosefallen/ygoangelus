import type { CardBuffers } from './card-storage.js';
import type { Scripts } from './script-reader.js';
import { CardStorage } from './card-storage.js';
import { YGOProLFList, type YGOProLFListItem } from 'ygopro-lflist-encode';

export interface DuelResources {
  cards: CardBuffers;
  scripts: Scripts;
  wasm?: SharedArrayBuffer;
  preload: string[];
}
export interface LoadedResources {
  duel: DuelResources;
  listFiles: string[];
  hash: string;
}
export class ResourceSnapshot {
  readonly cards: CardStorage;
  readonly lists: readonly YGOProLFListItem[];
  readonly byName: ReadonlyMap<string, YGOProLFListItem>;
  constructor(readonly loaded: LoadedResources) {
    this.cards = new CardStorage(loaded.duel.cards);
    this.lists = loaded.listFiles.flatMap(
      (text) => new YGOProLFList().fromText(text).items,
    );
    const byName = new Map<string, (typeof this.lists)[number]>();
    for (const list of this.lists) {
      const other = byName.get(list.name);
      if (other && other.getHash() !== list.getHash())
        throw new Error('Conflicting banlist: ' + list.name);
      byName.set(list.name, list);
    }
    this.byName = byName;
  }
}
