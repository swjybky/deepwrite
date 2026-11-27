import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import type { ChatMessage } from "../types/conversation";
import ConversationMessageList from "./ConversationMessageList.vue";

function makeMessages(
  count: number,
  overrides: Record<number, Partial<ChatMessage>> = {}
): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    content: `消息 ${index}`,
    status: "completed",
    createdAt: "2026-11-25T00:00:00.000Z",
    ...overrides[index]
  }));
}

async function renderList(messages: ChatMessage[]): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(ConversationMessageList, {
          messages,
          responding: false,
          runtimeAvailable: true
        })
    })
  );
}

function extractGroupClassSets(html: string): Set<string>[] {
  return [
    ...html.matchAll(/class="([^"]*conversation-message-group[^"]*)"/gu)
  ].map((match) => new Set((match[1] ?? "").split(/\s+/u).filter(Boolean)));
}

describe("ConversationMessageList deferred group classes", () => {
  it("keeps intrinsic-size eligibility on un-deferred streaming groups in long histories", async () => {
    const html = await renderList(
      makeMessages(520, { 0: { status: "streaming" } })
    );
    const groups = extractGroupClassSets(html);

    expect(groups.length).toBeGreaterThan(1);
    expect([...groups[0]!].sort()).toEqual([
      "conversation-message-group",
      "is-defer-eligible"
    ]);
    expect([...groups[1]!].sort()).toEqual([
      "conversation-message-group",
      "is-defer-eligible",
      "is-deferred"
    ]);
  });

  it("does not apply deferral classes below the group threshold", async () => {
    const html = await renderList(makeMessages(20));
    const groups = extractGroupClassSets(html);

    expect(groups.length).toBeGreaterThan(0);
    for (const cls of groups) {
      expect([...cls]).toEqual(["conversation-message-group"]);
    }
  });
});
