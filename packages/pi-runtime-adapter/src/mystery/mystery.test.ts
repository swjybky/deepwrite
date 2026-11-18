import { describe, expect, it, vi } from "vitest";
import { validateToolArguments, type JsonValue } from "@earendil-works/pi-ai";
import {
  buildEmptyMysteryWorkspaceIndex,
  createDefaultMysteryTruthDocuments,
  getDefaultMysteryAgentProfile,
  mysteryTextRevision,
  type MysteryBookManifest
} from "@deepwrite/contracts";
import { buildEffectiveSystemPrompt, buildRuntimeUserPrompt } from "../prompts";
import { toRuntimeEvents } from "../event-mapping";
import { applySubagentAgentMode } from "../subagent-mode";
import {
  buildMysteryWorkspaceTools,
  createMysteryWorkspaceToolSharedState,
  mysterySubagentContext,
  type MysteryAgentToolDetails
} from "./index";

function sampleManifest(
  narrativePerson: "second" | "first" = "second"
): MysteryBookManifest {
  const now = "2026-11-17T00:00:00.000Z";
  return {
    kind: "deepwrite.mystery-book",
    schemaVersion: 1,
    id: "book_mys_1",
    title: "雾钟山庄",
    genre: "硬核推理",
    status: "editing",
    boardSpec: {
      playerCount: 2,
      actCountTarget: 2,
      narrativePerson,
      summary: "暴风雪山庄时钟诡计"
    },
    linkedMaterialIds: [],
    linkedSkillIds: [],
    truthDocuments: createDefaultMysteryTruthDocuments(),
    roles: [
      { id: "role_1", name: "沈修", tag: "钟表匠", order: 1 },
      { id: "role_2", name: "顾晚", tag: "管家", order: 2 }
    ],
    acts: [
      { id: "act_1", title: "第一幕", order: 1 },
      { id: "act_2", title: "第二幕", order: 2 }
    ],
    clueRounds: [{ id: "round_1", title: "第一轮大厅搜证", order: 1 }],
    revision: 0,
    createdAt: now,
    updatedAt: now
  };
}

describe("mystery pi-runtime-adapter", () => {
  it("validates tool arguments with actionable messages and chains proposals via overlay", async () => {
    const manifest = sampleManifest("second");
    const index = buildEmptyMysteryWorkspaceIndex(manifest);
    const bodyText = "原有的第一幕正文。";
    const briefText = "你知道 22:00 钟声响过两次。";
    const profileText = "上帝底牌内容";
    const pitchText = "沉默的钟表修理师。";
    const coreTruthText = "SECRET_CORE_TRUTH: 沈修伪造了停摆时间。";
    index.truthDocuments.find((d) => d.id === "core_truth")!.revision =
      mysteryTextRevision(coreTruthText);
    const r1 = index.roles.find((r) => r.id === "role_1")!;
    r1.profileRevision = mysteryTextRevision(profileText);
    r1.pitchRevision = mysteryTextRevision(pitchText);
    const cell11 = index.actMatrix.find(
      (c) => c.roleId === "role_1" && c.actId === "act_1"
    )!;
    cell11.briefRevision = mysteryTextRevision(briefText);
    cell11.bodyRevision = mysteryTextRevision(bodyText);
    const docs = new Map<string, string>([
      ["truth_doc:core_truth", coreTruthText],
      ["role:role_1:profile", profileText],
      ["role:role_1:pitch", pitchText],
      ["player_act:role_1:act_1:brief", briefText],
      ["player_act:role_1:act_1:body", bodyText]
    ]);

    const executor = vi.fn(async (cmd) => {
      if (cmd.type === "mystery.getWorkspaceIndex") {
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: { bookId: manifest.id, workspaceIndex: index }
        };
      }
      if (cmd.type === "mystery.readDocument") {
        const { target } = cmd.payload;
        const key =
          target.kind === "truth_doc"
            ? `truth_doc:${target.docId}`
            : target.kind === "role"
              ? `role:${target.roleId}:${target.document}`
              : target.kind === "player_act"
                ? `player_act:${target.roleId}:${target.actId}:${target.document}`
                : target.kind;
        const content = docs.get(key) ?? "";
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: {
            bookId: manifest.id,
            target,
            content,
            totalCharacters: Array.from(content).length,
            offset: 0,
            hasMore: false,
            revision: mysteryTextRevision(content),
            updatedAt: manifest.updatedAt
          }
        };
      }
      if (cmd.type === "mystery.previewOperations") {
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: { workspaceIndex: index, structureChanges: [] }
        };
      }
      if (cmd.type === "mystery.search") {
        return {
          status: "accepted" as const,
          requestId: cmd.id,
          payload: {
            bookId: manifest.id,
            query: cmd.payload.query,
            totalHits: 0,
            hits: []
          }
        };
      }
      throw new Error(`Unexpected cmd: ${cmd.type}`);
    });

    const sharedState = createMysteryWorkspaceToolSharedState();
    const profile = getDefaultMysteryAgentProfile("mystery");
    const tools = buildMysteryWorkspaceTools({
      workspace: {
        bookId: manifest.id,
        title: manifest.title,
        genre: manifest.genre,
        activeAgentId: "mystery",
        focus: { stage: "scripts" },
        workspaceIndex: index
      },
      profile,
      sessionId: "sess_1",
      runId: "run_1",
      writeApprovalMode: "request-approval",
      executor,
      requestUserInput: async () => ({
        sessionId: "sess_1",
        runId: "run_1",
        requestId: "req_1",
        answers: [],
        skipped: true
      }),
      sharedState
    });

    const readTool = tools.find((t) => t.name === "read")!;
    const createTool = tools.find((t) => t.name === "create")!;
    const editTool = tools.find((t) => t.name === "edit")!;
    const searchTool = tools.find((t) => t.name === "search")!;
    expect(JSON.stringify(tools.map((tool) => tool.parameters))).not.toContain(
      '"type":"boolean"'
    );
    const search = (args: Record<string, JsonValue>) =>
      searchTool.execute(
        "tc_search",
        validateToolArguments(searchTool, {
          type: "toolCall",
          id: "tc_search",
          name: searchTool.name,
          arguments: { query: "密室", ...args }
        })
      );
    expect(() => search({ visibility: true })).toThrow("visibility");
    expect(() => search({ player_visible_only: true })).toThrow(
      "player_visible_only"
    );
    await search({});
    await search({ visibility: "all" });
    await search({ visibility: "player_visible" });
    expect(
      executor.mock.calls
        .filter(([cmd]) => cmd.type === "mystery.search")
        .map(([cmd]) => cmd.payload.playerVisibleOnly)
    ).toEqual([undefined, false, true]);

    // Actionable validation error when role document is missing
    await expect(
      readTool.execute("tc_bad", { kind: "role", role_id: "role_1" })
    ).rejects.toThrow(/document="profile".*"pitch"/);

    // Overwrite guard triggers before read
    const overwriteTarget = {
      kind: "player_act",
      role_id: "role_1",
      act_id: "act_1",
      document: "body",
      content: "覆盖后的正文"
    };
    const blockedOverwrite = await editTool.execute(
      "tc_guard",
      overwriteTarget
    );
    expect((blockedOverwrite.content[0] as { text: string }).text).toContain(
      "overwrite_mode=replace_all"
    );
    const validateOverwrite = (mode: JsonValue) =>
      validateToolArguments(editTool, {
        type: "toolCall",
        id: "tc_replace_all",
        name: editTool.name,
        arguments: { ...overwriteTarget, overwrite_mode: mode }
      });
    expect(() => validateOverwrite([null, null, null, 1])).toThrow(
      "overwrite_mode"
    );

    // Full read then replacement edit succeeds and maps to mystery.mutation_proposal event
    await readTool.execute("tc_read", {
      kind: "player_act",
      role_id: "role_1",
      act_id: "act_1",
      document: "body"
    });
    const editResult = await editTool.execute("tc_edit", {
      kind: "player_act",
      role_id: "role_1",
      act_id: "act_1",
      document: "body",
      replacements: [
        {
          original_text: "原有的第一幕正文。",
          new_text: "你站在大钟前。新正文。"
        }
      ],
      summary: "改写第一幕开篇"
    });
    const details = editResult.details as MysteryAgentToolDetails;
    expect(details.kind).toBe("mystery-mutation-proposal");

    const mappedEvents = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "tc_edit",
        toolName: "edit",
        result: editResult,
        isError: false
      },
      { runId: "run_1", sessionId: "sess_1" },
      { provider: "openai", model: "gpt-4o", mode: "provider" },
      "msg_1"
    );
    expect(mappedEvents.map((event) => event.type)).toContain(
      "mystery.mutation_proposal"
    );

    // Same-turn overlay: read back uncommitted proposal text
    const overlaidRead = await readTool.execute("tc_read_overlay", {
      kind: "player_act",
      role_id: "role_1",
      act_id: "act_1",
      document: "body"
    });
    expect((overlaidRead.content[0] as { text: string }).text).toContain(
      "你站在大钟前。新正文。"
    );

    // Chained structural creation in same turn -> read new role pitch from overlay
    await createTool.execute("tc_create_role", {
      kind: "role",
      id: "role_3",
      name: "白侦探",
      pitch_content: "受邀前来调查遗嘱的私家侦探。"
    });
    const newPitchRead = await readTool.execute("tc_read_new_role", {
      kind: "role",
      role_id: "role_3",
      document: "pitch"
    });
    expect((newPitchRead.content[0] as { text: string }).text).toContain(
      "私家侦探"
    );

    // Settling clears overlay back to disk content
    sharedState.proposalOverlay.clear();
    const afterClear = await readTool.execute("tc_read_after_clear", {
      kind: "player_act",
      role_id: "role_1",
      act_id: "act_1",
      document: "body"
    });
    expect((afterClear.content[0] as { text: string }).text).toContain(
      "原有的第一幕正文。"
    );
    const fullOverwrite = await editTool.execute(
      "tc_replace_all",
      validateOverwrite("replace_all")
    );
    expect(fullOverwrite.details).toMatchObject({
      kind: "mystery-mutation-proposal"
    });
  });

  it("enforces narrativePerson in system prompt and isolates pure-bare vs pure-read subagents", async () => {
    const secondManifest = sampleManifest("second");
    const firstManifest = sampleManifest("first");
    const profile = getDefaultMysteryAgentProfile("mystery");

    const secondPrompt = buildEffectiveSystemPrompt(
      "BASE",
      {
        runId: "r1",
        sessionId: "s1",
        prompt: "设计大纲",
        mysteryAgentProfile: profile,
        workspaceContext: {
          mysteryWorkspace: {
            bookId: secondManifest.id,
            title: secondManifest.title,
            genre: secondManifest.genre,
            activeAgentId: "mystery",
            focus: { stage: "truth" },
            workspaceIndex: buildEmptyMysteryWorkspaceIndex(secondManifest)
          }
        }
      },
      ["read", "edit"]
    );
    expect(secondPrompt).toContain("第二人称「你」");

    const firstPrompt = buildEffectiveSystemPrompt(
      "BASE",
      {
        runId: "r2",
        sessionId: "s2",
        prompt: "设计大纲",
        mysteryAgentProfile: profile,
        workspaceContext: {
          mysteryWorkspace: {
            bookId: firstManifest.id,
            title: firstManifest.title,
            genre: firstManifest.genre,
            activeAgentId: "mystery",
            focus: { stage: "scripts" },
            workspaceIndex: buildEmptyMysteryWorkspaceIndex(firstManifest)
          }
        }
      },
      ["read", "edit"]
    );
    expect(firstPrompt).toContain("第一人称「我」");

    const userPrompt = buildRuntimeUserPrompt({
      runId: "r1",
      sessionId: "s1",
      prompt: "帮我检查分幕",
      mysteryAgentProfile: profile,
      workspaceContext: {
        mysteryWorkspace: {
          bookId: secondManifest.id,
          title: secondManifest.title,
          genre: secondManifest.genre,
          activeAgentId: "mystery",
          focus: { stage: "scripts" },
          workspaceIndex: buildEmptyMysteryWorkspaceIndex(secondManifest)
        }
      }
    });
    expect(userPrompt).toContain("雾钟山庄");
    expect(userPrompt).toContain("role_1");
    expect(userPrompt).toContain("act_1");

    const subCtx = mysterySubagentContext({
      runId: "r1",
      sessionId: "s1",
      prompt: "审计",
      mysteryAgentProfile: profile,
      workspaceContext: {
        mysteryWorkspace: {
          bookId: secondManifest.id,
          title: secondManifest.title,
          genre: secondManifest.genre,
          activeAgentId: "mystery",
          focus: { stage: "scripts" },
          workspaceIndex: buildEmptyMysteryWorkspaceIndex(secondManifest)
        }
      }
    });
    const pureReadSource = subCtx.pureReadSystemPromptRequirements!;
    const pureReadReq =
      typeof pureReadSource === "function"
        ? await pureReadSource(["read", "search"])
        : pureReadSource;
    expect(pureReadReq).toContain("只读");
    expect(pureReadReq).toContain("雾钟山庄");

    // pure-bare gets zero tools
    const bareTools = applySubagentAgentMode(
      buildMysteryWorkspaceTools({
        workspace: {
          bookId: secondManifest.id,
          title: secondManifest.title,
          genre: secondManifest.genre,
          activeAgentId: "mystery",
          focus: { stage: "scripts" },
          workspaceIndex: buildEmptyMysteryWorkspaceIndex(secondManifest)
        },
        profile,
        sessionId: "s1",
        runId: "r1",
        writeApprovalMode: "request-approval",
        requestUserInput: async () => ({
          sessionId: "s1",
          runId: "r1",
          requestId: "req",
          answers: [],
          skipped: true
        })
      }),
      "pure-bare"
    );
    expect(bareTools).toEqual([]);
  });
});
