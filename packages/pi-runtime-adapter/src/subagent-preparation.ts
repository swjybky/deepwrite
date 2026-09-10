/** A stopped parent must not wait for an unresponsive child-context query. */
export function waitForSubagentPreparation<Value>(
  operation: Value | Promise<Value>,
  signal?: AbortSignal
): Promise<Value> {
  if (!signal) return Promise.resolve(operation);
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("子智能体运行已中止。"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}
