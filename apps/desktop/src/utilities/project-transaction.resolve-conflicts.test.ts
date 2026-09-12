import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recoverProjectTransaction } from "./project-transaction";
import { resolveProjectTransactionConflicts } from "./project-transaction/resolve-conflicts";
import { stageRecovery } from "./project-recovery.test-support";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map(async (root) => await rm(root, { recursive: true, force: true }))
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-rebase-"))
  );
  roots.push(root);
  await writeFile(join(root, "edited.md"), "original");
  await writeFile(join(root, "pending.md"), "before");
  return root;
}
const maxFileBytes = 1024 * 1024;
const prepare = async () => new Map<string, string>();

describe("explicit transaction conflict resolution", () => {
  it("keeps external writes and deletions while finishing unaffected staged files", async () => {
    const root = await fixture();
    const { journalPath } = await stageRecovery(
      root,
      [
        { path: "edited.md", content: null },
        { path: "pending.md", content: "staged" },
        { path: "missing.md", content: "new file" }
      ],
      "committing"
    );
    await writeFile(join(root, "edited.md"), "external");
    await expect(recoverProjectTransaction(root)).rejects.toThrow(
      "项目文件已在其他位置更新"
    );
    const result = await resolveProjectTransactionConflicts({
      projectRoot: root,
      maxFileBytes,
      prepare
    });
    expect(result.resolvedPaths).toEqual(["edited.md"]);
    expect(await readFile(join(root, "edited.md"), "utf8")).toBe("external");
    expect(await readFile(join(root, "pending.md"), "utf8")).toBe("staged");
    expect(await readFile(join(root, "missing.md"), "utf8")).toBe("new file");
    await expect(readFile(journalPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("retains missing external files and tolerates already-applied stages", async () => {
    const root = await fixture();
    const { journal } = await stageRecovery(root, [
      { path: "edited.md", content: "staged edit" },
      { path: "pending.md", content: "already applied" }
    ]);
    await rm(join(root, "edited.md"));
    await writeFile(join(root, "pending.md"), "already applied");
    await rm(join(root, journal.operations[1]!.stagePath!));
    await expect(
      resolveProjectTransactionConflicts({
        projectRoot: root,
        maxFileBytes,
        prepare
      })
    ).resolves.toMatchObject({ resolvedPaths: ["edited.md"] });
    await expect(readFile(join(root, "edited.md"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rechecks disk hashes if another editor writes during preparation", async () => {
    const root = await fixture();
    const { journalPath } = await stageRecovery(root, [
      { path: "edited.md", content: "staged edit" },
      { path: "pending.md", content: "staged pending" }
    ]);
    await writeFile(join(root, "edited.md"), "external");
    const journal = await readFile(journalPath, "utf8");
    await expect(
      resolveProjectTransactionConflicts({
        projectRoot: root,
        maxFileBytes,
        prepare: async () => {
          await writeFile(join(root, "edited.md"), "newer external edit");
          return new Map();
        }
      })
    ).rejects.toThrow("项目文件已在其他位置更新");
    expect(await readFile(join(root, "edited.md"), "utf8")).toBe(
      "newer external edit"
    );
    expect(await readFile(join(root, "pending.md"), "utf8")).toBe("before");
    expect(await readFile(journalPath, "utf8")).toBe(journal);
  });

  it("does not bypass unsafe paths or damaged staged contents", async () => {
    const root = await fixture();
    const { journal, journalPath } = await stageRecovery(root, [
      { path: "edited.md", content: "staged edit" },
      { path: "pending.md", content: "staged pending" }
    ]);
    await writeFile(join(root, "edited.md"), "external");
    await writeFile(join(root, journal.operations[1]!.stagePath!), "damaged");
    await expect(
      resolveProjectTransactionConflicts({
        projectRoot: root,
        maxFileBytes,
        prepare
      })
    ).rejects.toThrow("暂存文件校验失败");
    await rm(join(root, "edited.md"));
    await symlink(join(root, "pending.md"), join(root, "edited.md"));
    await expect(
      resolveProjectTransactionConflicts({
        projectRoot: root,
        maxFileBytes,
        prepare
      })
    ).rejects.toThrow("符号链接");
    expect(JSON.parse(await readFile(journalPath, "utf8"))).toEqual(journal);
  });
});
