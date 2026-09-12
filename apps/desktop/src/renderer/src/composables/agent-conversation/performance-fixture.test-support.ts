import type { ChatMessage } from "../../types/conversation";
import { useAgentConversation } from "../useAgentConversation";

/** Fictional, deterministic content shared by getter and timing regressions. */
export function createLongConversationFixture(
  rounds: number,
  lines: number
): ChatMessage[] {
  const createdAt = "2026-09-11T00:00:00.000Z";
  const text = "用于会话性能回归的虚构文字。".repeat(8).slice(0, 80);
  const body = Array.from({ length: lines }, () => text).join("\n");
  const messages: ChatMessage[] = Array.from(
    { length: rounds },
    (_, index) => ({
      id: `old-${index}`,
      role: "assistant",
      content: "章节已经完成",
      createdAt,
      status: "completed",
      thinking: "虚构的过程记录",
      toolCalls: [
        {
          id: `tool-${index}`,
          name: "write_text",
          args: { content: body },
          argumentsText: JSON.stringify({ content: body }),
          status: "completed",
          requestedAt: createdAt
        }
      ],
      editProposals: [
        {
          id: `proposal-${index}`,
          runId: `run-${index}`,
          workspaceId: "fictional-workspace",
          stageId: "draft",
          documentId: `document-${index}`,
          title: "回归测试章节",
          summary: "虚构测试差异",
          baseRevision: "test-before",
          proposedRevision: "test-after",
          additions: lines,
          deletions: 0,
          createdAt,
          updatedAt: createdAt,
          status: "accepted",
          toolCallIds: [`tool-${index}`],
          hunks: [
            {
              oldStart: 1,
              oldLines: 0,
              newStart: 1,
              newLines: lines,
              lines: Array.from({ length: lines }, (_, line) => ({
                type: "addition",
                text,
                newLineNumber: line + 1
              }))
            }
          ],
          discardSnapshot: { beforeText: body }
        }
      ]
    })
  );
  messages.push({
    id: "active",
    role: "assistant",
    content: "回复",
    createdAt,
    status: "streaming",
    processingSteps: [
      { id: "response", type: "response", content: "回复", createdAt }
    ]
  });
  return messages;
}

function statistics(values: number[]) {
  values.sort((left, right) => left - right);
  return {
    p50: values[Math.floor(values.length * 0.5)]!,
    p95: values[Math.floor(values.length * 0.95)]!,
    max: values.at(-1)!
  };
}

/** State-only benchmark: excludes DOM, IPC and disk. Run after the durable
 * baseline is acknowledged so the measured work reflects daily stream updates. */
export function measureConversationUpdates(
  rounds: number,
  lines: number,
  samples = 200,
  warmup = 20
) {
  const initialMessages = createLongConversationFixture(rounds, lines);
  const logicalBytes = new TextEncoder().encode(
    JSON.stringify(initialMessages)
  ).byteLength;
  const controller = useAgentConversation({
    api: () => undefined,
    initialMessages,
    onPersistenceChange: () => undefined
  });
  try {
    controller.initializePersistenceBaseline();
    const active = controller.messages.value.at(-1)!;
    const response = active.processingSteps![0]!;
    if (response.type !== "response")
      throw new Error("Expected fixture response");
    const updates: number[] = [];
    const captures: number[] = [];
    for (let index = 0; index < samples + warmup; index += 1) {
      const start = performance.now();
      active.content += "增量";
      response.content += "增量";
      const updated = performance.now();
      const changes = controller.capturePersistenceChanges();
      const captured = performance.now();
      controller.acknowledgePersistenceChanges(changes.revision);
      if (index >= warmup) {
        updates.push(updated - start);
        captures.push(captured - updated);
      }
    }
    return {
      rounds,
      lines,
      logicalBytes,
      samples,
      warmup,
      stateUpdateMs: statistics(updates),
      captureMs: statistics(captures)
    };
  } finally {
    controller.dispose();
  }
}
