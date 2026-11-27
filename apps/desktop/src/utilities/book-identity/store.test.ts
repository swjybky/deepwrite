import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BookIdentityRoundSchema,
  CoverLayoutSchema,
  type ChatAssistantProjectRef
} from "@deepwrite/contracts";
import { BookIdentityStore } from "./store";
import { writeIdentityFile } from "./io";
import {
  addManualCandidate,
  appendRound,
  deleteRound,
  pruneRounds,
  updateCandidate
} from "./records";
import {
  adopt,
  clearAdoption,
  saveComposedCover,
  writeCoverAsset
} from "./cover-operations";
import { readContext, resolveCoverAsset } from "./queries";

const roots: string[] = [];
const book: ChatAssistantProjectRef = {
  projectType: "short",
  projectId: "book_test"
};
const now = "2026-10-02T12:00:00.000Z";
const titleInput = {
  title: "雨夜来信",
  angle: "悬念",
  rationale: "未知来信制造悬念",
  keywords: ["雨夜"]
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO/aY8sAAAAASUVORK5CYII=";
// Core receives decoded and validated bytes from Main; this tests its header boundary.
const thumb = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
const image = {
  fileBase64: png,
  mimeType: "image/png",
  width: 1,
  height: 1,
  thumbBase64: thumb,
  imageProfile: {
    id: "image_test",
    presetId: "openai-compatible" as const,
    model: "placeholder-model"
  }
};
const layout = CoverLayoutSchema.parse({
  template: "top-center",
  title: "雨夜来信",
  fontFamily: "serif",
  color: "#ffffff"
});

async function fixture(write?: typeof writeIdentityFile) {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-identity-"));
  roots.push(root);
  const store = new BookIdentityStore({
    resolveProject: async () => root,
    now: () => now,
    ...(write ? { write } : {})
  });
  return { root, directory: join(root, "book-identity"), store };
}

function titleRound(id: string) {
  return BookIdentityRoundSchema.parse({
    id,
    field: "title",
    source: "agent",
    createdAt: now,
    request: { candidateCount: 1 },
    candidates: [{ ...titleInput, id: `cand_${id}` }]
  });
}

function coverRound() {
  return BookIdentityRoundSchema.parse({
    id: "round_cover",
    field: "cover",
    source: "agent",
    createdAt: now,
    request: {
      candidateCount: 1,
      imagesPerCandidate: 1,
      aspectRatio: "3:4",
      titleRendering: "overlay"
    },
    candidates: [
      {
        id: "cand_cover",
        concept: "孤灯",
        scene: "雨夜中的窗户",
        composition: "灯光占中央",
        palette: ["#ffffff"],
        artStyle: "水彩",
        typography: "顶部宋体",
        titlePlacement: "top",
        prompt: "a window in rain",
        rationale: "烘托悬念"
      }
    ]
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("book identity semantic store", () => {
  it("serializes concurrent rounds and manual writes without losing candidates", async () => {
    const { store, root } = await fixture();
    await Promise.all([
      appendRound(store, book, titleRound("round_a")),
      appendRound(store, book, titleRound("round_b")),
      addManualCandidate(store, book, "title", titleInput)
    ]);
    const record = await store.get(book);
    expect(record.rounds).toHaveLength(3);
    expect(record.revision).toBe(3);
    const reopened = new BookIdentityStore({
      resolveProject: async () => root
    });
    expect(await reopened.get(book)).toMatchObject({
      revision: 3,
      rounds: record.rounds
    });
    await expect(
      appendRound(store, book, titleRound("round_a"))
    ).rejects.toThrow("已经提交");
    expect((await store.get(book)).revision).toBe(3);
  });

  it("uses one manual round per field and keeps adopted text independent of edits", async () => {
    const { store } = await fixture();
    await addManualCandidate(store, book, "title", titleInput);
    await addManualCandidate(store, book, "title", {
      ...titleInput,
      title: "长夜灯火"
    });
    await addManualCandidate(store, book, "synopsis", {
      hook: "谁在门外？",
      text: "雨夜，有人送来了一封信。",
      angle: "悬念",
      rationale: "直入事件"
    });
    const record = await store.get(book);
    const round = record.rounds.find((entry) => entry.field === "title")!;
    const candidate = round.candidates[0]!;
    expect(record.rounds).toHaveLength(2);
    expect(round.candidates).toHaveLength(2);
    await adopt(store, book, "title", round.id, candidate.id);
    await updateCandidate(store, book, round.id, candidate.id, {
      title: "修改后的标题"
    });
    expect((await store.get(book)).adopted.title?.title).toBe("雨夜来信");
    await expect(deleteRound(store, book, round.id)).rejects.toThrow("已采用");
    expect(
      (await pruneRounds(store, book, "title")).rounds.some(
        (entry) => entry.id === round.id
      )
    ).toBe(true);
    await clearAdoption(store, book, "title");
    expect(
      (await deleteRound(store, book, round.id)).adopted.title
    ).toBeUndefined();
  });

  it("preserves corrupt files and only cleans old orphan images after a valid record is read", async () => {
    const { store, directory } = await fixture();
    await mkdir(join(directory, "covers"), { recursive: true });
    await writeFile(join(directory, "identity.json"), "{broken");
    await writeFile(
      join(directory, "covers", "orphan.png"),
      Buffer.from(png, "base64")
    );
    await utimes(join(directory, "covers", "orphan.png"), 0, 0);
    const record = await store.get(book);
    expect(record.rounds).toEqual([]);
    expect(record.diagnostics?.corruptFile).toMatch(/^identity\.corrupt-/);
    expect(
      await readFile(join(directory, record.diagnostics!.corruptFile!), "utf8")
    ).toBe("{broken");
    expect(await readdir(join(directory, "covers"))).toContain("orphan.png");
    await addManualCandidate(store, book, "title", titleInput);
    await store.get(book);
    expect(await readdir(join(directory, "covers"))).not.toContain(
      "orphan.png"
    );
  });

  it("does not modify copied records until the user explicitly inherits them", async () => {
    const { store, directory } = await fixture();
    const foreign = { ...book, projectId: "book_other" };
    await addManualCandidate(store, foreign, "title", titleInput);
    expect((await store.get(book)).diagnostics?.foreignBookId).toBe(
      "book_other"
    );
    await expect(
      addManualCandidate(store, book, "title", titleInput)
    ).rejects.toThrow("先继承");
    expect(
      JSON.parse(await readFile(join(directory, "identity.json"), "utf8"))
        .bookId
    ).toBe("book_other");
    expect(await store.inherit(book)).toMatchObject({
      bookId: "book_test",
      revision: 2
    });
  });

  it("rejects symlink directories and unsafe asset paths before touching external data", async () => {
    const { store, root, directory } = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "deepwrite-outside-"));
    roots.push(outside);
    await symlink(outside, directory);
    await expect(
      addManualCandidate(store, book, "title", titleInput)
    ).rejects.toThrow("真实文件夹");
    expect(await readdir(outside)).toEqual([]);
    await rm(directory);
    await appendRound(store, book, coverRound());
    await symlink(outside, join(directory, "covers"));
    await expect(
      writeCoverAsset(store, book, "round_cover", "cand_cover", { image })
    ).rejects.toThrow("真实文件夹");
    await expect(
      resolveCoverAsset(store, book, "../../secret.png")
    ).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(root)).toEqual(["book-identity"]);
  });

  it("rolls back new image files when the thumbnail or record commit fails and continues its queue", async () => {
    let failure: "thumb" | "record" | undefined;
    const { store, directory } = await fixture(async (path, bytes) => {
      if (
        (failure === "thumb" && path.endsWith(".thumb.jpg")) ||
        (failure === "record" && path.endsWith("identity.json"))
      ) {
        failure = undefined;
        throw new Error("injected commit failure");
      }
      await writeIdentityFile(path, bytes);
    });
    await appendRound(store, book, coverRound());
    for (const kind of ["thumb", "record"] as const) {
      failure = kind;
      await expect(
        writeCoverAsset(store, book, "round_cover", "cand_cover", {
          imageId: "img_failed",
          image
        })
      ).rejects.toThrow("injected");
      expect(await readdir(join(directory, "covers"))).toEqual([]);
      expect((await store.get(book)).revision).toBe(1);
    }
    expect(
      (
        await writeCoverAsset(store, book, "round_cover", "cand_cover", {
          imageId: "img_success",
          image
        })
      ).revision
    ).toBe(2);
  });

  it("rolls back an overwritten composition and adopted cover when record persistence fails", async () => {
    let fail = false;
    const { store, directory } = await fixture(async (path, bytes) => {
      if (fail && path.endsWith("identity.json")) {
        fail = false;
        throw new Error("injected record failure");
      }
      await writeIdentityFile(path, bytes);
    });
    await appendRound(store, book, coverRound());
    await writeCoverAsset(store, book, "round_cover", "cand_cover", {
      imageId: "img_a",
      image
    });
    await saveComposedCover(
      store,
      book,
      "round_cover",
      "cand_cover",
      "img_a",
      layout,
      png
    );
    await adopt(store, book, "cover", "round_cover", "cand_cover", "img_a");
    const original = await readFile(
      join(directory, "covers", "img_a.composed.png")
    );
    const changed = Buffer.concat([
      original,
      Buffer.from("different bytes")
    ]).toString("base64");
    fail = true;
    await expect(
      saveComposedCover(
        store,
        book,
        "round_cover",
        "cand_cover",
        "img_a",
        { ...layout, title: "另一标题" },
        changed
      )
    ).rejects.toThrow("injected");
    expect(
      await readFile(join(directory, "covers", "img_a.composed.png"))
    ).toEqual(original);
    await writeCoverAsset(store, book, "round_cover", "cand_cover", {
      imageId: "img_b",
      image: { ...image, fileBase64: changed }
    });
    fail = true;
    await expect(
      adopt(store, book, "cover", "round_cover", "cand_cover", "img_b")
    ).rejects.toThrow("injected");
    expect(await readFile(join(directory, "cover.png"))).toEqual(original);
    expect((await store.get(book)).adopted.cover?.imageId).toBe("img_a");
  });

  it("cleans deleted round assets, preserves favorites during pruning, and limits rounds", async () => {
    const { store, directory } = await fixture();
    await appendRound(store, book, coverRound());
    await writeCoverAsset(store, book, "round_cover", "cand_cover", {
      imageId: "img_a",
      image
    });
    await deleteRound(store, book, "round_cover");
    expect(await readdir(join(directory, "covers"))).toEqual([]);
    await appendRound(store, book, titleRound("round_star"));
    await updateCandidate(store, book, "round_star", "cand_round_star", {
      starred: true
    });
    await appendRound(store, book, titleRound("round_remove"));
    expect(
      (await pruneRounds(store, book, "title")).rounds.map((entry) => entry.id)
    ).toEqual(["round_star"]);
    for (let i = 1; i < 60; i += 1)
      await appendRound(store, book, titleRound(`round_${i}`));
    await expect(
      appendRound(store, book, titleRound("round_excess"))
    ).rejects.toThrow("60 轮");
    const context = await readContext(store, book, ["cand_round_star"]);
    expect(context.recentTitles).toHaveLength(60);
    expect(context.seedCandidates[0]?.id).toBe("cand_round_star");
  });

  it("rejects invalid bytes, mismatched dimensions and cross-field edits", async () => {
    const { store } = await fixture();
    await appendRound(store, book, coverRound());
    await expect(
      writeCoverAsset(store, book, "round_cover", "cand_cover", {
        image: { ...image, fileBase64: "%%%" }
      })
    ).rejects.toThrow("Base64");
    await expect(
      writeCoverAsset(store, book, "round_cover", "cand_cover", {
        image: { ...image, width: 100 }
      })
    ).rejects.toThrow("尺寸");
    await expect(
      updateCandidate(store, book, "round_cover", "cand_cover", {
        title: "坏字段"
      })
    ).rejects.toThrow("受控字段");
    expect((await store.get(book)).revision).toBe(1);
  });

  it("retains assets still referenced by another imported round", async () => {
    const { store, directory } = await fixture();
    await appendRound(store, book, coverRound());
    await writeCoverAsset(store, book, "round_cover", "cand_cover", {
      imageId: "img_shared",
      image
    });
    await store.mutate(book, (record) => {
      const copied = structuredClone(record.rounds[0]!);
      copied.id = "round_imported";
      copied.candidates[0]!.id = "cand_imported";
      record.rounds.push(copied);
    });
    await deleteRound(store, book, "round_cover");
    expect((await store.get(book)).rounds[0]?.id).toBe("round_imported");
    expect(await readdir(join(directory, "covers"))).toEqual([
      "img_shared.png",
      "img_shared.thumb.jpg"
    ]);
    await deleteRound(store, book, "round_imported");
    expect(await readdir(join(directory, "covers"))).toEqual([]);
  });

  it("enforces cover image counts and the record byte limit before committing metadata", async () => {
    const { store, directory } = await fixture();
    await appendRound(store, book, coverRound());
    for (let i = 0; i < 12; i += 1)
      await writeCoverAsset(store, book, "round_cover", "cand_cover", {
        imageId: `img_${i}`,
        image
      });
    await expect(
      writeCoverAsset(store, book, "round_cover", "cand_cover", {
        imageId: "img_excess",
        image
      })
    ).rejects.toThrow("12 张");
    const before = await readFile(join(directory, "identity.json"), "utf8");
    await expect(
      store.mutate(book, (record) => {
        const manual = titleRound("round_large");
        if (manual.field !== "title") throw new Error("Invalid fixture.");
        manual.source = "manual";
        manual.candidates = Array.from({ length: 1900 }, (_, i) => ({
          ...titleInput,
          id: `cand_large_${i}`,
          rationale: "字".repeat(2000),
          starred: false,
          edited: false
        }));
        record.rounds.push(manual);
      })
    ).rejects.toThrow("4 MB");
    expect(await readFile(join(directory, "identity.json"), "utf8")).toBe(
      before
    );
    expect((await store.get(book)).revision).toBe(13);
  });
});
