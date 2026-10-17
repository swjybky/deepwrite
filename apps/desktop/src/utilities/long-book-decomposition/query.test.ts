import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { queryDecomposition } from "./query";
import { decompositionFixture } from "./test-support";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it.each(["continuation", "materials"] as const)(
  "returns an empty registry before %s has saved its merge",
  async (mode) => {
    const fixture = await decompositionFixture(mode, 1);
    roots.push(fixture.root);
    const result = await queryDecomposition(
      fixture.job,
      fixture.root,
      fixture.service.reader,
      { kind: "registry" }
    );
    expect(JSON.parse(result.content)).toMatchObject({
      characters: [],
      terms: [],
      nameIndex: {},
      editedByUser: false
    });
    expect(result.nextCursor).toBeNull();
  }
);

it("still rejects a missing authoritative registry record after the merge is marked done", async () => {
  const fixture = await decompositionFixture("continuation", 1);
  roots.push(fixture.root);
  fixture.job.units["registry:merge"] = {
    ...fixture.job.units["chunk:1"]!,
    phase: "registry",
    status: "done",
    outputRefs: []
  };
  await expect(
    queryDecomposition(fixture.job, fixture.root, fixture.service.reader, {
      kind: "registry"
    })
  ).rejects.toThrow();
});

it("reconstructs a large paged status result from streamed JSON fragments", async () => {
  const fixture = await decompositionFixture("materials", 1);
  roots.push(fixture.root);
  const template = fixture.job.units["chunk:1"]!;
  for (let index = 0; index < 500; index += 1) {
    fixture.job.units[`unit:test:${index}`] = {
      ...template,
      dependencies: []
    };
  }

  let cursor = 0;
  let content = "";
  let totalCharacters: number | undefined;
  let pages = 0;
  do {
    const page = await queryDecomposition(
      fixture.job,
      fixture.root,
      fixture.service.reader,
      { kind: "status", ...(cursor > 0 ? { cursor } : {}) }
    );
    content += page.content;
    totalCharacters = page.totalCharacters;
    cursor = page.nextCursor ?? 0;
    pages += 1;
  } while (cursor > 0);

  expect(pages).toBeGreaterThan(1);
  expect(totalCharacters).toBe(content.length);
  expect(JSON.parse(content)).toMatchObject({ phase: fixture.job.phase });
});
