import WebSocket from 'ws';
import * as P from 'ygopro-msg-encode';
export async function connect(url, token, protocol = 'ygoangelus.v1') {
  const ws = new WebSocket(
    url,
    protocol,
    token ? { headers: { 'x-server-token': token } } : {},
  );
  const pending = new Map(),
    events = [];
  let next = 0;
  const closed = new Promise((resolve) => ws.once('close', resolve));
  ws.on('close', () => {
    for (const { reject } of pending.values())
      reject(new Error('Socket closed'));
    pending.clear();
  });
  ws.on('message', (data) => {
    const packet = P.YGOProAngelusStoc.getInstanceFromPayload(data);
    if (!packet.requestId) {
      events.push(packet);
      return;
    }
    const waiter = pending.get(packet.requestId);
    if (!waiter) return;
    pending.delete(packet.requestId);
    waiter.resolve(packet);
  });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  return {
    ws,
    events,
    closed,
    call(packet) {
      packet.requestId = ++next;
      return new Promise((resolve, reject) => {
        pending.set(packet.requestId, { resolve, reject });
        ws.send(packet.toFullPayload());
      });
    },
  };
}
export function startPacket(tag = false) {
  const p = new P.YGOProAngelusStart();
  Object.assign(p, {
    seed: [1, 2, 3, 4, 5, 6, 7, 8],
    flags: tag ? 3 : 2,
    duelRule: 5,
    startLp: 8000,
    startHand: 5,
    drawCount: 1,
  });
  const deck = [1, 2, 101, 3, 4, 5, 6, 7, 8, 9];
  p.decks = Array.from({ length: tag ? 4 : 2 }, () => [...deck]);
  p.setRegistry({ from: 'fixture' });
  return p;
}
