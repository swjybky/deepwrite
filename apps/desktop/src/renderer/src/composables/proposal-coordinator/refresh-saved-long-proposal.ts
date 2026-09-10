/** Refresh is presentation work; an acknowledged write must release its approval queue. */
export async function refreshSavedLongProposal(options: {
  refresh(): Promise<boolean>;
  warn(message: string): void;
}): Promise<void> {
  try {
    // False also means a newer refresh or another book superseded this one.
    // Active refresh failures already report through the workspace coordinator.
    await options.refresh();
  } catch {
    // The write already succeeded. Never relabel or replay it because a read failed.
    options.warn("世界观文件已保存，但界面刷新失败；请手动刷新长篇工作区。");
  }
}
