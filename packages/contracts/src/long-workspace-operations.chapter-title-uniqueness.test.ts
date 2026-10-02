import {
  applyPreviewedLongWorkspaceOperations,
  chapterFiles,
  describe,
  expect,
  expectOperationError,
  it,
  later,
  previewLongWorkspaceOperations,
  workspace
} from "./long-workspace-operations.test-support";

function chapterCreateOperation(input?: {
  id?: string;
  volumeId?: string;
  title?: string;
}) {
  const id = input?.id ?? "chapter_duplicate";
  return {
    type: "chapter.create" as const,
    chapterCard: {
      id,
      volumeId: input?.volumeId ?? "volume_one",
      primaryArcId: null,
      title: input?.title ?? "雨夜来信",
      narrativeOrder: 3
    },
    files: chapterFiles(id, "duplicate")
  };
}

describe("long workspace operation engine: chapter card title uniqueness", () => {
  it("rejects creating a chapter card with a duplicate title in the same volume", () => {
    expectOperationError(
      () =>
        previewLongWorkspaceOperations(workspace(), {
          updatedAt: later,
          operations: [chapterCreateOperation()]
        }),
      "already_exists"
    );
  });

  it("allows the same chapter title in another volume", () => {
    const result = applyPreviewedLongWorkspaceOperations(workspace(), {
      updatedAt: later,
      operations: [
        {
          type: "volume.create",
          volume: {
            id: "volume_two",
            title: "第二卷",
            order: 2,
            summary: ""
          }
        },
        chapterCreateOperation({
          id: "chapter_other_volume",
          volumeId: "volume_two"
        })
      ]
    });
    expect(
      result.snapshot.plot.chapterCards.filter(
        ({ title }) => title === "雨夜来信"
      )
    ).toHaveLength(2);
  });

  it("allows a distinct chapter title in the same volume", () => {
    const result = applyPreviewedLongWorkspaceOperations(workspace(), {
      updatedAt: later,
      operations: [chapterCreateOperation({ title: "码头疑云" })]
    });
    expect(
      result.snapshot.plot.chapterCards.find(
        ({ title }) => title === "码头疑云"
      )
    ).toMatchObject({ volumeId: "volume_one" });
  });

  it("rejects renaming a chapter card to a title already used in its volume", () => {
    expectOperationError(
      () =>
        previewLongWorkspaceOperations(workspace(), {
          updatedAt: later,
          operations: [
            {
              type: "chapter.update",
              id: "chapter_one",
              patch: { title: "旧钟楼" }
            }
          ]
        }),
      "already_exists"
    );
  });

  it("allows renaming a chapter card to a fresh title or keeping its own", () => {
    const renamed = applyPreviewedLongWorkspaceOperations(workspace(), {
      updatedAt: later,
      operations: [
        {
          type: "chapter.update",
          id: "chapter_one",
          patch: { title: "雾中回信" }
        }
      ]
    });
    expect(
      renamed.snapshot.plot.chapterCards.find(({ id }) => id === "chapter_one")
        ?.title
    ).toBe("雾中回信");

    const kept = applyPreviewedLongWorkspaceOperations(workspace(), {
      updatedAt: later,
      operations: [
        {
          type: "chapter.update",
          id: "chapter_one",
          patch: { title: "雨夜来信" }
        }
      ]
    });
    expect(
      kept.snapshot.plot.chapterCards.filter(
        ({ title }) => title === "雨夜来信"
      )
    ).toHaveLength(1);
  });
});
