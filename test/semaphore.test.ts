import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors.js";
import { Semaphore } from "../src/utils/semaphore.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

test("semaphore limits active tasks and drains queue", async () => {
  const semaphore = new Semaphore(1, 2);
  const gate = deferred<void>();
  const first = semaphore.run(async () => { await gate.promise; return "first"; });
  const second = semaphore.run(async () => "second");
  assert.equal(semaphore.activeCount, 1);
  assert.equal(semaphore.queuedCount, 1);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.equal(semaphore.activeCount, 0);
  assert.equal(semaphore.queuedCount, 0);
});

test("semaphore rejects when bounded queue is full", async () => {
  const semaphore = new Semaphore(1, 1);
  const gate = deferred<void>();
  const first = semaphore.run(async () => gate.promise);
  const second = semaphore.run(async () => "queued");
  await assert.rejects(() => semaphore.run(async () => "rejected"), (error: unknown) => error instanceof AppError && error.code === "SERVER_BUSY");
  gate.resolve();
  await Promise.all([first, second]);
});

test("queued request cancellation removes waiter without leaking capacity", async () => {
  const semaphore = new Semaphore(1, 2);
  const gate = deferred<void>();
  const first = semaphore.run(async () => gate.promise);
  const controller = new AbortController();
  const second = semaphore.run(async () => "never", controller.signal);
  assert.equal(semaphore.queuedCount, 1);
  controller.abort();
  await assert.rejects(() => second, (error: unknown) => error instanceof AppError && error.code === "REQUEST_CANCELLED");
  assert.equal(semaphore.queuedCount, 0);
  gate.resolve();
  await first;
  assert.equal(semaphore.activeCount, 0);
});

test("queued request times out and does not leak semaphore capacity", async () => {
  const semaphore = new Semaphore(1, 1, 25);
  const gate = deferred<void>();
  const first = semaphore.run(async () => gate.promise);
  await assert.rejects(
    () => semaphore.run(async () => "never"),
    (error: unknown) => error instanceof AppError && error.code === "QUEUE_TIMEOUT",
  );
  assert.equal(semaphore.queuedCount, 0);
  gate.resolve();
  await first;
  assert.equal(semaphore.activeCount, 0);
});
