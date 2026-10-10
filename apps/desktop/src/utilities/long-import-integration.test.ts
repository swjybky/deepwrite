import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectStore } from "./long-project-store";
import { readWriteClawLongImportPlan } from "./write-claw-long-import";

const FIXED_NOW = "2026-07-26T12:00:00.000Z";
const temporaryRoots: string[] = [];

function legacyBook() {
  return {
    id: "legacy-import-book",
    title: "迁移长篇",
    book_type: "long",
    categories: ["悬疑"],
    linked_material_ids_by_kind: {
      plot: ["material-long-legacy"]
    },
    linked_skill_ids_by_kind: {
      style: ["skill-long-legacy"]
    },
    memories: [
      {
        id: "memory-shadow",
        tag: "规则",
        content: "影子只在午夜后说真话。",
        created_at: "2025-01-02T00:00:00Z",
        updated_at: "2025-01-03T00:00:00Z"
      }
    ],
    memory_auto_capture_enabled: true,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-06-01T00:00:00Z",
    long_workspace: {
      schema_version: 5,
      revision: 9,
      worldbuilding: {
        categories: [
          {
            id: "rules",
            name: "规则",
            format: "text",
            overview: "",
            items: [],
            text: "午夜之后，所有影子都会说真话。"
          }
        ]
      },
      characters: {
        protagonists: {
          entries: [
            {
              id: "hero",
              name: "林岚",
              core_profile: "调查记者",
              relationships: "",
              current_state: "正在追查旧案",
              history: ""
            }
          ]
        },
        major_supporting: { entries: [] },
        minor_supporting: { entries: [] },
        passersby: { entries: [] }
      },
      plot: {
        book_line: "林岚追查会说话的影子。",
        volumes: [{ id: "volume-1", name: "影城", outline: "", order: 1 }],
        arcs: [
          {
            id: "arc-1",
            volume_id: "volume-1",
            name: "旧案",
            outline: "",
            order: 1
          }
        ],
        chapter_cards: [
          {
            id: "chapter-1",
            volume_id: "volume-1",
            arc_id: "arc-1",
            stage_id: "draft.volume-1.arc-1.chapter-1",
            title: "午夜来电",
            outline: "",
            world_constraints: "",
            characters: ["hero"],
            narrative_order: 1
          }
        ],
        story_events: [],
        event_links: [],
        narrative_placements: [],
        foreshadowing: []
      },
      chapters: {
        "draft.volume-1.arc-1.chapter-1": {
          title: "午夜来电",
          body: "电话在午夜十二点整响起。",
          character_state: "林岚决定赴约。",
          handoff: "下一章前往废弃报社。",
          committed: true,
          committed_at: "2025-06-01T00:00:00Z",
          commit_id: "legacy-commit"
        }
      },
      ledger: {
        committed_through: "draft.volume-1.arc-1.chapter-1",
        timeline: [
          {
            chapter_stage_id: "draft.volume-1.arc-1.chapter-1",
            chapter_card_id: "chapter-1",
            commit_id: "legacy-commit",
            content: "林岚于午夜接到来电。"
          }
        ],
        character_states: [],
        faction_states: [],
        realm_states: [],
        foreshadowing_states: [],
        continuity_notes: [],
        chapter_changes: []
      }
    }
  };
}

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-long-import-export-"))
  );
  temporaryRoots.push(root);
  const parentDirectory = join(root, "projects");
  const sourceDirectory = join(root, "source");
  await mkdir(parentDirectory);
  await mkdir(sourceDirectory);
  const sourcePath = join(sourceDirectory, "book.json");
  await writeFile(sourcePath, JSON.stringify(legacyBook(), null, 2), "utf8");
  return { root, parentDirectory, sourcePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("long import store integration", () => {
  it("imports through staging without changing the explicit source file", async () => {
    const { parentDirectory, sourcePath } = await fixture();
    const store = new LongProjectStore({ now: () => FIXED_NOW });
    const beforeContent = await readFile(sourcePath);
    const beforeInfo = await lstat(sourcePath);

    const imported = await store.importWriteClawBook(
      parentDirectory,
      sourcePath
    );

    const afterInfo = await lstat(sourcePath);
    expect(await readFile(sourcePath)).toEqual(beforeContent);
    expect({
      ino: afterInfo.ino,
      size: afterInfo.size,
      mode: afterInfo.mode,
      mtimeMs: afterInfo.mtimeMs
    }).toEqual({
      ino: beforeInfo.ino,
      size: beforeInfo.size,
      mode: beforeInfo.mode,
      mtimeMs: beforeInfo.mtimeMs
    });
    expect(imported).toMatchObject({
      sourceKind: "book-json",
      legacySchemaVersion: 5,
      committedChapterPolicy: "legacy-checkpoints"
    });
    expect(imported.book.workspaceIndex.ledger.commits).toHaveLength(1);
    expect(imported.book.workspaceIndex.ledger.commits[0]).not.toHaveProperty(
      "reversible"
    );
    expect(imported.book.workspaceIndex.chapters[0]!.commitId).toBe(
      imported.book.workspaceIndex.ledger.commits[0]!.id
    );
    const migratedContinuityChapter = imported.book.workspaceIndex.chapters[0]!;
    expect(imported.book.workspaceIndex.ledger.commits[0]!.mode).toBe(
      "structured"
    );
    expect(migratedContinuityChapter.characterContinuity).toEqual([]);
    expect(migratedContinuityChapter.worldReveals).toBeNull();
    await expect(
      store.readDocument(imported.projectDirectory, {
        fileId: migratedContinuityChapter.foreshadowingChanges.id
      })
    ).resolves.toMatchObject({
      content: expect.stringContaining("从旧版 structured 连续性记录")
    });
    expect(imported.book.linkedMaterialIdsByKind.plot).toEqual([
      "material-long-legacy"
    ]);
    expect(imported.book.linkedSkillIdsByKind.style).toEqual([
      "skill-long-legacy"
    ]);
    const memoryCategory = imported.book.workspaceIndex.worldbuilding.find(
      ({ title }) => title === "书籍记忆（旧版）"
    )!;
    if (memoryCategory.format !== "text") {
      throw new Error("expected migration evidence to use a text category");
    }
    const memoryDocument = await store.readDocument(imported.projectDirectory, {
      fileId: memoryCategory.file.id
    });
    expect(memoryDocument.content).toContain("memory-shadow");
    expect(memoryDocument.content).toContain("仅存档");
    await expect(
      store.writeDocument(imported.projectDirectory, {
        fileId: memoryCategory.file.id,
        content: "不应允许覆盖"
      })
    ).rejects.toThrow(/只读迁移证据/u);
    const memorySearch = await store.search(imported.projectDirectory, {
      query: "影子只在午夜后说真话",
      fileIds: [memoryCategory.file.id]
    });
    expect(memorySearch.matches.length).toBeGreaterThan(0);
    expect(
      memorySearch.matches.every(
        ({ fileId }) => fileId === memoryCategory.file.id
      )
    ).toBe(true);
    const body = imported.book.workspaceIndex.chapters[0]!.body;
    await expect(
      store.readDocument(imported.projectDirectory, { fileId: body.id })
    ).resolves.toMatchObject({
      content: "电话在午夜十二点整响起。"
    });
    expect(
      (await readdir(parentDirectory)).some((name) =>
        name.includes(".staging-")
      )
    ).toBe(false);
  });

  it("refuses an existing deterministic target without overwriting it", async () => {
    const { parentDirectory, sourcePath } = await fixture();
    const plan = await readWriteClawLongImportPlan(sourcePath, {
      importedAt: FIXED_NOW
    });
    const target = join(parentDirectory, plan.manifest.id);
    await mkdir(target);
    const sentinelPath = join(target, "keep.txt");
    await writeFile(sentinelPath, "用户原文件", "utf8");
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    await expect(
      store.importWriteClawBook(parentDirectory, sourcePath)
    ).rejects.toThrow(/已存在/u);
    expect(await readFile(sentinelPath, "utf8")).toBe("用户原文件");
    expect(await readdir(parentDirectory)).toEqual([plan.manifest.id]);
  });

  it("names the imported folder by title and refuses the same book again", async () => {
    const { parentDirectory, sourcePath } = await fixture();
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    const imported = await store.importWriteClawBook(
      parentDirectory,
      sourcePath
    );
    expect(imported.projectDirectory).toBe(join(parentDirectory, "迁移长篇"));
    await expect(
      store.importWriteClawBook(parentDirectory, sourcePath)
    ).rejects.toThrow(/已存在/u);
    expect(await readdir(parentDirectory)).toEqual(["迁移长篇"]);
  });

  it("rejects a symbolic-link Write Claw source before creating a project", async () => {
    if (process.platform === "win32") return;
    const { root, parentDirectory, sourcePath } = await fixture();
    const linkedSource = join(root, "linked-book.json");
    await symlink(sourcePath, linkedSource);
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    await expect(
      store.importWriteClawBook(parentDirectory, linkedSource)
    ).rejects.toThrow(/符号链接/u);
    expect(await readdir(parentDirectory)).toEqual([]);
  });

  it("rejects a hard-linked Write Claw source before creating a project", async () => {
    if (process.platform === "win32") return;
    const { root, parentDirectory, sourcePath } = await fixture();
    const linkedSource = join(root, "hard-linked-book.json");
    await link(sourcePath, linkedSource);
    const store = new LongProjectStore({ now: () => FIXED_NOW });

    await expect(
      store.importWriteClawBook(parentDirectory, linkedSource)
    ).rejects.toThrow(/硬链接/u);
    expect(await readdir(parentDirectory)).toEqual([]);
  });
});
