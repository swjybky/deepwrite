import type { CreationTreeReorderPayload } from "../types/workspace";
import {
  runAcademicChapterReorder,
  runAcademicFrameworkStageReorder,
  runAcademicSectionReorder
} from "../stores/academicWorkspaceDialog";
import { mysteryWorkspaceNavigation } from "../stores/mysteryWorkspaceNavigation";

export type ShortCreationTreeReorderPayload = Extract<
  CreationTreeReorderPayload,
  {
    kind: "short-plot-stage" | "short-character-item" | "short-draft-section";
  }
>;

export type LongCreationTreeReorderPayload = Extract<
  CreationTreeReorderPayload,
  {
    kind:
      | "long-worldbuilding-category"
      | "long-worldbuilding-item"
      | "long-character-group"
      | "long-character"
      | "long-volume"
      | "long-plot-point"
      | "long-draft-chapter";
  }
>;

export async function dispatchCreationTreeReorder(
  payload: CreationTreeReorderPayload,
  handlers: {
    reorderShortTreeNode: (
      payload: ShortCreationTreeReorderPayload
    ) => Promise<void>;
    handleReorderLongTreeNode: (
      payload: LongCreationTreeReorderPayload
    ) => Promise<void>;
  }
): Promise<void> {
  switch (payload.kind) {
    case "short-plot-stage":
    case "short-character-item":
    case "short-draft-section":
      await handlers.reorderShortTreeNode(payload);
      return;
    case "long-worldbuilding-category":
    case "long-worldbuilding-item":
    case "long-character-group":
    case "long-character":
    case "long-volume":
    case "long-plot-point":
    case "long-draft-chapter":
      await handlers.handleReorderLongTreeNode(payload);
      return;
    case "academic-framework-stage":
      await runAcademicFrameworkStageReorder(
        payload.bookId,
        payload.stageId,
        payload.anchorId,
        payload.position
      );
      return;
    case "academic-chapter":
      await runAcademicChapterReorder(
        payload.bookId,
        payload.chapterId,
        payload.anchorChapterId,
        payload.position
      );
      return;
    case "academic-section":
      await runAcademicSectionReorder(
        payload.bookId,
        payload.sectionId,
        payload.anchorSectionId,
        payload.position
      );
      return;
    case "mystery-item": {
      const port = mysteryWorkspaceNavigation.value;
      if (port && port.bookId() === payload.bookId && !port.busy()) {
        await port.reorderItem({
          kind: payload.itemKind,
          id: payload.id,
          anchorId: payload.anchorId,
          position: payload.position
        });
      }
      return;
    }
  }
}
