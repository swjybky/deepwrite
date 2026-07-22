import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  LearningImitationSettings,
  LearningImitationSettingsInput,
  LearningImitationStageId
} from "@deepwrite/contracts";
import {
  DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS,
  LearningImitationConfigStore
} from "./learning-imitation-config-store";

const temporaryRoots = new Set<string>();

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-learning-imitation-store-"));
  temporaryRoots.add(root);
  return root;
}

function asInput(settings: LearningImitationSettings): LearningImitationSettingsInput {
  return {
    prompts: settings.prompts.map(({ id, systemPrompt }) => ({ id, systemPrompt }))
  };
}

function promptById(
  settings: LearningImitationSettings,
  stageId: LearningImitationStageId
): LearningImitationSettings["prompts"][number] {
  const prompt = settings.prompts.find((candidate) => candidate.id === stageId);
  if (!prompt) throw new Error(`Missing test prompt: ${stageId}`);
  return prompt;
}

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { recursive: true, force: true }))
  );
  temporaryRoots.clear();
});

describe("LearningImitationConfigStore", () => {
  it("keeps byte-identical copies of the three reference prompts", () => {
    const digest = (value: string): string =>
      createHash("sha256").update(value, "utf8").digest("hex");

    expect(digest(DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS.material_split)).toBe(
      "495e8d49413a087a2dbbbdc7e3ea27050992609d61c6ef40bf57250e5658409f"
    );
    expect(digest(DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS.plot_learning)).toBe(
      "ba4c96aa62a3090ca05901c721d72c06ea19f1cf43f246c1abd5a477e53149d4"
    );
    expect(digest(DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS.style_learning)).toBe(
      "000f46bdf64df47b74eee1aabcd380a4ff04e2ae1ce5bb5d33fda99aca797473"
    );
  });

  it("returns the three non-customized defaults when no config exists", async () => {
    const store = new LearningImitationConfigStore(await makeTemporaryRoot());

    const settings = await store.list();

    expect(settings.prompts.map(({ id }) => id)).toEqual([
      "material_split",
      "plot_learning",
      "style_learning"
    ]);
    expect(settings.prompts.every(({ customized }) => !customized)).toBe(true);
    expect(settings.updatedAt).toBeUndefined();
    expect(promptById(settings, "style_learning").systemPrompt).toBe(
      DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS.style_learning
    );
  });

  it("persists only customized prompts with private file permissions", async () => {
    const root = await makeTemporaryRoot();
    const store = new LearningImitationConfigStore(root);
    const input = asInput(await store.list());
    input.prompts.find(({ id }) => id === "plot_learning")!.systemPrompt =
      "自定义剧情学习提示词";

    const saved = await store.save(input);
    const path = join(root, "config", "learning-imitation-prompts.json");
    const disk = JSON.parse(await readFile(path, "utf8")) as {
      version: number;
      overrides: Record<string, string>;
      updatedAt: string;
    };

    expect(disk.version).toBe(1);
    expect(disk.overrides).toEqual({ plot_learning: "自定义剧情学习提示词" });
    expect(new Date(disk.updatedAt).toISOString()).toBe(disk.updatedAt);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(promptById(saved, "plot_learning").customized).toBe(true);
    expect(promptById(saved, "material_split").customized).toBe(false);
  });

  it("resets one override without changing the others, then resets all", async () => {
    const store = new LearningImitationConfigStore(await makeTemporaryRoot());
    const input = asInput(await store.list());
    input.prompts.find(({ id }) => id === "material_split")!.systemPrompt =
      "自定义素材拆分";
    input.prompts.find(({ id }) => id === "style_learning")!.systemPrompt =
      "自定义文风学习";
    await store.save(input);

    const partiallyReset = await store.reset("material_split");

    expect(promptById(partiallyReset, "material_split").customized).toBe(false);
    expect(promptById(partiallyReset, "style_learning").customized).toBe(true);
    await expect(store.resolve("style_learning")).resolves.toEqual({
      id: "style_learning",
      label: "文风学习",
      systemPrompt: "自定义文风学习"
    });

    const fullyReset = await store.reset();
    expect(fullyReset.prompts.every(({ customized }) => !customized)).toBe(true);
    expect(await store.list()).toEqual(fullyReset);
  });

  it("drops invalid or redundant disk overrides", async () => {
    const root = await makeTemporaryRoot();
    const directory = join(root, "config");
    await mkdir(directory);
    await writeFile(
      join(directory, "learning-imitation-prompts.json"),
      JSON.stringify({
        version: 1,
        overrides: {
          material_split: "",
          plot_learning: DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS.plot_learning,
          style_learning: "保留的文风覆盖",
          unknown: "忽略"
        },
        updatedAt: "not-a-date"
      }),
      "utf8"
    );

    const settings = await new LearningImitationConfigStore(root).list();

    expect(promptById(settings, "material_split").customized).toBe(false);
    expect(promptById(settings, "plot_learning").customized).toBe(false);
    expect(promptById(settings, "style_learning").systemPrompt).toBe(
      "保留的文风覆盖"
    );
    expect(settings.updatedAt).toBeUndefined();
  });

  it("continues the write queue after a persistence failure", async () => {
    const root = await makeTemporaryRoot();
    const store = new LearningImitationConfigStore(root);
    const input = asInput(await store.list());
    input.prompts.find(({ id }) => id === "material_split")!.systemPrompt =
      "恢复后的素材拆分";
    const blockingPath = join(root, "config");
    await writeFile(blockingPath, "not-a-directory", "utf8");

    await expect(store.save(input)).rejects.toMatchObject({
      code: expect.stringMatching(/EEXIST|ENOTDIR/u)
    });

    await unlink(blockingPath);
    await mkdir(blockingPath);
    const recovered = await store.save(input);
    expect(promptById(recovered, "material_split").systemPrompt).toBe(
      "恢复后的素材拆分"
    );
  });
});
