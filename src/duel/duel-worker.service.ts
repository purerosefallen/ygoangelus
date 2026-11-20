import { Injectable } from '@nestjs/common';
import { initWorker, type WorkerInstance } from 'yuzuthread';
import { OcgcoreWorker } from './ocgcore.worker.js';

export type DuelWorker = WorkerInstance<OcgcoreWorker>;
export class DuelTimeout extends Error {}
export async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new DuelTimeout('Engine operation timed out')),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
@Injectable()
export class DuelWorkerService {
  create() {
    return initWorker(OcgcoreWorker);
  }
}
