import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  LEARNING_IMITATION_STAGE_DESCRIPTIONS,
  LEARNING_IMITATION_STAGE_IDS,
  LEARNING_IMITATION_STAGE_LABELS,
  LearningImitationAgentProfileSchema,
  LearningImitationPromptInputSchema,
  LearningImitationSettingsInputSchema,
  LearningImitationSettingsSchema,
  LearningImitationStageIdSchema,
  type LearningImitationAgentProfile,
  type LearningImitationSettings,
  type LearningImitationSettingsInput,
  type LearningImitationStageId
} from "@deepwrite/contracts";
import materialSplitPrompt from "./prompts/learning-imitation/material_split.txt?raw";
import plotLearningPrompt from "./prompts/learning-imitation/plot_learning.txt?raw";
import styleLearningPrompt from "./prompts/learning-imitation/style_learning.txt?raw";

interface DiskLearningImitationSettings {
  version: 1;
  overrides: Partial<Record<LearningImitationStageId, string>>;
  updatedAt?: string;
}

export const DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS = Object.freeze({
  material_split: materialSplitPrompt,
  plot_learning: plotLearningPrompt,
  style_learning: styleLearningPrompt
}) satisfies Readonly<Record<LearningImitationStageId, string>>;

function emptyDiskSettings(): DiskLearningImitationSettings {
  return { version: 1, overrides: {} };
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeDiskSettings(raw: unknown): DiskLearningImitationSettings {
  if (!raw || typeof raw !== "object") return emptyDiskSettings();
  const candidate = raw as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !candidate.overrides ||
    typeof candidate.overrides !== "object"
  ) {
    return emptyDiskSettings();
  }

  const rawOverrides = candidate.overrides as Record<string, unknown>;
  const overrides: Partial<Record<LearningImitationStageId, string>> = {};
  for (const id of LEARNING_IMITATION_STAGE_IDS) {
    if (!hasOwn(rawOverrides, id)) continue;
    const parsed = LearningImitationPromptInputSchema.safeParse({
      id,
      systemPrompt: rawOverrides[id]
    });
    if (
      parsed.success &&
      parsed.data.systemPrompt !== DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS[id]
    ) {
      overrides[id] = parsed.data.systemPrompt;
    }
  }

  const updatedAtTimestamp =
    typeof candidate.updatedAt === "string"
      ? Date.parse(candidate.updatedAt)
      : Number.NaN;
  const updatedAt =
    typeof candidate.updatedAt === "string" &&
    Number.isFinite(updatedAtTimestamp) &&
    new Date(updatedAtTimestamp).toISOString() === candidate.updatedAt
      ? candidate.updatedAt
      : undefined;
  return {
    version: 1,
    overrides,
    ...(updatedAt ? { updatedAt } : {})
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function toPublicSettings(
  disk: DiskLearningImitationSettings
): LearningImitationSettings {
  return LearningImitationSettingsSchema.parse({
    prompts: LEARNING_IMITATION_STAGE_IDS.map((id) => {
      const customized = hasOwn(disk.overrides, id);
      return {
        id,
        label: LEARNING_IMITATION_STAGE_LABELS[id],
        description: LEARNING_IMITATION_STAGE_DESCRIPTIONS[id],
        systemPrompt:
          disk.overrides[id] ?? DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS[id],
        customized
      };
    }),
    ...(disk.updatedAt ? { updatedAt: disk.updatedAt } : {})
  });
}

export class LearningImitationConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(
      userDataPath,
      "config",
      "learning-imitation-prompts.json"
    );
  }

  async list(): Promise<LearningImitationSettings> {
    await this.writeChain;
    return toPublicSettings(await this.readDiskSettings());
  }

  async save(
    rawInput: LearningImitationSettingsInput
  ): Promise<LearningImitationSettings> {
    const input = LearningImitationSettingsInputSchema.parse(rawInput);
    let saved: LearningImitationSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const byId = new Map(input.prompts.map((prompt) => [prompt.id, prompt]));
      const overrides: Partial<Record<LearningImitationStageId, string>> = {};
      for (const id of LEARNING_IMITATION_STAGE_IDS) {
        const systemPrompt = byId.get(id)!.systemPrompt;
        if (systemPrompt !== DEFAULT_LEARNING_IMITATION_SYSTEM_PROMPTS[id]) {
          overrides[id] = systemPrompt;
        }
      }
      const disk: DiskLearningImitationSettings = {
        version: 1,
        overrides,
        updatedAt: new Date().toISOString()
      };
      await atomicWriteJson(this.settingsPath, disk);
      saved = toPublicSettings(disk);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async reset(
    rawStageId?: LearningImitationStageId
  ): Promise<LearningImitationSettings> {
    const stageId = rawStageId
      ? LearningImitationStageIdSchema.parse(rawStageId)
      : undefined;
    let saved: LearningImitationSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const current = stageId
        ? await this.readDiskSettings()
        : emptyDiskSettings();
      const overrides = { ...current.overrides };
      if (stageId) delete overrides[stageId];
      const disk: DiskLearningImitationSettings = {
        version: 1,
        overrides,
        updatedAt: new Date().toISOString()
      };
      await atomicWriteJson(this.settingsPath, disk);
      saved = toPublicSettings(disk);
    });
    this.trackWrite(operation);
    await operation;
    return saved!;
  }

  async resolve(
    rawStageId: LearningImitationStageId
  ): Promise<LearningImitationAgentProfile> {
    const stageId = LearningImitationStageIdSchema.parse(rawStageId);
    const settings = await this.list();
    const prompt = settings.prompts.find((candidate) => candidate.id === stageId);
    if (!prompt) {
      throw new Error(`Missing learning imitation prompt profile: ${stageId}`);
    }
    return LearningImitationAgentProfileSchema.parse({
      id: prompt.id,
      label: prompt.label,
      systemPrompt: prompt.systemPrompt
    });
  }

  private trackWrite(operation: Promise<unknown>): void {
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
  }

  private async readDiskSettings(): Promise<DiskLearningImitationSettings> {
    return normalizeDiskSettings(await readJson(this.settingsPath));
  }
}
