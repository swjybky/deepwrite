import { isRecord, toJsonFileText } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";

const MAX_IMPORTED_TEXT_DOCUMENT_BYTES = 28 * 1024 * 1024;
const MAX_MIGRATION_WARNINGS = 10_000;
const MAX_MIGRATION_WARNING_CHARACTERS = 4_000;
const MIGRATION_WARNING_OVERFLOW =
  "迁移过程中还有更多重复或次要警告；已达到 10,000 条返回上限。原始导入文件未被修改，已生成的迁移证据仍保留在项目中。";

export function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function normalizeTimestamp(value: unknown, fallback: string): string {
  const raw = stringValue(value).trim();
  if (!raw) return fallback;
  const timestamp = new Date(raw);
  return Number.isNaN(timestamp.valueOf()) ? fallback : timestamp.toISOString();
}

export function normalizeImportedAt(value: string | undefined): string {
  const fallback = new Date().toISOString();
  return normalizeTimestamp(value, fallback);
}

export class WarningCollector {
  private readonly values: string[] = [];
  private readonly seen = new Set<string>();
  private overflowed = false;
  private readonly decisions: Array<{
    action: "drop" | "merge" | "coerce" | "unresolved-reference";
    sourcePath: string;
    reason: string;
    raw: unknown;
  }> = [];
  private readonly evidence: Array<{
    title: string;
    source: string;
    content: string;
  }> = [];

  add(message: string): void {
    const trimmed = message.trim();
    if (!trimmed) return;
    let normalized = trimmed.slice(0, MAX_MIGRATION_WARNING_CHARACTERS);
    if (/[\uD800-\uDBFF]/u.test(normalized.at(-1) ?? "")) {
      normalized = normalized.slice(0, -1);
    }
    if (!normalized || this.seen.has(normalized)) return;
    if (this.values.length >= MAX_MIGRATION_WARNINGS - 1) {
      this.overflowed = true;
      return;
    }
    this.seen.add(normalized);
    this.values.push(normalized);
  }

  all(): string[] {
    return this.overflowed
      ? [...this.values, MIGRATION_WARNING_OVERFLOW]
      : [...this.values];
  }

  preserve(title: string, source: string, content: string): void {
    if (!content) return;
    this.evidence.push({ title, source, content });
  }

  preserveDecision(
    action: "drop" | "merge" | "coerce" | "unresolved-reference",
    sourcePath: string,
    reason: string,
    raw: unknown
  ): void {
    this.decisions.push({
      action,
      sourcePath,
      reason,
      raw: raw === undefined ? null : raw
    });
  }

  preserved(): ReadonlyArray<{
    title: string;
    source: string;
    content: string;
  }> {
    if (this.decisions.length === 0) return this.evidence;
    return [
      ...this.evidence,
      {
        title: "迁移决策完整审计日志",
        source: "migration.decisions.json",
        content: toJsonFileText({
          schema: "deepwrite.write-claw-migration-decisions",
          schemaVersion: 1,
          decisions: this.decisions
        })
      }
    ];
  }
}

export function safeUnicode(
  value: unknown,
  warnings: WarningCollector,
  label: string
): string {
  const content = stringValue(value);
  const roundTrip = Buffer.from(content, "utf8").toString("utf8");
  if (roundTrip !== content) {
    warnings.add(`${label}包含无效 Unicode，已替换为安全字符。`);
  }
  return roundTrip;
}

export function clipped(
  value: unknown,
  maxLength: number,
  warnings: WarningCollector,
  label: string
): string {
  const content = safeUnicode(value, warnings, label);
  if (content.length <= maxLength) return content;
  warnings.preserve(`${label}（完整溢出原文）`, label, content);
  warnings.add(
    `${label}超过当前长篇结构字段上限；结构字段保留前 ${maxLength} 个字符，完整原文已写入只读迁移证据。`
  );
  return content.slice(0, maxLength);
}

export function splitTextByUtf8Bytes(
  content: string,
  maxBytes: number
): string[] {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return [content];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    let low = offset + 1;
    let high = content.length;
    let end = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate =
        middle < content.length && /[\uD800-\uDBFF]/u.test(content[middle - 1]!)
          ? middle - 1
          : middle;
      if (
        candidate > offset &&
        Buffer.byteLength(content.slice(offset, candidate), "utf8") <= maxBytes
      ) {
        end = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (end <= offset) {
      throw new Error("迁移证据包含无法按 UTF-8 安全分片的内容。");
    }
    chunks.push(content.slice(offset, end));
    offset = end;
  }
  return chunks;
}

export function clippedTextDocument(
  value: unknown,
  warnings: WarningCollector,
  label: string
): string {
  const content = safeUnicode(value, warnings, label);
  if (Buffer.byteLength(content, "utf8") <= MAX_IMPORTED_TEXT_DOCUMENT_BYTES) {
    return content;
  }
  warnings.preserve(`${label}（完整溢出原文）`, label, content);
  warnings.add(
    `${label}超过当前单文档 28 MiB 导入预算；可编辑文档已安全裁剪，完整原文已写入只读迁移证据。`
  );
  return splitTextByUtf8Bytes(content, MAX_IMPORTED_TEXT_DOCUMENT_BYTES)[0]!;
}

export function title(
  value: unknown,
  fallback: string,
  warnings: WarningCollector,
  label: string
): string {
  return clipped(value, 256, warnings, label).trim() || fallback.slice(0, 256);
}

export class DeterministicIdRegistry {
  private readonly firstByKindAndLegacy = new Map<string, string>();
  private readonly counts = new Map<string, number>();
  private readonly exportMap = new Map<string, Map<string, string>>();

  constructor(
    private readonly namespace: string,
    private readonly warnings: WarningCollector
  ) {}

  allocate(
    kind: string,
    prefix: string,
    legacyValue: unknown,
    fallbackKey: string
  ): string {
    const legacyId = stringValue(legacyValue).trim();
    const externalKey = legacyId || fallbackKey;
    const internalKey = `${kind}\0${externalKey}`;
    const occurrence = (this.counts.get(internalKey) ?? 0) + 1;
    this.counts.set(internalKey, occurrence);
    if (occurrence > 1 && legacyId) {
      this.warnings.add(
        `旧版 ${kind} ID“${legacyId}”重复；引用将指向首个条目，重复条目已获得独立稳定 ID。`
      );
      this.warnings.preserveDecision(
        "coerce",
        `$legacy.${kind}[id=${JSON.stringify(legacyId)}].id`,
        `重复旧版 ID 的第 ${occurrence} 个实体已获得独立稳定 ID；旧引用仍指向首个实体。`,
        legacyValue
      );
    }
    const seed =
      occurrence === 1
        ? `${this.namespace}\0${kind}\0${externalKey}`
        : `${this.namespace}\0${kind}\0${externalKey}\0duplicate-${occurrence}`;
    const id = `${prefix}_legacy-${sha256Hex(seed).slice(0, 24)}`;
    if (!this.firstByKindAndLegacy.has(internalKey)) {
      this.firstByKindAndLegacy.set(internalKey, id);
      const map = this.exportMap.get(kind) ?? new Map<string, string>();
      map.set(externalKey, id);
      this.exportMap.set(kind, map);
    } else {
      const map = this.exportMap.get(kind) ?? new Map<string, string>();
      map.set(`${externalKey}#duplicate-${occurrence}`, id);
      this.exportMap.set(kind, map);
    }
    return id;
  }

  resolve(kind: string, legacyValue: unknown): string | undefined {
    const legacyId = stringValue(legacyValue).trim();
    return legacyId
      ? this.firstByKindAndLegacy.get(`${kind}\0${legacyId}`)
      : undefined;
  }

  alias(kind: string, legacyValue: unknown, id: string): void {
    const legacyId = stringValue(legacyValue).trim();
    if (!legacyId) return;
    const internalKey = `${kind}\0${legacyId}`;
    if (this.firstByKindAndLegacy.has(internalKey)) return;
    this.firstByKindAndLegacy.set(internalKey, id);
    const map = this.exportMap.get(kind) ?? new Map<string, string>();
    map.set(legacyId, id);
    this.exportMap.set(kind, map);
  }

  snapshot(): Record<string, Record<string, string>> {
    return Object.fromEntries(
      [...this.exportMap.entries()].map(([kind, values]) => [
        kind,
        Object.fromEntries(values)
      ])
    );
  }
}

export function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
  aliases: Readonly<Record<string, string>> = {},
  audit?: {
    warnings: WarningCollector;
    sourcePath: string;
  }
): string {
  const raw = stringValue(value).trim();
  const normalized = aliases[raw] ?? (allowed.has(raw) ? raw : fallback);
  if (audit && raw && normalized !== raw) {
    audit.warnings.preserveDecision(
      "coerce",
      audit.sourcePath,
      aliases[raw]
        ? `旧枚举值已映射为 ${normalized}。`
        : `未知枚举值已回退为 ${fallback}。`,
      value
    );
  }
  return normalized;
}
