import { describe, expect, it } from "vitest";
import {
  LongWorkspaceIndexSnapshotSchema,
  LongWorkspaceOperationError,
  applyLongWorkspaceOperations,
  longWorkspaceImpactIsDestructive,
  longWorldbuildingContentPath,
  longWorldbuildingFileId,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  previewLongWorkspaceOperations
} from "./index";
import {
  file,
  later,
  workspace
} from "./long-workspace-operations.test-support";

function expectImpactMismatch(run: () => unknown): void {
  try {
    run();
    throw new Error("Expected destructive impact confirmation to be rejected.");
  } catch (error) {
    expect(error).toBeInstanceOf(LongWorkspaceOperationError);
    expect((error as LongWorkspaceOperationError).code).toBe("impact_mismatch");
  }
}

function listWorkspace() {
  return LongWorkspaceIndexSnapshotSchema.parse({
    ...workspace(),
    worldbuilding: [
      {
        id: "world_rules",
        title: "规则",
        order: 1,
        format: "list",
        contentAuthority: "files",
        overview: file(
          longWorldbuildingOverviewFileId("world_rules"),
          longWorldbuildingOverviewContentPath("world_rules")
        ),
        items: [
          {
            id: "worlditem_rule_one",
            title: "第一条规则",
            order: 1,
            file: file(
              longWorldbuildingItemFileId("worlditem_rule_one"),
              longWorldbuildingItemContentPath(
                "world_rules",
                "worlditem_rule_one"
              )
            )
          }
        ]
      }
    ]
  });
}

function textWorkspace() {
  return LongWorkspaceIndexSnapshotSchema.parse({
    ...workspace(),
    worldbuilding: [
      {
        id: "world_rules",
        title: "规则",
        order: 1,
        format: "text",
        contentAuthority: "markdown",
        file: file(
          longWorldbuildingFileId("world_rules"),
          longWorldbuildingContentPath("world_rules")
        )
      }
    ]
  });
}

describe("long workspace operation engine: worldbuilding conversion impact", () => {
  it("requires the exact destructive preview for list-to-text conversion", () => {
    const source = listWorkspace();
    const batch = {
      updatedAt: later,
      operations: [
        {
          type: "worldbuilding.update" as const,
          id: "world_rules",
          patch: { format: "text" as const }
        }
      ]
    };
    const preview = previewLongWorkspaceOperations(source, batch);

    expect(longWorkspaceImpactIsDestructive(preview)).toBe(true);
    expect(preview.entityChanges).toContainEqual(
      expect.objectContaining({
        id: "worlditem_rule_one",
        kind: "worldbuilding-item",
        action: "delete"
      })
    );
    expect(
      preview.fileIntents.filter(({ action }) => action === "delete")
    ).toHaveLength(2);
    expectImpactMismatch(() => applyLongWorkspaceOperations(source, batch));

    const applied = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(applied.snapshot.worldbuilding[0]).toMatchObject({
      id: "world_rules",
      format: "text"
    });

    const changed = structuredClone(source);
    const category = changed.worldbuilding[0]!;
    if (category.format !== "list") throw new Error("Expected list fixture.");
    category.items.push({
      id: "worlditem_rule_two",
      title: "第二条规则",
      order: 2,
      file: file(
        longWorldbuildingItemFileId("worlditem_rule_two"),
        longWorldbuildingItemContentPath("world_rules", "worlditem_rule_two")
      )
    });
    expectImpactMismatch(() =>
      applyLongWorkspaceOperations(changed, {
        ...batch,
        expectedImpact: preview.confirmation
      })
    );
  });

  it("requires the exact destructive preview for text-to-list conversion", () => {
    const source = textWorkspace();
    const batch = {
      updatedAt: later,
      operations: [
        {
          type: "worldbuilding.update" as const,
          id: "world_rules",
          patch: { format: "list" as const }
        }
      ]
    };
    const preview = previewLongWorkspaceOperations(source, batch);

    expect(longWorkspaceImpactIsDestructive(preview)).toBe(true);
    expect(preview.fileIntents).toContainEqual(
      expect.objectContaining({
        action: "delete",
        file: expect.objectContaining({
          id: longWorldbuildingFileId("world_rules")
        })
      })
    );
    const createdFiles = preview.fileIntents
      .filter(({ action }) => action === "create")
      .map(({ file }) => file);
    expect(createdFiles).toHaveLength(2);
    for (const createdFile of createdFiles) {
      // A path produced on macOS must also be writable on Windows.
      expect(createdFile.path).not.toMatch(/[<>:"\\|?*]/u);
    }
    expectImpactMismatch(() => applyLongWorkspaceOperations(source, batch));

    const applied = applyLongWorkspaceOperations(source, {
      ...batch,
      expectedImpact: preview.confirmation
    });
    expect(applied.snapshot.worldbuilding[0]).toMatchObject({
      id: "world_rules",
      format: "list",
      items: [expect.objectContaining({ title: "原文本内容" })]
    });
    const category = applied.snapshot.worldbuilding[0]!;
    if (category.format !== "list") throw new Error("Expected list category.");
    expect([category.overview, category.items[0]!.file]).toEqual(createdFiles);

    const changed = structuredClone(source);
    changed.worldbuilding[0]!.title = "已经变化的规则";
    expectImpactMismatch(() =>
      applyLongWorkspaceOperations(changed, {
        ...batch,
        expectedImpact: preview.confirmation
      })
    );
  });
});
