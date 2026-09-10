interface ShutdownOptions {
  flushRenderer(): Promise<void>;
  shutdownUtilities(): Promise<void>;
  flushUsage(): Promise<unknown> | undefined;
  reportUsage(): Promise<unknown> | undefined;
  complete(installUpdate: boolean): void;
  cancel(error: unknown): void;
}

export function createGracefulShutdown(options: ShutdownOptions) {
  let pending: Promise<void> | undefined;
  let installUpdate = false;
  function begin(input: { installUpdate?: boolean } = {}): void {
    installUpdate ||= input.installUpdate === true;
    if (pending) return;
    pending = Promise.resolve().then(async () => {
      try {
        // The old fixed delay could expire before any renderer write started.
        // Do not stop Core until its final conversation save has acknowledged.
        await options.flushRenderer();
      } catch (error: unknown) {
        pending = undefined;
        installUpdate = false;
        options.cancel(error);
        return;
      }
      // Retain the existing grace period for document draft recovery.
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      for (const task of [
        options.shutdownUtilities,
        options.flushUsage,
        options.reportUsage
      ]) {
        try {
          await task();
        } catch {
          console.warn("DeepWrite could not complete a shutdown cleanup step.");
        }
      }
      options.complete(installUpdate);
    });
  }
  return { begin };
}
