import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import {
  createLongContinuitySelection,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import { createLongWorkspaceTreeNode } from "./longWorkspaceTreeNode";
import { longContinuityBatchLabel } from "./longContinuityBatchLabel";

export function projectLongWorkspaceContinuityTree(
  book: LongBookSummary,
  index?: LongWorkspaceIndexSnapshot | null
): ResourceTreeNode[] {
  const node = createLongWorkspaceTreeNode(book);
  const characterAndContinuityUseLeftTree =
    index?.featureSettings.characterAndContinuityItemLayout === "left-tree";
  const continuityPendingChildren: ResourceTreeNode[] = [];
  const continuityRecordChildren: ResourceTreeNode[] = [];
  const continuityChapterNode = (
    selection: LongWorkspaceSelection,
    options: {
      icon: NonNullable<ResourceTreeNode["icon"]>;
      label: string;
      badge: string;
      longLedgerCommit?: ResourceTreeNode["longLedgerCommit"];
    }
  ): ResourceTreeNode => {
    const children = characterAndContinuityUseLeftTree
      ? selection.files.map((file) =>
          node(
            {
              ...selection,
              title: file.label,
              breadcrumbs: [...selection.breadcrumbs, file.label],
              preferredFileId: file.file.id,
              preferredRole: file.role
            },
            {
              nodeKey: `${selection.key}:file:${file.file.id}`,
              icon: "file",
              label: file.label,
              readOnly: Boolean(file.readOnly)
            }
          )
        )
      : undefined;
    return node(selection, {
      ...options,
      ...(children ? { children } : {})
    });
  };
  const pendingRecordChapterIds = index
    ? index.chapters
        .filter(
          ({ bodyStatus, commitId }) =>
            bodyStatus === "written" && commitId === null
        )
        .map(({ chapterCardId }) => chapterCardId)
    : [];
  if (index) {
    for (const chapterCardId of pendingRecordChapterIds) {
      const selection = createLongContinuitySelection(
        book,
        index,
        chapterCardId
      );
      if (!selection) continue;
      const chapter = book.navigation.chapterCards.find(
        ({ id }) => id === chapterCardId
      );
      continuityPendingChildren.push(
        continuityChapterNode(selection, {
          icon: "check",
          label: chapter?.title ?? selection.title,
          badge: "待提交"
        })
      );
    }
  }
  if (index) {
    const latestCommitId = index.ledger.commits.at(-1)?.id;
    for (const commit of [...index.ledger.commits].sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id)
    )) {
      const selection = createLongContinuitySelection(
        book,
        index,
        commit.chapterCardId
      );
      if (selection) {
        const display = longContinuityBatchLabel(
          commit,
          book.navigation.chapterCards
        );
        continuityRecordChildren.push(
          continuityChapterNode(selection, {
            icon: "file",
            label: display.label,
            badge:
              commit.mode === "import_checkpoint"
                ? "导入检查点"
                : display.badge,
            longLedgerCommit: {
              id: commit.id,
              deletable: commit.id === latestCommitId
            }
          })
        );
      }
    }
  }
  return [
    node(
      {
        key: "continuity-group:pending",
        root: "continuity_ledger",
        title: "待处理章节",
        breadcrumbs: [book.title, "连续性账本", "待处理章节"],
        files: [],
        preferredRole: "body",
        description: pendingRecordChapterIds.length
          ? "选择任意已有正文的章节，按需补充连续性记录。"
          : "当前没有等待补记连续性的章节。"
      },
      {
        icon: "check",
        badge: String(continuityPendingChildren.length),
        children: continuityPendingChildren
      }
    ),
    node(
      {
        key: "continuity-group:records",
        root: "continuity_ledger",
        title: "章节记录",
        breadcrumbs: [book.title, "连续性账本", "章节记录"],
        files: [],
        preferredRole: "body",
        description: "按章节查看已经留存的连续性 Markdown 文件。"
      },
      {
        icon: "file",
        badge: String(continuityRecordChildren.length),
        children: continuityRecordChildren
      }
    )
  ];
}
