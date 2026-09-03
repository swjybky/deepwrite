import {
  RemoteModelListItemSchema,
  type RemoteModelListItem
} from "@deepwrite/contracts";

function recordValue(
  record: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function normalizeModelId(raw: string): string {
  const trimmed = raw.trim().replace(/^models\//u, "");
  return trimmed && trimmed.length <= 240 ? trimmed : "";
}

function remoteCandidate(record: Record<string, unknown>, id: string) {
  return {
    id,
    label: recordValue(record, "label", "display_name", "displayName"),
    provider: record.provider,
    requestModelId: recordValue(record, "requestModelId", "request_model_id"),
    supportsDeveloperRole: recordValue(
      record,
      "supportsDeveloperRole",
      "supports_developer_role"
    ),
    toolSchemaProfile: recordValue(
      record,
      "toolSchemaProfile",
      "tool_schema_profile"
    ),
    reasoning: record.reasoning,
    defaultThinkingLevel: recordValue(
      record,
      "defaultThinkingLevel",
      "default_thinking_level"
    ),
    thinkingLevelOptions: recordValue(
      record,
      "thinkingLevelOptions",
      "thinking_level_options"
    ),
    temperatureOptions: recordValue(
      record,
      "temperatureOptions",
      "temperature_options"
    ),
    contextWindow: recordValue(
      record,
      "contextWindow",
      "context_window",
      "context_length",
      "inputTokenLimit"
    ),
    maxTokens: recordValue(
      record,
      "maxTokens",
      "max_tokens",
      "max_output_tokens",
      "outputTokenLimit"
    ),
    status: record.status,
    discount: record.discount,
    input: record.input,
    output: record.output,
    cache: record.cache
  };
}

export function parseRemoteModelItem(
  item: unknown
): RemoteModelListItem | null {
  if (typeof item === "string") {
    const id = normalizeModelId(item);
    return id ? { id } : null;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const rawId =
    typeof record.id === "string"
      ? record.id
      : typeof record.name === "string"
        ? record.name
        : "";
  const id = normalizeModelId(rawId);
  if (!id) return null;

  let parsed: RemoteModelListItem = { id };
  for (const [key, value] of Object.entries(remoteCandidate(record, id))) {
    if (key === "id" || value === undefined) continue;
    const field = RemoteModelListItemSchema.safeParse({ id, [key]: value });
    if (field.success) parsed = { ...parsed, ...field.data };
  }
  if (parsed.label === id) delete parsed.label;
  return parsed;
}

export function parseRemoteModelList(payload: unknown): RemoteModelListItem[] {
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : undefined;
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : [];
  const models = new Map<string, RemoteModelListItem>();
  for (const item of items) {
    const parsed = parseRemoteModelItem(item);
    if (parsed && !models.has(parsed.id)) models.set(parsed.id, parsed);
    if (models.size >= 2_000) break;
  }
  return [...models.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}
