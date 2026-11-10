import { wrapUnboundCreation } from "./unbound-creation";
import { buildLibraryStructureTools } from "./structure-tools";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  LibraryAgentWorkspaceSnapshotSchema,
  MATERIAL_STAGE_IDS,
  SKILL_STAGE_IDS,
  type CommandEnvelope,
  type CommandResult,
  type LibraryAgentWorkspaceSnapshot,
  type LibraryAgentReadableLibrary
} from "@deepwrite/contracts";
import { buildLibraryAgentTools } from "../library-agent-tools";
import type { AgentRunInput } from "../runtime-types";
import type { BuildLibraryAgentToolsInput } from "./types";
import { reconcileLibraryToolState } from "../library-management-state";
import { textResult } from "./shared";
import { piStrictToolSampling } from "../pi-tool-schema";

export type LibraryAgentCommandExecutor = (
  command: Extract<
    CommandEnvelope,
    {
      type:
        "catalog.readLibraryAgentLibrary" | "catalog.previewLibraryStructure";
    }
  >,
  signal?: AbortSignal
) => Promise<CommandResult>;

/** Per-turn library states: each library keeps its own revisions and read-before-edit guard. */
export function buildDomainLibraryAgentTools(
  input: BuildLibraryAgentToolsInput,
  run: AgentRunInput
): AgentTool[] {
  const structure = buildLibraryStructureTools(input, run);
  const tools = buildIndexedLibraryTools(input, {
    load: async (id, signal) => {
      if (!run.libraryAgentCommandExecutor)
        throw new Error("资料库读取服务不可用。");
      const command = CommandEnvelopeSchema.parse(
        createEnvelope(
          "catalog.readLibraryAgentLibrary",
          {
            domain: input.workspace.domain,
            libraryId: id
          },
          {
            id: `library-agent:${run.runId}:${id}`,
            context: { sessionId: run.sessionId, runId: run.runId }
          }
        )
      ) as Parameters<LibraryAgentCommandExecutor>[0];
      const result = await run.libraryAgentCommandExecutor(command, signal);
      if (result.status !== "accepted") throw new Error(result.error.message);
      const workspace = LibraryAgentWorkspaceSnapshotSchema.parse(
        result.payload
      );
      if (
        workspace.domain !== input.workspace.domain ||
        workspace.libraryId !== id
      )
        throw new Error("资料库读取结果与请求不符。");
      return workspace;
    }
  });
  return [
    ...tools.map((tool) => wrapUnboundCreation(tool, input, structure.propose)),
    ...structure.tools
  ];
}

/** Shared wrapper for library pages and the work's explicitly enabled management tools. */
export function buildIndexedLibraryTools(
  input: BuildLibraryAgentToolsInput,
  options: {
    index?: readonly (Pick<
      LibraryAgentReadableLibrary,
      "libraryId" | "title" | "readOnly"
    > &
      Partial<LibraryAgentReadableLibrary>)[];
    preload?: boolean;
    requireLibraryId?: boolean;
    load: (
      id: string,
      signal?: AbortSignal
    ) => Promise<LibraryAgentWorkspaceSnapshot>;
  }
): AgentTool[] {
  const focus = input.workspace;
  const index = options.index ??
    focus.readableLibraries ?? [
      {
        libraryId: focus.libraryId,
        title: focus.title,
        kind: focus.kind,
        readOnly: focus.readOnly,
        entryCount: focus.entries.length
      }
    ];
  const states = new Map<string, AgentTool[]>();
  const current = buildLibraryAgentTools({
    ...input,
    workspace: LibraryAgentWorkspaceSnapshotSchema.parse({
      ...focus,
      readableLibraries: undefined,
      entries: focus.entries.filter(
        (entry) =>
          !entry.sourceLibraryId || entry.sourceLibraryId === focus.libraryId
      )
    })
  });
  if (options.preload !== false) states.set(focus.libraryId, current);
  async function load(id: string, signal?: AbortSignal) {
    if (!index.some((library) => library.libraryId === id))
      throw new Error("库不存在或不属于本领域。");
    const cached = states.get(id);
    if (cached) return cached;
    const workspace = await options.load(id, signal);
    if (workspace.domain !== focus.domain || workspace.libraryId !== id)
      throw new Error("资料库读取结果与请求不符。");
    const tools = buildLibraryAgentTools({
      ...input,
      workspace,
      sharedState: reconcileLibraryToolState(workspace)
    });
    states.set(id, tools);
    return tools;
  }
  // Build the complete manifest even when the focus is a built-in read-only library.
  const manifest = buildLibraryAgentTools({
    ...input,
    workspace: { ...focus, readOnly: false }
  });
  return manifest.map((tool) => {
    if (tool.name === "load_skill") return tool;
    const schema = tool.parameters as ReturnType<typeof Type.Object>;
    const parameters = Type.Object(
      {
        ...schema.properties,
        ...(schema.properties.stage_id
          ? {
              stage_id: tool.name.startsWith("create_")
                ? StringEnum(
                    focus.domain === "material"
                      ? MATERIAL_STAGE_IDS
                      : SKILL_STAGE_IDS
                  )
                : Type.Optional(Type.String())
            }
          : {}),
        library_id: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 512,
            description: options.requireLibraryId
              ? "目标绑定库 id，必须明确指定。"
              : "目标库 id；缺省为当前位置。"
          })
        )
      },
      {
        required: [
          ...(schema.required?.filter((name) => name !== "library_id") ?? []),
          ...(options.requireLibraryId ? ["library_id"] : [])
        ]
      }
    );
    return {
      ...tool,
      parameters,
      ...piStrictToolSampling(parameters),
      description: `${tool.description} ${options.requireLibraryId ? "library_id 必须指定索引中的绑定库" : "library_id 缺省为当前位置，可指定本领域其它库"}，内置技能库只读${tool.name.startsWith("search_") ? "；搜索缺省范围为本轮已加载的库" : ""}。`,
      executionMode: "sequential",
      execute: async (callId, rawParams, signal, onUpdate) => {
        const params = rawParams as Record<string, unknown>;
        try {
          if (options.requireLibraryId && !params.library_id)
            throw new Error("请先确定目标资料库并传入 library_id。");
          const id = String(params.library_id ?? focus.libraryId);
          const targets =
            tool.name.startsWith("search_") && !params.library_id
              ? [
                  ...new Set([
                    ...states.keys(),
                    ...focus.entries.flatMap((entry) =>
                      entry.sourceLibraryId ? [entry.sourceLibraryId] : []
                    )
                  ])
                ]
              : [id];
          const results = [];
          for (const target of targets) {
            const tools = await load(target, signal);
            const selected = tools.find((item) => item.name === tool.name);
            if (!selected)
              return textResult("目标资料库只读，不能创建或修改。");
            const localParams = { ...params };
            delete localParams.library_id;
            const result = await selected.execute(
              callId,
              localParams,
              signal,
              onUpdate
            );
            results.push(result);
          }
          if (tool.name.startsWith("list_")) {
            const listing = index
              .map(
                (library) =>
                  `${library.title}｜id=${library.libraryId}｜${library.kind ? `${library.kind}｜` : ""}${library.entryCount === undefined ? "" : `${library.entryCount} 条｜`}${library.readOnly ? "只读" : "可写"}`
              )
              .join("\n");
            return textResult(
              `【分组索引】\n${JSON.stringify(input.workspace.libraryGroups ?? [])}\n【全库索引】\n${listing}\n\n` +
                results
                  .flatMap((result) =>
                    result.content
                      .filter((item) => item.type === "text")
                      .map((item) => item.text)
                  )
                  .join("\n")
            );
          }
          if (results.length === 1) return results[0]!;
          return textResult(
            results
              .flatMap((result) =>
                result.content
                  .filter((item) => item.type === "text")
                  .map((item) => item.text)
              )
              .join("\n\n")
          );
        } catch (error) {
          return textResult(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    } satisfies AgentTool;
  });
}
