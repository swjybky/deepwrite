import { createId } from "@deepwrite/shared";
import {
  CommandEnvelopeSchema,
  MATERIAL_KINDS,
  MYSTERY_AGENT_DEFAULT_MATERIAL_KINDS,
  MaterialQueryResultSchema,
  MaterialReadScopeSchema,
  createEnvelope,
  type AcademicAgentProfile,
  type CommandEnvelope,
  type CommandResult,
  type LongAgentProfile,
  type MaterialReadScope,
  type MysteryAgentProfile,
  type ShortWorkspaceAgentProfile,
  type ScriptWorkspaceAgentProfile,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

interface MaterialRunInput {
  workspaceContext?: WorkspaceRuntimeContext | undefined;
  agentProfile?: ShortWorkspaceAgentProfile | ScriptWorkspaceAgentProfile;
  longAgentProfile?: LongAgentProfile;
  academicAgentProfile?: AcademicAgentProfile;
  mysteryAgentProfile?: MysteryAgentProfile;
  snapshotMode?: boolean;
}

export function resolveMaterialReadScope(
  input: MaterialRunInput
): MaterialReadScope | undefined {
  const workspace = input.workspaceContext;
  if (workspace?.longWorkspace && input.longAgentProfile) {
    return MaterialReadScopeSchema.parse({
      bookId: workspace.longWorkspace.bookId,
      bookType: "long",
      stageId: workspace.longWorkspace.activeRoot,
      kinds: [...MATERIAL_KINDS]
    });
  }
  if (workspace?.academicWorkspace && input.academicAgentProfile) {
    return MaterialReadScopeSchema.parse({
      bookId: workspace.academicWorkspace.id,
      bookType: "academic",
      stageId: (
        workspace.academicWorkspace.activeTarget?.targetId ?? "thesis_overview"
      ).slice(0, 120),
      kinds: [...MATERIAL_KINDS]
    });
  }
  if (workspace?.mysteryWorkspace && input.mysteryAgentProfile) {
    return MaterialReadScopeSchema.parse({
      bookId: workspace.mysteryWorkspace.bookId,
      bookType: "mystery",
      stageId: workspace.mysteryWorkspace.focus.stage,
      kinds: [...MYSTERY_AGENT_DEFAULT_MATERIAL_KINDS]
    });
  }
  const writing = workspace?.scriptWorkspace ?? workspace?.shortWorkspace;
  if (!writing || !input.agentProfile) return undefined;
  return MaterialReadScopeSchema.parse({
    bookId: writing.id,
    bookType: workspace?.scriptWorkspace ? "script" : "short",
    stageId: writing.activeStageId,
    kinds: [...MATERIAL_KINDS]
  });
}

/** Replaces any Renderer-supplied catalog with a Core projection under Main's scope. */
export async function prepareMaterialRunContext(
  input: MaterialRunInput,
  request: (command: CommandEnvelope) => Promise<CommandResult>
): Promise<WorkspaceRuntimeContext | undefined> {
  const scope = resolveMaterialReadScope(input);
  if (!scope || !input.workspaceContext) return input.workspaceContext;
  const query = async (mode: "list" | "read", entry_id?: string) => {
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.queryMaterials",
        { scope, mode, limit: 64, ...(entry_id ? { entry_id } : {}) },
        { id: createId("material-query") }
      )
    );
    const result = await request(command);
    if (result.status !== "accepted") throw new Error(result.error.message);
    return MaterialQueryResultSchema.parse(result.payload);
  };
  const listed = await query("list");
  if (!input.snapshotMode) {
    return {
      ...input.workspaceContext,
      attachedMaterials: [],
      materialCatalog: {
        scope,
        entries: listed.entries,
        total: listed.total,
        ...(listed.nextCursor !== undefined
          ? { nextCursor: listed.nextCursor }
          : {}),
        notices: listed.notices
      }
    };
  }
  const attachedMaterials: NonNullable<
    WorkspaceRuntimeContext["attachedMaterials"]
  > = [];
  for (const entry of listed.entries) {
    const result = await query("read", entry.id);
    if (result.status !== "ok" || result.content === undefined) continue;
    const marker = "\n\n[DeepWrite：素材超过附件容量，内容已截断。]";
    const content =
      result.content.length > 100_000
        ? result.content.slice(0, 100_000 - marker.length) + marker
        : result.content;
    attachedMaterials.push({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      metadata: result.entries[0]!.metadata,
      source: "attached-material",
      content
    });
  }
  const { materialCatalog: _catalog, ...workspace } = input.workspaceContext;
  return {
    ...workspace,
    attachedMaterials,
    materialReadNotice:
      listed.total > attachedMaterials.length
        ? `当前使用素材附件快照，已附加 ${attachedMaterials.length} / ${listed.total} 条；超出容量的条目本轮不可读取。`
        : "当前使用素材附件快照。"
  };
}
