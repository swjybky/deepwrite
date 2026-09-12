interface ValueFrame {
  kind: "value";
  value: unknown;
}
interface ArrayFrame {
  kind: "array";
  value: unknown[];
  index: number;
}
interface ObjectFrame {
  kind: "object";
  value: Record<string, unknown>;
  keys: string[];
  index: number;
}
interface CloseFrame {
  kind: "close";
  value: object;
  text: string;
}
type Frame = ValueFrame | ArrayFrame | ObjectFrame | CloseFrame;
function* quoted(text: string, stringSlice: number): Generator<string> {
  yield '"';
  for (let index = 0; index < text.length; index += stringSlice)
    yield JSON.stringify(text.slice(index, index + stringSlice)).slice(1, -1);
  yield '"';
}
function* tokens(value: unknown, stringSlice: number): Generator<string> {
  const stack: Frame[] = [{ kind: "value", value }];
  const ancestors = new Set<object>();
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.kind === "close") {
      ancestors.delete(frame.value);
      yield frame.text;
      continue;
    }
    if (frame.kind === "array") {
      if (frame.index === frame.value.length) continue;
      if (frame.index) yield ",";
      stack.push(
        { ...frame, index: frame.index + 1 },
        { kind: "value", value: frame.value[frame.index] }
      );
      continue;
    }
    if (frame.kind === "object") {
      if (frame.index === frame.keys.length) continue;
      if (frame.index) yield ",";
      const key = frame.keys[frame.index]!;
      yield* quoted(key, stringSlice);
      yield ":";
      stack.push(
        { ...frame, index: frame.index + 1 },
        { kind: "value", value: frame.value[key] }
      );
      continue;
    }
    const current = frame.value;
    if (current === null || current === undefined) {
      yield "null";
      continue;
    }
    if (typeof current === "string") {
      yield* quoted(current, stringSlice);
      continue;
    }
    if (typeof current === "boolean") {
      yield current ? "true" : "false";
      continue;
    }
    if (typeof current === "number") {
      yield Number.isFinite(current) ? String(current) : "null";
      continue;
    }
    if (typeof current !== "object")
      throw new Error("会话中包含无法导出为 JSON 的数据。");
    if (ancestors.has(current))
      throw new Error("会话中包含循环引用，无法完整导出。");
    ancestors.add(current);
    if (Array.isArray(current)) {
      yield "[";
      stack.push(
        { kind: "close", value: current, text: "]" },
        { kind: "array", value: current, index: 0 }
      );
    } else {
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record).filter(
        (key) => record[key] !== undefined
      );
      yield "{";
      stack.push(
        { kind: "close", value: current, text: "}" },
        { kind: "object", value: record, keys, index: 0 }
      );
    }
  }
}

/** No whole-record/string stringify: even a single huge tool argument is encoded in small slices. */
export function* conversationJsonChunks(
  value: unknown,
  maxBytes = 256 * 1024
): Generator<string> {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 64 ||
    maxBytes > 1024 * 1024
  )
    throw new Error("Invalid export chunk budget.");
  const encoder = new TextEncoder();
  let parts: string[] = [];
  let size = 0;
  for (const text of tokens(value, Math.min(4096, Math.floor(maxBytes / 6)))) {
    const bytes = encoder.encode(text).byteLength;
    if (size + bytes > maxBytes) {
      yield parts.join("");
      parts = [];
      size = 0;
    }
    parts.push(text);
    size += bytes;
  }
  if (parts.length) yield parts.join("");
}
