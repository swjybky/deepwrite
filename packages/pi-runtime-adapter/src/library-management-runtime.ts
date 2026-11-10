import {
  LIBRARY_MANAGEMENT_INVOCATION_POLICY,
  MATERIAL_METADATA_AUTHORING_GUIDANCE,
  DEFAULT_LIBRARY_AGENT_PROFILES,
  LibraryAgentWorkspaceSnapshotSchema,
  createShortWorkspaceContentRevision,
  CommandEnvelopeSchema,
  LibraryManagementQueryResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { buildIndexedLibraryTools } from "./library-agent-tools/domain-tools";
import type { AgentRunInput } from "./runtime-types";

export type LibraryManagementCommandExecutor = (
  command: Extract<CommandEnvelope, { type: "catalog.queryLibraryManagement" }>,
  signal?: AbortSignal
) => Promise<CommandResult>;

export function libraryManagementParentPrompt(input: AgentRunInput): string {
  const context = input.libraryManagement;
  if (!context?.managers.length) return "";
  return [
    "【内置资料库管理工具】",
    LIBRARY_MANAGEMENT_INVOCATION_POLICY,
    ...context.managers.map(
      (manager) =>
        `${manager.domain} 管理工具：${manager.description} 工具名前缀 manage_${manager.domain}_；必须用 library_id 指定目标库。`
    ),
    "管理范围是整本作品绑定的资料库；目标不明确时先用 ask_user_question 询问。只读库不能写入，未绑定的库不可管理。",
    ...(context.managers.some((manager) => manager.domain === "material")
      ? [MATERIAL_METADATA_AUTHORING_GUIDANCE]
      : []),
    "已绑定的候选库：",
    ...context.libraries
      .filter((library) =>
        context.managers.some((manager) => manager.domain === library.domain)
      )
      .map(
        (library) =>
          `- ${library.domain} / ${library.libraryId}：${library.title}${library.readOnly ? "（只读）" : ""}`
      ),
    ...(context.libraries.length
      ? []
      : ["当前没有已绑定的资料库，请告知用户先绑定目标库。"])
  ].join("\n");
}

export function createLibraryManagementRuntime(input: AgentRunInput) {
  const context = input.libraryManagement;
  const tools = (context?.managers ?? []).flatMap((manager) => {
    const index = context!.libraries.filter(
      (library) => library.domain === manager.domain
    );
    // A manifest snapshot only; the selected library is always fetched through the authorized bridge.
    const workspace = LibraryAgentWorkspaceSnapshotSchema.parse({
      domain: manager.domain,
      libraryId: index[0]?.libraryId ?? "unbound",
      title: index[0]?.title ?? "未绑定",
      kind: manager.domain === "skill" ? "general" : "mixed",
      readOnly: false,
      libraryType: context!.scope.bookType,
      overviewDocumentId: "manifest-overview",
      overviewRevision: createShortWorkspaceContentRevision(""),
      overview: "",
      entries: []
    });
    const profile = DEFAULT_LIBRARY_AGENT_PROFILES.find(
      (profile) => profile.domain === manager.domain
    )!;
    return buildIndexedLibraryTools(
      {
        workspace,
        profile,
        writeApprovalMode: input.writeApprovalMode ?? "request-approval"
      },
      {
        index,
        preload: false,
        requireLibraryId: true,
        load: async (libraryId, signal) => {
          if (!input.libraryManagementCommandExecutor)
            throw new Error("资料库管理通道不可用。");
          const command = CommandEnvelopeSchema.parse(
            createEnvelope(
              "catalog.queryLibraryManagement",
              { scope: context!.scope, domain: manager.domain, libraryId },
              {
                id: `library-management:${input.runId}:${libraryId}`,
                context: {
                  sessionId: input.sessionId,
                  runId: input.runId,
                  resourceId: context!.scope.bookId
                }
              }
            )
          ) as Parameters<LibraryManagementCommandExecutor>[0];
          const result = await input.libraryManagementCommandExecutor(
            command,
            signal
          );
          if (result.status !== "accepted")
            throw new Error(result.error.message);
          const snapshot = LibraryManagementQueryResultSchema.parse(
            result.payload
          ).workspace;
          if (!snapshot) throw new Error("目标资料库不可用。");
          const candidate = index.find(
            (library) => library.libraryId === libraryId
          )!;
          return {
            ...snapshot,
            readOnly: candidate.readOnly || snapshot.readOnly
          };
        }
      }
    )
      .filter((tool) => tool.name !== "load_skill")
      .map((tool) => ({
        ...tool,
        name: `manage_${manager.domain}_${tool.name}`,
        description: tool.description.replace(
          /\b(?:list|read|search|create|edit)_(?:material|skill)_(?:entries|entry|library_overview)\b/g,
          (name) => `manage_${manager.domain}_${name}`
        )
      }));
  });
  return { tools };
}
