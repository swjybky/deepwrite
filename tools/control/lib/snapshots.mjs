import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { CliError } from "./output.mjs";
import { assertInsideTestEnvironment } from "./paths.mjs";

const SNAPSHOT_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/u;
/** Chromium caches rebuild themselves; config stays as seeded. */
const PROFILE_SKIP = new Set([
  "config",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Shared Dictionary",
  "DevToolsActivePort"
]);

export function snapshotDirectory(layout, name) {
  if (!SNAPSHOT_NAME.test(name ?? "")) {
    throw new CliError(
      "cli.invalid_arguments",
      `快照名「${name ?? ""}」无效：用字母、数字、点、下划线或连字符，最长 64 个字符。`,
      { nextSteps: ["例如 pnpm -s ctl data snapshot baseline"] }
    );
  }
  return join(layout.snapshots, name);
}

export async function listSnapshots(layout) {
  let names;
  try {
    names = await readdir(layout.snapshots);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const snapshots = [];
  for (const name of names.sort()) {
    try {
      snapshots.push(
        JSON.parse(
          await readFile(join(layout.snapshots, name, "meta.json"), "utf8")
        )
      );
    } catch {
      // An interrupted snapshot has no meta.json and is not offered.
    }
  }
  return snapshots;
}

export async function readSnapshot(layout, name) {
  const directory = snapshotDirectory(layout, name);
  try {
    return {
      directory,
      meta: JSON.parse(await readFile(join(directory, "meta.json"), "utf8"))
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    throw new CliError("data.unknown_snapshot", `没有名为「${name}」的快照。`, {
      nextSteps: ["运行 pnpm -s ctl data list 查看已有快照"]
    });
  }
}

const profileFilter = (layout) => (source) => {
  const offset = relative(layout.profile, source);
  return offset === "" || !PROFILE_SKIP.has(offset.split(sep)[0]);
};

export async function takeSnapshot(layout, name) {
  const directory = snapshotDirectory(layout, name);
  const existing = await listSnapshots(layout);
  if (existing.some((snapshot) => snapshot.name === name)) {
    throw new CliError("data.snapshot_exists", `快照「${name}」已存在。`, {
      nextSteps: ["换一个快照名", "运行 pnpm -s ctl data list 查看已有快照"]
    });
  }
  const staging = assertInsideTestEnvironment(layout, `${directory}.partial`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await cp(layout.profile, join(staging, "profile"), {
    recursive: true,
    filter: profileFilter(layout)
  }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await cp(layout.workspace, join(staging, "workspace"), {
    recursive: true
  }).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await cp(
    join(layout.root, "fixtures.json"),
    join(staging, "fixtures.json")
  ).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const meta = { name, createdAt: new Date().toISOString() };
  await writeFile(
    join(staging, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`
  );
  await rm(assertInsideTestEnvironment(layout, directory), {
    recursive: true,
    force: true
  });
  await rename(staging, directory);
  return { ...meta, directory };
}

/**
 * Copies a snapshot over data that `resetTargets` has already removed. The
 * fixture ledger comes back with it, since it describes that data.
 */
export async function copySnapshotBack(layout, directory) {
  const ledger = assertInsideTestEnvironment(
    layout,
    join(layout.root, "fixtures.json")
  );
  await cp(join(directory, "fixtures.json"), ledger).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await cp(
    join(directory, "profile"),
    assertInsideTestEnvironment(layout, layout.profile),
    {
      recursive: true,
      force: true
    }
  ).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  await cp(
    join(directory, "workspace"),
    assertInsideTestEnvironment(layout, layout.workspace),
    { recursive: true, force: true }
  ).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
