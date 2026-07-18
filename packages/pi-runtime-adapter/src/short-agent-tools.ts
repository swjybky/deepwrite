import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import {
  SHORT_MATERIAL_KINDS,
  SHORT_SKILL_KINDS,
  SHORT_WORKSPACE_STAGE_IDS,
  createShortWorkspaceContentRevision,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId,
  type WorkspaceRuntimeContext
} from "@deepwrite/contracts";

export type ShortWorkspaceToolDetails =
  | { kind: "none" }
  | {
      kind: "workspace-editor-mutation";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
      text: string;
      baseRevision: string;
      summary: string;
    }
  | {
      kind: "workspace-stage-selection";
      workspaceId: string;
      stageId: ShortWorkspaceStageId;
    };

export interface BuildShortWorkspaceToolsInput {
  workspace: ShortWorkspaceSnapshot;
  profile: ShortWorkspaceAgentProfile;
  attachedSkills?: WorkspaceRuntimeContext["attachedSkills"];
  attachedMaterials?: WorkspaceRuntimeContext["attachedMaterials"];
}

export const SHORT_WORKSPACE_TOOL_MANIFEST = {
  standard: [
    "read_workspace_content",
    "search_workspace_text",
    "query_linked_material_entries",
    "load_skill",
    "write_workspace_editor",
    "replace_current_stage_text"
  ],
  plot: ["switch_storyline_stage"],
  coordinator: [
    "initialize_expert_draft",
    "edit_expert_draft_section",
    "write_single_expert_section",
    "start_expert_writing"
  ],
  sectionWriter: [
    "read_expert_draft_section",
    "replace_section_body_text",
    "write_section_body",
    "replace_character_state_text",
    "write_character_state"
  ]
} as const;

function textResult(
  text: string,
  details: ShortWorkspaceToolDetails = { kind: "none" }
): AgentToolResult<ShortWorkspaceToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function literalUnion<T extends string>(values: readonly T[]) {
  if (values.length === 1) {
    return Type.Literal(values[0]!);
  }
  return Type.Union(values.map((value) => Type.Literal(value)));
}

function primitiveTypeOf(value: unknown): string | undefined {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "boolean") return "boolean";
  return undefined;
}

function sanitizeToolSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeToolSchemaForGemini(item));
  }
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(input)) {
    output[key] = sanitizeToolSchemaForGemini(child);
  }

  for (const unionKey of ["anyOf", "oneOf"]) {
    const union = output[unionKey];
    if (!Array.isArray(union) || union.length === 0) continue;
    const branches = union as Array<Record<string, unknown>>;
    if (
      branches.every(
        (branch) =>
          branch &&
          typeof branch === "object" &&
          Object.prototype.hasOwnProperty.call(branch, "const")
      )
    ) {
      const values = branches.map((branch) => branch.const);
      delete output[unionKey];
      output.enum = values;
      if (!output.type) {
        const types = [...new Set(values.map(primitiveTypeOf).filter(Boolean))];
        if (types.length === 1) output.type = types[0];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(output, "const")) {
    output.enum = [output.const];
    if (!output.type) output.type = primitiveTypeOf(output.const);
    delete output.const;
  }
  return output;
}

function defineTool<T extends ReturnType<typeof Type.Object>>(definition: {
  name: string;
  label: string;
  description: string;
  parameters: T;
  execute: (
    toolCallId: string,
    params: Static<T>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<ShortWorkspaceToolDetails>>;
  executionMode?: AgentTool["executionMode"];
}): AgentTool<T, ShortWorkspaceToolDetails> {
  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    parameters: sanitizeToolSchemaForGemini(definition.parameters) as T,
    execute: definition.execute,
    ...(definition.executionMode ? { executionMode: definition.executionMode } : {})
  };
}

function stageLabel(stageId: ShortWorkspaceStageId): string {
  const labels: Record<ShortWorkspaceStageId, string> = {
    character_design: "人物",
    plot_design: "剧情设计",
    intro_design: "导语设计",
    plot_refine: "剧情细化",
    outline: "大纲",
    draft: "正文"
  };
  return labels[stageId];
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const prefix = text.slice(0, index);
  const lines = prefix.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function replaceText(
  current: string,
  replacements: Array<{ original_text: string; new_text: string }>
): { next?: string; count: number; error?: string } {
  let next = current;
  let count = 0;
  for (const replacement of replacements) {
    const original = replacement.original_text;
    if (!original) {
      return { count, error: "original_text 不能为空。" };
    }
    const first = next.indexOf(original);
    if (first < 0) {
      return { count, error: `没有找到原文片段：${original.slice(0, 80)}` };
    }
    if (next.indexOf(original, first + original.length) >= 0) {
      return { count, error: `原文片段出现多次，请提供更长且唯一的上下文：${original.slice(0, 80)}` };
    }
    next = `${next.slice(0, first)}${replacement.new_text}${next.slice(first + original.length)}`;
    count += 1;
  }
  return { next, count };
}

function writableStageIds(profile: ShortWorkspaceAgentProfile): ShortWorkspaceStageId[] {
  if (profile.id === "character_design") return ["character_design"];
  if (profile.id === "plot_design") {
    return ["plot_design", "intro_design", "plot_refine"];
  }
  if (profile.id === "outline") return ["outline"];
  return ["draft"];
}

function buildReadWorkspaceContentTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>
): AgentTool {
  const allowed = input.profile.readAccess.workspace;
  return defineTool({
    name: "read_workspace_content",
    label: "读取工作区内容",
    description: `读取当前短篇某一阶段的实时快照。仅允许：${allowed
      .map((stageId) => `${stageLabel(stageId)}(${stageId})`)
      .join("、")}。每次只读取一个阶段。`,
    parameters: Type.Object({ stage_id: literalUnion(allowed) }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.stage_id) as ShortWorkspaceStageId;
      if (!allowed.includes(stageId)) {
        return textResult(`当前智能体不允许读取「${stageLabel(stageId)}」。`);
      }
      const body = stageBodies.get(stageId) ?? "";
      const snapshot = input.workspace.stages.find((stage) => stage.stageId === stageId);
      const truncationNote = snapshot?.truncated
        ? `\n注意：本轮只提供前 ${body.length.toLocaleString("zh-CN")} 个字符，原文共 ${snapshot.originalLength?.toLocaleString("zh-CN") ?? "更多"} 个字符。`
        : "";
      return textResult(
        `书名：《${input.workspace.title}》\n【${stageLabel(stageId)}】（${stageId}）\n本轮可读字数：${body.replace(/\s/g, "").length}${truncationNote}\n\n${body || "该阶段当前文本为空。"}`
      );
    }
  });
}

function buildSearchWorkspaceTextTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>
): AgentTool {
  const allowed = input.profile.readAccess.workspace;
  return defineTool({
    name: "search_workspace_text",
    label: "搜索工作区文本",
    description:
      "在当前智能体可读的短篇阶段中按原文搜索，只返回命中位置和少量上下文；局部替换前可先用它定位准确原文。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 600 }),
      stage_id: Type.Optional(literalUnion(allowed)),
      max_matches: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      context_chars: Type.Optional(Type.Integer({ minimum: 10, maximum: 300 }))
    }),
    execute: async (_toolCallId, params) => {
      const query = String(params.query ?? "");
      const selected = params.stage_id
        ? [String(params.stage_id) as ShortWorkspaceStageId]
        : allowed;
      const maxMatches = Math.min(50, Math.max(1, Number(params.max_matches ?? 10)));
      const contextChars = Math.min(300, Math.max(10, Number(params.context_chars ?? 60)));
      const matches: string[] = [];
      for (const stageId of selected) {
        if (!allowed.includes(stageId)) continue;
        const body = stageBodies.get(stageId) ?? "";
        let cursor = 0;
        while (matches.length < maxMatches) {
          const index = body.indexOf(query, cursor);
          if (index < 0) break;
          const { line, column } = lineColumnAt(body, index);
          const start = Math.max(0, index - contextChars);
          const end = Math.min(body.length, index + query.length + contextChars);
          matches.push(
            `${stageLabel(stageId)}(${stageId}) ${line}:${column} ${start > 0 ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}`
          );
          cursor = index + Math.max(1, query.length);
        }
      }
      const truncatedLabels = selected
        .filter((stageId) =>
          input.workspace.stages.some(
            (stage) => stage.stageId === stageId && stage.truncated
          )
        )
        .map(stageLabel);
      const truncationNote = truncatedLabels.length
        ? `\n\n注意：${truncatedLabels.join("、")}仅搜索了本轮可见的前段快照，不能据此判断全文无匹配。`
        : "";
      return textResult(
        matches.length
          ? `${matches.join("\n\n")}${truncationNote}`
          : truncatedLabels.length
            ? `本轮可见快照中没有找到匹配文本。${truncationNote}`
            : "没有找到匹配文本。"
      );
    }
  });
}

function buildQueryLinkedMaterialEntriesTool(
  input: BuildShortWorkspaceToolsInput
): AgentTool {
  const allowedKinds = input.profile.readAccess.material;
  return defineTool({
    name: "query_linked_material_entries",
    label: "查询关联素材条目",
    description:
      "列出、搜索或读取本轮显式附加且位于当前智能体读取范围内的素材。未显式附加的素材不会被读取。",
    parameters: Type.Object({
      mode: Type.Union([Type.Literal("list"), Type.Literal("search"), Type.Literal("read")]),
      query: Type.Optional(Type.String({ maxLength: 300 })),
      entry_name: Type.Optional(Type.String({ maxLength: 240 })),
      material_kind: Type.Optional(literalUnion(allowedKinds.length ? allowedKinds : SHORT_MATERIAL_KINDS))
    }),
    execute: async (_toolCallId, params) => {
      const items = (input.attachedMaterials ?? []).filter(
        (item) => item.kind !== undefined && allowedKinds.includes(item.kind)
      );
      const kind = params.material_kind ? String(params.material_kind) : "";
      const scoped = kind ? items.filter((item) => item.kind === kind) : items;
      if (params.mode === "read") {
        const name = String(params.entry_name ?? params.query ?? "").trim();
        const found = scoped.find((item) => item.title === name);
        return textResult(
          found
            ? `【${found.title}】${found.kind ? `（${found.kind}）` : ""}\n\n${found.content}`
            : "没有找到同名的已附加素材条目。"
        );
      }
      if (params.mode === "search") {
        const query = String(params.query ?? "").trim();
        const found = scoped.filter(
          (item) => item.title.includes(query) || item.content.includes(query)
        );
        return textResult(
          found.length
            ? found
                .map((item) => `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}: ${item.content.slice(0, 220)}`)
                .join("\n")
            : "已附加素材中没有匹配条目。"
        );
      }
      return textResult(
        scoped.length
          ? scoped.map((item) => `- ${item.title}${item.kind ? ` [${item.kind}]` : ""}`).join("\n")
          : "本轮没有附加当前智能体可读的素材。"
      );
    }
  });
}

function buildLoadSkillTool(input: BuildShortWorkspaceToolsInput): AgentTool {
  const allowedKinds = input.profile.readAccess.skill;
  return defineTool({
    name: "load_skill",
    label: "加载技能",
    description:
      "按名称加载本轮显式附加、且属于当前智能体读取范围的技能正文。技能是方法，不会自动成为作品事实。",
    parameters: Type.Object({ name: Type.String({ minLength: 1, maxLength: 240 }) }),
    execute: async (_toolCallId, params) => {
      const name = String(params.name ?? "").trim();
      const found = (input.attachedSkills ?? []).find(
        (item) =>
          item.title === name &&
          item.kind !== undefined &&
          allowedKinds.includes(item.kind)
      );
      return textResult(
        found ? `【技能：${found.title}】\n\n${found.content}` : "没有找到可读取的同名已附加技能。"
      );
    }
  });
}

function buildSwitchStorylineStageTool(
  input: BuildShortWorkspaceToolsInput,
  selectStage: (stageId: ShortWorkspaceStageId) => void
): AgentTool {
  const plotStages = ["plot_design", "intro_design", "plot_refine"] as const;
  return defineTool({
    name: "switch_storyline_stage",
    label: "切换剧情方向",
    description: "切换短篇剧情父节点下的当前子方向；只改变选中项，不写入内容。",
    parameters: Type.Object({ target_stage_id: literalUnion(plotStages) }),
    execute: async (_toolCallId, params) => {
      const stageId = String(params.target_stage_id) as (typeof plotStages)[number];
      selectStage(stageId);
      return textResult(`已切换到「${stageLabel(stageId)}」。`, {
        kind: "workspace-stage-selection",
        workspaceId: input.workspace.id,
        stageId
      });
    },
    executionMode: "sequential"
  });
}

function editorMutationResult(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  stageId: ShortWorkspaceStageId,
  text: string,
  summary: string
): AgentToolResult<ShortWorkspaceToolDetails> {
  const baseRevision = stageRevisions.get(stageId);
  if (!baseRevision) {
    return textResult(`未写入：缺少「${stageLabel(stageId)}」的基础版本标识。`);
  }
  stageBodies.set(stageId, text);
  stageRevisions.set(stageId, createShortWorkspaceContentRevision(text));
  return textResult(summary, {
    kind: "workspace-editor-mutation",
    workspaceId: input.workspace.id,
    stageId,
    text,
    baseRevision,
    summary
  });
}

function buildWriteWorkspaceEditorTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  currentStage: () => ShortWorkspaceStageId
): AgentTool {
  const allowedTargets: ShortWorkspaceStageId[] = writableStageIds(input.profile).filter(
    (stageId) => stageId !== "draft"
  );
  return defineTool({
    name: "write_workspace_editor",
    label: "写入当前文本编辑框",
    description:
      "覆盖目标阶段全文。仅用于空白阶段或用户明确要求整体重写；局部修改必须使用 replace_current_stage_text。",
    parameters: Type.Object({
      target_stage_id: Type.Optional(literalUnion(allowedTargets)),
      text: Type.String({ minLength: 1, maxLength: 200_000 }),
      allow_overwrite_existing: Type.Optional(Type.Boolean()),
      mode: Type.Literal("replace")
    }),
    execute: async (_toolCallId, params) => {
      const fallback = allowedTargets.includes(currentStage())
        ? currentStage()
        : allowedTargets[0]!;
      const stageId = params.target_stage_id
        ? (String(params.target_stage_id) as ShortWorkspaceStageId)
        : fallback;
      const snapshot = input.workspace.stages.find(
        (stage) => stage.stageId === stageId
      );
      if (snapshot?.truncated) {
        return textResult(
          `未写入：「${stageLabel(stageId)}」超过本轮安全快照上限，无法在看不到全文尾部时覆盖阶段内容。`
        );
      }
      const current = stageBodies.get(stageId) ?? "";
      if (current.trim() && params.allow_overwrite_existing !== true) {
        return textResult(
          `「${stageLabel(stageId)}」已有内容。局部修改请使用 replace_current_stage_text；整体重写需明确设置 allow_overwrite_existing=true。`
        );
      }
      const text = String(params.text ?? "").trim();
      if (!text) return textResult("未写入：文本为空。");
      return editorMutationResult(
        input,
        stageBodies,
        stageRevisions,
        stageId,
        text,
        `已用新内容覆盖「${stageLabel(stageId)}」编辑区。`
      );
    },
    executionMode: "sequential"
  });
}

function buildReplaceStageTextTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>,
  currentStage: () => ShortWorkspaceStageId,
  options: { name?: string; label?: string } = {}
): AgentTool {
  const allowedTargets = writableStageIds(input.profile);
  return defineTool({
    name: options.name ?? "replace_current_stage_text",
    label: options.label ?? "替换当前阶段文本",
    description:
      "按原文片段精确替换当前智能体可写阶段的内容。每个 original_text 必须在目标文本中唯一存在。",
    parameters: Type.Object({
      target_stage_id: Type.Optional(literalUnion(allowedTargets)),
      replacements: Type.Array(
        Type.Object({
          original_text: Type.String({ minLength: 1, maxLength: 2_400 }),
          new_text: Type.String({ maxLength: 20_000 })
        }),
        { minItems: 1, maxItems: 20 }
      )
    }),
    execute: async (_toolCallId, params) => {
      const fallback = allowedTargets.includes(currentStage())
        ? currentStage()
        : allowedTargets[0]!;
      const stageId = params.target_stage_id
        ? (String(params.target_stage_id) as ShortWorkspaceStageId)
        : fallback;
      const snapshot = input.workspace.stages.find(
        (stage) => stage.stageId === stageId
      );
      if (snapshot?.truncated) {
        return textResult(
          `未替换：「${stageLabel(stageId)}」超过本轮安全快照上限，无法在看不到全文尾部时执行局部替换。请缩小文稿或等待后续持久化编辑接口。`
        );
      }
      const replacements = params.replacements as Array<{
        original_text: string;
        new_text: string;
      }>;
      const result = replaceText(stageBodies.get(stageId) ?? "", replacements);
      if (result.error || result.next === undefined) {
        return textResult(`未替换：${result.error ?? "未知错误"}`);
      }
      return editorMutationResult(
        input,
        stageBodies,
        stageRevisions,
        stageId,
        result.next,
        `已替换「${stageLabel(stageId)}」编辑区 ${result.count} 个片段。`
      );
    },
    executionMode: "sequential"
  });
}

function buildInitializeExpertDraftTool(
  input: BuildShortWorkspaceToolsInput,
  stageBodies: Map<ShortWorkspaceStageId, string>,
  stageRevisions: Map<ShortWorkspaceStageId, string>
): AgentTool {
  return defineTool({
    name: "initialize_expert_draft",
    label: "初始化正文",
    description:
      "根据大纲初始化正文小节骨架。当前 DeepWrite 迁移切片先建立可编辑合并正文；后台分节写手调度将在后续切片接通。",
    parameters: Type.Object({
      sections: Type.Array(
        Type.Object({
          id: Type.Optional(Type.String({ maxLength: 120 })),
          title: Type.String({ minLength: 1, maxLength: 240 }),
          word_count_requirement: Type.Optional(Type.String({ maxLength: 120 })),
          body: Type.Optional(Type.String({ maxLength: 200_000 }))
        }),
        { minItems: 1, maxItems: 100 }
      ),
      allow_overwrite_existing: Type.Optional(Type.Boolean())
    }),
    execute: async (_toolCallId, params) => {
      const current = stageBodies.get("draft") ?? "";
      const snapshot = input.workspace.stages.find(
        (stage) => stage.stageId === "draft"
      );
      if (snapshot?.truncated) {
        return textResult(
          "正文超过本轮安全快照上限，不能在未读取完整正文时重建小节骨架。"
        );
      }
      if (current.trim() && params.allow_overwrite_existing !== true) {
        return textResult("正文已有内容，未重建小节骨架；如需重建必须明确允许覆盖。 ");
      }
      const sections = params.sections as Array<{
        id?: string;
        title: string;
        word_count_requirement?: string;
        body?: string;
      }>;
      const body = sections
        .map((section, index) => {
          const meta = section.word_count_requirement?.trim()
            ? `\n> 字数要求：${section.word_count_requirement.trim()}\n`
            : "";
          return `## ${section.title.trim() || `第${index + 1}节`}\n${meta}\n${section.body?.trim() ?? ""}`;
        })
        .join("\n\n");
      return editorMutationResult(
        input,
        stageBodies,
        stageRevisions,
        "draft",
        body,
        `已初始化 ${sections.length} 个正文小节骨架。`
      );
    },
    executionMode: "sequential"
  });
}

export function buildShortWorkspaceTools(
  input: BuildShortWorkspaceToolsInput
): AgentTool[] {
  const stageBodies = new Map<ShortWorkspaceStageId, string>(
    input.workspace.stages.map((stage) => [stage.stageId, stage.content])
  );
  const stageRevisions = new Map<ShortWorkspaceStageId, string>(
    input.workspace.stages.map((stage) => [stage.stageId, stage.revision])
  );
  let activeStageId = input.workspace.activeStageId;
  const readTools = [
    buildReadWorkspaceContentTool(input, stageBodies),
    buildSearchWorkspaceTextTool(input, stageBodies),
    buildQueryLinkedMaterialEntriesTool(input),
    buildLoadSkillTool(input)
  ];

  if (input.profile.id === "expert_draft_coordinator") {
    return [
      ...readTools,
      buildInitializeExpertDraftTool(input, stageBodies, stageRevisions),
      buildReplaceStageTextTool(input, stageBodies, stageRevisions, () => "draft", {
        name: "edit_expert_draft_section",
        label: "编辑正文"
      })
    ];
  }

  if (input.profile.id === "expert_section_writer") {
    return [
      ...readTools,
      buildReplaceStageTextTool(input, stageBodies, stageRevisions, () => "draft", {
        name: "replace_section_body_text",
        label: "替换正文片段"
      })
    ];
  }

  const tools = [...readTools];
  if (input.profile.id === "plot_design") {
    tools.push(
      buildSwitchStorylineStageTool(input, (stageId) => {
        activeStageId = stageId;
      })
    );
  }
  tools.push(
    buildWriteWorkspaceEditorTool(input, stageBodies, stageRevisions, () => activeStageId),
    buildReplaceStageTextTool(input, stageBodies, stageRevisions, () => activeStageId)
  );
  return tools;
}

export function isShortWorkspaceToolDetails(
  value: unknown
): value is ShortWorkspaceToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "workspace-editor-mutation" ||
    kind === "workspace-stage-selection"
  );
}

export function assertKnownShortWorkspaceStage(stageId: string): ShortWorkspaceStageId {
  if (!SHORT_WORKSPACE_STAGE_IDS.includes(stageId as ShortWorkspaceStageId)) {
    throw new Error(`Unknown short workspace stage: ${stageId}`);
  }
  return stageId as ShortWorkspaceStageId;
}

export function isKnownShortMaterialKind(kind: string): boolean {
  return SHORT_MATERIAL_KINDS.includes(kind as (typeof SHORT_MATERIAL_KINDS)[number]);
}

export function isKnownShortSkillKind(kind: string): boolean {
  return SHORT_SKILL_KINDS.includes(kind as (typeof SHORT_SKILL_KINDS)[number]);
}
