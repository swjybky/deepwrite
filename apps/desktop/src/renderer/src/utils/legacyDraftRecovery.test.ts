import {
  CatalogSnapshotSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  serializeExpertDraftMarkdown,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import { projectCatalogWorkspace } from "../data/catalogWorkspace";
import type { EditorDraftState } from "../types/workspace";
import {
  legacyBookDraftRecoveryKey,
  migrateLegacyDraftRecoveries
} from "./legacyDraftRecovery";

const NOW = "2026-07-22T08:00:00.000Z";
const RECOVERED_AT = "2026-07-22T09:00:00.000Z";

function fixture(): CatalogSnapshot {
  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    updatedAt: NOW,
    books: [
      {
        id: "book-1",
        title: "雨夜来信",
        bookType: "short",
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: [],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: [],
          plot: [],
          style: [],
          other: []
        },
        documents: [],
        draft: {
          id: "draft",
          title: "正文",
          sections: [
            {
              id: "intro",
              title: "导语",
              wordCountRequirement: "",
              body: {
                id: catalogDraftBodyDocumentId("intro"),
                title: "导语",
                content: "磁盘导语",
                createdAt: NOW,
                updatedAt: NOW
              },
              characterState: {
                id: catalogDraftCharacterStateDocumentId("intro"),
                title: "导语 · 人物状态",
                content: "",
                createdAt: NOW,
                updatedAt: NOW
              },
              createdAt: NOW,
              updatedAt: NOW
            },
            {
              id: "section-1",
              title: "第一节",
              wordCountRequirement: "1000 字",
              body: {
                id: catalogDraftBodyDocumentId("section-1"),
                title: "第一节",
                content: "磁盘正文",
                createdAt: NOW,
                updatedAt: NOW
              },
              characterState: {
                id: catalogDraftCharacterStateDocumentId("section-1"),
                title: "第一节 · 人物状态",
                content: "磁盘状态",
                createdAt: NOW,
                updatedAt: NOW
              },
              createdAt: NOW,
              updatedAt: NOW
            }
          ],
          createdAt: NOW,
          updatedAt: NOW
        },
        projectRevision: 7,
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: []
  });
}

function currentCombinedRevision(snapshot = fixture()): string {
  const book = snapshot.books[0]!;
  return createShortWorkspaceContentRevision(
    serializeExpertDraftMarkdown({
      sections: book.draft.sections.map((section) => ({
        id: section.id,
        title: section.title,
        wordCountRequirement: section.wordCountRequirement,
        body: section.body.content,
        characterState: section.characterState.content
      }))
    })
  );
}

function legacyRecovery(
  sections = [
    {
      id: "intro",
      title: "导语",
      wordCountRequirement: "",
      body: "磁盘导语",
      characterState: ""
    },
    {
      id: "section-1",
      title: "第一节：名单",
      wordCountRequirement: "1000 字",
      body: "恢复后的正文",
      characterState: "恢复后的人物状态"
    }
  ],
  baseRevision: string | undefined = currentCombinedRevision()
): EditorDraftState {
  return {
    title: "正文",
    content: serializeExpertDraftMarkdown({ sections }),
    dirty: true,
    recoveryUpdatedAt: RECOVERED_AT,
    ...(baseRevision === undefined ? {} : { baseRevision }),
    baseProjectRevision: 3
  };
}

describe("legacy combined draft recovery migration", () => {
  it("splits a matching legacy recovery into physical body and state drafts", () => {
    const snapshot = fixture();
    const projection = projectCatalogWorkspace(snapshot);
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const result = migrateLegacyDraftRecoveries(
      { [legacyKey]: legacyRecovery() },
      snapshot,
      projection
    );
    const section = projection.draftDirectories[0]!.sections[1]!;

    expect(result.migratedLegacyKeys).toEqual([legacyKey]);
    expect(result.unmappedLegacyKeys).toEqual([]);
    expect(result.drafts[legacyKey]).toBeUndefined();
    expect(result.drafts[section.bodyDocumentId]).toEqual({
      title: "第一节：名单",
      content: "恢复后的正文",
      dirty: true,
      recoveryUpdatedAt: RECOVERED_AT,
      baseRevision: createShortWorkspaceContentRevision("磁盘正文"),
      baseProjectRevision: 7
    });
    expect(result.drafts[section.characterStateDocumentId]).toEqual({
      title: "第一节：名单 · 人物状态",
      content: "恢复后的人物状态",
      dirty: true,
      recoveryUpdatedAt: RECOVERED_AT,
      baseRevision: createShortWorkspaceContentRevision("磁盘状态"),
      baseProjectRevision: 7
    });
  });

  it("retains the legacy fallback when its section structure cannot be mapped", () => {
    const snapshot = fixture();
    const projection = projectCatalogWorkspace(snapshot);
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const legacy = legacyRecovery([
      {
        id: "section-1",
        title: "第一节",
        wordCountRequirement: "1000 字",
        body: "恢复正文",
        characterState: ""
      }
    ]);
    const result = migrateLegacyDraftRecoveries(
      { [legacyKey]: legacy },
      snapshot,
      projection
    );

    expect(result.migratedLegacyKeys).toEqual([]);
    expect(result.unmappedLegacyKeys).toEqual([legacyKey]);
    expect(result.drafts).toEqual({ [legacyKey]: legacy });
  });

  it("retains the legacy fallback instead of rebasing it onto a newer combined draft", () => {
    const snapshot = fixture();
    const projection = projectCatalogWorkspace(snapshot);
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const legacy = legacyRecovery(undefined, "v1:1:deadbeef");

    const result = migrateLegacyDraftRecoveries(
      { [legacyKey]: legacy },
      snapshot,
      projection
    );

    expect(result.migratedLegacyKeys).toEqual([]);
    expect(result.unmappedLegacyKeys).toEqual([legacyKey]);
    expect(result.drafts).toEqual({ [legacyKey]: legacy });
  });

  it("retains a legacy fallback whose combined base revision is missing", () => {
    const snapshot = fixture();
    const projection = projectCatalogWorkspace(snapshot);
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const legacy = legacyRecovery();
    delete legacy.baseRevision;

    const result = migrateLegacyDraftRecoveries(
      { [legacyKey]: legacy },
      snapshot,
      projection
    );

    expect(result.migratedLegacyKeys).toEqual([]);
    expect(result.unmappedLegacyKeys).toEqual([legacyKey]);
    expect(result.drafts).toEqual({ [legacyKey]: legacy });
  });

  it("is idempotent after a successful migration", () => {
    const snapshot = fixture();
    const projection = projectCatalogWorkspace(snapshot);
    const legacyKey = legacyBookDraftRecoveryKey("book-1");
    const first = migrateLegacyDraftRecoveries(
      { [legacyKey]: legacyRecovery() },
      snapshot,
      projection
    );
    const second = migrateLegacyDraftRecoveries(
      first.drafts,
      snapshot,
      projection
    );

    expect(second.drafts).toEqual(first.drafts);
    expect(second.migratedLegacyKeys).toEqual([]);
    expect(second.unmappedLegacyKeys).toEqual([]);
  });
});
