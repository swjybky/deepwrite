import { describe, expect, it } from "vitest";
import type { LongWorkspaceIndexSnapshot } from "./index-validation";
import { latestCommittedContinuityChapter } from "./latest-continuity";

describe("latestCommittedContinuityChapter", () => {
  it("maps a batch commit to its final checkpoint instead of its first member", () => {
    const index = {
      plot: {
        volumes: [{ id: "volume_one", order: 1 }],
        chapterCards: [
          {
            id: "chapter_one",
            volumeId: "volume_one",
            narrativeOrder: 1
          },
          {
            id: "chapter_two",
            volumeId: "volume_one",
            narrativeOrder: 2
          }
        ]
      },
      chapters: [
        {
          chapterCardId: "chapter_one",
          commitId: "commit_batch",
          characterContinuity: []
        },
        {
          chapterCardId: "chapter_two",
          commitId: "commit_batch",
          characterContinuity: [{ characterId: "character_lead" }]
        }
      ],
      ledger: {
        commits: [
          {
            id: "commit_batch",
            mode: "text_files_batch",
            sequence: 1,
            chapterCardId: "chapter_two",
            chapterCardIds: ["chapter_one", "chapter_two"],
            checkpointChapterCardId: "chapter_two"
          }
        ]
      }
    } as unknown as LongWorkspaceIndexSnapshot;

    expect(latestCommittedContinuityChapter(index)?.chapterCardId).toBe(
      "chapter_two"
    );
    expect(
      latestCommittedContinuityChapter(index, (chapter) =>
        chapter.characterContinuity.some(
          ({ characterId }) => characterId === "character_lead"
        )
      )?.chapterCardId
    ).toBe("chapter_two");
  });
});
