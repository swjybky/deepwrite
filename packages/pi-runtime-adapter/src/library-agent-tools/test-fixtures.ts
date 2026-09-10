import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentDomain,
  type LibraryAgentProfile,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";

export function profile(domain: LibraryAgentDomain): LibraryAgentProfile {
  const value = DEFAULT_LIBRARY_AGENT_PROFILES.find(
    (candidate) => candidate.domain === domain
  );
  if (!value) throw new Error(`Missing profile: ${domain}`);
  return value;
}

export function materialWorkspace(
  overrides: Partial<
    Extract<LibraryAgentWorkspaceSnapshot, { domain: "material" }>
  > = {}
): Extract<LibraryAgentWorkspaceSnapshot, { domain: "material" }> {
  return {
    domain: "material",
    libraryId: "material-library-1",
    title: "雾港素材",
    libraryType: "short",
    kind: "plot",
    overviewDocumentId: "material:material-library-1:overview",
    overview: "悬疑短篇剧情素材。",
    overviewRevision: createShortWorkspaceContentRevision("悬疑短篇剧情素材。"),
    readOnly: false,
    activeEntryId: "material-entry-1",
    projectRevision: 7,
    entries: [
      {
        id: "material-entry-1",
        documentId: "material:material-library-1:material-entry-1",
        stageId: "pacing",
        title: "迟到的汽笛",
        content: "汽笛迟到了七分钟。共同片段。",
        revision:
          createShortWorkspaceContentRevision("汽笛迟到了七分钟。共同片段。"),
        readOnly: false
      },
      {
        id: "material-entry-2",
        documentId: "material:material-library-1:material-entry-2",
        stageId: "plot_refine",
        title: "暗房反转",
        content: "共同片段。暗房里显出了照片。",
        revision:
          createShortWorkspaceContentRevision("共同片段。暗房里显出了照片。"),
        readOnly: false
      }
    ],
    ...overrides
  };
}

export function skillWorkspace(
  overrides: Partial<
    Extract<LibraryAgentWorkspaceSnapshot, { domain: "skill" }>
  > = {}
): Extract<LibraryAgentWorkspaceSnapshot, { domain: "skill" }> {
  return {
    domain: "skill",
    libraryId: "skill-library-1",
    title: "短篇方法库",
    libraryType: "short",
    kind: "style",
    overviewDocumentId: "skill:skill-library-1:overview",
    overview: "正文与分节写作方法。",
    overviewRevision:
      createShortWorkspaceContentRevision("正文与分节写作方法。"),
    readOnly: false,
    activeEntryId: "skill-entry-1",
    projectRevision: 3,
    entries: [
      {
        id: "skill-entry-1",
        documentId: "skill:skill-library-1:skill-entry-1",
        stageId: "expert_section_writer",
        title: "悬疑分节写法",
        content: "先建立疑问，再用人物行动推进。",
        revision:
          createShortWorkspaceContentRevision("先建立疑问，再用人物行动推进。"),
        readOnly: false
      }
    ],
    ...overrides
  };
}

export function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

export function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(
      (
        item
      ): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text"
    )
    .map((item) => item.text)
    .join("\n");
}
