import { promptLocaleOf } from "./prompt-locale";
import type { AgentRunInput } from "./runtime-types";
import { webToolNamesFor } from "./web-search/prompt";
import { writeApprovalBoundary } from "./write-approval";

/** Non-editable requirements of a team member delegated by the long-form agent. */
export function longSubagentRequirements(input: AgentRunInput): {
  systemPromptRequirements: string;
  pureReadSystemPromptRequirements: string;
} {
  const locale = promptLocaleOf(input);
  const webTools = input.webSearch
    ? webToolNamesFor(input.webSearch.providerId, locale)
    : undefined;
  if (locale === "en-US") {
    return {
      systemPromptRequirements: [
        "This is a single-level task delegated by the long-form main agent. Use only the inherited long-form query and proposal tools and the current bookId. When handing back, list the changes you submitted.",
        writeApprovalBoundary(input.writeApprovalMode, locale)
      ].join("\n"),
      pureReadSystemPromptRequirements: `This is a single-level read-only task delegated by the long-form main agent. Use only read and list on the current bookId and query_linked_material_entries for materials${
        webTools
          ? `; when web_search is in the tool list, you may also verify public facts with ${webTools}`
          : ""
      }. There are no write tools: you cannot change the work and must never claim to have changed it or committed to the continuity ledger.`
    };
  }
  return {
    systemPromptRequirements: [
      "这是长篇主智能体委派的单层子任务。只能使用继承的长篇查询/提案工具和当前 bookId。交回结果时列出已提交的修改。",
      writeApprovalBoundary(input.writeApprovalMode, locale)
    ].join("\n"),
    pureReadSystemPromptRequirements: `这是长篇主智能体委派的单层只读子任务。只能使用 read、list 读取当前 bookId 的作品，以及 query_linked_material_entries 读取素材${
      webTools
        ? `；工具清单列有 web_search 时，也可用 ${webTools} 查证公开资料`
        : ""
    }；没有任何写入工具，不能修改作品，也不得声称已修改或已提交连续性账本。`
  };
}
