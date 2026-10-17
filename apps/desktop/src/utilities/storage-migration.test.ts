import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationDatabase } from "./conversation-storage/database";
import { LegacyConversationStore } from "./conversation-storage/legacy-store";
import { STORAGE_MIGRATION_RECEIPT } from "./storage-migration-files";
import {
  migrationSidecars,
  type StorageMigrationOptions
} from "./storage-migration-state";
import { migrateStorageProfile } from "./storage-migration";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function fixture(
  allowExistingTarget = false
): Promise<StorageMigrationOptions> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-storage-migration-"))
  );
  roots.push(root);
  const sourcePath = join(root, "source");
  const targetPath = join(root, "target");
  await mkdir(sourcePath);
  return {
    sourcePath,
    targetPath,
    allowExistingTarget,
    migrationId: randomUUID()
  };
}

async function file(path: string, value: string | Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

async function json(path: string, value: unknown): Promise<void> {
  await file(path, JSON.stringify(value));
}

async function load(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("offline profile migration", () => {
  it("preserves encrypted keys, browser state, fonts and SQLite WAL while rewriting only registered internal paths", async () => {
    const options = await fixture();
    const { sourcePath, targetPath } = options;
    const external = `${sourcePath}-external`;
    await mkdir(external);
    const keyBytes = Buffer.from([0, 1, 255, 34, 10, 87, 95]);
    const browserBytes = Buffer.from([255, 17, 4, 0, 8, 29]);
    const files = new Map([
      [join("config", "model-secrets.bin"), keyBytes],
      [join("Local Storage", "leveldb", "000007.ldb"), browserBytes],
      [join("Session Storage", "000012.log"), browserBytes],
      [join("fonts", "files", "fixture.woff2"), keyBytes],
      [
        join("projects", "book", "body.md"),
        Buffer.from(`文稿中的路径 ${sourcePath} 保持原样`)
      ]
    ]);
    for (const [name, value] of files)
      await file(join(sourcePath, name), value);
    for (const suffix of ["", ".bak"]) {
      await json(join(sourcePath, `catalog-registry.json${suffix}`), {
        schemaVersion: 1,
        projects: [
          { projectDirectory: join(sourcePath, "projects", "book") },
          { projectDirectory: external }
        ],
        note: sourcePath
      });
      await json(join(sourcePath, `long-project-registry.json${suffix}`), {
        schemaVersion: 2,
        projects: [
          {
            projectDirectory: join(sourcePath, "projects", "long"),
            deletion: {
              originalProjectDirectory: join(sourcePath, "projects", "long"),
              stagedProjectDirectory: join(sourcePath, "projects", "retired")
            }
          }
        ]
      });
    }
    await json(join(sourcePath, "config", "workspace-directory.json"), {
      version: 1,
      path: join(sourcePath, "projects")
    });
    await file(join(external, "body.md"), "外部作品");
    const databasePath = join(
      sourcePath,
      "renderer-state",
      "conversations.sqlite"
    );
    await mkdir(dirname(databasePath));
    const history = {
      version: 1,
      conversations: [
        {
          sessionId: "fixture-session",
          messages: [{ id: "m1", role: "user", content: "写作历史" }]
        }
      ]
    };
    const initial = new ConversationDatabase(databasePath);
    new LegacyConversationStore(initial.database).save(
      "conversation-history:fixture",
      history
    );
    initial.database.exec("CREATE TABLE migration_wal_fixture (content TEXT)");
    initial.close();
    // An abruptly stopped writer leaves a real WAL; it must travel with the database.
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { DatabaseSync } from 'node:sqlite';
      const database = new DatabaseSync(process.argv[1]);
      database.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO migration_wal_fixture VALUES ('fixture-wal-row')");
      process.exit(0);
    `,
        databasePath
      ],
      { stdio: "pipe" }
    );
    expect((await lstat(`${databasePath}-wal`)).size).toBeGreaterThan(0);

    await migrateStorageProfile(options);

    for (const [name, value] of files) {
      expect(await readFile(join(targetPath, name))).toEqual(value);
      expect(await readFile(join(sourcePath, name))).toEqual(value);
    }
    expect(await readFile(join(external, "body.md"), "utf8")).toBe("外部作品");
    const catalog = await load(join(targetPath, "catalog-registry.json"));
    expect(
      catalog.projects.map(
        (item: { projectDirectory: string }) => item.projectDirectory
      )
    ).toEqual([join(targetPath, "projects", "book"), external]);
    expect(catalog.note).toBe(sourcePath);
    expect(
      (await load(join(targetPath, "long-project-registry.json.bak")))
        .projects[0].deletion
    ).toEqual({
      originalProjectDirectory: join(targetPath, "projects", "long"),
      stagedProjectDirectory: join(targetPath, "projects", "retired")
    });
    expect(
      (await load(join(targetPath, "config", "workspace-directory.json"))).path
    ).toBe(join(targetPath, "projects"));
    expect(
      (await load(join(sourcePath, "config", "workspace-directory.json"))).path
    ).toBe(join(sourcePath, "projects"));
    const reopened = new ConversationDatabase(
      join(targetPath, "renderer-state", "conversations.sqlite")
    );
    try {
      expect(
        new LegacyConversationStore(reopened.database).load(
          "conversation-history:fixture"
        )
      ).toEqual(history);
      expect(
        reopened.database
          .prepare("SELECT content FROM migration_wal_fixture")
          .get()?.content
      ).toBe("fixture-wal-row");
    } finally {
      reopened.close();
    }
  });

  it("ignores only known runtime locks and rejects links inside user content without following them", async () => {
    const options = await fixture();
    await file(
      join(options.sourcePath, "config", "models.json"),
      "fixture-model-config"
    );
    await symlink(
      "/missing-socket",
      join(options.sourcePath, "SingletonSocket")
    );
    await file(
      join(options.sourcePath, "long-project-registry.lock"),
      "retired-lock"
    );
    await migrateStorageProfile(options);
    expect(await readdir(options.targetPath)).not.toContain("SingletonSocket");
    expect(await readdir(options.targetPath)).not.toContain(
      "long-project-registry.lock"
    );
    const linked = await fixture();
    const external = join(dirname(linked.sourcePath), "outside.txt");
    await file(external, "outside");
    await symlink(external, join(linked.sourcePath, "linked-user-content"));
    await expect(migrateStorageProfile(linked)).rejects.toThrow("符号链接");
    expect(await readFile(external, "utf8")).toBe("outside");
    expect(
      (
        await lstat(join(linked.sourcePath, "linked-user-content"))
      ).isSymbolicLink()
    ).toBe(true);
    await expect(lstat(linked.targetPath)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects nonempty targets and same, nested or aliased directories without changing existing files", async () => {
    const options = await fixture();
    await file(join(options.sourcePath, "source.txt"), "source");
    await file(join(options.targetPath, "target.txt"), "target");
    await expect(migrateStorageProfile(options)).rejects.toThrow("不是空目录");
    await expect(
      migrateStorageProfile({ ...options, targetPath: options.sourcePath })
    ).rejects.toThrow("互相包含");
    await expect(
      migrateStorageProfile({
        ...options,
        targetPath: join(options.sourcePath, "nested")
      })
    ).rejects.toThrow("互相包含");
    await expect(
      migrateStorageProfile({
        ...options,
        targetPath: dirname(options.sourcePath)
      })
    ).rejects.toThrow("互相包含");
    const alias = join(dirname(options.sourcePath), "alias");
    await symlink(options.sourcePath, alias, "dir");
    await expect(
      migrateStorageProfile({ ...options, targetPath: alias })
    ).rejects.toThrow("符号链接");
    await expect(
      migrateStorageProfile({ ...options, targetPath: join(alias, "nested") })
    ).rejects.toThrow("互相包含");
    expect(await readFile(join(options.targetPath, "target.txt"), "utf8")).toBe(
      "target"
    );
    expect(await readFile(join(options.sourcePath, "source.txt"), "utf8")).toBe(
      "source"
    );
  });

  it("backs up a previous default profile and accepts only the verified same migration on retry", async () => {
    const options = await fixture(true);
    await file(join(options.sourcePath, "new.txt"), "new-profile");
    await file(join(options.targetPath, "old.txt"), "previous-default");
    await migrateStorageProfile(options);
    const { backup } = migrationSidecars(options);
    expect(await readFile(join(backup, "old.txt"), "utf8")).toBe(
      "previous-default"
    );
    expect(await readFile(join(options.targetPath, "new.txt"), "utf8")).toBe(
      "new-profile"
    );
    await migrateStorageProfile(options);
    await expect(
      migrateStorageProfile({
        ...options,
        allowExistingTarget: false,
        migrationId: randomUUID()
      })
    ).rejects.toThrow("不是空目录");
    await file(join(options.targetPath, "new.txt"), "changed-after-migration");
    await expect(migrateStorageProfile(options)).rejects.toThrow("校验失败");
    expect(await readFile(join(options.sourcePath, "new.txt"), "utf8")).toBe(
      "new-profile"
    );
  });

  it("completes a crash between backup and target renames using the journal and verified staging", async () => {
    const options = await fixture(true);
    await file(join(options.sourcePath, "new.txt"), "new-profile");
    await file(join(options.targetPath, "old.txt"), "previous-default");
    await migrateStorageProfile(options);
    const paths = migrationSidecars(options);
    await rename(options.targetPath, paths.staging);
    await json(paths.journal, { version: 1, ...options });
    await migrateStorageProfile(options);
    expect(await readFile(join(options.targetPath, "new.txt"), "utf8")).toBe(
      "new-profile"
    );
    expect(await readFile(join(paths.backup, "old.txt"), "utf8")).toBe(
      "previous-default"
    );
  });

  it("restores the previous target if interrupted staging cannot pass recovery checks", async () => {
    const options = await fixture(true);
    await file(join(options.sourcePath, "new.txt"), "new-profile");
    await file(join(options.targetPath, "old.txt"), "previous-default");
    await migrateStorageProfile(options);
    const paths = migrationSidecars(options);
    await rename(options.targetPath, paths.staging);
    await json(paths.journal, { version: 1, ...options });
    await file(join(paths.staging, "new.txt"), "damaged-staging");
    await expect(migrateStorageProfile(options)).rejects.toThrow(
      "原目标目录已恢复"
    );
    expect(await readFile(join(options.targetPath, "old.txt"), "utf8")).toBe(
      "previous-default"
    );
    expect(await readFile(join(options.sourcePath, "new.txt"), "utf8")).toBe(
      "new-profile"
    );
  });

  it("rebuilds an interrupted partial copy and refuses unowned staging directories", async () => {
    const options = await fixture();
    await file(join(options.sourcePath, "data.txt"), "complete");
    const paths = migrationSidecars(options);
    await file(join(paths.staging, "partial.txt"), "incomplete");
    await expect(migrateStorageProfile(options)).rejects.toThrow(
      "没有恢复记录"
    );
    await json(paths.journal, { version: 1, ...options });
    await migrateStorageProfile(options);
    expect(await readdir(options.targetPath)).toEqual([
      STORAGE_MIGRATION_RECEIPT,
      "data.txt"
    ]);
  });

  it("retains source and target when path configuration is invalid", async () => {
    const options = await fixture(true);
    await file(
      join(options.sourcePath, "catalog-registry.json"),
      "{invalid-json"
    );
    await file(join(options.targetPath, "old.txt"), "previous-default");
    await expect(migrateStorageProfile(options)).rejects.toThrow("配置损坏");
    expect(await readFile(join(options.targetPath, "old.txt"), "utf8")).toBe(
      "previous-default"
    );
    expect(
      await readFile(join(options.sourcePath, "catalog-registry.json"), "utf8")
    ).toBe("{invalid-json");
  });

  // libuv maps chmod to the Windows read-only attribute, which never blocks
  // reads for the owner, so an unreadable file cannot be staged there.
  it.runIf(process.platform !== "win32")(
    "retains source and target when source files cannot be read",
    async () => {
      const unreadable = await fixture();
      const path = join(unreadable.sourcePath, "private.bin");
      await file(path, "fixture-secret-bytes");
      await chmod(path, 0);
      try {
        await expect(migrateStorageProfile(unreadable)).rejects.toBeDefined();
        await expect(lstat(unreadable.targetPath)).rejects.toMatchObject({
          code: "ENOENT"
        });
      } finally {
        await chmod(path, 0o600);
      }
      expect(await readFile(path, "utf8")).toBe("fixture-secret-bytes");
    }
  );
});
