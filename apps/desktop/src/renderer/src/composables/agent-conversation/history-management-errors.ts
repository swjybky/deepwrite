/** A follow-up storage read confirmed that the attempted deletion did not take effect. */
export class HistoryDeletionNotCommittedError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : "删除会话失败，请重试。");
    this.name = "HistoryDeletionNotCommittedError";
  }
}

export class HistoryPersistenceDeferredError extends Error {
  constructor(readonly sessionIds: readonly string[]) {
    super("会话删除结果尚未确认，请先重试删除；新编辑仍保留在本地。");
    this.name = "HistoryPersistenceDeferredError";
  }
}
