import { AppError } from "../errors.js";

interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
  timer: NodeJS.Timeout | undefined;
}

/** Bounded semaphore with abortable queue entries. */
export class Semaphore {
  private active = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueue: number,
    private readonly maxQueueWaitMs = 30_000,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be >= 1");
    if (!Number.isInteger(maxQueue) || maxQueue < 0) throw new Error("maxQueue must be >= 0");
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan oleh client.");

    if (this.active < this.concurrency) {
      this.active += 1;
    } else {
      if (this.queue.length >= this.maxQueue) {
        throw new AppError("SERVER_BUSY", "Antrean server penuh. Coba kembali beberapa saat lagi.");
      }
      await new Promise<void>((resolve, reject) => {
        const entry: QueueEntry = { resolve, reject, signal, onAbort: undefined, timer: undefined };
        entry.timer = setTimeout(() => {
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
          reject(new AppError("QUEUE_TIMEOUT", "Waktu tunggu antrean habis. Coba kembali atau kurangi permintaan bersamaan."));
        }, this.maxQueueWaitMs);
        if (signal) {
          entry.onAbort = () => {
            const index = this.queue.indexOf(entry);
            if (index >= 0) this.queue.splice(index, 1);
            if (entry.timer) clearTimeout(entry.timer);
            reject(new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan saat menunggu antrean."));
          };
          signal.addEventListener("abort", entry.onAbort, { once: true });
        }
        this.queue.push(entry);
        if (signal?.aborted) entry.onAbort?.();
      });
    }

    try {
      if (signal?.aborted) throw new AppError("REQUEST_CANCELLED", "Permintaan dibatalkan oleh client.");
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) {
        if (next.timer) clearTimeout(next.timer);
        if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
        next.resolve();
      } else {
        this.active -= 1;
      }
    }
  }

  get activeCount(): number { return this.active; }
  get queuedCount(): number { return this.queue.length; }
}
