import type { BrowserWindow } from "electron";
import type { ConversationHistoryApi } from "@deepwrite/contracts";

/** Serialized into the hidden smoke Renderer so every call crosses the real Preload/Main/Core boundary. */
async function conversationSmokeInRenderer() {
  const api = (
    globalThis as unknown as {
      deepwrite: {
        conversationPersistence: { history: ConversationHistoryApi };
      };
    }
  ).deepwrite.conversationPersistence.history;
  const identity = {
    key: "conversation-history:packaged-fixture",
    sessionId: "packaged-session"
  };
  const text = '虚构持久化正文😀\n"'.repeat(1000);
  const body = text.repeat(3);
  const draft = `${body}未发送草稿`;
  const ensure = (condition: unknown, reason: string) => {
    if (!condition) throw new Error(`Conversation smoke: ${reason}`);
  };
  const existing = await api.session(identity);
  if (!existing) {
    await api.commit({
      ...identity,
      expectedRevision: 0,
      generation: 0,
      sequence: 1,
      batchId: "initial",
      operations: [
        {
          type: "setMetadata",
          value: {
            sessionId: identity.sessionId,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            draft: "初始草稿",
            future: { retained: true }
          }
        }
      ]
    });
    const stage = {
      ...identity,
      expectedRevision: 1,
      generation: 0,
      stageId: "message",
      messageId: "message"
    };
    const metadata = {
      ...identity,
      expectedRevision: 1,
      generation: 0,
      stageId: "draft",
      target: "metadata" as const
    };
    await api.stage({
      ...stage,
      chunkId: "first",
      sequence: 1,
      value: {
        id: "message",
        role: "user",
        status: "complete",
        content: "",
        toolCalls: [
          {
            id: "tool",
            argsText: '{ "raw": "fixture" }',
            args: { parsed: "保留独立参数" }
          }
        ],
        editProposals: [
          {
            id: "proposal",
            status: "pending",
            discardSnapshot: { before: "虚构可恢复原文" }
          }
        ],
        future: { retained: true }
      }
    });
    await api.stage({
      ...metadata,
      chunkId: "first",
      sequence: 1,
      value: { value: "" }
    });
    for (let index = 0; index < 3; index++) {
      await api.stage({
        ...stage,
        chunkId: `chunk-${index}`,
        sequence: index + 2,
        changes: [{ op: "append", path: ["content"], text }]
      });
      await api.stage({
        ...metadata,
        chunkId: `chunk-${index}`,
        sequence: index + 2,
        changes: [
          {
            op: "append",
            path: ["value"],
            text: text + (index === 2 ? "未发送草稿" : "")
          }
        ]
      });
    }
    const batch = {
      ...identity,
      expectedRevision: 1,
      generation: 0,
      sequence: 2,
      batchId: "final",
      operations: [
        {
          type: "putStagedMessage" as const,
          stageId: "message",
          messageId: "message",
          position: 0
        },
        {
          type: "setStagedMetadata" as const,
          stageId: "draft",
          path: ["draft"]
        },
        { type: "setActive" as const, sessionId: identity.sessionId }
      ]
    };
    const receipt = await api.commit(batch);
    ensure(
      JSON.stringify(await api.commit(batch)) === JSON.stringify(receipt),
      "idempotent receipt differs"
    );
  }
  const state = await api.session({ ...identity, maxBytes: 1024 });
  ensure(
    state?.revision === 2 && state.messageCount === 1,
    "persisted session differs"
  );
  const read = async (metadata: boolean, path: string[]) => {
    let offset = 0;
    let result = "";
    let pages = 0;
    for (;;) {
      const query = {
        ...identity,
        path,
        offset,
        expectedRevision: 2,
        maxBytes: 4096
      };
      const part = metadata
        ? await api.metadataDetail(query)
        : await api.detail({ ...query, messageId: "message" });
      ensure(
        new TextEncoder().encode(part.chunk).byteLength <= 4096,
        "detail exceeded byte budget"
      );
      result += part.chunk;
      pages++;
      if (part.nextOffset === null) break;
      ensure(part.nextOffset > offset, "detail cursor did not advance");
      offset = part.nextOffset;
    }
    return { result, pages };
  };
  const content = await read(false, ["content"]);
  const metadata = await read(true, ["draft"]);
  ensure(
    content.result === body && metadata.result === draft,
    "content or draft changed after persistence"
  );
  const calls = JSON.parse((await read(false, ["toolCalls"])).result);
  const proposals = JSON.parse((await read(false, ["editProposals"])).result);
  ensure(
    calls[0].argsText === '{ "raw": "fixture" }' &&
      calls[0].args.parsed === "保留独立参数",
    "tool arguments lost fidelity"
  );
  ensure(
    proposals[0].discardSnapshot.before === "虚构可恢复原文",
    "proposal recovery snapshot changed"
  );
  const future = JSON.parse((await read(false, ["future"])).result);
  ensure(
    future.retained &&
      (state?.metadata.future as { retained?: boolean })?.retained,
    "unknown fields changed"
  );
  const listed = await api.list({ key: identity.key });
  ensure(
    listed.activeSessionId === identity.sessionId &&
      listed.sessions[0]?.summary?.turnCount === 1,
    "indexed summary differs"
  );
  return {
    status: "ok",
    staged: true,
    reopened: !!existing,
    chunkPages: content.pages,
    metadataChunkPages: metadata.pages,
    unknownRetained: true,
    proposalRetained: true
  };
}

export async function runConversationSmoke(window: BrowserWindow) {
  return window.webContents.executeJavaScript(
    `(${conversationSmokeInRenderer.toString()})()`
  );
}
