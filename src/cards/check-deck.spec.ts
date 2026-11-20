import { expect, it } from 'vitest';
import {
  YGOProLFListItem,
  YGOProLFListErrorReason as Reason,
} from 'ygopro-lflist-encode';
import { checkDeck } from './check-deck.js';

it('counts related cards by rule code across all zones and preserves the first error', () => {
  const read = (code: number) =>
    code <= 3 ? { code, ot: 3, type: 17, alias: 0, ruleCode: 1 } : undefined;
  const deck = { main: [1, 2], extra: [], side: [3] };
  expect(checkDeck(deck, read, { minMain: 0, maxCopies: 2 })).toMatchObject({
    reason: Reason.CARDCOUNT,
    code: 3,
  });
  const list = new YGOProLFListItem().fromText('!Test\n1 1\n');
  expect(checkDeck(deck, read, { minMain: 0, lflist: list })).toMatchObject({
    reason: Reason.LFLIST,
    code: 1,
  });
  expect(checkDeck({ ...deck, main: [4] }, read)).toMatchObject({
    reason: Reason.MAINCOUNT,
    code: 1,
  });
  expect(checkDeck({ ...deck, main: [4] }, read, { minMain: 0 })).toMatchObject(
    { reason: Reason.UNKNOWNCARD, code: 4 },
  );
});
