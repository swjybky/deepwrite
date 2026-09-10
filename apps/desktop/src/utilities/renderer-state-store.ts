import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { backupRendererStateHistory } from "./renderer-state-history-backup";
import {
  RendererStateKeySchema,
  RendererStateHistoryMigrationSchema,
  type RendererStateHistoryMigration
} from "@deepwrite/contracts";

export const DEFAULT_RENDERER_STATE_MAX_ITEM_BYTES = 64 * 1024 * 1024;
export const DEFAULT_RENDERER_STATE_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

interface RendererStateDiskDocument {
  readonly version: 1;
  readonly entries: Record<string, unknown>;
}

export interface RendererStateStoreOptions {
  readonly maxItemBytes?: number;
  readonly maxTotalBytes?: number;
}

export class RendererStateSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererStateSerializationError";
  }
}

export class RendererStateCapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererStateCapacityError";
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonCompatible(
  value: unknown,
  path: string,
  ancestors: Set<object>
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RendererStateSerializationError(
        `${path} must not contain a non-finite number.`
      );
    }
    return;
  }
  if (typeof value !== "object") {
    throw new RendererStateSerializationError(
      `${path} contains a value that JSON cannot preserve.`
    );
  }
  if (ancestors.has(value)) {
    throw new RendererStateSerializationError(
      `${path} contains a circular reference.`
    );
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    throw new RendererStateSerializationError(
      `${path} must contain only JSON arrays and plain objects.`
    );
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        throw new RendererStateSerializationError(
          `${path}[${index}] must not be an array hole.`
        );
      }
      assertJsonCompatible(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    for (const [key, child] of Object.entries(value)) {
      // JSON.stringify omits undefined properties. Treat them as absent so
      // conversation patches like `proposedText: undefined` can still persist.
      if (child === undefined) continue;
      assertJsonCompatible(child, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function serializeJsonValue(value: unknown): {
  readonly value: unknown;
  readonly bytes: number;
} {
  assertJsonCompatible(value, "Renderer state value", new Set());
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error: unknown) {
    throw new RendererStateSerializationError(
      error instanceof Error
        ? `Renderer state value cannot be serialized: ${error.message}`
        : "Renderer state value cannot be serialized."
    );
  }
  return {
    value: JSON.parse(serialized) as unknown,
    bytes: Buffer.byteLength(serialized, "utf8")
  };
}

function positiveByteLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export class RendererStateStore {
  readonly statePath: string;
  readonly maxItemBytes: number;
  readonly maxTotalBytes: number;

  private writeChain: Promise<void> = Promise.resolve();
  private statePromise: Promise<Map<string, unknown>> | undefined;
  private temporaryFileClock = 0;

  constructor(userDataPath: string, options: RendererStateStoreOptions = {}) {
    if (!userDataPath.trim()) {
      throw new Error(
        "Renderer state store requires an application data path."
      );
    }
    this.statePath = join(
      userDataPath,
      "renderer-state",
      "conversation-persistence.json"
    );
    this.maxItemBytes = positiveByteLimit(
      options.maxItemBytes ?? DEFAULT_RENDERER_STATE_MAX_ITEM_BYTES,
      "Renderer state item byte limit"
    );
    this.maxTotalBytes = positiveByteLimit(
      options.maxTotalBytes ?? DEFAULT_RENDERER_STATE_MAX_TOTAL_BYTES,
      "Renderer state total byte limit"
    );
  }

  async listHistoryKeys(): Promise<string[]> {
    await this.writeChain;
    return [...(await this.requireState()).keys()].filter((key) =>
      key.startsWith("conversation-history:")
    );
  }

  async load(rawKey: string): Promise<unknown | undefined> {
    const key = RendererStateKeySchema.parse(rawKey);
    await this.writeChain;
    return (await this.requireState()).get(key);
  }

  async save(rawKey: string, value: unknown): Promise<void> {
    const key = RendererStateKeySchema.parse(rawKey);
    const serializedValue = serializeJsonValue(value);
    if (serializedValue.bytes > this.maxItemBytes) {
      throw new RendererStateCapacityError(
        `Renderer state item exceeds the ${this.maxItemBytes} byte limit.`
      );
    }

    await this.enqueueWrite(async () => {
      const next = new Map(await this.requireState());
      next.set(key, serializedValue.value);
      await this.persist(next);
      this.statePromise = Promise.resolve(next);
    });
  }

  async remove(rawKey: string): Promise<void> {
    const key = RendererStateKeySchema.parse(rawKey);
    await this.enqueueWrite(async () => {
      const current = await this.requireState();
      if (!current.has(key)) return;
      const next = new Map(current);
      next.delete(key);
      await this.persist(next);
      this.statePromise = Promise.resolve(next);
    });
  }

  async migrateHistory(input: RendererStateHistoryMigration): Promise<boolean> {
    const migration = RendererStateHistoryMigrationSchema.parse(input);
    const serialized = serializeJsonValue(migration.value);
    if (serialized.bytes > this.maxItemBytes) {
      throw new RendererStateCapacityError(
        `Renderer state item exceeds the ${this.maxItemBytes} byte limit.`
      );
    }
    let committed = false;
    await this.enqueueWrite(async () => {
      const current = await this.requireState();
      const expected = migration.expected;
      if (
        current.has(migration.key) !== expected.found ||
        (expected.found &&
          JSON.stringify(current.get(migration.key)) !==
            JSON.stringify(expected.value)) ||
        migration.sources.some(
          (source) =>
            !current.has(source.key) ||
            JSON.stringify(current.get(source.key)) !==
              JSON.stringify(source.value)
        )
      )
        return;
      const next = new Map(current);
      next.set(migration.key, serialized.value);
      for (const source of migration.sources) next.delete(source.key);
      const originals = new Map(
        migration.sources.map((source) => [source.key, current.get(source.key)])
      );
      if (current.has(migration.key))
        originals.set(migration.key, current.get(migration.key));
      await backupRendererStateHistory(this.statePath, originals);
      // Capacity is measured on the final state; rename commits save and cleanup together.
      await this.persist(next);
      this.statePromise = Promise.resolve(next);
      committed = true;
    });
    return committed;
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const queued = this.writeChain.then(operation);
    this.writeChain = queued.then(
      () => undefined,
      () => undefined
    );
    await queued;
  }

  private async requireState(): Promise<Map<string, unknown>> {
    if (!this.statePromise) {
      const loading = this.readState();
      const tracked = loading.catch((error: unknown) => {
        if (this.statePromise === tracked) this.statePromise = undefined;
        throw error;
      });
      this.statePromise = tracked;
    }
    return await this.statePromise;
  }

  private async readState(): Promise<Map<string, unknown>> {
    try {
      const metadata = await stat(this.statePath);
      if (metadata.size > this.maxTotalBytes) {
        throw new RendererStateCapacityError(
          `Renderer state file exceeds the ${this.maxTotalBytes} byte limit.`
        );
      }
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (
        !isPlainRecord(parsed) ||
        parsed.version !== 1 ||
        !isPlainRecord(parsed.entries)
      ) {
        throw new RendererStateSerializationError(
          "History file format is invalid; existing data has been preserved."
        );
      }

      const entries = new Map<string, unknown>();
      for (const [rawKey, value] of Object.entries(parsed.entries)) {
        const key = RendererStateKeySchema.safeParse(rawKey);
        if (!key.success)
          throw new RendererStateSerializationError(
            "History file contains an invalid key; existing data has been preserved."
          );
        const serializedValue = serializeJsonValue(value);
        if (serializedValue.bytes > this.maxItemBytes)
          throw new RendererStateCapacityError(
            "History file contains an oversized entry; existing data has been preserved."
          );
        entries.set(key.data, serializedValue.value);
      }
      return entries;
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return new Map();
      if (error instanceof SyntaxError)
        throw new RendererStateSerializationError(
          "History file JSON is invalid; existing data has been preserved."
        );
      throw error;
    }
  }

  private async persist(entries: ReadonlyMap<string, unknown>): Promise<void> {
    const document: RendererStateDiskDocument = {
      version: 1,
      entries: Object.fromEntries(entries)
    };
    const serialized = `${JSON.stringify(document)}\n`;
    const bytes = Buffer.byteLength(serialized, "utf8");
    if (bytes > this.maxTotalBytes) {
      throw new RendererStateCapacityError(
        `Renderer state exceeds the ${this.maxTotalBytes} byte total limit.`
      );
    }

    await mkdir(dirname(this.statePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.statePath}.tmp-${process.pid}-${Date.now()}-${++this.temporaryFileClock}`;
    try {
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporary, this.statePath);
    } catch (error: unknown) {
      try {
        await unlink(temporary);
      } catch (cleanupError: unknown) {
        if (!isNodeError(cleanupError, "ENOENT")) {
          throw new AggregateError(
            [error, cleanupError],
            "Renderer state write and temporary-file cleanup both failed."
          );
        }
      }
      throw error;
    }
  }
}
