import { unwrapMessageValue } from "./message-mutations";
import type {
  ConversationHistoryJson,
  ConversationHistoryOperation,
  ConversationHistoryRecord
} from "@deepwrite/contracts";
import type { AgentConversationPersistenceRecord } from "./types";

export interface ConversationPersistenceChanges {
  revision: number;
  /** These sessions retain their local journal until a pending deletion is resolved. */
  deferredSessionIds?: string[];
  activeSessionId: string;
  conversations: {
    sessionId: string;
    metadata: Omit<AgentConversationPersistenceRecord, "messages">;
    operations: ConversationHistoryOperation[];
  }[];
}

/** Copy mutable containers while sharing immutable strings. Large tool text
 * must not be stringified merely to prepare a later chunked IPC upload. */
export function clonePersistenceValue(value: unknown): ConversationHistoryJson {
  const ancestors = new Set<object>();
  function copy(input: unknown): ConversationHistoryJson {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    )
      return input;
    if (typeof input === "number") {
      if (!Number.isFinite(input))
        throw new TypeError("会话记录包含无法保存的非有限数值。");
      return input;
    }
    if (typeof input !== "object")
      throw new TypeError("会话记录包含 JSON 无法保存的数据类型。");
    const current = unwrapMessageValue(input);
    if (ancestors.has(current))
      throw new TypeError("会话记录包含循环引用，无法保存。");
    if (
      !Array.isArray(current) &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      Object.getPrototypeOf(current) !== null
    )
      throw new TypeError("会话记录只能包含 JSON 数组和普通对象。");
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const result: ConversationHistoryJson[] = [];
        for (let index = 0; index < current.length; index += 1) {
          if (!(index in current))
            throw new TypeError("会话记录数组含缺失项，无法保存。");
          result.push(copy(current[index]));
        }
        return result;
      }
      const result: ConversationHistoryRecord = {};
      for (const key of Object.keys(current)) {
        const child: unknown = Reflect.get(current, key);
        if (child !== undefined)
          Object.defineProperty(result, key, {
            value: copy(child),
            enumerable: true,
            writable: true,
            configurable: true
          });
      }
      return result;
    } finally {
      ancestors.delete(current);
    }
  }
  return copy(value);
}
export function clonePersistenceRecord(
  value: object
): ConversationHistoryRecord {
  const cloned = clonePersistenceValue(value);
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned))
    throw new Error("Expected persistence record");
  return cloned;
}
