import {
  createMessageLocation,
  resolveMessageLocation,
  type MessageLocation
} from "./message-locations";
import { customRef, reactive, toRaw, type Ref } from "vue";
import type { ChatMessage } from "../../types/conversation";

const rawByProxy = new WeakMap<object, object>();
export function unwrapMessageValue<Value>(value: Value): Value {
  if (!value || typeof value !== "object") return value;
  const raw = toRaw(value);
  return (rawByProxy.get(raw) ?? raw) as Value;
}

export type MessageMutation =
  | { type: "structure"; changedMessages?: ChatMessage[] }
  | {
      type: "field";
      message: ChatMessage;
      path: (string | number)[];
      previous: unknown;
      value: unknown;
      removed: boolean;
      appendText?: string;
    };

export interface TrackedMessages {
  messages: Ref<ChatMessage[]>;
  findById(messageId: string): ChatMessage | undefined;
  appendText(target: object, key: string, text: string): void;
  replaceLoaded(messages: ChatMessage[]): void;
  subscribe(listener: (mutation: MessageMutation) => void): () => void;
}

/** Track writes as they happen, without subscribing to or walking old payloads.
 * Vue still owns presentation reactivity; these lazy proxies only journal the
 * changed path. Public nested mutations remain observable for existing callers.
 */
export function createTrackedMessages(initial: ChatMessage[]): TrackedMessages {
  const listeners = new Set<(mutation: MessageMutation) => void>();
  const proxyByRaw = new WeakMap<
    object,
    WeakMap<object, Map<string, { lineage: string; proxy: object }>>
  >();
  let replacingLoaded = false;
  let pendingAppend: { target: object; key: string; text: string } | undefined;
  let indexedMessages: Map<string, ChatMessage> | undefined;
  const notify = (mutation: MessageMutation) => {
    if (mutation.type === "structure") indexedMessages = undefined;
    for (const listener of listeners) listener(mutation);
  };
  const unwrap = unwrapMessageValue;

  function wrap(
    target: object,
    message?: ChatMessage,
    path: (string | number)[] = [],
    location?: MessageLocation
  ): object {
    const cacheKey = JSON.stringify(path);
    const owner = message ?? target;
    const lineage = location?.lineage ?? "root";
    const owners =
      proxyByRaw.get(target) ??
      new WeakMap<object, Map<string, { lineage: string; proxy: object }>>();
    const cache =
      owners.get(owner) ??
      new Map<string, { lineage: string; proxy: object }>();
    const cached = cache.get(cacheKey);
    if (cached?.lineage === lineage) return cached.proxy;
    const proxy = new Proxy(target, {
      get(source, key, receiver) {
        const value = Reflect.get(source, key, receiver);
        if (
          !value ||
          typeof value !== "object" ||
          typeof key === "symbol" ||
          key.startsWith("__v_")
        )
          return value;
        const part =
          Array.isArray(source) && /^\d+$/.test(key) ? Number(key) : key;
        return message
          ? wrap(
              unwrap(value) as object,
              message,
              [...path, part],
              createMessageLocation(unwrap(value) as object, location!, part)
            )
          : wrap(
              unwrap(value) as ChatMessage,
              unwrap(value) as ChatMessage,
              [],
              createMessageLocation(unwrap(value) as object)
            );
      },
      set(source, key, value) {
        const previous = Reflect.get(source, key);
        const next = unwrap(value);
        if (Object.is(previous, next)) return true;
        const applied = Reflect.set(source, key, next);
        if (!applied || typeof key === "symbol") return applied;
        if (!message || (path.length === 0 && key === "id")) {
          const replaced =
            message ??
            (previous &&
            next &&
            typeof previous === "object" &&
            typeof next === "object" &&
            Reflect.get(previous, "id") === Reflect.get(next, "id")
              ? (next as ChatMessage)
              : undefined);
          notify({
            type: "structure",
            ...(replaced ? { changedMessages: [replaced] } : {})
          });
        } else {
          if (unwrap(findById(message.id)) !== message) return true;
          const currentPath = resolveMessageLocation(location!, unwrap);
          if (!currentPath) return true;
          const part =
            Array.isArray(source) && /^\d+$/.test(key) ? Number(key) : key;
          // Array truncation is represented as replacement of that array; its
          // synthetic length property is not part of the JSON document.
          notify({
            type: "field",
            message,
            path:
              key === "length" && Array.isArray(source)
                ? currentPath
                : [...currentPath, part],
            previous,
            value: key === "length" && Array.isArray(source) ? source : next,
            removed: next === undefined,
            ...(pendingAppend?.target === source &&
            pendingAppend.key === key &&
            typeof previous === "string"
              ? { appendText: pendingAppend.text }
              : {})
          });
        }
        return true;
      },
      deleteProperty(source, key) {
        if (!Reflect.has(source, key)) return true;
        const previous = Reflect.get(source, key);
        if (!Reflect.deleteProperty(source, key)) return false;
        if (typeof key === "symbol") return true;
        if (!message) notify({ type: "structure" });
        else {
          if (unwrap(findById(message.id)) !== message) return true;
          const currentPath = resolveMessageLocation(location!, unwrap);
          if (!currentPath) return true;
          notify({
            type: "field",
            message,
            path: [
              ...currentPath,
              Array.isArray(source) && /^\d+$/.test(key) ? Number(key) : key
            ],
            previous,
            value: undefined,
            removed: true
          });
        }
        return true;
      }
    });
    rawByProxy.set(proxy, target);
    cache.set(cacheKey, { lineage, proxy });
    owners.set(owner, cache);
    proxyByRaw.set(target, owners);
    return proxy;
  }

  let current = reactive(wrap(initial) as ChatMessage[]);
  const messages = customRef<ChatMessage[]>((track, trigger) => ({
    get() {
      track();
      return current;
    },
    set(next) {
      if (next === current) return;
      const previous = replacingLoaded
        ? undefined
        : new Map(current.map((message) => [message.id, unwrap(message)]));
      current = reactive(wrap(unwrap(next) as ChatMessage[]) as ChatMessage[]);
      const changedMessages = previous
        ? current.filter(
            (message) => previous.get(message.id) !== unwrap(message)
          )
        : undefined;
      trigger();
      notify({
        type: "structure",
        ...(changedMessages ? { changedMessages } : {})
      });
    }
  }));
  function findById(messageId: string): ChatMessage | undefined {
    indexedMessages ??= new Map(
      current.map((message) => [message.id, message])
    );
    return indexedMessages.get(messageId);
  }
  return {
    messages,
    replaceLoaded(next) {
      replacingLoaded = true;
      try {
        messages.value = next;
      } finally {
        replacingLoaded = false;
      }
    },
    appendText(target, key, text) {
      const previous = pendingAppend;
      pendingAppend = { target: unwrap(target) as object, key, text };
      try {
        Reflect.set(target, key, `${Reflect.get(target, key) ?? ""}${text}`);
      } finally {
        pendingAppend = previous;
      }
    },
    findById,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
