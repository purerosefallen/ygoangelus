import type { CardBuffers } from './card-storage.js';
import { CardStorage } from './card-storage.js';
import { YGOProLFList, YGOProLFListItem } from 'ygopro-lflist-encode';

export interface DuelResources {
  cards: CardBuffers;
  roots: string[];
  wasm?: SharedArrayBuffer;
  preload: string[];
}
export interface LoadedResources {
  duel: DuelResources;
  listFiles: string[];
  hash: string;
}

export interface PreparedLFList {
  limits: YGOProLFListItem;
  credits?: YGOProLFListItem;
}

export function prepareLFList(list: YGOProLFListItem): PreparedLFList {
  return {
    limits: new YGOProLFListItem({ entries: list.entries }),
    credits: list.creditLimits.length
      ? new YGOProLFListItem({ creditLimits: list.creditLimits })
      : undefined,
  };
}

export class ResourceSnapshot {
  readonly cards: CardStorage;
  readonly lists: readonly YGOProLFListItem[];
  readonly byName: ReadonlyMap<string, PreparedLFList>;
  constructor(readonly loaded: LoadedResources) {
    this.cards = new CardStorage(loaded.duel.cards);
    this.lists = loaded.listFiles.flatMap(
      (text) => new YGOProLFList().fromText(text).items,
    );
    // Reserve literal titles up front, including numbered titles in later files.
    const originalNames = new Set(this.lists.map((list) => list.name));
    const nextSuffix = new Map<string, number>();
    const byName = new Map<string, PreparedLFList>();
    for (const list of this.lists) {
      const title = list.name;
      if (byName.has(title)) {
        let suffix = nextSuffix.get(title) ?? 2;
        while (originalNames.has(`${title} (${suffix})`)) suffix++;
        list.name = `${title} (${suffix})`;
        nextSuffix.set(title, suffix + 1);
      }
      byName.set(list.name, prepareLFList(list));
    }
    this.byName = byName;
  }
}
