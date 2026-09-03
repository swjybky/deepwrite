import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { computed, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { useLongEditorDeleteDialogs } from "./useLongEditorDeleteDialogs";

const CONFIRMATION: LongWorkspaceImpactConfirmation = {
  impact: {
    createdEntityIds: [],
    updatedEntityIds: [],
    deletedEntityIds: ["chapter_one"],
    createdFileIds: [],
    deletedFileIds: [],
    documentWriteProposalIds: []
  },
  entityChanges: [],
  relationshipChanges: [],
  fileIntents: [],
  ledgerRecordEdits: []
};

type DialogOptions = Parameters<typeof useLongEditorDeleteDialogs>[0];

function createSubject(
  input: {
    selection?: LongWorkspaceSelection | null;
    worldbuildingItems?: Array<{ id: string; title: string }>;
    previewMutation?: DialogOptions["emitPreviewMutation"];
    mutation?: DialogOptions["emitMutation"];
    previewNavigation?: DialogOptions["emitPreviewDeleteStructure"];
    deleteNavigation?: DialogOptions["emitDeleteStructure"];
  } = {}
) {
  const pendingWorldbuildingDeleteId = ref<string | null>(null);
  const dialog = useLongEditorDeleteDialogs({
    props: {
      selection: input.selection ?? null,
      workspaceIndex: null
    },
    currentReadOnly: computed(() => false),
    currentNavigationDeleteTarget: computed(() => null),
    currentWorldbuildingItems: computed(() => input.worldbuildingItems ?? []),
    pendingWorldbuildingDeleteId,
    emitPreviewMutation:
      input.previewMutation ?? ((_batch, completion) => completion()),
    emitMutation: input.mutation ?? (() => undefined),
    selectWorldbuildingItem: async () => undefined,
    selectWorldbuildingOverview: async () => undefined,
    emitPreviewDeleteStructure:
      input.previewNavigation ?? ((_target, completion) => completion()),
    emitDeleteStructure: input.deleteNavigation ?? (() => undefined)
  });
  return { dialog, pendingWorldbuildingDeleteId };
}

describe("useLongEditorDeleteDialogs", () => {
  beforeEach(() => {
    vi.stubGlobal("HTMLElement", class HTMLElementStub {});
    vi.stubGlobal("document", { activeElement: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("accepts only the current navigation preview and submits raw impact", () => {
    const previews: Array<(impact?: LongWorkspaceImpactConfirmation) => void> =
      [];
    let submitted:
      | {
          kind: "character" | "volume" | "plotPoint" | "chapterCard";
          id: string;
          title: string;
          expectedImpact: LongWorkspaceImpactConfirmation;
        }
      | undefined;
    const { dialog } = createSubject({
      previewNavigation: (_target, completion) => previews.push(completion),
      deleteNavigation: (input) => {
        submitted = input;
      }
    });

    dialog.showNavigationDelete({
      kind: "chapterCard",
      id: "chapter_one",
      title: "第一章",
      label: "章卡",
      description: "删除第一章"
    });
    dialog.showNavigationDelete({
      kind: "chapterCard",
      id: "chapter_two",
      title: "第二章",
      label: "章卡",
      description: "删除第二章"
    });

    previews[0]!(CONFIRMATION);
    expect(dialog.navigationDeleteTarget.value).toMatchObject({
      id: "chapter_two",
      previewPending: true
    });

    previews[1]!(CONFIRMATION);
    expect(dialog.navigationDeleteTarget.value).toMatchObject({
      id: "chapter_two",
      previewPending: false,
      expectedImpact: CONFIRMATION
    });
    expect(dialog.navigationDeleteTarget.value?.expectedImpact).toBe(
      CONFIRMATION
    );

    dialog.confirmNavigationDelete();
    expect(submitted).toMatchObject({
      id: "chapter_two",
      expectedImpact: CONFIRMATION
    });
    expect(() => structuredClone(submitted)).not.toThrow();
  });

  it("keeps a worldbuilding item impact cloneable through confirmation", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-31T08:00:00.000Z");
    let previewed: LongWorkspaceOperationBatch | undefined;
    let submitted: LongWorkspaceOperationBatch | undefined;
    const { dialog } = createSubject({
      selection: {
        key: "worldbuilding:world_rules"
      } as LongWorkspaceSelection,
      worldbuildingItems: [{ id: "worlditem_rule", title: "规则" }],
      previewMutation: (batch, completion) => {
        previewed = batch;
        completion(CONFIRMATION);
      },
      mutation: (batch) => {
        submitted = batch;
      }
    });

    dialog.openWorldbuildingItemDelete("worlditem_rule");
    expect(dialog.pendingWorldbuildingDeleteItem.value?.expectedImpact).toBe(
      CONFIRMATION
    );

    vi.setSystemTime("2026-08-31T08:01:00.000Z");
    dialog.confirmWorldbuildingItemDelete();
    expect(submitted?.expectedImpact).toBe(CONFIRMATION);
    expect(submitted?.updatedAt).toBe(previewed?.updatedAt);
    expect(() => structuredClone(submitted)).not.toThrow();
  });
});
