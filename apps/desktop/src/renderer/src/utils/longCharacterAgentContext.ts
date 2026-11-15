import { createScopedTranslator } from "../i18n";
import {
  type LongCharacterFocusSnapshot,
  type LongFileId,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import type {
  LongWorkspaceFileRole,
  LongWorkspaceSelection
} from "../types/longWorkspace";

const t = createScopedTranslator("workspace");

const CHARACTER_DOCUMENTS: Partial<
  Record<
    LongWorkspaceFileRole,
    {
      kind: Exclude<
        LongCharacterFocusSnapshot["currentDocument"]["kind"],
        "overview"
      >;
      title: string;
    }
  >
> = {
  "core-profile": {
    kind: "core_profile",
    get title() {
      return t("longCharacterAgentContext.coreProfile");
    }
  },
  relationships: {
    kind: "relationships",
    get title() {
      return t("longCharacterAgentContext.relationships");
    }
  },
  "current-state": {
    kind: "current_state",
    get title() {
      return t("longCharacterAgentContext.currentState");
    }
  },
  history: {
    kind: "history",
    get title() {
      return t("longCharacterAgentContext.history");
    }
  }
};

export function buildLongCharacterFocusSnapshot(input: {
  selection: LongWorkspaceSelection | null;
  activeFileId: LongFileId | null;
  characterOverviewFile?: LongWorkspaceFileReference | null;
}): LongCharacterFocusSnapshot | undefined {
  const { selection, activeFileId, characterOverviewFile } = input;
  if (selection?.root !== "character_design" || !activeFileId) {
    return undefined;
  }

  if (selection.key === "character-overview") {
    const overviewFile =
      selection.files.find(({ role }) => role === "overview")?.file ??
      characterOverviewFile;
    if (overviewFile?.id !== activeFileId) return undefined;
    return {
      currentDocument: {
        kind: "overview",
        title: t("catalogWorkspace.overview")
      }
    };
  }

  if (!selection.characterId || !selection.characterGroup) return undefined;
  const active = selection.files.find(({ file }) => file.id === activeFileId);
  if (!active) return undefined;
  const document = CHARACTER_DOCUMENTS[active.role];
  if (!document) return undefined;
  return {
    characterId: selection.characterId,
    characterName: selection.title,
    group: selection.characterGroup,
    currentDocument: { kind: document.kind, title: document.title }
  };
}
