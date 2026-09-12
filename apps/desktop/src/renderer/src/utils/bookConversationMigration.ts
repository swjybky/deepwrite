import type { ConversationPersistenceApi } from "@deepwrite/contracts";
import {
  mergeAgentConversationPersistenceSnapshots,
  isCompletePersistenceSnapshot
} from "../composables/agent-conversation/persistence-snapshot";
import {
  conversationHistoryPersistenceKey,
  HISTORY_PREFIX
} from "./conversationPersistenceKeys";

const SHORT_LEGACY_LANES = [
  "general",
  "character_design",
  "plot_design",
  "intro_design",
  "plot_refine",
  "narrative_perspective",
  "outline",
  "expert_draft_coordinator",
  "expert_section_writer"
];
const LONG_LEGACY_ROOTS = [
  "general",
  "setting",
  "worldbuilding",
  "character_design",
  "plot_design",
  "draft",
  "continuity_ledger"
];

function logicalHistoryKey(key: string): string | undefined {
  if (!key.startsWith(HISTORY_PREFIX) || /~[a-f0-9]{16}$/u.test(key))
    return undefined;
  try {
    return decodeURIComponent(key.slice(HISTORY_PREFIX.length));
  } catch {
    return undefined;
  }
}

function bookHistorySources(
  logicalKey: string,
  persistedKeys: readonly string[]
): string[] {
  if (!logicalKey.endsWith(":chat")) return [];
  const bookPrefix = logicalKey.slice(0, -4);
  const isLong = logicalKey.startsWith("long:");
  const lanes = isLong ? LONG_LEGACY_ROOTS : SHORT_LEGACY_LANES;
  const knownKeys = lanes.flatMap((lane) =>
    (isLong ? ["", ":__book__"] : [""]).map((suffix) =>
      conversationHistoryPersistenceKey(`${bookPrefix}${lane}${suffix}`)
    )
  );
  const discovered = persistedKeys.filter((key) => {
    const legacy = logicalHistoryKey(key);
    if (!legacy?.startsWith(bookPrefix)) return false;
    const [lane, child, ...rest] = legacy.slice(bookPrefix.length).split(":");
    if (!lane || !lanes.includes(lane) || rest.length > 0) return false;
    if (isLong) return child === undefined || Boolean(child);
    return (
      child === undefined || (lane.startsWith("expert_") && Boolean(child))
    );
  });
  return [...new Set([...knownKeys, ...discovered])];
}

/** Core backs up and atomically replaces sources only if the loaded values are unchanged. */
export async function migrateBookConversationHistory(
  api: ConversationPersistenceApi,
  logicalKey: string,
  save: (
    api: ConversationPersistenceApi,
    key: string,
    value: unknown
  ) => Promise<void> = (api, key, value) => api.save(key, value),
  onSnapshot?: (value: unknown) => void
): Promise<void> {
  if (!logicalKey.endsWith(":chat")) return;
  const key = conversationHistoryPersistenceKey(logicalKey);
  const sources = bookHistorySources(
    logicalKey,
    (await api.listHistoryKeys?.()) ?? []
  );
  if (api.history?.mergeScopes) {
    await api.history.mergeScopes({ key, sources });
    return;
  }
  const values: unknown[] = [];
  const migratedKeys: string[] = [];
  for (const source of sources) {
    const value = await api.load(source);
    // Keep an unreadable source intact instead of silently dropping its records.
    if (!isCompletePersistenceSnapshot(value)) continue;
    values.push(value);
    migratedKeys.push(source);
  }
  if (!values.length) return;
  const current = await api.load(key);
  const merged = mergeAgentConversationPersistenceSnapshots(current, values);
  if (!merged) return;
  onSnapshot?.(merged);
  if (current !== undefined && !isCompletePersistenceSnapshot(current)) {
    throw new Error("已有书籍历史包含暂无法识别的记录，原始记录已保留。");
  }
  if (api.migrateHistory) {
    await save(
      {
        ...api,
        async save(targetKey, value) {
          const committed = await api.migrateHistory!({
            key: targetKey,
            value,
            expected:
              current === undefined
                ? { found: false }
                : { found: true, value: current },
            sources: migratedKeys.map((source, index) => ({
              key: source,
              value: values[index]
            }))
          });
          if (!committed) throw new Error("历史记录在迁移期间已更新，请重试。");
        }
      },
      key,
      merged
    );
    return;
  }
  // Older APIs cannot back up and replace atomically. Keep their originals.
  await save(api, key, merged);
}
