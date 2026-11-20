import { CardDataEntry } from 'ygopro-cdb-encode';
import { BinaryField } from 'ygopro-msg-encode';

const coreSize = new CardDataEntry().toPayload().length;
class StoredCard extends CardDataEntry {
  @BinaryField('u8', coreSize)
  declare ot: number;
}
const stride = new StoredCard().toPayload().length;

export interface CardBuffers {
  records: SharedArrayBuffer;
  slots: SharedArrayBuffer;
  count: number;
}

export function packCards(cards: Iterable<CardDataEntry>): CardBuffers {
  const sorted = Array.from(cards).sort((a, b) => a.code - b.code);
  let capacity = 16;
  while (capacity * 0.75 < sorted.length) capacity *= 2;
  const slots = new Uint32Array(new SharedArrayBuffer(capacity * 4));
  const bytes = new Uint8Array(new SharedArrayBuffer(sorted.length * stride));
  sorted.forEach((card, index) => {
    bytes.set(new StoredCard().fromPartial(card).toPayload(), index * stride);
    let slot = Math.imul(card.code, 0x9e3779b1) & (capacity - 1);
    while (slots[slot]) slot = (slot + 1) & (capacity - 1);
    slots[slot] = index + 1;
  });
  return { records: bytes.buffer, slots: slots.buffer, count: sorted.length };
}

export class CardStorage {
  private readonly records: Uint8Array;
  private readonly slots: Uint32Array;
  private readonly view: DataView;
  constructor(private readonly buffers: CardBuffers) {
    this.records = new Uint8Array(buffers.records);
    this.slots = new Uint32Array(buffers.slots);
    this.view = new DataView(buffers.records);
  }
  private at(index: number) {
    return new StoredCard().fromPayload(
      this.records.subarray(index * stride, (index + 1) * stride),
    );
  }
  readonly read = (code: number): StoredCard | undefined => {
    if (!Number.isInteger(code) || code < 1 || code > 0x7fffffff)
      return undefined;
    const mask = this.slots.length - 1;
    let slot = Math.imul(code, 0x9e3779b1) & mask;
    while (this.slots[slot]) {
      const index = this.slots[slot] - 1;
      if (this.view.getUint32(index * stride, true) === code)
        return this.at(index);
      slot = (slot + 1) & mask;
    }
    return undefined;
  };
  *all() {
    for (let i = 0; i < this.buffers.count; i++) yield this.at(i);
  }
}
