import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { CLIENT_NAME } from "./control-client.mjs";
import { CliError } from "./output.mjs";
import { assertInsideTestEnvironment } from "./paths.mjs";

/** Models, keys and the login; never works, conversations, sync or backup identity. */
export const SEED_COPY_FILES = [
  "models.json",
  "image-models.json",
  "voice.json",
  "web-search.json",
  "marketplace-session.json",
  "deepwrite-official-models-cache.json",
  "deepwrite-free-models-cache.json"
];

export const DEFAULT_TEST_MODEL_ID = "deepwrite-site-official-deepseek-flash";

export function installedProfilePath({
  home = homedir(),
  platform = process.platform,
  env = process.env
} = {}) {
  const appData =
    platform === "darwin"
      ? join(home, "Library/Application Support")
      : platform === "win32"
        ? (env.APPDATA ?? join(home, "AppData/Roaming"))
        : (env.XDG_CONFIG_HOME ?? join(home, ".config"));
  return join(appData, "@deepwrite", "desktop");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Follows the installed app's storage-location pointer, as Main does. */
export async function resolveSeedSource(from) {
  if (from) return resolve(from);
  const defaultPath = installedProfilePath();
  const pointer = await readJson(
    join(
      dirname(defaultPath),
      `.${basename(defaultPath)}.storage-location.json`
    )
  );
  if (pointer?.pending) {
    throw new CliError(
      "seed.source_migrating",
      "正式版的用户数据正在迁移，不能从中复制配置。",
      { nextSteps: ["请开发者先启动正式版完成数据迁移，再重新运行 env seed"] }
    );
  }
  return resolve(pointer?.currentPath ?? defaultPath);
}

function generatedFiles(layout, now) {
  return {
    "general-settings.json": {
      version: 2,
      permissionMode: "auto-approve",
      autoSave: true,
      language: "zh-CN",
      showInMenuBar: false,
      externalControlEnabled: true
    },
    "workspace-directory.json": { version: 1, path: layout.workspace },
    "external-control.json": {
      version: 1,
      clients: [{ name: CLIENT_NAME, approvedAt: now }]
    }
  };
}

async function hash(path) {
  try {
    return createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function planSeed(layout, sourceProfile) {
  const sourceConfig = join(sourceProfile, "config");
  const copies = [];
  for (const file of SEED_COPY_FILES) {
    const from = join(sourceConfig, file);
    copies.push({
      file,
      from,
      to: assertInsideTestEnvironment(layout, join(layout.config, file)),
      sourceHash: await hash(from)
    });
  }
  if (!copies.some((copy) => copy.file === "models.json" && copy.sourceHash)) {
    throw new CliError(
      "seed.source_missing",
      `在 ${sourceConfig} 没找到模型配置，无法准备测试环境。`,
      {
        nextSteps: [
          "确认正式版 DeepWrite 已配置过模型",
          "或用 --from <数据目录> 指定另一份配置来源"
        ]
      }
    );
  }
  return {
    source: sourceProfile,
    copies,
    writes: Object.keys(generatedFiles(layout, "")).map((file) => ({
      file,
      to: assertInsideTestEnvironment(layout, join(layout.config, file))
    }))
  };
}

export async function applySeed(layout, plan) {
  await mkdir(assertInsideTestEnvironment(layout, layout.config), {
    recursive: true
  });
  await mkdir(assertInsideTestEnvironment(layout, layout.workspace), {
    recursive: true
  });
  for (const copy of plan.copies) {
    if (copy.sourceHash) await copyFile(copy.from, copy.to);
  }
  const defaultModel = await setDefaultTestModel(layout);
  const files = generatedFiles(layout, new Date().toISOString());
  for (const write of plan.writes) {
    const temporary = `${write.to}.tmp-${process.pid}`;
    await writeFile(
      temporary,
      `${JSON.stringify(files[write.file], null, 2)}\n`
    );
    await rename(temporary, write.to);
  }
  const changed = [];
  for (const copy of plan.copies) {
    if ((await hash(copy.from)) !== copy.sourceHash) changed.push(copy.file);
  }
  if (changed.length > 0) {
    throw new CliError(
      "seed.source_changed",
      "复制期间正式配置发生了变化，测试环境里的副本可能不一致。",
      {
        nextSteps: ["等正式版或开发版停止写配置后重新运行 env seed"],
        details: { changed }
      }
    );
  }
  return {
    source: plan.source,
    copied: plan.copies.filter((copy) => copy.sourceHash).map((c) => c.file),
    skipped: plan.copies.filter((copy) => !copy.sourceHash).map((c) => c.file),
    written: plan.writes.map((write) => write.file),
    defaultModel,
    sourceUnchanged: true
  };
}

/** Agent checks run on the official site's DeepSeek unless a run names another model. */
async function setDefaultTestModel(layout) {
  const path = assertInsideTestEnvironment(
    layout,
    join(layout.config, "models.json")
  );
  const settings = JSON.parse(await readFile(path, "utf8"));
  if (!settings.models?.some((model) => model.id === DEFAULT_TEST_MODEL_ID)) {
    return {
      id: settings.defaultModelId,
      warning: `正式配置里没有 ${DEFAULT_TEST_MODEL_ID}，测试沿用原默认模型`
    };
  }
  settings.defaultModelId = DEFAULT_TEST_MODEL_ID;
  await writeFile(
    `${path}.tmp-${process.pid}`,
    `${JSON.stringify(settings, null, 2)}\n`
  );
  await rename(`${path}.tmp-${process.pid}`, path);
  return { id: DEFAULT_TEST_MODEL_ID };
}
