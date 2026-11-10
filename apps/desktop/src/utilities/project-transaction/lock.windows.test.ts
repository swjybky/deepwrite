import { constants } from "node:fs";
import {
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openProjectTransactionLockFile } from "./lock";
import { readRegularFileOptionalWithIdentity } from "./io";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open), realpath: vi.fn(fs.realpath) };
});
const realFs =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const roots: string[] = [];
beforeEach(() => {
  vi.mocked(open).mockReset().mockImplementation(realFs.open);
  vi.mocked(realpath).mockReset().mockImplementation(realFs.realpath);
});
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50
      })
    )
  );
});

function denied(code = "EPERM") {
  return Object.assign(new Error("fixture exclusive open denied"), { code });
}

it("retries transient Windows deletion contention without relaxing exclusive creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-lock-retry-"));
  roots.push(root);
  const path = join(root, "transaction.lock");
  vi.useFakeTimers();
  vi.mocked(open)
    .mockRejectedValueOnce(denied())
    .mockRejectedValueOnce(denied());
  const pending = openProjectTransactionLockFile(path, "win32");
  await vi.runAllTimersAsync();
  const handle = await pending;
  try {
    await handle.writeFile("new owner");
  } finally {
    await handle.close();
  }
  expect(await readFile(path, "utf8")).toBe("new owner");
  expect(open).toHaveBeenCalledTimes(3);
  for (const [, flags, mode] of vi.mocked(open).mock.calls) {
    expect(Number(flags) & constants.O_EXCL).toBe(constants.O_EXCL);
    expect(Number(flags) & constants.O_CREAT).toBe(constants.O_CREAT);
    expect(mode).toBe(0o600);
  }
});

it("preserves a persistent permission failure after a finite retry budget", async () => {
  vi.useFakeTimers();
  const error = denied();
  vi.mocked(open).mockRejectedValue(error);
  const assertion = expect(
    openProjectTransactionLockFile("transaction.lock", "win32")
  ).rejects.toBe(error);
  await vi.runAllTimersAsync();
  await assertion;
  expect(open).toHaveBeenCalledTimes(6);
});

it.each([
  ["linux", "EPERM"],
  ["darwin", "EPERM"],
  ["win32", "EACCES"],
  ["win32", "EIO"]
] as const)("does not retry %s %s failures", async (platform, code) => {
  const error = denied(code);
  vi.mocked(open).mockRejectedValue(error);
  await expect(
    openProjectTransactionLockFile("transaction.lock", platform)
  ).rejects.toBe(error);
  expect(open).toHaveBeenCalledTimes(1);
});

it("leaves an existing owner untouched and returns EEXIST to the lock protocol", async () => {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-lock-owner-"));
  roots.push(root);
  const path = join(root, "transaction.lock");
  await writeFile(path, "existing owner");
  await expect(
    openProjectTransactionLockFile(path, "win32")
  ).rejects.toMatchObject({
    code: "EEXIST"
  });
  expect(open).toHaveBeenCalledTimes(1);
  expect(await readFile(path, "utf8")).toBe("existing owner");
});

it("treats a lock deleted during canonical resolution as missing", async () => {
  const root = await realFs.realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-lock-deleted-"))
  );
  roots.push(root);
  const path = join(root, "transaction.lock");
  await writeFile(path, "existing owner");
  vi.mocked(realpath).mockImplementationOnce(async () => {
    await realFs.unlink(path);
    return join(root, "..", "deleted-lock");
  });
  await expect(
    readRegularFileOptionalWithIdentity(root, path, 4096, {
      pathRaceAsMissing: true
    })
  ).resolves.toBeUndefined();
});

it("still rejects an outside canonical path when the lock identity is unchanged", async () => {
  const root = await realFs.realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-lock-outside-"))
  );
  roots.push(root);
  const path = join(root, "transaction.lock");
  await writeFile(path, "existing owner");
  vi.mocked(realpath).mockResolvedValueOnce(join(root, "..", "outside-lock"));
  await expect(
    readRegularFileOptionalWithIdentity(root, path, 4096, {
      pathRaceAsMissing: true
    })
  ).rejects.toThrow("项目事务路径越过项目根目录");
  expect(await readFile(path, "utf8")).toBe("existing owner");
});
