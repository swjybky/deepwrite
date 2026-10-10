import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MaterialQueryInputSchema,
  parseMaterialMarkdown,
  type LongMaterialConvertResult,
  type LongMaterialProgressPayload
} from "@deepwrite/contracts";
import { MaterialQueryService } from "../material-query-service";
import { longMaterialFixture } from "./test-support";

const status = (result: LongMaterialConvertResult, key: string) =>
  result.entries.find((entry) => entry.key === key)?.status;

async function entryFile(
  fixture: Awaited<ReturnType<typeof longMaterialFixture>>,
  libraryId: string,
  entryId: string
) {
  const directory = await fixture.catalog.managedProjectDirectory(libraryId);
  return join(directory, "entries", `${entryId}.md`);
}

describe("long book → material pack (Core)", { timeout: 60_000 }, () => {
  it("creates a group of five long libraries with agent-readable entries", async () => {
    const fixture = await longMaterialFixture();
    const progress: Omit<LongMaterialProgressPayload, "operationId">[] = [];
    const result = await fixture
      .service((p) => progress.push(p))
      .convert({
        bookId: fixture.bookId,
        options: fixture.options,
        target: { action: "create", title: "《铜铃记》仿写素材" },
        operationId: "op-create"
      });
    expect(result.counts.new).toBe(result.entries.length);
    expect(progress.at(-1)?.phase).toBe("finished");
    const snapshot = await fixture.catalog.indexSnapshot();
    const group = snapshot.materialGroups.find(
      ({ id }) => id === result.pack.groupId
    )!;
    expect(group.title).toBe("《铜铃记》仿写素材");
    const libraries = snapshot.materials.filter(({ id }) =>
      Object.values(group.members).includes(id)
    );
    expect(libraries.map(({ title }) => title).sort()).toEqual(
      [
        "《铜铃记》人设",
        "《铜铃记》其他",
        "《铜铃记》剧情",
        "《铜铃记》梗",
        "《铜铃记》正文"
      ].sort()
    );
    expect(libraries.every(({ materialType }) => materialType === "long")).toBe(
      true
    );
    const plot = libraries.find(({ materialKind }) => materialKind === "plot")!;
    expect(plot.entries[0]!.title).toBe("全书导读");
    const other = libraries.find(
      ({ materialKind }) => materialKind === "other"
    )!;
    expect(other.entries[0]!.title).toBe("世界观总览");
    const manifest = JSON.parse(
      await readFile(
        join(
          await fixture.catalog.managedProjectDirectory(other.id),
          "deepwrite.json"
        ),
        "utf8"
      )
    ) as { overview: string };
    expect(manifest.overview).toContain("本库存放《铜铃记》的世界观设定");
    const guide = await readFile(
      await entryFile(fixture, plot.id, plot.entries[0]!.id),
      "utf8"
    );
    const parsed = parseMaterialMarkdown(guide);
    expect(parsed.state).toBe("configured");
    expect(parsed.description).toMatch(/^先读这一条/u);
    expect(guide).toContain("「《铜铃记》其他 · 世界观总览」");
    expect(status(result, "gimmick:1")).toBe("new");
  });

  it("is idempotent and keeps the user's edits unless they choose to overwrite", async () => {
    const fixture = await longMaterialFixture();
    const service = fixture.service();
    const first = await service.convert({
      bookId: fixture.bookId,
      options: fixture.options,
      target: { action: "create", title: "仿写素材" },
      operationId: "op-1"
    });
    const update = {
      bookId: fixture.bookId,
      options: fixture.options,
      target: { action: "update" as const, packId: first.pack.id },
      operationId: "op-2"
    };
    const before = await fixture.catalog.indexSnapshot();
    const again = await service.convert(update);
    expect(again.counts.unchanged).toBe(first.entries.length);
    const after = await fixture.catalog.indexSnapshot();
    expect(after.materials.map((m) => m.projectRevision)).toEqual(
      before.materials.map((m) => m.projectRevision)
    );

    const book = first.entries.find(({ key }) => key === "book-line:1")!;
    const path = await entryFile(fixture, book.libraryId!, book.entryId!);
    await writeFile(path, "我自己改写的主线。", "utf8");
    const { projectDirectory } = await fixture.longs.catalog.open(
      fixture.bookId
    );
    const index = (
      await fixture.longs.getWorkspaceIndex({ bookId: fixture.bookId })
    ).workspaceIndex;
    await writeFile(
      join(projectDirectory, index.bookLine.path),
      "主线已经改了。",
      "utf8"
    );
    const conflicted = await service.convert(update);
    expect(status(conflicted, "book-line:1")).toBe("conflict");
    expect(await readFile(path, "utf8")).toBe("我自己改写的主线。");
    expect(status(conflicted, "gimmick:1")).toBe("stale");

    const resolved = await service.convert(update, {
      decisions: {
        overwrite: new Set(["book-line:1"]),
        remove: new Set(["gimmick:1"]),
        regenerate: new Set()
      }
    });
    expect(status(resolved, "book-line:1")).toBe("updated");
    expect(await readFile(path, "utf8")).toContain("主线已经改了。");
    const snapshot = await fixture.catalog.indexSnapshot();
    const gimmick = first.entries.find(({ key }) => key === "gimmick:1")!;
    expect(
      snapshot.materials
        .find(({ id }) => id === gimmick.libraryId)!
        .entries.some(({ id }) => id === gimmick.entryId)
    ).toBe(false);
  });

  it("does not bring back an entry the user deleted until asked", async () => {
    const fixture = await longMaterialFixture();
    const service = fixture.service();
    const first = await service.convert({
      bookId: fixture.bookId,
      options: fixture.options,
      target: { action: "create", title: "仿写素材" },
      operationId: "op-deleted"
    });
    const world = first.entries.find(({ key }) => key === "world:index")!;
    await fixture.catalog.removeLibraryEntry({
      domain: "material",
      libraryId: world.libraryId!,
      entryId: world.entryId!,
      force: true
    });
    const update = {
      bookId: fixture.bookId,
      options: fixture.options,
      target: { action: "update" as const, packId: first.pack.id },
      operationId: "op-deleted-2"
    };
    expect(status(await service.convert(update), "world:index")).toBe(
      "deleted"
    );
    const regenerated = await service.convert(update, {
      decisions: {
        overwrite: new Set(),
        remove: new Set(),
        regenerate: new Set(["world:index"])
      }
    });
    expect(status(regenerated, "world:index")).toBe("new");
  });

  it("rebuilds guide entries from the saved submission and the agent can reach every index", async () => {
    const fixture = await longMaterialFixture();
    const service = fixture.service();
    const first = await service.convert({
      bookId: fixture.bookId,
      options: fixture.options,
      target: { action: "create", title: "仿写素材" },
      operationId: "op-guide"
    });
    const update = {
      bookId: fixture.bookId,
      options: fixture.options,
      target: { action: "update" as const, packId: first.pack.id },
      operationId: "op-guide-2"
    };
    const text = "这是一段足够长的仿写增强内容，覆盖结构与节奏。";
    const withGuide = await service.convert(update, {
      guide: {
        submission: {
          guide: text,
          roles: text,
          hooks: text,
          opening: text,
          style: { profile: text, excerpts: [] }
        }
      }
    });
    expect(status(withGuide, "enhance:guide:1")).toBe("new");
    expect(status(withGuide, "enhance:style:1")).toBe("new");
    expect(status(withGuide, "guide")).toBe("updated");
    expect((await service.convert(update)).counts.updated).toBe(0);

    await fixture.longs.updateBindings({
      bookId: fixture.bookId,
      linkedMaterialIdsByKind: {
        character: [
          first.entries.find((e) => e.kind === "character")!.libraryId!
        ],
        gimmick: [first.entries.find((e) => e.kind === "gimmick")!.libraryId!],
        plot: [first.entries.find((e) => e.kind === "plot")!.libraryId!],
        draft: [withGuide.entries.find((e) => e.kind === "draft")!.libraryId!],
        other: [first.entries.find((e) => e.kind === "other")!.libraryId!]
      },
      linkedSkillIdsByKind: {}
    });
    const query = new MaterialQueryService(fixture.catalog, fixture.longs);
    const scope = {
      bookId: fixture.bookId,
      bookType: "long" as const,
      stageId: "draft",
      kinds: ["character", "gimmick", "plot", "draft", "other"] as const
    };
    const listed = await query.query(
      MaterialQueryInputSchema.parse({ scope, mode: "list", limit: 64 })
    );
    const titles = listed.entries.map(({ title }) => title);
    for (const title of [
      "《铜铃记》剧情 · 全书导读",
      "《铜铃记》人设 · 人物总览与关系网",
      "《铜铃记》其他 · 世界观总览",
      "《铜铃记》正文 · 文风画像",
      "《铜铃记》梗 · 核心梗、金手指与卖点"
    ])
      expect(titles).toContain(title);
    expect(
      listed.entries.every(
        ({ metadata }) => metadata.descriptionSource === "configured"
      )
    ).toBe(true);
    const read = await query.query(
      MaterialQueryInputSchema.parse({
        scope,
        mode: "read",
        entry_name: "《铜铃记》其他 · 世界观总览"
      })
    );
    expect(read.content).toContain("铃境");
  });
});
