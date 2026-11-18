/**
 * PI validates a tool call's arguments as a whole before `execute` runs: one
 * chapter with a ninth event, or one card that skips an empty section, would
 * reject every item of a batch and echo the full arguments back into the
 * context. Submission tools therefore show count and length limits as
 * descriptions and let empty collections be left out; `execute` puts those
 * back and checks each item on its own against the contract schema.
 */
import { parseJsonWithRepair } from "@earendil-works/pi-ai";

interface JsonSchema {
  type?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
}
const LIMIT_HINTS: Record<string, (value: unknown) => string> = {
  minItems: (value) => `至少 ${String(value)} 项`,
  maxItems: (value) => `最多 ${String(value)} 项`,
  // "Not empty" goes without saying; the item check still enforces it.
  minLength: (value) => (value === 1 ? "" : `至少 ${String(value)} 字`),
  maxLength: (value) => `不超过 ${String(value)} 字`
};
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions"]);

/**
 * What a left-out property stands for: `[]` for an array that may be empty,
 * and an object of such values for one made only of them. Anything else has
 * no stand-in and stays required.
 */
function emptyValue(schema: JsonSchema | undefined): unknown {
  if (schema?.type === "array") return schema.minItems ? undefined : [];
  if (schema?.type !== "object" || !schema.properties) return undefined;
  const value: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const empty = emptyValue(schema.properties[name]);
    if (empty === undefined) return undefined;
    value[name] = empty;
  }
  return value;
}

function relax(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(relax);
  if (!node || typeof node !== "object") return node;
  const { properties } = node as JsonSchema;
  const relaxed: Record<string, unknown> = {};
  const hints: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const hint = LIMIT_HINTS[key];
    if (hint) hints.push(hint(value));
    else if (key === "additionalProperties" && value === false) continue;
    else if (key === "required" && Array.isArray(value))
      relaxed[key] = value.filter(
        (name: string) => emptyValue(properties?.[name]) === undefined
      );
    else if (SCHEMA_MAPS.has(key) && value && typeof value === "object")
      relaxed[key] = Object.fromEntries(
        Object.entries(value).map(([name, schema]) => [name, relax(schema)])
      );
    else relaxed[key] = relax(value);
  }
  const limits = hints.filter(Boolean).join("，");
  if (limits)
    relaxed.description =
      typeof relaxed.description === "string" && relaxed.description
        ? `${relaxed.description}；${limits}`
        : limits;
  return relaxed;
}

/**
 * Each tool submits a single data kind (and asset kind), so `execute` fills
 * them in. A model that put `kind` beside `unitId` would otherwise fail the
 * whole-call check for every item.
 */
function omitKind(schema: JsonSchema, nested: string[] = []): JsonSchema {
  if (!schema.properties) return schema;
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([name]) => name !== "kind")
        .map(([name, value]) => [
          name,
          nested.includes(name) ? omitKind(value) : value
        ])
    ),
    required: (schema.required ?? []).filter((name) => name !== "kind")
  };
}

const relaxedSchemas = new WeakMap<object, unknown>();
/**
 * Same JSON schema without the fixed kinds, with limits as hints and empty
 * collections optional; cached so every child sends identical tools.
 */
export function relaxedSubmissionSchema(schema: object): unknown {
  let relaxed = relaxedSchemas.get(schema);
  if (!relaxed)
    relaxedSchemas.set(schema, (relaxed = relax(omitKind(schema, ["asset"]))));
  return relaxed;
}

/** Puts back the empty collections a model left out, before the item check. */
export function withEmptyCollections(
  schema: JsonSchema | undefined,
  value: unknown
): unknown {
  if (Array.isArray(value))
    return schema?.type === "array"
      ? value.map((item) => withEmptyCollections(schema.items, item))
      : value;
  if (!schema?.properties || !value || typeof value !== "object") return value;
  const filled: Record<string, unknown> = { ...value };
  for (const [name, property] of Object.entries(schema.properties)) {
    if (filled[name] != null)
      filled[name] = withEmptyCollections(property, filled[name]);
    else if (schema.required?.includes(name)) {
      const empty = emptyValue(property);
      if (empty !== undefined) filled[name] = empty;
    }
  }
  return filled;
}

const PAYLOAD_KEYS = new Set(["card", "registry", "review", "asset"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function decodeReadingEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeReadingEvidence);
  if (!isRecord(value)) return value;
  const { evidence_kind: evidenceKind, ...fields } = value;
  if (
    Object.hasOwn(fields, "inferred") ||
    (evidenceKind !== undefined &&
      evidenceKind !== "stated" &&
      evidenceKind !== "inferred")
  ) {
    throw new Error("事实来源请使用 evidence_kind=stated 或 inferred。");
  }
  const decoded = Object.fromEntries(
    Object.entries(fields).map(([name, item]) => [
      name,
      decodeReadingEvidence(item)
    ])
  );
  if (evidenceKind !== undefined)
    decoded.inferred = evidenceKind === "inferred";
  return decoded;
}
/**
 * Models send `items`, an item or its `data` as JSON text, sometimes encoded
 * twice and often with raw line breaks or stray escapes inside. Text that
 * still does not parse is reported here in a line: PI would wrap the string
 * in a list, report `items.0: must be object` and echo every argument back.
 */
function fromJsonText(value: unknown, path: string): unknown {
  let parsed = value;
  try {
    for (let depth = 0; typeof parsed === "string" && depth < 3; depth++)
      parsed = parseJsonWithRepair(parsed) as unknown;
  } catch (error) {
    const at = /position (\d+)/u.exec(
      error instanceof Error ? error.message : ""
    )?.[1];
    throw new Error(
      `${path} 被写成了文本，且无法解析为 JSON${at ? `（第 ${at} 个字符附近）` : ""}。items 直接传数组，每项是 {unitId, data} 对象，data 也直接写对象，不要再包成字符串；按原内容重交，不要删减。`
    );
  }
  if (typeof parsed === "string")
    throw new Error(
      `${path} 被多次编码成文本。items 直接传数组，不要包成字符串。`
    );
  return parsed;
}
function repairItem(raw: unknown, index: number): unknown {
  const item = fromJsonText(raw, `items.${index}`);
  if (!isRecord(item)) return item;
  const { data: rawData, ...rest } = item;
  const data = fromJsonText(rawData, `items.${index}.data`);
  const entries = Object.entries(rest);
  const moved = entries.filter(([key]) => PAYLOAD_KEYS.has(key));
  if (!moved.length) return rawData === undefined ? item : { ...rest, data };
  return {
    ...Object.fromEntries(entries.filter(([key]) => !PAYLOAD_KEYS.has(key))),
    data: { ...Object.fromEntries(moved), ...(isRecord(data) ? data : {}) }
  };
}
/**
 * Repairs shape slips the whole-call check would reject for every item: JSON
 * sent as text, one item instead of a list, or data fields beside `unitId`.
 */
export function repairSubmissionArguments(args: unknown): unknown {
  const value = fromJsonText(args, "参数");
  if (!isRecord(value)) return args;
  const items = fromJsonText(value.items, "items");
  const list = isRecord(items) ? [items] : items;
  return Array.isArray(list)
    ? { ...value, items: list.map(repairItem) }
    : value;
}

interface SubmissionIssue {
  code: string;
  path: PropertyKey[];
  message: string;
  maximum?: unknown;
  minimum?: unknown;
  expected?: string;
  values?: readonly unknown[];
  errors?: readonly (readonly SubmissionIssue[])[];
}
const MAX_LISTED_ISSUES = 6;

function valueAt(data: unknown, path: PropertyKey[]): unknown {
  let value = data;
  for (const key of path) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<PropertyKey, unknown>)[key];
  }
  return value;
}

// Union errors keep their real field errors inside `errors`. Prefer the branch
// matching the submitted kind, not a shorter but unrelated asset variant.
function fieldIssues(
  issues: readonly SubmissionIssue[],
  data: unknown,
  prefix: PropertyKey[] = []
): SubmissionIssue[] {
  return issues.flatMap((issue) => {
    const field = { ...issue, path: [...prefix, ...issue.path] };
    if (issue.code !== "invalid_union" || !issue.errors?.length) return [field];
    // Zod's branch paths are relative to the union, even for nested unions.
    const branches = issue.errors
      .map((branch) => fieldIssues(branch, data, field.path))
      .filter(
        (branch) =>
          !branch.some(
            (error) =>
              error.code === "invalid_value" &&
              error.path.at(-1) === "kind" &&
              error.values &&
              !error.values.includes(valueAt(data, error.path))
          )
      );
    branches.sort((a, b) => a.length - b.length);
    return branches[0] ?? [field];
  });
}

const TYPE_NAMES: Record<string, string> = {
  string: "字符串",
  number: "数字",
  int: "整数",
  boolean: "布尔值",
  array: "数组",
  object: "对象"
};

/** Short, field-level reasons; never echoes the submitted content. */
export function describeSubmissionIssues(
  issues: readonly SubmissionIssue[],
  data: unknown
): string {
  const fields = fieldIssues(issues, data);
  const lines = fields.slice(0, MAX_LISTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".") || "data";
    const value = valueAt(data, issue.path);
    if (issue.code === "invalid_type") {
      const expected = TYPE_NAMES[issue.expected ?? ""] ?? "符合要求的类型";
      return value === undefined
        ? `${path}：缺少必填字段，应填写${expected}`
        : `${path}：类型错误，应填写${expected}`;
    }
    if (issue.code === "invalid_union")
      return `${path}：结构不符合要求，请按工具参数填写 kind 对应的对象及字段`;
    if (issue.code !== "too_big" && issue.code !== "too_small")
      return `${path}：${issue.message}`;
    const size = Array.isArray(value)
      ? `${value.length} 项`
      : typeof value === "string"
        ? `${value.length} 字`
        : String(value);
    return issue.code === "too_big"
      ? `${path}：当前 ${size}，上限 ${String(issue.maximum)}`
      : `${path}：当前 ${size}，下限 ${String(issue.minimum)}`;
  });
  if (fields.length > MAX_LISTED_ISSUES)
    lines.push(`另有 ${fields.length - MAX_LISTED_ISSUES} 处`);
  return lines.join("；");
}
