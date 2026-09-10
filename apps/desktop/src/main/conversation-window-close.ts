interface CloseWindow {
  isDestroyed(): boolean;
  close(): void;
  on(
    event: "close",
    listener: (event: { preventDefault(): void }) => void
  ): unknown;
}

export function guardConversationWindowClose(
  window: CloseWindow,
  options: {
    skip(): boolean;
    flush(): Promise<void>;
    onError(error: unknown): void;
  }
): void {
  let pending = false;
  let saved = false;
  window.on("close", (event) => {
    if (options.skip()) return;
    if (saved) {
      saved = false;
      return;
    }
    event.preventDefault();
    if (pending) return;
    pending = true;
    void Promise.resolve()
      .then(options.flush)
      .then(() => {
        pending = false;
        saved = true;
        if (!window.isDestroyed()) window.close();
      })
      .catch((error: unknown) => {
        pending = false;
        options.onError(error);
      });
  });
}
