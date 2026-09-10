import type { LibraryAgentWorkspaceSnapshot } from "@deepwrite/contracts";
import {
  mutableEntries,
  mutableOverview
} from "./library-agent-tools/workspace";
import type { LibraryAgentToolSharedState } from "./library-agent-tools/types";

/** Keep pending edits, but never overwrite an intervening external change. */
export function reconcileLibraryToolState(
  workspace: LibraryAgentWorkspaceSnapshot,
  prior?: {
    workspace: LibraryAgentWorkspaceSnapshot;
    state: LibraryAgentToolSharedState;
  }
): LibraryAgentToolSharedState {
  const next = {
    entries: mutableEntries(workspace, workspace.readOnly),
    overview: mutableOverview(workspace)
  };
  if (!prior) return next;
  const baseEntries = mutableEntries(prior.workspace, prior.workspace.readOnly);
  for (const previous of prior.state.entries) {
    if (previous.pendingCreate) {
      const saved = next.entries.find(
        (item) =>
          item.title === previous.title && item.stageId === previous.stageId
      );
      if (!saved) next.entries.push({ ...previous });
      else if (saved.content !== previous.content)
        throw new Error(
          "新建条目与当前资料库发生冲突，请先完成审阅后重新运行。"
        );
      continue;
    }
    const base = baseEntries.find((item) => item.entryId === previous.entryId);
    if (
      !base ||
      (base.content === previous.content && base.title === previous.title)
    )
      continue;
    const current = next.entries.find(
      (item) => item.entryId === previous.entryId
    );
    if (
      !current ||
      ![base.content, previous.content].includes(current.content) ||
      ![base.title, previous.title].includes(current.title)
    )
      throw new Error("资料库条目已被其它操作修改，请先处理冲突后重新运行。");
    Object.assign(current, {
      content: previous.content,
      title: previous.title,
      revision: previous.revision
    });
  }
  const priorOverview = prior.state.overview;
  if (prior.workspace.overview !== priorOverview.content) {
    if (
      ![prior.workspace.overview, priorOverview.content].includes(
        workspace.overview
      )
    )
      throw new Error("库介绍已被其它操作修改，请重新运行。");
    Object.assign(next.overview, priorOverview);
  }
  return next;
}
