export class ModelConnectionTestCancelledError extends Error {
  constructor(message = "模型连接测试已取消。") {
    super(message);
    this.name = "ModelConnectionTestCancelledError";
  }
}

export class ModelConnectionTestTimeoutError extends Error {
  constructor(message = "模型连接超时，请检查网络或稍后重试。") {
    super(message);
    this.name = "ModelConnectionTestTimeoutError";
  }
}

export interface ConnectionTestAbortScope {
  readonly signal: AbortSignal;
  didTimeout(): boolean;
  wasCancelled(): boolean;
  dispose(): void;
}

export function createConnectionTestAbortScope(
  externalSignal?: AbortSignal,
  timeoutMs = 15_000
): ConnectionTestAbortScope {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = externalSignal?.aborted === true;

  const onExternalAbort = (): void => {
    cancelled = true;
    controller.abort(
      externalSignal?.reason instanceof Error
        ? externalSignal.reason
        : new ModelConnectionTestCancelledError()
    );
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new ModelConnectionTestTimeoutError());
  }, timeoutMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    wasCancelled: () => cancelled || externalSignal?.aborted === true,
    dispose: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

export async function awaitStreamResultWithAbortGrace<TMessage>(
  streamPromise:
    Promise<{ result(): Promise<TMessage> }> | { result(): Promise<TMessage> },
  signal: AbortSignal,
  graceMs = 1_000
): Promise<TMessage> {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  return await new Promise<TMessage>((resolve, reject) => {
    const cleanup = (): void => {
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer);
        graceTimer = undefined;
      }
      signal.removeEventListener("abort", armGrace);
    };
    const armGrace = (): void => {
      if (settled || graceTimer !== undefined) return;
      graceTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new ModelConnectionTestCancelledError()
        );
      }, graceMs);
      if (typeof graceTimer === "object" && "unref" in graceTimer) {
        graceTimer.unref();
      }
    };

    if (signal.aborted) {
      armGrace();
    } else {
      signal.addEventListener("abort", armGrace, { once: true });
    }

    Promise.resolve(streamPromise)
      .then((stream) => stream.result())
      .then(
        (message) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(message);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        }
      );
  });
}
