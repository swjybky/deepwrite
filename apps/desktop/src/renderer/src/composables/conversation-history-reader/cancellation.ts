import { HistoryReadCancelledError } from "./types";

/** IPC cannot be retracted, but cancellation releases the caller and discards its response. */
export function awaitHistoryResponse<T>(
  promise: Promise<T>,
  signals: (AbortSignal | undefined)[]
): Promise<T> {
  const active = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined
  );
  return new Promise((resolve, reject) => {
    function cleanup() {
      for (const signal of active) signal.removeEventListener("abort", abort);
    }
    function abort() {
      cleanup();
      reject(new HistoryReadCancelledError());
    }
    // Install completion handlers even if already aborted: late IPC errors must be consumed.
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
    for (const signal of active)
      signal.addEventListener("abort", abort, { once: true });
    if (active.some((signal) => signal.aborted)) abort();
  });
}
