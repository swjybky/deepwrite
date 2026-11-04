import { ExternalControlError } from "./errors";

/** Serialize setup/mutations, never the lifetime of a generated run. */
const tails = new WeakMap<object, Promise<void>>();
const MAX_QUEUE_WAIT_MS = 8_000;

export async function queueExternalOperation<T>(
  owner: object,
  operation: () => Promise<T>
): Promise<T> {
  const previous = tails.get(owner) ?? Promise.resolve();
  let release!: () => void;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => slot);
  tails.set(owner, tail);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ExternalControlError(
                "external.busy",
                "基础操作队列繁忙，请稍后重试本次操作。"
              )
            ),
          MAX_QUEUE_WAIT_MS
        );
      })
    ]);
    clearTimeout(timer);
    return await operation();
  } finally {
    clearTimeout(timer);
    release();
    if (tails.get(owner) === tail)
      void tail.then(() => {
        if (tails.get(owner) === tail) tails.delete(owner);
      });
  }
}
