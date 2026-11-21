import 'reflect-metadata';
import {
  DefineWorker,
  WorkerMethod,
  WorkerCallback,
  OnWorkerExit,
} from 'yuzuthread';
import {
  createOcgcoreWrapper,
  DirScriptReaderEx,
  OcgcoreMessageType,
  OcgcoreDuelOptionFlag,
  type OcgcoreWrapper,
  type OcgcoreDuel,
} from 'koishipro-core.js';
import * as P from 'ygopro-msg-encode';
import { CardStorage } from '../resources/card-storage.js';
import type { DuelResources } from '../resources/resource-snapshot.js';

@DefineWorker({ moduleUrl: import.meta.url })
export class OcgcoreWorker {
  private wrapper?: OcgcoreWrapper;
  private duel?: OcgcoreDuel;
  // Host callbacks are attached immediately after the lightweight Worker handshake.
  onMessage?: (type: OcgcoreMessageType, message: string) => void;
  onExit?: () => void;
  @WorkerCallback()
  async notify(type: OcgcoreMessageType, message: string) {
    this.onMessage?.(type, message);
  }
  @OnWorkerExit()
  exited() {
    this.onExit?.();
  }

  private async start(input: P.YGOProAngelusStart, resources: DuelResources) {
    const scriptReader = await DirScriptReaderEx(...resources.roots);
    const wrapper = (this.wrapper = await createOcgcoreWrapper(
      resources.wasm
        ? { wasmBinary: new Uint8Array(resources.wasm) }
        : undefined,
    ));
    const cards = new CardStorage(resources.cards);
    wrapper.setScriptReader(scriptReader);
    wrapper.setCardReader(cards.read);
    wrapper.setMessageHandler((_duel, message, type) => {
      void this.notify(type, message).catch(() => {});
    });
    const duel = (this.duel = wrapper.createDuelV2(input.seed));
    duel.loadRegistry(input.registry);
    for (const player of [0, 1])
      duel.setPlayerInfo({
        player,
        lp: input.startLp,
        startHand: input.startHand,
        drawCount: input.drawCount,
      });
    for (const path of resources.preload) duel.preloadScript(path);
    const tag = !!(input.flags & 1);
    const c = P.OcgcoreScriptConstants;
    for (const seat of tag ? [0, 1, 3, 2] : [0, 1]) {
      const owner = tag ? (seat < 2 ? 0 : 1) : seat;
      const main: number[] = [],
        extra: number[] = [];
      for (const code of input.decks[seat]) {
        const item = cards.read(code);
        (item && item.type & P.OcgcoreCommonConstants.TYPES_EXTRA_DECK
          ? extra
          : main
        ).push(code);
      }
      for (const [zone, location] of [
        [main, c.LOCATION_DECK],
        [extra, c.LOCATION_EXTRA],
      ] as const) {
        for (let i = zone.length - 1; i >= 0; i--) {
          if (tag && (seat === 1 || seat === 2))
            duel.newTagCard({ code: zone[i], owner, location });
          else
            duel.newCard({
              code: zone[i],
              owner,
              player: owner,
              location,
              sequence: 0,
              position: c.POS_FACEDOWN_DEFENSE,
            });
        }
      }
    }
    let opt = input.duelRule << 16;
    if (tag) opt |= OcgcoreDuelOptionFlag.TagMode;
    if (input.flags & 2) opt |= OcgcoreDuelOptionFlag.PseudoShuffle;
    duel.startDuel(opt);
  }

  @WorkerMethod()
  async execute(
    frame: Uint8Array,
    resources?: DuelResources,
  ): Promise<Uint8Array> {
    const input = P.YGOProAngelusCtos.getInstanceFromPayload(frame);
    if (!input) throw new Error('Unknown command');
    let reply: P.YGOProAngelusStocBase;
    if (input instanceof P.YGOProAngelusStart) {
      await this.start(input, resources!);
      reply = new P.YGOProAngelusStartOk();
    } else {
      const duel = this.duel;
      if (!duel) throw new Error('Duel unavailable');
      if (input instanceof P.YGOProAngelusProcess) {
        reply = new P.YGOProAngelusProcessResult().fromOcgcorePayload(
          duel.process({ noParse: true }).raw,
        );
      } else if (input instanceof P.YGOProAngelusResponse) {
        duel.setResponse(input.response);
        reply = new P.YGOProAngelusResponseOk();
      } else if (input instanceof P.YGOProAngelusQueryCard) {
        const p = new P.YGOProAngelusQueryCardResult();
        p.raw = duel.queryCard(input, { noParse: true }).raw;
        reply = p;
      } else if (input instanceof P.YGOProAngelusQueryFieldCard) {
        const p = new P.YGOProAngelusQueryFieldCardResult();
        p.raw = duel.queryFieldCard(input, { noParse: true }).raw;
        reply = p;
      } else if (input instanceof P.YGOProAngelusQueryFieldCount) {
        const p = new P.YGOProAngelusQueryFieldCountResult();
        p.count = duel.queryFieldCount(input);
        reply = p;
      } else if (input instanceof P.YGOProAngelusQueryFieldInfo) {
        const p = new P.YGOProAngelusQueryFieldInfoResult();
        p.raw = duel.queryFieldInfo({ noParse: true }).raw;
        reply = p;
      } else if (input instanceof P.YGOProAngelusFinish) {
        const p = new P.YGOProAngelusFinishOk();
        p.registry = duel.dumpRegistry().raw;
        duel.endDuel();
        this.wrapper!.finalize();
        this.duel = undefined;
        reply = p;
      } else {
        throw new Error('Unsupported command');
      }
    }
    reply.requestId = input.requestId;
    return reply.toFullPayload();
  }
}
