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
    // Reserve literal titles up front, including numbered titles in later files.
    const originalNames = new Set(this.lists.map((list) => list.name));
    const nextSuffix = new Map<string, number>();
    const byName = new Map<string, YGOProLFListItem>();
    for (const list of this.lists) {
      const title = list.name;
      if (byName.has(title)) {
        let suffix = nextSuffix.get(title) ?? 2;
        while (originalNames.has(`${title} (${suffix})`)) suffix++;
        list.name = `${title} (${suffix})`;
        nextSuffix.set(title, suffix + 1);
      }
      byName.set(list.name, list);
    }
    this.byName = byName;
  }
}
