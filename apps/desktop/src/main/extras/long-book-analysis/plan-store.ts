import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LONG_BOOK_ANALYSIS_PLAN_MAX_BYTES,
  LONG_BOOK_ANALYSIS_PLAN_MAX_PLANS,
  LongBookAnalysisPlanIdSchema,
  LongBookAnalysisPlanSchema,
  type LongBookAnalysisPlan
} from "@deepwrite/contracts";

export const LONG_BOOK_ANALYSIS_PLAN_DIRECTORY = "long-book-analysis-plans";

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readPlanFile(path: string): Promise<LongBookAnalysisPlan | null> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  }
  // A symlinked or oversized file is not one we wrote; ignore rather than follow.
  if (stats.isSymbolicLink() || !stats.isFile()) return null;
  if (stats.size > LONG_BOOK_ANALYSIS_PLAN_MAX_BYTES) return null;
  try {
    return LongBookAnalysisPlanSchema.parse(
      JSON.parse(await readFile(path, "utf8")) as unknown
    );
  } catch {
    // A corrupt plan must not take the whole listing down.
    return null;
  }
}

/**
 * Persists long-book analysis plans — the batch-scheduling state that lets a
 * 1000+ chapter run survive an app restart.
 *
 * One file per plan so checkpoint writes stay small: a round updates only its
 * own plan file instead of rewriting every plan.
 */
export class LongBookAnalysisPlanStore {
  readonly directory: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.directory = join(
      userDataPath,
      "config",
      LONG_BOOK_ANALYSIS_PLAN_DIRECTORY
    );
  }

  async list(): Promise<LongBookAnalysisPlan[]> {
    await this.writeChain;
    let entries;
    try {
      entries = await readdir(this.directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return [];
      throw error;
    }
    const plans: LongBookAnalysisPlan[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const plan = await readPlanFile(join(this.directory, entry.name));
      if (plan) plans.push(plan);
      if (plans.length >= LONG_BOOK_ANALYSIS_PLAN_MAX_PLANS) break;
    }
    return plans.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    );
  }

  async load(rawPlanId: string): Promise<LongBookAnalysisPlan | null> {
    const planId = LongBookAnalysisPlanIdSchema.parse(rawPlanId);
    return readPlanFile(join(this.directory, `${planId}.json`));
  }

  async save(rawPlan: LongBookAnalysisPlan): Promise<LongBookAnalysisPlan> {
    const plan = LongBookAnalysisPlanSchema.parse(rawPlan);
    const serialized = `${JSON.stringify(plan, null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > LONG_BOOK_ANALYSIS_PLAN_MAX_BYTES) {
      throw new Error("拆书计划体积超过安全上限。");
    }
    let saved: LongBookAnalysisPlan | undefined;
    const operation = this.writeChain.then(async () => {
      await mkdir(this.directory, { recursive: true });
      const target = join(this.directory, `${plan.id}.json`);
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
      await rename(temporary, target);
      saved = plan;
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async remove(rawPlanId: string): Promise<boolean> {
    const planId = LongBookAnalysisPlanIdSchema.parse(rawPlanId);
    let removed = false;
    const operation = this.writeChain.then(async () => {
      try {
        await rm(join(this.directory, `${planId}.json`));
        removed = true;
      } catch (error: unknown) {
        if (!isNodeError(error, "ENOENT")) throw error;
      }
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return removed;
  }
}
