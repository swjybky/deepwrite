import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  StorageChangeResultSchema,
  StorageSettingsSnapshotSchema,
  SystemEventEnvelopeSchema,
  createEnvelope,
  stripModelCallSnapshot
} from "./index";

describe("storage settings contracts", () => {
  it("requires current and default locations without exposing extra configuration", () => {
    const snapshot = {
      userData: {
        path: "/storage/custom",
        defaultPath: "/storage/default",
        isDefault: false
      },
      workspace: {
        path: "/workspace/default",
        defaultPath: "/workspace/default",
        isDefault: true
      }
    };
    expect(StorageSettingsSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      StorageSettingsSnapshotSchema.safeParse({
        ...snapshot,
        userData: { ...snapshot.userData, defaultPath: "" }
      }).success
    ).toBe(false);
    expect(
      StorageSettingsSnapshotSchema.safeParse({
        ...snapshot,
        credentials: "invalid-placeholder"
      }).success
    ).toBe(false);
    expect(
      StorageChangeResultSchema.safeParse({ restarting: "yes" }).success
    ).toBe(false);
  });

  it.each([
    "storageSettings.get",
    "storageSettings.chooseUserData",
    "storageSettings.resetUserData",
    "storageSettings.resetWorkspaceDirectory",
    "storageSettings.compactConversations",
    "storageSettings.releaseConversationBackup"
  ])(
    "registers %s and prevents renderer-supplied destination paths",
    (type) => {
      expect(
        CommandEnvelopeSchema.parse(
          createEnvelope(type, {}, { id: "storage_settings_test" })
        ).type
      ).toBe(type);
      expect(
        CommandEnvelopeSchema.safeParse(
          createEnvelope(
            type,
            { path: "/unapproved/destination" },
            { id: "storage_settings_test" }
          )
        ).success
      ).toBe(false);
    }
  );

  it("only opens the two authorized storage locations", () => {
    for (const kind of ["user-data", "workspace"]) {
      expect(
        CommandEnvelopeSchema.parse(
          createEnvelope(
            "storageSettings.openDirectory",
            { kind },
            { id: "storage_settings_test" }
          )
        ).payload
      ).toEqual({ kind });
    }
    for (const payload of [
      { kind: "/arbitrary/path" },
      { kind: "workspace", path: "/arbitrary/path" },
      {}
    ]) {
      expect(
        CommandEnvelopeSchema.safeParse(
          createEnvelope("storageSettings.openDirectory", payload, {
            id: "storage_settings_test"
          })
        ).success
      ).toBe(false);
    }
  });

  it("validates conversationCompaction status, event envelope, and snapshot stripping", () => {
    const status = {
      phase: "completed_with_backup" as const,
      legacyCallsFound: 120,
      estimatedReclaimableBytes: 50_000_000,
      processedSessions: 12,
      totalSessions: 12,
      bytesBefore: 60_000_000,
      bytesAfter: 2_000_000,
      backupBytes: 60_000_000,
      netFreedBytes: -2_000_000,
      canRetry: false,
      canReleaseBackup: true,
      canRollback: true,
      backupPath: "/tmp/conversations.sqlite.bak-v190"
    };
    const event = createEnvelope(
      "rendererState.compactionUpdated",
      { status },
      { id: "evt-1" }
    );
    expect(SystemEventEnvelopeSchema.parse(event)).toEqual(event);

    const stripped = stripModelCallSnapshot({
      requestId: "req-1",
      sequence: 1,
      requestedProvider: "openai",
      requestedModel: "gpt-4o",
      responseModel: null,
      responseModelEvidence: "unknown",
      startedAt: new Date().toISOString(),
      status: "completed",
      snapshot: {
        systemPrompt: "secret prompt",
        messages: [{ role: "user", content: "hi" }],
        tools: []
      },
      inputSummary: {
        systemPromptChars: 13,
        messageCount: 1,
        toolCount: 0
      }
    });
    expect("snapshot" in stripped).toBe(false);
    expect(stripped.inputSummary).toEqual({
      systemPromptChars: 13,
      messageCount: 1,
      toolCount: 0
    });
  });
});
