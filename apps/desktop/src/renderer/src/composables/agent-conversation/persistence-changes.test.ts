import { describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import {
  clonePersistenceRecord,
  clonePersistenceValue
} from "./persistence-changes";
import { useAgentConversation } from "../useAgentConversation";

describe("incremental persistence container copies", () => {
  it("shares a 65 MiB immutable string without JSON serialization while copying mutable containers", () => {
    const content = "x".repeat(65 * 1024 * 1024);
    const value = reactive({
      content,
      nested: { values: ["one", "two"], omitted: undefined }
    });
    const stringify = vi.spyOn(JSON, "stringify");
    let copied: ReturnType<typeof clonePersistenceRecord>;
    try {
      copied = clonePersistenceRecord(value);
      expect(stringify).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }
    expect(copied.content).toBe(content);
    expect(copied.nested).toEqual({ values: ["one", "two"] });
    value.nested.values.push("later");
    expect(copied.nested).toEqual({ values: ["one", "two"] });
  });

  it("preserves unknown prototype-shaped own properties without modifying the output prototype", () => {
    const value = JSON.parse(
      '{"__proto__":{"retained":true},"future":[null,1,true]}'
    );
    const copied = clonePersistenceValue(value);
    expect(copied).toEqual(value);
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(copied, "__proto__")).toBe(
      true
    );
  });

  it.each([
    NaN,
    Infinity,
    1n,
    () => undefined,
    Symbol("test"),
    new Map(),
    new Date(),
    Object.assign(Array<unknown>(2), { 1: 1 }),
    [undefined]
  ])(
    "rejects unsupported data instead of silently changing it (case %#)",
    (value) => {
      expect(() => clonePersistenceValue(value)).toThrow();
    }
  );

  it("rejects cycles while permitting repeated independent references", () => {
    const shared = { text: "可重复引用" };
    expect(clonePersistenceValue([shared, shared])).toEqual([shared, shared]);
    const cyclic: { child?: unknown } = {};
    cyclic.child = cyclic;
    expect(() => clonePersistenceValue(cyclic)).toThrow("循环引用");
  });

  it("retains pending mutations when capture fails and can recover after the invalid field is corrected", () => {
    const controller = useAgentConversation({
      api: () => undefined,
      initialMessages: [
        {
          id: "m",
          role: "assistant",
          content: "正文",
          createdAt: "2026-09-11T00:00:00.000Z",
          toolCalls: [
            {
              id: "tool",
              name: "read",
              args: { value: "正常" },
              status: "completed",
              requestedAt: "2026-09-11T00:00:00.000Z"
            }
          ]
        }
      ]
    });
    try {
      controller.initializePersistenceBaseline();
      const call = controller.messages.value[0]!.toolCalls![0]!;
      call.args = { value: Infinity };
      expect(() => controller.capturePersistenceChanges()).toThrow(
        "非有限数值"
      );
      call.args = { value: "修复后的参数" };
      expect(
        controller.capturePersistenceChanges().conversations[0]?.operations
      ).toEqual([
        {
          type: "patchMessage",
          messageId: "m",
          changes: [
            {
              op: "set",
              path: ["toolCalls", 0, "args"],
              value: { value: "修复后的参数" }
            }
          ]
        }
      ]);
    } finally {
      controller.dispose();
    }
  });
});
