import { describe, expect, it } from "vitest";
import {
  CatalogSnapshotSchema,
  WorkspaceRuntimeContextSchema,
  type CatalogSnapshot
} from "@deepwrite/contracts";
import {
  MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN,
  MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH,
  buildLibraryAttachments
} from "./libraryAttachments";

const NOW = "2026-07-18T08:00:00.000Z";

function fixture(): CatalogSnapshot {
  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    updatedAt: NOW,
    books: [
      {
        id: "book-1",
        title: "附件测试",
        bookType: "short",
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: ["material-mixed"],
          gimmick: [],
          plot: ["material-mixed"],
          draft: ["material-mixed"],
          other: ["missing-material"]
        },
        linkedSkillIdsByKind: {
          general: ["skill-style"],
          plot: [],
          style: [],
          other: ["missing-skill"]
        },
        documents: [],
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materials: [
      {
        id: "material-mixed",
        title: "综合素材",
        materialType: "short",
        materialKind: "mixed",
        parentGenre: "悬疑",
        subGenre: "",
        overview: "这段库说明不能成为附件",
        entries: [
          { id: "entry-character", stageId: "character", title: "人物条目", body: "人物素材正文", createdAt: NOW, updatedAt: NOW },
          { id: "entry-plot", stageId: "pacing", title: "剧情条目", body: "剧情素材正文", createdAt: NOW, updatedAt: NOW },
          { id: "entry-empty", stageId: "draft_excerpt", title: "空正文条目", body: "  \n", createdAt: NOW, updatedAt: NOW }
        ],
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "material-unbound",
        title: "未绑定素材",
        materialType: "short",
        materialKind: "other",
        parentGenre: "",
        subGenre: "",
        overview: "",
        entries: [
          { id: "entry-unbound", stageId: "other", title: "不能出现", body: "未绑定", createdAt: NOW, updatedAt: NOW }
        ],
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    materialGroups: [],
    skills: [
      {
        id: "skill-style",
        title: "文风技能",
        skillType: "short",
        skillKind: "style",
        overview: "这段技能库说明不能成为附件",
        isBuiltin: false,
        entries: [
          { id: "skill-entry", stageId: "draft", title: "文风执行", body: "技能正文", createdAt: NOW, updatedAt: NOW },
          { id: "skill-empty", stageId: "expert_section_writer", title: "空技能", body: "", createdAt: NOW, updatedAt: NOW }
        ],
        createdAt: NOW,
        updatedAt: NOW
      },
      {
        id: "skill-unbound",
        title: "未绑定技能",
        skillType: "short",
        skillKind: "general",
        overview: "",
        isBuiltin: false,
        entries: [
          { id: "skill-unbound-entry", stageId: "outline", title: "不能出现", body: "未绑定", createdAt: NOW, updatedAt: NOW }
        ],
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    skillGroups: []
  });
}

describe("library attachments", () => {
  it("resolves only bound non-empty entries and assigns runtime kinds", () => {
    const result = buildLibraryAttachments(fixture(), "book-1");

    expect(result.attachedMaterials.map(({ title, kind }) => [title, kind])).toEqual([
      ["综合素材 · 人物条目", "character"],
      ["综合素材 · 剧情条目", "plot"]
    ]);
    expect(result.attachedSkills.map(({ title, kind }) => [title, kind])).toEqual([
      ["文风技能 · 文风执行", "style"]
    ]);
    expect(result.attachedMaterials.every((item) => item.id.includes("material-mixed"))).toBe(true);
    expect(result.attachedMaterials[0]?.id).toContain("entry-character");
    expect(result.attachedSkills[0]?.id).toContain("skill-style");
    expect(result.attachedSkills[0]?.id).toContain("skill-entry");
    expect(result.attachedMaterials.some((item) => item.content.includes("库说明"))).toBe(false);
    expect(result.attachedSkills.some((item) => item.content.includes("库说明"))).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "library-not-found",
      "library-kind-mismatch",
      "library-not-found"
    ]);

    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        attachedSkills: result.attachedSkills,
        attachedMaterials: result.attachedMaterials
      })
    ).not.toThrow();
  });

  it("lists every capacity omission instead of silently dropping entries", () => {
    const source = fixture();
    const entries = Array.from(
      { length: MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN + 2 },
      (_, index) => ({
        id: `skill-capacity-${index}`,
        stageId: "draft" as const,
        title: `容量技能 ${index}`,
        body: `正文 ${index}`,
        createdAt: NOW,
        updatedAt: NOW
      })
    );
    const snapshot = CatalogSnapshotSchema.parse({
      ...source,
      books: [
        {
          ...source.books[0]!,
          linkedSkillIdsByKind: {
            general: [],
            plot: [],
            style: ["skill-style"],
            other: []
          },
          linkedMaterialIdsByKind: {
            character: [],
            gimmick: [],
            plot: [],
            draft: [],
            other: []
          }
        }
      ],
      skills: [{ ...source.skills[0]!, entries }]
    });

    const result = buildLibraryAttachments(snapshot, "book-1");
    expect(result.attachedSkills).toHaveLength(MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN);
    expect(result.omittedAttachments).toEqual([
      {
        domain: "skill",
        libraryId: "skill-style",
        entryId: `skill-capacity-${MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN}`,
        title: `文风技能 · 容量技能 ${MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN}`,
        reason: "capacity-exceeded"
      },
      {
        domain: "skill",
        libraryId: "skill-style",
        entryId: `skill-capacity-${MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN + 1}`,
        title: `文风技能 · 容量技能 ${MAX_LIBRARY_ATTACHMENTS_PER_DOMAIN + 1}`,
        reason: "capacity-exceeded"
      }
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "capacity-exceeded", domain: "skill" })
    );
    expect(result.complete).toBe(false);
    expect(() =>
      WorkspaceRuntimeContextSchema.parse({ attachedSkills: result.attachedSkills })
    ).not.toThrow();
  });

  it("marks overlong content inside the attachment and returns diagnostics", () => {
    const source = fixture();
    const body = "长".repeat(MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH + 37);
    const snapshot = CatalogSnapshotSchema.parse({
      ...source,
      books: [
        {
          ...source.books[0]!,
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
            style: ["skill-style"],
            other: []
          }
        }
      ],
      skills: [
        {
          ...source.skills[0]!,
          entries: [
            {
              id: "skill-long",
              stageId: "draft",
              title: "超长技能",
              body,
              createdAt: NOW,
              updatedAt: NOW
            }
          ]
        }
      ]
    });

    const result = buildLibraryAttachments(snapshot, "book-1");
    expect(result.attachedSkills[0]?.content).toHaveLength(
      MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH
    );
    expect(result.attachedSkills[0]?.content).toContain("附件内容因");
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "content-truncated",
        entryId: "skill-long",
        originalLength: body.length,
        includedLength: MAX_LIBRARY_ATTACHMENT_CONTENT_LENGTH
      })
    );
    expect(result.complete).toBe(false);
    expect(() =>
      WorkspaceRuntimeContextSchema.parse({ attachedSkills: result.attachedSkills })
    ).not.toThrow();
  });

  it("returns an explicit diagnostic for an unknown book", () => {
    const result = buildLibraryAttachments(fixture(), "missing-book");
    expect(result).toMatchObject({
      bookId: "missing-book",
      attachedSkills: [],
      attachedMaterials: [],
      complete: false
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "book-not-found", bookId: "missing-book" })
    ]);
  });
});
