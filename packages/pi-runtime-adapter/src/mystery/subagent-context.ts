import { randomUUID } from "node:crypto";
import {
  MysteryWorkspaceIndexResultSchema,
  createEnvelope
} from "@deepwrite/contracts";
import { promptLocaleOf } from "../prompt-locale";
import type { AgentRunInput } from "../runtime-types";
import type { BuildSpawnSubagentToolInput } from "../subagent-types";
import { writeApprovalBoundary } from "../write-approval";
import { buildMysteryFollowUpContextLines } from "./prompts-navigation";
import {
  buildMysteryReadOnlyWorkspaceRules,
  buildMysteryWorkspaceRules
} from "./prompts-rules";

export function mysterySubagentContext(
  input: AgentRunInput
): Pick<
  BuildSpawnSubagentToolInput,
  "systemPromptRequirements" | "pureReadSystemPromptRequirements"
> {
  const locale = promptLocaleOf(input);
  const workspace = input.workspaceContext?.mysteryWorkspace;

  const navigationSnapshot = async (): Promise<string> => {
    if (!workspace) return "";
    let index = workspace.workspaceIndex;
    if (input.mysteryCommandExecutor) {
      const cmd = createEnvelope(
        "mystery.getWorkspaceIndex",
        { bookId: workspace.bookId },
        {
          id: randomUUID(),
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: workspace.bookId
          }
        }
      );
      if (cmd.type === "mystery.getWorkspaceIndex") {
        const res = await input.mysteryCommandExecutor(cmd, input.signal);
        if (res.status === "accepted") {
          index = MysteryWorkspaceIndexResultSchema.parse(
            res.payload
          ).workspaceIndex;
        }
      }
    }
    return buildMysteryFollowUpContextLines({
      ...workspace,
      workspaceIndex: index
    })
      .filter(Boolean)
      .join("\n");
  };

  const narrativePerson =
    workspace?.workspaceIndex.boardSpec.narrativePerson ?? "second";
  const delegated =
    locale === "en-US"
      ? "This is a single-level task delegated by the murder-mystery main agent. Use only the inherited tools and report submitted changes when done."
      : "这是剧本杀主智能体委派的单层子任务。只能使用继承的工具，交回结果时列出已提交的提案对象与改动摘要。";
  const readOnly =
    locale === "en-US"
      ? "This is a single-level read-only task delegated by the murder-mystery main agent. You have no write tools and must never claim to have edited files."
      : "这是剧本杀主智能体委派的单层只读子任务。没有写入工具，不得声称已修改作品；只可引用实际读取或检索到的证据。";

  return {
    systemPromptRequirements: async (toolNames) =>
      [
        buildMysteryWorkspaceRules(locale, narrativePerson, toolNames),
        writeApprovalBoundary(input.writeApprovalMode, locale),
        await navigationSnapshot(),
        delegated
      ].join("\n\n"),
    pureReadSystemPromptRequirements: async () =>
      [
        buildMysteryReadOnlyWorkspaceRules(locale, narrativePerson),
        await navigationSnapshot(),
        readOnly
      ].join("\n\n")
  };
}
