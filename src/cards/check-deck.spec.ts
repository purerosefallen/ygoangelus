import { expect, it } from 'vitest';
import {
  YGOProLFListItem,
  YGOProLFListErrorReason as Reason,
} from 'ygopro-lflist-encode';
import { prepareLFList } from '../resources/resource-snapshot.js';
import { checkDeck } from './check-deck.js';

it('counts related cards by rule code across all zones and preserves the first error', () => {
  const read = (code: number) =>
    code <= 3
      ? { code, ot: 3, type: code === 2 ? 0x41 : 17, alias: 0, ruleCode: 1 }
      : undefined;
  const deck = { main: [1], extra: [2], side: [3] };
  expect(checkDeck(deck, read, { minMain: 0, maxCopies: 2 })).toMatchObject({
    reason: Reason.CARDCOUNT,
    code: 3,
  });
  const list = prepareLFList(new YGOProLFListItem().fromText('!Test\n1 0\n'));
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

it('applies ordinary limits to prints and retains rule-code accounting for credits', () => {
  const albaz = 68468459;
  const albazArtwork = 68468460;
  const white = 73819701;
  const read = (code: number) => ({
    code,
    ot: 3,
    type: 17,
    alias: code === albazArtwork ? albaz : 0,
    ruleCode: code === white ? albaz : 0,
  });
  const lflist = prepareLFList(
    new YGOProLFListItem().fromText(
      `!Test\n${white} 1\n$points 2\n${albaz} $points 1\n`,
    ),
  );
  const options = { minMain: 0, lflist };
  expect(
    checkDeck({ main: [white], extra: [], side: [albaz] }, read, options),
  ).toBeNull();
  expect(
    checkDeck(
      { main: [white], extra: [], side: [albaz, albazArtwork] },
      read,
      options,
    ),
  ).toMatchObject({ reason: Reason.LFLIST, code: albaz });
  expect(
    checkDeck({ main: [white], extra: [], side: [white, albaz] }, read, options),
  ).toMatchObject({ reason: Reason.LFLIST, code: white });
});
