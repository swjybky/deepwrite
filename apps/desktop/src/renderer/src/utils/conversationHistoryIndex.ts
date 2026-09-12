import type {
  ConversationHistoryApi,
  ConversationHistorySession
} from "@deepwrite/contracts";
import type { ConversationHistoryItem } from "../types/conversation";

export function conversationHistoryItem(
  session: ConversationHistorySession,
  activeSessionId: string | null
): ConversationHistoryItem {
  const metadata = session.metadata;
  if (
    typeof metadata.createdAt !== "string" ||
    typeof metadata.updatedAt !== "string"
  )
    throw new Error("历史对话时间格式无效，原始记录已保留。");
  return {
    sessionId: session.sessionId,
    title:
      session.summary?.title ??
      (typeof metadata.title === "string" ? metadata.title : "未命名对话"),
    preview:
      session.summary?.preview ??
      (typeof metadata.preview === "string" ? metadata.preview : ""),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    messageCount: session.messageCount,
    turnCount:
      session.summary?.turnCount ??
      (typeof metadata.turnCount === "number" ? metadata.turnCount : 0),
    current: session.sessionId === activeSessionId
  };
}

async function withHistoryDates(
  api: ConversationHistoryApi,
  key: string,
  session: ConversationHistorySession
): Promise<ConversationHistorySession> {
  const metadata = { ...session.metadata };
  for (const field of ["createdAt", "updatedAt"]) {
    if (
      typeof metadata[field] === "string" &&
      Number.isFinite(Date.parse(metadata[field]))
    )
      continue;
    const result = await api.metadataDetail({
      key,
      sessionId: session.sessionId,
      path: [field],
      offset: 0,
      maxBytes: 1024,
      expectedRevision: session.revision
    });
    if (
      result.revision !== session.revision ||
      result.encoding !== "text" ||
      result.nextOffset !== null ||
      !Number.isFinite(Date.parse(result.chunk))
    )
      throw new Error("历史对话时间格式无效，原始记录已保留。");
    metadata[field] = result.chunk;
  }
  return { ...session, metadata };
}

export async function listConversationHistoryIndex(
  api: ConversationHistoryApi,
  key: string,
  deleted = false
) {
  const items: ConversationHistoryItem[] = [];
  let activeSessionId: string | null;
  let afterSessionId: string | undefined;
  for (;;) {
    const page = await api.list({
      key,
      afterSessionId,
      includeDeleted: deleted,
      limit: 100,
      maxBytes: 256 * 1024
    });
    activeSessionId = page.activeSessionId;
    for (const session of page.sessions) {
      if (session.deleted === deleted && session.messageCount > 0)
        items.push(
          conversationHistoryItem(
            await withHistoryDates(api, key, session),
            activeSessionId
          )
        );
    }
    if (page.nextSessionId === null) break;
    if (afterSessionId !== undefined && page.nextSessionId <= afterSessionId)
      throw new Error("历史会话分页游标没有向前移动。");
    afterSessionId = page.nextSessionId;
  }
  items.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
  for (const item of items) item.current = item.sessionId === activeSessionId;
  return { activeSessionId, items };
}
