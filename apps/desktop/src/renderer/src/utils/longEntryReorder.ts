import type { LongWorkspaceOperation } from "@deepwrite/contracts";
import type { LongWorkspaceSelection } from "../types/longWorkspace";

export type LongEntryGroup =
  "worldbuilding" | "character" | "volume" | "plotPoint" | "storyPlot";

export function moveLongEntry(
  ids: readonly string[],
  sourceId: string,
  targetId: string,
  position: "before" | "after"
): string[] {
  if (
    sourceId === targetId ||
    !ids.includes(sourceId) ||
    !ids.includes(targetId)
  ) {
    return [...ids];
  }
  const result = ids.filter((id) => id !== sourceId);
  const target = result.indexOf(targetId);
  result.splice(target + (position === "after" ? 1 : 0), 0, sourceId);
  return result;
}

export function longEntryReorderOperation(
  group: LongEntryGroup,
  selection: LongWorkspaceSelection,
  orderedIds: string[]
): LongWorkspaceOperation | undefined {
  switch (group) {
    case "worldbuilding": {
      if (
        selection.root !== "worldbuilding" ||
        selection.worldbuildingFormat !== "list"
      )
        return;
      const categoryId = selection.key.slice("worldbuilding:".length);
      if (categoryId)
        return { type: "worldbuildingItem.reorder", categoryId, orderedIds };
      return;
    }
    case "character":
      if (selection.characterGroup) {
        return {
          type: "character.reorder",
          group: selection.characterGroup,
          orderedIds
        };
      }
      return;
    case "volume":
      return { type: "volume.reorder", orderedIds };
    case "plotPoint":
      if (selection.plotPointVolumeId) {
        return {
          type: "arc.reorder",
          volumeId: selection.plotPointVolumeId,
          orderedIds
        };
      }
      return;
    case "storyPlot":
      if (selection.plotPointId) {
        return {
          type: "storyPlot.reorder",
          arcId: selection.plotPointId,
          orderedIds
        };
      }
      return;
  }
}
