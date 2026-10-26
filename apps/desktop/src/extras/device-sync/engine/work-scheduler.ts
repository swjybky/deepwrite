/** Cached reads and hashing can otherwise occupy the Main event loop for an entire book. */
export async function syncWorkCheckpoint(
  completed: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new Error("同步已取消。");
  if (completed % 128 !== 0) return;
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (signal?.aborted) throw new Error("同步已取消。");
}
