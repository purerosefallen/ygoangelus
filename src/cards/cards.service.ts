import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlankReturnMessageDto } from 'nesties';
import DeckModule from 'ygopro-deck-encode';
import type { DeckLimits } from '../config/load-config.js';
import { ResourceLoader } from '../resources/resource-loader.service.js';
import {
  CardDataDto,
  type CheckDeckRequestDto,
  type CheckDeckResultDto,
  type LFListsResultDto,
} from './cards.dto.js';
import { checkDeck } from './check-deck.js';

function invalid() {
  return new BlankReturnMessageDto(400, 'INVALID_REQUEST').toException();
}
function decodeDeck(uri: string) {
  // Node's base64 decoder skips malformed input. Validate the three u32 zones first.
  if (!uri?.startsWith('ydke://')) throw invalid();
  const parts = uri.slice(7).split('!');
  if (parts.length !== 4 || parts.pop() !== '') throw invalid();
  for (const part of parts) {
    const bytes = Buffer.from(part, 'base64');
    if (bytes.length % 4 || bytes.toString('base64') !== part) throw invalid();
  }
  try {
    return (DeckModule as unknown as typeof DeckModule.default).fromYdkeURL(
      uri,
    );
  } catch {
    throw invalid();
  }
}

@Injectable()
export class CardsService {
  constructor(
    private readonly resources: ResourceLoader,
    private readonly config: ConfigService,
  ) {}
  lists(): LFListsResultDto {
    return {
      lists: this.resources.snapshot.lists.map((list) => ({
        name: list.name,
        hash: list.getHash() >>> 0,
      })),
    };
  }
  cards(id?: string): CardDataDto[] {
    const storage = this.resources.snapshot.cards;
    if (id === undefined)
      return Array.from(storage.all(), (c) => new CardDataDto(c));
    const seen = new Set<number>(),
      result: CardDataDto[] = [];
    for (const part of id.split(',')) {
      const token = part.trim();
      if (!/^[0-9]+$/.test(token)) continue;
      const code = Number(token);
      if (
        !Number.isSafeInteger(code) ||
        code <= 0 ||
        code > 0x7fffffff ||
        seen.has(code)
      )
        continue;
      seen.add(code);
      const card = storage.read(code);
      if (card) result.push(new CardDataDto(card));
    }
    return result;
  }
  check(input: CheckDeckRequestDto): CheckDeckResultDto {
    const snapshot = this.resources.snapshot;
    const list =
      input.lflist == null ? undefined : snapshot.byName.get(input.lflist);
    if (input.lflist != null && !list)
      throw new BlankReturnMessageDto(404, 'LFLIST_NOT_FOUND').toException();
    const deck = decodeDeck(input.deck);
    const defaults = this.config.getOrThrow<DeckLimits>('limits');
    const limits = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof DeckLimits)[])
      limits[key] = input.limits?.[key] ?? defaults[key];
    if (limits.minMain > limits.maxMain) throw invalid();
    const error = checkDeck(deck, snapshot.cards.read, {
      ...limits,
      ot: input.rule ?? 5,
      lflist: list,
    });
    return error
      ? { valid: false, error: { reason: error.reason, code: error.code } }
      : { valid: true };
  }
}
